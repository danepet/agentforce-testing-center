#!/usr/bin/env python
"""
Simplified RQ worker script that doesn't rely on the Connection context manager.
Run this to process test jobs in the background.

Usage:
    python run_worker.py
"""

import os
import sys
import logging
import redis
from rq import Worker, Queue
from app import create_app
from config import config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

logger = logging.getLogger(__name__)

def main():
    """Start worker to process Redis Queue jobs."""
    # Determine configuration based on environment
    env = os.environ.get('FLASK_ENV', 'default')
    app_config = config[env]
    
    # Create app with context for database access
    app = create_app(app_config)
    
    # Configure Redis connection
    redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    redis_conn = redis.from_url(redis_url)
    
    # Define queues to listen to, in order of priority
    listen = ['high', 'default', 'low']
    queues = [Queue(name, connection=redis_conn) for name in listen]
    
    logger.info(f"Starting RQ worker listening to queues: {', '.join(listen)}")
    logger.info(f"Using Redis at: {redis_url}")
    
    # Start worker with Flask app context
    with app.app_context():
        # Create and start the worker directly
        worker = Worker(queues, connection=redis_conn)
        
        # Enable work with scheduler
        worker.work(with_scheduler=True)

if __name__ == '__main__':
    main()