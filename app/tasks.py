import json
import logging
import time
from datetime import datetime
from flask import current_app
from rq import get_current_job
from app import db
from app.models import TestCase, TestRun, ConversationTurn
from app.agent_connector import AgentConnector, AgentConfig
from app.async_test_runner import AsyncTestRunner
from app.test_runner import TestRunner
from app.queue import update_job_meta

logger = logging.getLogger(__name__)

def run_test_task(test_case_id, credentials, html_selector=None):
    """
    RQ task to run a test case asynchronously.
    
    Args:
        test_case_id: ID of the test case to run
        credentials: Dictionary with Salesforce credentials
        html_selector: Optional CSS selector for web scraping
        
    Returns:
        Dictionary with test results information
    """
    # Get the current job to update meta info
    job = get_current_job()
    if job:
        job.meta['status'] = 'initializing'
        job.save_meta()
    
    try:
        # Get the test case
        test_case = TestCase.query.get(test_case_id)
        if not test_case:
            raise ValueError(f"Test case with ID {test_case_id} not found")
            
        # Calculate total turns for progress reporting
        total_turns = ConversationTurn.query.filter_by(test_case_id=test_case_id).count()
        
        # Create a new test run
        test_run = TestRun(
            test_case_id=test_case_id,
            status='running'
        )
        db.session.add(test_run)
        db.session.commit()
        
        # Update job meta with test run info
        if job:
            job.meta.update({
                'test_run_id': test_run.id,
                'current_turn': 0,
                'total_turns': total_turns,
                'status': 'running',
                'percent': 0
            })
            job.save_meta()
        
        # Create async test runner
        config = current_app.config.copy()
        
        test_runner = AsyncTestRunner(config)
        
        # Configure agent connector with credentials
        agent_config = AgentConfig(
            sf_org_domain=credentials.get('org_domain', '') or credentials.get('sf_org_domain', ''),
            client_id=credentials.get('client_id', '') or credentials.get('sf_client_id', ''),
            client_secret=credentials.get('client_secret', '') or credentials.get('sf_client_secret', ''),
            agent_id=credentials.get('agent_id', '') or credentials.get('sf_agent_id', '')
        )
        test_runner.agent_connector = AgentConnector(config=agent_config)
        
        # Define progress callback
        def progress_callback(current_turn, total_turns):
            percent = int((current_turn / total_turns) * 100) if total_turns > 0 else 0
            
            # Update job meta
            if job:
                job.meta.update({
                    'current_turn': current_turn,
                    'total_turns': total_turns,
                    'status': 'running',
                    'percent': percent
                })
                job.save_meta()
            else:
                # Alternative progress tracking if job isn't available
                logger.info(f"Progress: Turn {current_turn}/{total_turns} ({percent}%)")
        
        # Set the progress callback
        test_runner.set_progress_callback(progress_callback)
        
        # Run the test
        test_run_id = test_runner.run_test(test_case_id, html_selector)
        
        # Get the test results
        results_runner = TestRunner(config)
        results = results_runner.get_test_results(test_run_id)
        
        # Update job meta with results
        if job:
            job.meta.update({
                'status': 'completed',
                'test_run_id': test_run_id
            })
            job.save_meta()
        
        # Return success with results summary
        return {
            'status': 'completed',
            'test_run_id': test_run_id,
            'test_case_id': test_case_id,
            'pass_percentage': results.get('pass_percentage', 0),
            'validation_counts': results.get('validation_counts', {}),
            'overall_passed': results.get('overall_passed', False)
        }
        
    except Exception as e:
        logger.error(f"Error in test execution task: {str(e)}")
        logger.exception(e)
        
        # Update job meta with error info
        if job:
            job.meta.update({
                'status': 'failed',
                'error': str(e)
            })
            job.save_meta()
        
        # Update test run status if it was created
        try:
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
        except Exception as db_error:
            logger.error(f"Error updating test run: {str(db_error)}")
            
        return {
            'status': 'failed',
            'test_case_id': test_case_id,
            'error': str(e)
        }

def run_multiple_tests_task(test_ids, credentials, html_selector=None):
    """
    RQ task to run multiple test cases one after another.
    
    Args:
        test_ids: List of test case IDs to run
        credentials: Dictionary with Salesforce credentials
        html_selector: Optional CSS selector for web scraping
        
    Returns:
        Dictionary with results for all test runs
    """
    # Get the current job to update meta info
    job = get_current_job()
    if job:
        job.meta['status'] = 'initializing'
        job.save_meta()
    
    try:
        total_tests = len(test_ids)
        results = {}
        completed = 0
        failed = 0
        
        # Update job meta with initial progress
        if job:
            job.meta.update({
                'completed': completed,
                'failed': failed,
                'total': total_tests,
                'current_test_id': None,
                'current_test_name': None,
                'percent': 0,
                'results': results
            })
            job.save_meta()
        
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
                
                # Update job meta with current test
                if job:
                    job.meta.update({
                        'completed': completed,
                        'failed': failed,
                        'total': total_tests,
                        'current_test_id': test_id,
                        'current_test_name': test_case.name,
                        'percent': int((completed + failed) / total_tests * 100),
                        'results': results
                    })
                    job.save_meta()
                
                # Create test runner
                config = current_app.config.copy()
                test_runner = AsyncTestRunner(config)
                
                # Configure agent connector with credentials
                agent_config = AgentConfig(
                    sf_org_domain=credentials.get('org_domain', '') or credentials.get('sf_org_domain', ''),
                    client_id=credentials.get('client_id', '') or credentials.get('sf_client_id', ''),
                    client_secret=credentials.get('client_secret', '') or credentials.get('sf_client_secret', ''),
                    agent_id=credentials.get('agent_id', '') or credentials.get('sf_agent_id', '')
                )
                test_runner.agent_connector = AgentConnector(config=agent_config)
                
                # Run the test
                test_run_id = test_runner.run_test(test_id, html_selector)
                
                # Get the test results
                results_runner = TestRunner(config)
                run_results = results_runner.get_test_results(test_run_id)
                
                # Store the result
                results[test_id] = {
                    'status': 'completed',
                    'test_run_id': test_run_id,
                    'test_case_id': test_id,
                    'pass_percentage': run_results.get('pass_percentage', 0),
                    'validation_counts': run_results.get('validation_counts', {}),
                    'overall_passed': run_results.get('overall_passed', False)
                }
                
                # Update counters
                completed += 1
                
            except Exception as e:
                logger.error(f"Error running test {test_id}: {str(e)}")
                failed += 1
                results[test_id] = {
                    'status': 'failed',
                    'test_case_id': test_id,
                    'error': str(e)
                }
            
            # Update job meta after each test
            if job:
                job.meta.update({
                    'completed': completed,
                    'failed': failed,
                    'total': total_tests,
                    'current_test_id': None,
                    'current_test_name': None,
                    'percent': int((completed + failed) / total_tests * 100),
                    'results': results
                })
                job.save_meta()
        
        # Update job meta with final results
        if job:
            job.meta.update({
                'status': 'completed',
                'completed': completed,
                'failed': failed,
                'total': total_tests,
                'results': results
            })
            job.save_meta()
        
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
        
        # Update job meta with error info
        if job:
            job.meta.update({
                'status': 'failed',
                'error': str(e)
            })
            job.save_meta()
        
        return {
            'status': 'failed',
            'error': str(e),
            'results': results if 'results' in locals() else {}
        }