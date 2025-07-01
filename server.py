from dotenv import load_dotenv
import os
from neo4j import GraphDatabase
import motor.motor_asyncio
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from scrapers.news.scraper_router import scrape_article


load_dotenv()


URI = os.getenv("NEO4J_URI")
AUTH = (os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD"))
MONGO_URI = os.getenv("MONGO_URI")

# Neo4j connection
with GraphDatabase.driver(URI, auth=AUTH) as driver:
    driver.verify_connectivity()
    print("Neo4j connection verified.")

# MongoDB connection
mongo_client = None
mongo_db = None
articles_collection = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup database connections"""
    global mongo_client, mongo_db, articles_collection
    
    # Startup: Initialize MongoDB connection
    try:
        print("Connecting to MongoDB...")
        # Add SSL parameters for Atlas connection
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(
            MONGO_URI,
            tls=True,
            tlsAllowInvalidCertificates=False
        )
        mongo_db = mongo_client["jachaikori"]
        articles_collection = mongo_db["articles"]
        # Test connection
        await mongo_client.admin.command('ping')
        print("MongoDB connection verified.")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")
        mongo_client = None
        mongo_db = None
        articles_collection = None
    
    yield
    
    # Shutdown: Clean up MongoDB connection
    if mongo_client:
        mongo_client.close()
        print("MongoDB connection closed.")

app = FastAPI(lifespan=lifespan)

@app.get("/scrape")
async def scrape(url: str):
    try:
        article = scrape_article(url)
        
        # Save to MongoDB if connection is available
        if articles_collection is not None:
            try:
                # Check if article with same URL already exists
                existing_article = await articles_collection.find_one({"url": url})
                
                if existing_article:
                    print(f"Article with URL {url} already exists in database")
                else:
                    # Prepare document for MongoDB
                    article_doc = article.dict()
                    article_doc["scraped_at"] = datetime.utcnow()
                    
                    # Insert into MongoDB
                    result = await articles_collection.insert_one(article_doc)
                    print(f"Article saved to MongoDB with ID: {result.inserted_id}")
                    
            except Exception as db_error:
                print(f"Error saving to MongoDB: {db_error}")
                # Continue with the response even if DB save fails
        else:
            print("MongoDB not available, article not saved to database")
        
        return article.dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scraping error: {str(e)}")

@app.get("/articles")
async def get_articles(limit: int = 10, skip: int = 0):
    """Retrieve articles from MongoDB database"""
    if articles_collection is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Get articles from MongoDB, sorted by scraped_at (newest first)
        cursor = articles_collection.find().sort("scraped_at", -1).skip(skip).limit(limit)
        articles = []
        
        async for doc in cursor:
            # Convert ObjectId to string for JSON serialization
            doc["_id"] = str(doc["_id"])
            articles.append(doc)
        
        return {"articles": articles, "count": len(articles)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/articles/search")
async def search_articles(query: str, limit: int = 10):
    """Search articles by headline or content"""
    if articles_collection is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Search in headline and content fields
        search_filter = {
            "$or": [
                {"headline": {"$regex": query, "$options": "i"}},
                {"content": {"$regex": query, "$options": "i"}}
            ]
        }
        
        cursor = articles_collection.find(search_filter).sort("scraped_at", -1).limit(limit)
        articles = []
        
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            articles.append(doc)
        
        return {"articles": articles, "query": query, "count": len(articles)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)