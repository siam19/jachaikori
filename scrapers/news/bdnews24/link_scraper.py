from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
import os
import time
import json
import random
from datetime import datetime, timedelta

class LinkScraper:
    def __init__(self, start_date, end_date):
        self.website_name = "bdnews24"
        self.start_date = start_date
        self.end_date = end_date
        self.current_dir = os.path.dirname(os.path.abspath(__file__))
        self.geckodriver_path = os.path.join(self.current_dir, 'geckodriver')
        self.progress_file = os.path.join(self.current_dir, 'scraping_progress.json')
        self.archive_dir = os.path.join(self.current_dir, f'{self.website_name}_archive')
        self.MAX_RETRIES = 7
        self.driver = None
        self.wait = None

    def setup_driver(self):
        service = Service(executable_path=self.geckodriver_path)
        options = Options()
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--no-sandbox")
        driver = webdriver.Firefox(service=service, options=options)
        wait = WebDriverWait(driver, 15)
        return driver, wait

    def save_progress(self, date):
        with open(self.progress_file, 'w') as f:
            json.dump({'last_completed_date': date}, f)
        print(f"Progress saved: {date}")

    def load_progress(self):
        if os.path.exists(self.progress_file):
            with open(self.progress_file, 'r') as f:
                return json.load(f).get('last_completed_date')
        return None

    def extract_links(self, html_content):
        soup = BeautifulSoup(html_content, 'html.parser')
        return [a['href'] for wrapper in soup.find_all('div', class_='SubCat-wrapper') 
                if (a := wrapper.find('a')) and a.has_attr('href')]

    def process_date(self, date):
        print(f"\nProcessing {date}")
        
        if not self.driver:
            self.driver, self.wait = self.setup_driver()
        
        try:
            self.driver.get('https://bangla.bdnews24.com/archive')
            self.wait.until(EC.presence_of_element_located((By.ID, "from_date")))
            
            # Set dates using JavaScript
            js_script = f"""
                document.querySelector("#from_date")._flatpickr.setDate("{date}");
                document.querySelector("#to_date")._flatpickr.setDate("{date}");
            """
            self.driver.execute_script(js_script)
            time.sleep(2)
            
            # Execute search
            search_btn = self.wait.until(EC.element_to_be_clickable((By.ID, "archive_search")))
            search_btn.click()
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "SubCat-wrapper")))
            
            # Load all content
            page_num = 1
            while True:
                try:
                    load_more = WebDriverWait(self.driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, ".load-more-data:not(.d-none)"))
                    )
                    if "d-none" in load_more.find_element(By.XPATH, "./parent::div").get_attribute("class"):
                        break
                    
                    print(f"Loading page {page_num}")
                    self.driver.execute_script("arguments[0].click();", load_more)
                    page_num += 1
                    time.sleep(2 + random.uniform(0.5, 1.5))
                except:
                    break
            
            # Extract and save URLs
            urls = self.extract_links(self.driver.page_source)
            os.makedirs(self.archive_dir, exist_ok=True)
            output_file = os.path.join(self.archive_dir, f'{self.website_name}_archive_{date}.txt')
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write("\n".join(urls))
            
            print(f"Saved {len(urls)} URLs")
            self.save_progress(date)
            return True
        
        except Exception as e:
            print(f"Error processing {date}: {e}")
            return False

    def run(self):
        last_completed = self.load_progress()
        start_date = datetime.strptime(last_completed, "%Y-%m-%d") + timedelta(days=1) if last_completed \
                   else datetime.strptime(self.start_date, "%Y-%m-%d")
        end_date = datetime.strptime(self.end_date, "%Y-%m-%d")
        
        if start_date > end_date:
            print("Date range already processed")
            return
        
        print(f"Starting from {start_date.strftime('%Y-%m-%d')}")
        current_date = start_date
        
        try:
            while current_date <= end_date:
                date_str = current_date.strftime("%Y-%m-%d")
                retries = 0
                success = False
                
                while not success and retries < self.MAX_RETRIES:
                    success = self.process_date(date_str)
                    if not success:
                        retries += 1
                        delay = retries * 10
                        print(f"Retry #{retries} in {delay}s...")
                        time.sleep(delay)
                
                if not success:
                    print(f"Failed to process {date_str} after {self.MAX_RETRIES} attempts")
                
                current_date += timedelta(days=1)
        
        finally:
            if self.driver:
                self.driver.quit()
                print("Browser closed")

if __name__ == "__main__":
    scraper = LinkScraper(start_date="2025-04-05", end_date="2025-04-08")
    scraper.run()