import re
import requests
from bs4 import BeautifulSoup
import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

class WebScraper:
    """Scraper for extracting content from URLs found in AI Agent responses."""
    
    def __init__(self, user_agent, timeout):
        """Initialize the scraper.
        
        Args:
            user_agent (str): User agent string to use for requests
            timeout (int): Request timeout in seconds
        """
        self.user_agent = user_agent
        self.timeout = timeout
        self.headers = {
            'User-Agent': self.user_agent
        }
    
    def extract_urls(self, text):
        """Extract URLs from text.
        
        Args:
            text (str): Text to extract URLs from
            
        Returns:
            list: List of extracted URLs
        """
        # URL regex pattern to match most common URL formats
        url_pattern = r'https?://(?:[-\w.]|(?:%[\da-fA-F]{2}))+(?:/[^"\s<>]*)?'
        urls = re.findall(url_pattern, text)
        return urls
    
    def scrape_url(self, url):
        """Scrape content from a URL.
        
        Args:
            url (str): URL to scrape
            
        Returns:
            dict: Dictionary containing scraped content and metadata
        """
        try:
            # Validate URL schema
            parsed_url = urlparse(url)
            if parsed_url.scheme not in ['http', 'https']:
                return {
                    'url': url,
                    'success': False,
                    'error': 'Unsupported URL schema',
                    'content': None
                }
            
            # Make the request
            response = requests.get(url, headers=self.headers, timeout=self.timeout)
            response.raise_for_status()
            
            # Parse the content with BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.extract()
            
            # Get text content
            text = soup.get_text(separator='\n')
            
            # Remove excess whitespace
            clean_text = '\n'.join([line.strip() for line in text.splitlines() if line.strip()])
            
            # Get title
            title = soup.title.string if soup.title else None
            
            # Get meta description
            meta_desc = None
            meta_tag = soup.find('meta', attrs={'name': 'description'})
            if meta_tag:
                meta_desc = meta_tag.get('content')
            
            return {
                'url': url,
                'success': True,
                'title': title,
                'meta_description': meta_desc,
                'content': clean_text
            }
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to scrape URL {url}: {str(e)}")
            return {
                'url': url,
                'success': False,
                'error': str(e),
                'content': None
            }
        except Exception as e:
            logger.error(f"Error processing URL {url}: {str(e)}")
            return {
                'url': url,
                'success': False,
                'error': str(e),
                'content': None
            }
    
    def scrape_multiple_urls(self, urls):
        """Scrape content from multiple URLs.
        
        Args:
            urls (list): List of URLs to scrape
            
        Returns:
            dict: Dictionary mapping URLs to their scraped content
        """
        results = {}
        for url in urls:
            results[url] = self.scrape_url(url)
        
        return results