from dotenv import load_dotenv
import os
from neo4j import GraphDatabase

from fastapi import FastAPI, HTTPException
from scraper.news.scraper_router import scrape_article


load_dotenv()


URI = os.getenv("NEO4J_URI")
AUTH = (os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD"))

with GraphDatabase.driver(URI, auth=AUTH) as driver:
    driver.verify_connectivity()
    print("Neo4j connection verified.")

app = FastAPI()

@app.get("/scrape")
async def scrape(url: str):
    try:
        article = scrape_article(url)
        return article.dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scraping error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)