# app/browser_scraper.py
import asyncio
from playwright.async_api import async_playwright
import logging

logger = logging.getLogger(__name__)

class BrowserScraper:
    """Scraper that uses a headless browser to bypass anti-scraping protections."""
    
    async def _scrape_with_browser(self, url, selector=None):
        """Use Playwright to scrape a URL with a full browser.
        
        Args:
            url (str): The URL to scrape
            selector (str, optional): CSS selector to target specific content
                                     Default is None, which gets the entire page content
        """
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

                # Use provided selector if available, otherwise use a default
                content_selector = selector if selector else "body"
                
                try:
                    # Wait for the element to appear on the page (with a reasonable timeout)
                    await page.wait_for_selector(content_selector, timeout=5000)
                    
                    # Extract the text content from the specified element
                    text_content = await page.locator(content_selector).inner_text()
                except Exception as e:
                    logger.warning(f"Could not find selector '{content_selector}' on page. Falling back to body content: {str(e)}")
                    text_content = await page.locator("body").inner_text()
                
                return {
                    'url': url,
                    'success': True,
                    'title': title,
                    'content': text_content,
                    'selector_used': content_selector
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
    
    def scrape_url(self, url, selector=None):
        """Synchronous wrapper around async browser scraping.
        
        Args:
            url (str): The URL to scrape
            selector (str, optional): CSS selector to target specific content
        """
        try:
            # Run the async scraping in a new event loop
            return asyncio.run(self._scrape_with_browser(url, selector))
        except Exception as e:
            logger.error(f"Failed to scrape URL with browser: {str(e)}")
            return {
                'url': url,
                'success': False,
                'error': str(e),
                'content': None
            }
    
    def scrape_multiple_urls(self, urls, selector=None):
        """Scrape multiple URLs sequentially with a browser.
        
        Args:
            urls (list): List of URLs to scrape
            selector (str, optional): CSS selector to target specific content
        """
        results = {}
        for url in urls:
            results[url] = self.scrape_url(url, selector)
        return results