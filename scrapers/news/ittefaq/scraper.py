import requests
from bs4 import BeautifulSoup
from ..models import Article

def scrape_article(url: str) -> Article:
    try:
        resp = requests.get(url)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        headline_tag = soup.find('h1', class_='title') or soup.find('h1')
        headline = headline_tag.get_text(strip=True) if headline_tag else ""
        
        time_tag = soup.find('span', class_='date') or soup.find('div', class_='time') or soup.find('time')
        published_time = time_tag.get_text(strip=True) if time_tag else ""
        
        content_block = soup.find('div', class_='full-content') or soup.find('div', class_='article-content') or soup.find('article')
        paragraphs = content_block.find_all('p') if content_block else []
        content = '\n\n'.join(p.get_text(strip=True) for p in paragraphs)
        
        return Article(
            url=url,
            headline=headline,
            published_time=published_time,
            content=content
        )
    except Exception as e:
        raise ValueError(f"Ittefaq scraping failed: {str(e)}")