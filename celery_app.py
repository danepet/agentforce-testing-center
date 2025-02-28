import os
from celery import Celery

def make_celery():
    """Create and configure a Celery application."""
    redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    
    celery = Celery(
        'app_celery',  # Use a different name to avoid conflicts
        broker=redis_url,
        backend=redis_url
    )
    
    # Configure Celery
    celery.conf.update(
        result_expires=3600,  # Results expire after 1 hour
        task_serializer='json',
        accept_content=['json'],
        result_serializer='json',
        enable_utc=True,
        worker_max_tasks_per_child=200,  # Restart worker after 200 tasks to prevent memory leaks
        broker_connection_retry_on_startup=True
    )
    
    # Important: only import tasks when needed to avoid circular imports
    # Don't include tasks here - we'll import them in the worker process
    
    return celery

celery = make_celery()

# Explicitly register tasks module
# This must be after the celery instance is created
@celery.on_after_configure.connect
def setup_tasks(sender, **kwargs):
    # Dynamic import to avoid circular imports
    # This runs when celery is configured, not at module load time
    try:
        import app.tasks
    except ImportError as e:
        print(f"Warning: Could not import tasks: {e}")

if __name__ == '__main__':
    celery.start()