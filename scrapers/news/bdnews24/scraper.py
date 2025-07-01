import requests
from bs4 import BeautifulSoup
from ..models import Article

class BDNews24Scraper:
    def scrape_article(self, url: str) -> Article:
        try:
            response = requests.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            title, subtitle = self._extract_title(soup)
            pub_date = self._extract_pub_date(soup)
            content = self._extract_content(soup)
            
            return Article(
                url=url,
                headline=title,
                published_time=pub_date,
                content=content
            )
        except Exception as e:
            raise ValueError(f"BDNews24 scraping failed: {str(e)}")

    def _extract_title(self, soup):
        title_div = soup.find('div', class_="details-title")
        title = title_div.find('h1').get_text().strip() if title_div else ""
        subtitle = title_div.find('p').get_text().strip() if title_div else ""
        return title, subtitle

    def _extract_pub_date(self, soup):
        pub_div = soup.find('div', class_="pub-up")
        return pub_div.find('span').get_text().strip() if pub_div else ""

    def _extract_content(self, soup):
        content_div = soup.find(id="contentDetails")
        paragraphs = content_div.find_all('p') if content_div else []
        return "\n\n".join(p.get_text().strip() for p in paragraphs)