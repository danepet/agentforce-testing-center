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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        }
    
    def extract_urls(self, text):
        """Extract URLs from text.
        
        Args:
            text (str): Text to extract URLs from
            
        Returns:
            list: List of extracted URLs
        """
        # This regex finds URLs starting with http or https and continues until it finds
        # invalid URL characters, but is careful not to include trailing punctuation
        url_pattern = r'https?://[^\s()<>[\]{}]+(?:\.[^\s()<>[\]{}]+)+(?:/[^\s()<>[\]{}.,;:\'\"!?]*)*'
        
        # Find all potential URLs
        potential_urls = re.findall(url_pattern, text)
        
        # Clean up the URLs to remove trailing punctuation
        cleaned_urls = []
        for url in potential_urls:
            # Remove trailing punctuation like ., ), ], }, etc.
            while url and url[-1] in '.,;:!?)]}\'\"':
                url = url[:-1]
            cleaned_urls.append(url)
        
        return cleaned_urls
    
    def scrape_url(self, url, selector=None):
        """Scrape content from a URL.
        
        Args:
            url (str): URL to scrape
            selector (str, optional): CSS selector to target specific content
            
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
            
            # If a CSS selector is provided, try to extract content from specified elements
            text = ""
            if selector:
                try:
                    selected_elements = soup.select(selector)
                    if selected_elements:
                        for element in selected_elements:
                            text += element.get_text(separator='\n') + "\n"
                    else:
                        logger.warning(f"Selector '{selector}' not found in page, falling back to full page content")
                        text = soup.get_text(separator='\n')
                except Exception as e:
                    logger.warning(f"Error using selector '{selector}': {str(e)}. Falling back to full page content")
                    text = soup.get_text(separator='\n')
            else:
                # Get full page text content by default
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
                'content': clean_text,
                'selector_used': selector if selector else 'full_page'
            }
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 403:
                logger.warning(f"Access forbidden for URL {url}. The website may be blocking scrapers.")
                return {
                    'url': url,
                    'success': False,
                    'error': "Access forbidden (403). Website may be blocking scrapers.",
                    'content': None
                }
            else:
                logger.error(f"Failed to scrape URL {url}: {str(e)}")
                return {
                    'url': url,
                    'success': False,
                    'error': str(e),
                    'content': None
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
    
    def scrape_multiple_urls(self, urls, selector=None):
        """Scrape content from multiple URLs.
        
        Args:
            urls (list): List of URLs to scrape
            selector (str, optional): CSS selector to target specific content
            
        Returns:
            dict: Dictionary mapping URLs to their scraped content
        """
        results = {}
        for url in urls:
            results[url] = self.scrape_url(url, selector)
        
        return results