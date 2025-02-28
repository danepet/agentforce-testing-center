import json
import logging
from datetime import datetime

# Import from celery_app first
from celery_app import celery

# Database and model imports
from app import db
from app.models import TestCase, TestRun, ConversationTurn
from app.agent_connector import AgentConnector, AgentConfig
from app.async_test_runner import AsyncTestRunner

logger = logging.getLogger(__name__)

@celery.task(bind=True, name='run_test_task')
def run_test_task(self, test_case_id, credentials, html_selector=None):
    """
    Celery task to run a test case asynchronously.
    Updates task progress in Celery's result backend.
    
    Args:
        test_case_id: ID of the test case to run
        credentials: Dictionary with Salesforce credentials
        html_selector: Optional CSS selector for web scraping
        
    Returns:
        Dictionary with test results information
    """
    try:
        # Get the test case
        test_case = TestCase.query.get(test_case_id)
        if not test_case:
            raise ValueError(f"Test case with ID {test_case_id} not found")
            
        # Calculate total turns for progress reporting
        total_turns = ConversationTurn.query.filter_by(test_case_id=test_case_id).count()
            
        # Initialize progress state
        self.update_state(
            state='PROGRESS',
            meta={
                'current_turn': 0,
                'total_turns': total_turns,
                'status': 'initializing',
                'percent': 0
            }
        )
        
        # Create async test runner
        # Import config here to avoid circular imports
        from flask import current_app
        config = current_app.config.copy()
        
        test_runner = AsyncTestRunner(config)
        
        # Configure agent connector with credentials
        agent_config = AgentConfig(
            sf_org_domain=credentials.get('org_domain', ''),
            client_id=credentials.get('client_id', ''),
            client_secret=credentials.get('client_secret', ''),
            agent_id=credentials.get('agent_id', '')
        )
        test_runner.agent_connector = AgentConnector(config=agent_config)
        
        # Define progress callback
        def progress_callback(current_turn, total_turns):
            percent = int((current_turn / total_turns) * 100) if total_turns > 0 else 0
            self.update_state(
                state='PROGRESS',
                meta={
                    'current_turn': current_turn,
                    'total_turns': total_turns,
                    'status': 'running',
                    'percent': percent
                }
            )
        
        # Set the progress callback
        test_runner.set_progress_callback(progress_callback)
        
        # Run the test
        test_run_id = test_runner.run_test(test_case_id, html_selector)
        
        # Get the test results
        # Import TestRunner only when needed
        from app.test_runner import TestRunner
        results_runner = TestRunner(config)
        results = results_runner.get_test_results(test_run_id)
        
        # Return success with results summary
        return {
            'status': 'completed',
            'test_run_id': test_run_id,
            'test_case_id': test_case_id,
            'pass_percentage': results['pass_percentage'],
            'validation_counts': results['validation_counts'],
            'overall_passed': results['overall_passed']
        }
        
    except Exception as e:
        logger.error(f"Error in test execution task: {str(e)}")
        logger.exception(e)
        
        # Update test run status if it was created
        test_run = TestRun.query.filter_by(test_case_id=test_case_id, status='running').first()
        if test_run:
            test_run.status = 'failed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            
            return {
                'status': 'failed',
                'test_run_id': test_run.id,
                'test_case_id': test_case_id,
                'error': str(e)
            }
        else:
            return {
                'status': 'failed',
                'test_case_id': test_case_id,
                'error': str(e)
            }

@celery.task(bind=True, name='run_multiple_tests_task')
def run_multiple_tests_task(self, test_ids, credentials, html_selector=None):
    """
    Celery task to run multiple test cases one after another.
    Updates task progress in Celery's result backend.
    
    Args:
        test_ids: List of test case IDs to run
        credentials: Dictionary with Salesforce credentials
        html_selector: Optional CSS selector for web scraping
        
    Returns:
        Dictionary with results for all test runs
    """
    try:
        total_tests = len(test_ids)
        results = {}
        completed = 0
        failed = 0
        
        # Initialize progress state
        self.update_state(
            state='PROGRESS',
            meta={
                'completed': completed,
                'failed': failed,
                'total': total_tests,
                'current_test_id': None,
                'current_test_name': None,
                'percent': 0,
                'results': results
            }
        )
        
        # Process each test in sequence
        for test_id in test_ids:
            try:
                # Get test case details
                test_case = TestCase.query.get(test_id)
                if not test_case:
                    logger.warning(f"Test case with ID {test_id} not found")
                    failed += 1
                    results[test_id] = {
                        'status': 'failed',
                        'error': f"Test case with ID {test_id} not found"
                    }
                    continue
                
                # Update state to show current test
                self.update_state(
                    state='PROGRESS',
                    meta={
                        'completed': completed,
                        'failed': failed,
                        'total': total_tests,
                        'current_test_id': test_id,
                        'current_test_name': test_case.name,
                        'percent': int((completed + failed) / total_tests * 100),
                        'results': results
                    }
                )
                
                # Run the test - use the above function directly to avoid Celery overhead
                task_result = run_test_task(test_id, credentials, html_selector)
                
                # Store the result
                results[test_id] = task_result
                
                # Update counters
                if task_result.get('status') == 'completed':
                    completed += 1
                else:
                    failed += 1
            
            except Exception as e:
                logger.error(f"Error running test {test_id}: {str(e)}")
                failed += 1
                results[test_id] = {
                    'status': 'failed',
                    'test_case_id': test_id,
                    'error': str(e)
                }
            
            # Update progress after each test
            self.update_state(
                state='PROGRESS',
                meta={
                    'completed': completed,
                    'failed': failed,
                    'total': total_tests,
                    'current_test_id': None,
                    'current_test_name': None,
                    'percent': int((completed + failed) / total_tests * 100),
                    'results': results
                }
            )
        
        # Return final results
        return {
            'status': 'completed',
            'completed': completed,
            'failed': failed,
            'total': total_tests,
            'results': results
        }
        
    except Exception as e:
        logger.error(f"Error in multiple test execution task: {str(e)}")
        logger.exception(e)
        
        return {
            'status': 'failed',
            'error': str(e),
            'results': results if 'results' in locals() else {}
        }