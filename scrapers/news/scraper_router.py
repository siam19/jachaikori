from .models import Article
from .bdnews24.scraper import BDNews24Scraper
from .ittefaq.scraper import scrape_article as scrape_ittefaq
from .tbs.scraper import scrape_article as scrape_tbs

def scrape_article(url: str) -> Article:
    if "bdnews24.com" in url:
        return BDNews24Scraper().scrape_article(url)
    elif "en.ittefaq.com.bd" in url:
        return scrape_ittefaq(url)
    elif "tbsnews.net" in url:
        return scrape_tbs(url)
    raise ValueError("Unsupported website URL")