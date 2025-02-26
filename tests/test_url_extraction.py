import unittest
from app.scraper import WebScraper

class TestURLExtraction(unittest.TestCase):
    """Tests for the URL extraction functionality in WebScraper."""
    
    def setUp(self):
        """Set up a WebScraper instance for testing."""
        self.scraper = WebScraper(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            timeout=10
        )
    
    def test_simple_url(self):
        """Test extraction of a simple URL."""
        text = "Check out https://www.example.com for more information."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com"])
    
    def test_url_with_path(self):
        """Test extraction of a URL with a path."""
        text = "Visit https://www.example.com/path/to/page for details."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/path/to/page"])
    
    def test_url_with_query_params(self):
        """Test extraction of a URL with query parameters."""
        text = "Search results: https://www.example.com/search?q=test&page=1"
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/search?q=test&page=1"])
    
    def test_url_in_parentheses(self):
        """Test extraction of a URL inside parentheses."""
        text = "For more information (https://www.example.com/info)."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/info"])
    
    def test_url_with_trailing_period(self):
        """Test extraction of a URL followed by a period."""
        text = "See https://www.example.com/page."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/page"])
    
    def test_url_with_trailing_comma(self):
        """Test extraction of a URL followed by a comma."""
        text = "Check https://www.example.com/info, which has details."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/info"])
    
    def test_multiple_urls(self):
        """Test extraction of multiple URLs from text."""
        text = "First link: https://www.example.com and second link: https://www.test.org/page"
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com", "https://www.test.org/page"])
    
    def test_complex_case_with_punctuation(self):
        """Test a complex case with various punctuation."""
        text = """Check these resources:
        1. Main site (https://www.example.com/main).
        2. Documentation: https://www.example.com/docs, which is helpful.
        3. Support (https://www.example.com/support).
        """
        urls = self.scraper.extract_urls(text)
        expected = [
            "https://www.example.com/main",
            "https://www.example.com/docs",
            "https://www.example.com/support"
        ]
        self.assertEqual(sorted(urls), sorted(expected))
    
    def test_liquidweb_case(self):
        """Test the specific Liquid Web case mentioned."""
        text = """To reset your password on my.liquidweb.com, follow these steps: 
        1. Log into your Liquid Web account. 
        2. In the left navigation menu, click on "Account." 
        3. Select the "Users" tab to view the list of users associated with your account. 
        4. Click the "Edit" button next to the username for which you want to change the password. 
        5. Enter a new, strong password and confirm it. 
        6. Click "Save" to apply the changes. 
        For additional guidance, you can refer to the following link for more information: 
        "Changing Your Liquid Web Account Password" (https://www.liquidweb.com/help-docs/changing-your-liquid-web-account-password/). 
        Were you able to get what you needed?"""
        
        urls = self.scraper.extract_urls(text)
        expected = ["https://www.liquidweb.com/help-docs/changing-your-liquid-web-account-password"]
        self.assertEqual(urls, expected)
    
    def test_url_with_hyphen_underscore(self):
        """Test URL with hyphens and underscores."""
        text = "Documentation: https://api.example.com/v2/user-profiles/get_data"
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://api.example.com/v2/user-profiles/get_data"])
    
    def test_url_with_path_and_trailing_punctuation(self):
        """Test URL with path and trailing punctuation."""
        text = "Check out (https://www.example.com/path/to/resource)."
        urls = self.scraper.extract_urls(text)
        self.assertEqual(urls, ["https://www.example.com/path/to/resource"])


if __name__ == '__main__':
    unittest.main()