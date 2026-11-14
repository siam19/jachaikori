from pydantic import BaseModel

class Article(BaseModel):
    url: str
    headline: str
    published_time: str
    content: str