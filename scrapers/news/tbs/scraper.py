import requests
from bs4 import BeautifulSoup
from ...models import Article

def scrape_article(url: str) -> Article:
    try:
        resp = requests.get(url)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        headline_tag = soup.select_one('h1.hide-for-small-only') or soup.find('h1')
        headline = headline_tag.get_text(strip=True) if headline_tag else ""
        
        date_tag = soup.select_one('div.author-section div.date') or soup.select_one('time')
        published_time = date_tag['datetime'] if date_tag and date_tag.get('datetime') else date_tag.get_text(strip=True) if date_tag else ""
        
        content_block = soup.select_one('article div.section-content') or soup.find('article')
        for ad in content_block.select('div.hide-for-print'):
            ad.decompose()
        paragraphs = content_block.find_all('p') if content_block else []
        content = '\n\n'.join(p.get_text(strip=True) for p in paragraphs)
        
        return Article(
            url=url,
            headline=headline,
            published_time=published_time,
            content=content
        )
    except Exception as e:
        raise ValueError(f"TBS scraping failed: {str(e)}")