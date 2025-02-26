import os
from dotenv import load_dotenv

# Load environment variables from .env file if present
load_dotenv()

class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key-for-testing-only')
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///ai_agent_tests.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Salesforce AI Agent settings
    SF_ORG_DOMAIN = os.environ.get('SF_ORG_DOMAIN', '')
    SF_CLIENT_ID = os.environ.get('SF_CLIENT_ID', '')
    SF_CLIENT_SECRET = os.environ.get('SF_CLIENT_SECRET', '')
    SF_AGENT_ID = os.environ.get('SF_AGENT_ID', '')
    
    # DeepEval settings
    DEEPEVAL_API_KEY = os.environ.get('DEEPEVAL_API_KEY', '')
    
    # Web scraping settings
    REQUEST_TIMEOUT = 10  # seconds
    USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    
class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    
class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///test.db'
    
class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    
# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}