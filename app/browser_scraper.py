# app/browser_scraper.py
import asyncio
from playwright.async_api import async_playwright
import logging

logger = logging.getLogger(__name__)

class BrowserScraper:
    """Scraper that uses a headless browser to bypass anti-scraping protections."""
    
    async def _scrape_with_browser(self, url):
        """Use Playwright to scrape a URL with a full browser."""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                
                # Set more realistic user agent
                await page.set_extra_http_headers({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                })
                
                # Navigate to the URL
                await page.goto(url, wait_until="domcontentloaded")
                
                # Extract content
                title = await page.title()

                selector = "#main"  
                
                # Wait for the element to appear on the page
                await page.wait_for_selector(selector)
                
                # Extract the text content from the specified element
                text_content = await page.locator(selector).inner_text()
                
                return {
                    'url': url,
                    'success': True,
                    'title': title,
                    'content': text_content
                }
            except Exception as e:
                logger.error(f"Error scraping {url} with browser: {str(e)}")
                return {
                    'url': url,
                    'success': False,
                    'error': str(e),
                    'content': None
                }
            finally:
                await browser.close()
    
    def scrape_url(self, url):
        """Synchronous wrapper around async browser scraping."""
        try:
            # Run the async scraping in a new event loop
            return asyncio.run(self._scrape_with_browser(url))
        except Exception as e:
            logger.error(f"Failed to scrape URL with browser: {str(e)}")
            return {
                'url': url,
                'success': False,
                'error': str(e),
                'content': None
            }
    
    def scrape_multiple_urls(self, urls):
        """Scrape multiple URLs sequentially with a browser."""
        results = {}
        for url in urls:
            results[url] = self.scrape_url(url)
        return results