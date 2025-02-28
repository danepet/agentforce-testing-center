import os
import redis
from rq import Queue
from rq.job import Job

# Configure Redis connection
redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
redis_conn = redis.from_url(redis_url)

# Create queues with different priorities
# Default queue for standard test runs
default_queue = Queue('default', connection=redis_conn)

# High priority queue for important or short tests
high_queue = Queue('high', connection=redis_conn)

# Low priority queue for longer/less urgent tests
low_queue = Queue('low', connection=redis_conn)

def get_job_status(job_id):
    """
    Get the status of a job by its ID.
    
    Args:
        job_id (str): The job ID to check
        
    Returns:
        dict: Status information about the job
    """
    try:
        job = Job.fetch(job_id, connection=redis_conn)
        
        # Basic status info
        status_info = {
            'id': job.id,
            'status': job.get_status(),
            'created_at': job.created_at.isoformat() if job.created_at else None,
            'ended_at': job.ended_at.isoformat() if job.ended_at else None,
            'exc_info': job.exc_info
        }
        
        # Add meta information if it exists
        if job.meta:
            status_info.update(job.meta)
        
        # Add result if job is finished
        if job.is_finished:
            status_info['result'] = job.result
        
        return status_info
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e)
        }

def update_job_meta(job_id, meta_dict):
    """
    Update the meta information for a job.
    
    Args:
        job_id (str): The job ID to update
        meta_dict (dict): Dictionary of metadata to update
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        job = Job.fetch(job_id, connection=redis_conn)
        # Update metadata
        job.meta.update(meta_dict)
        job.save_meta()
        return True
    except Exception:
        return False