import requests
from bs4 import BeautifulSoup
import os
import re
from urllib.parse import urlparse
import time
import glob

class ArticleScraper:
    def __init__(self):
        self.website_name = "bdnews24"
    
    def scrape_article(self, url, output_file=None):
        """
        Scrapes the given URL for title, subtitle, publication date and article content
        and saves the text to a markdown file.
        
        Args:
            url (str): The URL to scrape
            output_file (str, optional): Path to save the output. If None, generates a filename based on the URL.
        
        Returns:
            str: Path to the saved file or markdown content if no output_file
        """
        try:
            response = requests.get(url)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching URL {url}: {e}")
            return None
        
        soup = BeautifulSoup(response.text, 'html.parser')
        title, subtitle = self._extract_title(soup)
        pub_date = self._extract_pub_date(soup)
        content = self._extract_content(soup)
        
        if content is None:
            return None
        
        markdown_content = self._generate_markdown(title, subtitle, pub_date, url, content)
        
        if output_file:
            return self._save_to_file(output_file, markdown_content)
        return markdown_content

    def _extract_title(self, soup):
        title = subtitle = ""
        title_div = soup.find('div', class_="details-title")
        if title_div:
            title_element = title_div.find('h1')
            if title_element:
                title = title_element.get_text().strip()
            
            subtitle_element = title_div.find('p', class_=lambda x: x != "shoulder-text")
            if subtitle_element:
                subtitle = subtitle_element.get_text().strip()
        return title, subtitle

    def _extract_pub_date(self, soup):
        pub_date = ""
        pub_div = soup.find('div', class_="pub-up")
        if pub_div:
            date_span = pub_div.find('span', string=lambda t: t and 'Published' not in t)
            if date_span:
                pub_date = date_span.get_text().strip()
        return pub_date

    def _extract_content(self, soup):
        content_div = soup.find(id="contentDetails")
        if not content_div:
            print("No content found")
            return None
        
        paragraphs = content_div.find_all('p')
        if not paragraphs:
            print("No paragraphs found")
            return None
        
        return [p.get_text().strip() for p in paragraphs]

    def _generate_markdown(self, title, subtitle, pub_date, url, content_paragraphs):
        markdown = f"# {title}\n\n"
        if subtitle:
            markdown += f"*{subtitle}*\n\n"
        if pub_date:
            markdown += f"**Published: {pub_date}**\n\n"
        markdown += f"**Source:** [{url}]({url})\n\n---\n\n"
        markdown += "\n\n".join(p for p in content_paragraphs if p.strip())
        return markdown

    def _save_to_file(self, output_file, content):
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Article saved to {output_file}")
            return output_file
        except IOError as e:
            print(f"Error saving file: {e}")
            return None

    def extract_url_components(self, url):
        parsed = urlparse(url)
        path_parts = parsed.path.strip('/').split('/')
        return (path_parts[0], path_parts[1]) if len(path_parts) >= 2 else (None, None)

    def process_archive_files(self, archive_dir="bdnews_archive", output_base_dir="."):
        archive_path = os.path.join(output_base_dir, archive_dir)
        archive_files = glob.glob(os.path.join(archive_path, f"{self.website_name}_archive_*.txt"))
        
        if not archive_files:
            print(f"No archive files found in {archive_path}")
            return
        
        print(f"Found {len(archive_files)} archive files to process")
        
        for archive_file in sorted(archive_files):
            date_match = re.search(rf'{self.website_name}_archive_(\d{{4}}-\d{{2}}-\d{{2}})\.txt', 
                                  os.path.basename(archive_file))
            if not date_match:
                print(f"Skipping invalid file: {archive_file}")
                continue
            
            date = date_match.group(1)
            output_dir = os.path.join(output_base_dir, date)
            os.makedirs(output_dir, exist_ok=True)
            
            try:
                with open(archive_file, 'r', encoding='utf-8') as f:
                    urls = [line.strip() for line in f if line.strip()]
                
                print(f"Processing {len(urls)} URLs from {archive_file}")
                
                for i, url in enumerate(urls):
                    category, article_id = self.extract_url_components(url)
                    if not category or not article_id:
                        print(f"Skipping invalid URL: {url}")
                        continue
                    
                    output_file = os.path.join(output_dir, f"{category}.{date}.{article_id}.md")
                    if os.path.exists(output_file):
                        print(f"Skipping existing file: {output_file}")
                        continue
                    
                    self.scrape_article(url, output_file)
                    time.sleep(1)  # Be polite to the server
            
            except Exception as e:
                print(f"Error processing {archive_file}: {e}")

    def run(self):
        print(f"{self.website_name.capitalize()} Article Scraper")
        print("1. Scrape single article\n2. Process archive files")
        choice = input("Choice (1/2): ")
        
        if choice == '1':
            url = input("URL: ")
            output_file = input("Output file (optional): ") or None
            result = self.scrape_article(url, output_file)
            print("Success!" if result else "Failed")
        
        elif choice == '2':
            archive_dir = input(f"Archive dir (default: {self.website_name}_archive): ") or f"{self.website_name}_archive"
            output_dir = input("Output dir (default: current): ") or "."
            self.process_archive_files(archive_dir, output_dir)
            print("Archive processing complete")
        
        else:
            print("Invalid choice")

if __name__ == "__main__":
    scraper = ArticleScraper()
    scraper.scrape_article("https://bangla.bdnews24.com/bangladesh/4da3f9fe38d6", output_file="./artkle.md")
    scraper.run()