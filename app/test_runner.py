import asyncio
import json
import logging
import time
from datetime import datetime
from app import db
from app.models import TestCase, TestRun, TurnResult, ValidationResult, ConversationTurn, ExpectedValidation, TestMetrics
from app.agent_connector import AgentConnector, AgentConfig, extract_response_text
from app.scraper import WebScraper
from app.browser_scraper import BrowserScraper
from app.validator import ResponseValidator
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from threading import Lock


logger = logging.getLogger(__name__)

class ParallelTestRunner:
    """Runner for executing multiple test cases in parallel."""
    
    def __init__(self, config, max_workers=3):
        """Initialize the parallel test runner.
        
        Args:
            config: Application configuration
            max_workers (int): Maximum number of concurrent tests
        """
        self.config = config
        self.max_workers = max_workers
        self.test_runs = {}  # Track running tests
        self.status_lock = Lock()  # Thread safety for status updates
    
    def run_test_case(self, test_case_id, html_selector=None, credentials=None):
        """Run a single test case - used as worker function for parallel execution.
        
        Args:
            test_case_id (int): ID of the test case to run
            html_selector (str, optional): CSS selector for web scraping
            credentials (dict, optional): Salesforce credentials
            
        Returns:
            int: Test run ID
        """
        try:
            # Update status to running
            with self.status_lock:
                if test_case_id in self.test_runs:
                    self.test_runs[test_case_id]['status'] = 'running'
            
            # Create a new async test runner for improved performance
            test_runner = AsyncTestRunner(self.config)
            
            # Update credentials if provided
            if credentials:
                agent_config = AgentConfig(
                    sf_org_domain=credentials.get('org_domain', ''),
                    client_id=credentials.get('client_id', ''),
                    client_secret=credentials.get('client_secret', ''),
                    agent_id=credentials.get('agent_id', '')
                )
                test_runner.agent_connector = AgentConnector(config=agent_config)
            
            # Run the test
            test_run_id = test_runner.run_test(test_case_id, html_selector)
            
            # Update status
            with self.status_lock:
                if test_case_id in self.test_runs:
                    self.test_runs[test_case_id]['status'] = 'completed'
                    self.test_runs[test_case_id]['test_run_id'] = test_run_id
            
            return test_run_id
            
        except Exception as e:
            logger.error(f"Error in parallel test execution for test case {test_case_id}: {str(e)}")
            
            # Update status
            with self.status_lock:
                if test_case_id in self.test_runs:
                    self.test_runs[test_case_id]['status'] = 'failed'
                    self.test_runs[test_case_id]['error'] = str(e)
            
            return None
    
    def run_multiple_tests(self, test_case_ids, html_selector=None, credentials=None):
        """Run multiple test cases in parallel.
        
        Args:
            test_case_ids (list): List of test case IDs to run
            html_selector (str, optional): CSS selector for web scraping
            credentials (dict, optional): Salesforce credentials
            
        Returns:
            dict: Status of all test runs
        """
        # Initialize status tracking for each test
        with self.status_lock:
            for test_id in test_case_ids:
                test_case = TestCase.query.get(test_id)
                if test_case:
                    self.test_runs[test_id] = {
                        'status': 'queued',
                        'test_run_id': None,
                        'error': None,
                        'test_case_name': test_case.name
                    }
                else:
                    logger.warning(f"Test case with ID {test_id} not found")
        
        # Use ThreadPoolExecutor for parallel execution
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all tasks
            future_to_test_id = {}
            for test_id in test_case_ids:
                if test_id not in self.test_runs:
                    continue
                
                # Submit the task
                future = executor.submit(
                    self.run_test_case, 
                    test_id, 
                    html_selector, 
                    credentials
                )
                future_to_test_id[future] = test_id
            
            # Process results as they complete
            for future in concurrent.futures.as_completed(future_to_test_id):
                test_id = future_to_test_id[future]
                try:
                    test_run_id = future.result()
                    logger.info(f"Test case {test_id} completed with test run ID {test_run_id}")
                except Exception as e:
                    logger.error(f"Test case {test_id} failed: {str(e)}")
                    with self.status_lock:
                        if test_id in self.test_runs:
                            self.test_runs[test_id]['status'] = 'failed'
                            self.test_runs[test_id]['error'] = str(e)
        
        # Return the final status of all tests
        return dict(self.test_runs)
    
    def get_status(self):
        """Get the current status of all test runs.
        
        Returns:
            dict: Status of all test runs
        """
        with self.status_lock:
            return dict(self.test_runs)

class AsyncTestRunner:
    """Asynchronous runner for executing test cases against an AI Agent."""
    
    def __init__(self, config, max_workers=5):
        """Initialize the test runner.
        
        Args:
            config: Application configuration dictionary
            max_workers: Maximum concurrent workers for validation tasks
        """
        self.config = config
        self.max_workers = max_workers
        
        # Create AgentConfig from application config
        agent_config = AgentConfig(
            sf_org_domain=config.get('SF_ORG_DOMAIN', ''),
            client_id=config.get('SF_CLIENT_ID', ''),
            client_secret=config.get('SF_CLIENT_SECRET', ''),
            agent_id=config.get('SF_AGENT_ID', '')
        )
        
        self.agent_connector = AgentConnector(config=agent_config)
        
        # Initialize both regular and browser scrapers
        self.scraper = WebScraper(
            user_agent=config.get('USER_AGENT', 'Mozilla/5.0'),
            timeout=config.get('REQUEST_TIMEOUT', 10)
        )
        self.browser_scraper = BrowserScraper()
        
        # List of domains that need browser-based scraping
        self.problematic_domains = [
            'liquidweb.com',
            'cloudflare.com',
            # Add other domains that block regular scraping
        ]
        
        self.validator = ResponseValidator(
            api_key=config.get('DEEPEVAL_API_KEY', '')
        )
        
        # Current test run status for progress updates
        self.current_test_run = None
        self.current_turn = None
        
        # Thread pool for async validations
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
    
    def scrape_urls(self, urls, html_selector=None):
        """Scrape content from multiple URLs, using the appropriate scraper for each domain."""
        results = {}
        
        for url in urls:
            try:
                # Check if domain is in problematic list
                if any(domain in url for domain in self.problematic_domains):
                    logger.info(f"Using browser scraper for potentially protected domain: {url}")
                    results[url] = self.browser_scraper.scrape_url(url, html_selector)
                else:
                    # Use regular scraper for other domains
                    results[url] = self.scraper.scrape_url(url, html_selector)
            except Exception as e:
                logger.error(f"Error scraping URL {url}: {str(e)}")
                results[url] = {
                    'url': url,
                    'success': False,
                    'error': str(e),
                    'content': None
                }
        
        return results
    
    def run_test(self, test_case_id, html_selector=None):
        """Run a test case with async validation processing.
        
        Args:
            test_case_id (int): ID of the test case to run
            html_selector (str, optional): CSS selector for web scraping
            
        Returns:
            int: ID of the test run
        """
        # Get the test case
        test_case = TestCase.query.get(test_case_id)
        if not test_case:
            raise ValueError(f"Test case with ID {test_case_id} not found")
        
        # Create a new test run
        test_run = TestRun(
            test_case_id=test_case_id,
            status='running'
        )
        db.session.add(test_run)
        db.session.commit()
        
        # Store current test run info for status updates
        self.current_test_run = test_run.id
        self.current_turn = 0
        
        try:
            # Initialize the agent connector and start a session
            try:
                start_time = time.time()
                session_data = self.agent_connector.start_session(f"testrun_{test_run.id}")
                session_setup_time = int((time.time() - start_time) * 1000)
                logger.info(f"Started session: {self.agent_connector.session_id} in {session_setup_time}ms")
            except Exception as e:
                logger.error(f"Failed to start agent session: {str(e)}")
                raise Exception(f"Failed to start a session with the AI Agent: {str(e)}")
            
            # Get all conversation turns for the test case, ordered by turn order
            turns = ConversationTurn.query.filter_by(test_case_id=test_case_id).order_by(ConversationTurn.order).all()
            
            # Create asyncio event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Process turns and validations asynchronously
            loop.run_until_complete(self._process_turns(turns, test_run, html_selector))
            loop.close()
            
            # Try to end the session and mark test run as completed
            try:
                self.agent_connector.end_session()
                logger.info(f"Ended session for test run {test_run.id}")
            except Exception as e:
                logger.warning(f"Failed to gracefully end session: {str(e)}")
            
            test_run.status = 'completed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            
            # Generate metrics for this test run
            try:
                TestMetrics.create_from_test_run(test_run.id)
            except Exception as e:
                logger.error(f"Error creating test metrics: {str(e)}")
            
            # Clear current test run status
            self.current_test_run = None
            self.current_turn = None
            
            return test_run.id
            
        except Exception as e:
            logger.error(f"Error running test case {test_case_id}: {str(e)}")
            logger.exception(e)
            
            # Try to end the session if it exists
            if hasattr(self.agent_connector, 'session_id') and self.agent_connector.session_id:
                try:
                    self.agent_connector.end_session()
                except Exception as end_err:
                    logger.warning(f"Failed to end session after error: {str(end_err)}")
            
            test_run.status = 'failed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            
            # Clear current test run status
            self.current_test_run = None
            self.current_turn = None
            
            raise
    
    async def _process_turns(self, turns, test_run, html_selector=None):
        """Process all conversation turns asynchronously."""
        # Track pending validation tasks for each turn
        turn_validation_tasks = {}
        
        # Process each turn
        for i, turn in enumerate(turns):
            # Update current turn number for status tracking
            self.current_turn = i + 1
            
            # Send message to agent and track response time
            try:
                start_time = time.time()
                agent_response_data = self.agent_connector.send_message(turn.user_input)
                response_time_ms = int((time.time() - start_time) * 1000)
                
                # Extract agent response text
                agent_response = extract_response_text(agent_response_data)
                logger.info(f"Got response for turn {i+1} in {response_time_ms}ms")
            except Exception as e:
                logger.error(f"Failed to get response from AI Agent: {str(e)}")
                raise Exception(f"Failed to get response from AI Agent: {str(e)}")
            
            # Check for URLs in the response and scrape content
            scraped_content = await self._scrape_content(agent_response, html_selector)
            
            # Create turn result
            turn_result = TurnResult(
                test_run_id=test_run.id,
                turn_id=turn.id,
                agent_response=agent_response,
                scraped_content=scraped_content,
                response_time_ms=response_time_ms
            )
            db.session.add(turn_result)
            db.session.commit()
            
            # Get expected validations for this turn
            validations = ExpectedValidation.query.filter_by(turn_id=turn.id).all()
            
            # Start validation tasks asynchronously
            validation_tasks = await self._start_validation_tasks(
                validations, turn, turn_result, agent_response, scraped_content
            )
            
            # Store tasks for this turn
            turn_validation_tasks[turn.id] = validation_tasks
            
            # Wait for previous turn's validations to complete before proceeding
            # This ensures we don't overload the system while still allowing
            # validations to run in parallel with the next turn's API call
            if i > 0 and turns[i-1].id in turn_validation_tasks:
                prev_tasks = turn_validation_tasks[turns[i-1].id]
                await asyncio.gather(*prev_tasks)
                # Remove completed tasks to free memory
                turn_validation_tasks.pop(turns[i-1].id)
        
        # Wait for any remaining validation tasks to complete
        for turn_id, tasks in turn_validation_tasks.items():
            await asyncio.gather(*tasks)
    
    async def _scrape_content(self, agent_response, html_selector=None):
        """Scrape URLs from response asynchronously."""
        urls = self.scraper.extract_urls(agent_response)
        scraped_content = None
        
        if urls:
            try:
                # Execute scraping in a thread pool to avoid blocking
                start_time = time.time()
                
                # Run scraping in a separate thread
                loop = asyncio.get_event_loop()
                scrape_results = await loop.run_in_executor(
                    self.executor, 
                    lambda: self.scrape_urls(urls, html_selector)
                )
                
                # Calculate scraping time
                scraping_time_ms = int((time.time() - start_time) * 1000)
                logger.info(f"Scraped {len(urls)} URLs in {scraping_time_ms}ms")
                
                # Combine scraped content for validation
                scraped_texts = []
                for url, result in scrape_results.items():
                    if result.get('success') and result.get('content'):
                        scraped_texts.append(f"Content from {url}:")
                        scraped_texts.append(result.get('content', ''))
                        scraped_texts.append("---")
                
                if scraped_texts:
                    scraped_content = '\n\n'.join(scraped_texts)
            except Exception as e:
                logger.warning(f"Error scraping URLs: {str(e)}")
        
        return scraped_content
    
    async def _start_validation_tasks(self, validations, turn, turn_result, agent_response, scraped_content):
        """Start validation tasks for a turn asynchronously."""
        tasks = []
        
        for validation in validations:
            # Create a task for each validation
            task = asyncio.create_task(
                self._run_validation(validation, turn, turn_result, agent_response, scraped_content)
            )
            tasks.append(task)
        
        return tasks
    
    async def _run_validation(self, validation, turn, turn_result, agent_response, scraped_content):
        """Run a single validation asynchronously."""
        validation_type = validation.validation_type
        failure_details = None
        
        try:
            # Prepare parameters
            try:
                parameters = validation.get_parameters()
                
                # Process parameters based on validation type
                if isinstance(parameters, str):
                    try:
                        parameters = json.loads(parameters)
                    except json.JSONDecodeError:
                        parameters = {"raw_input": parameters}
                
                # For certain validation types, create defaults or enhanced parameters
                if validation_type == 'answer_relevancy':
                    # If parameters are empty or minimal, add the question from the user input
                    if not parameters or len(parameters) <= 1:
                        parameters = {
                            'question': turn.user_input,
                            'threshold': 0.7  # Default threshold
                        }
                        
                elif validation_type == 'contextual_relevancy' or validation_type == 'faithfulness':
                    # If parameters are empty, create a base dictionary
                    if not parameters or len(parameters) <= 1:
                        parameters = {
                            'threshold': 0.7  # Default threshold
                        }
                
                # Add scraped content to context if available and appropriate
                if scraped_content and validation_type in ['contextual_relevancy', 'faithfulness']:
                    if isinstance(parameters, dict):
                        if 'context' in parameters:
                            parameters['context'] = f"{parameters['context']}\n\n{scraped_content}"
                        else:
                            parameters['context'] = scraped_content
            except Exception as param_err:
                logger.error(f"Error preparing parameters for {validation_type}: {str(param_err)}")
                parameters = {}
            
            # Run validation in a thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            start_time = time.time()
            
            result = await loop.run_in_executor(
                self.executor,
                lambda: self.validator.validate(validation_type, agent_response, parameters)
            )
            
            validation_time_ms = int((time.time() - start_time) * 1000)
            
            # Collect detailed info about failures
            if not result.get('passed', False):
                failure_details = {
                    'type': validation_type,
                    'details': result.get('details', ''),
                    'score': result.get('score', 0.0),
                    'expected': parameters
                }
            
            # Create validation result
            validation_result = ValidationResult(
                turn_result_id=turn_result.id,
                validation_id=validation.id,
                is_passed=result.get('passed', False),
                score=result.get('score'),
                details=json.dumps({
                    **result,
                    'validation_time_ms': validation_time_ms
                })
            )
            
            # Lock database operations to prevent concurrent write issues
            db.session.add(validation_result)
            db.session.commit()
            
            return validation_result, failure_details
            
        except Exception as e:
            logger.error(f"Validation error for {validation_type}: {str(e)}")
            
            # Create a failed validation result
            validation_result = ValidationResult(
                turn_result_id=turn_result.id,
                validation_id=validation.id,
                is_passed=False,
                score=0.0,
                details=json.dumps({
                    'type': validation_type,
                    'passed': False,
                    'score': 0.0,
                    'details': f"Validation error: {str(e)}"
                })
            )
            
            # Add failure details
            failure_details = {
                'type': validation_type,
                'details': f"Validation error: {str(e)}",
                'score': 0.0,
                'expected': str(parameters) if 'parameters' in locals() else '{}'
            }
            
            # Safely commit to database
            db.session.add(validation_result)
            db.session.commit()
            
            return validation_result, failure_details

class TestRunner:
    """Runner for executing test cases against an AI Agent."""
    
    def __init__(self, config):
        """Initialize the test runner.
        
        Args:
            config: Application configuration dictionary
        """
        self.config = config
        
        # Create AgentConfig from application config - use dictionary-style access
        agent_config = AgentConfig(
            sf_org_domain=config.get('SF_ORG_DOMAIN', ''),
            client_id=config.get('SF_CLIENT_ID', ''),
            client_secret=config.get('SF_CLIENT_SECRET', ''),
            agent_id=config.get('SF_AGENT_ID', '')
        )
        
        self.agent_connector = AgentConnector(config=agent_config)
        
        # Initialize both regular and browser scrapers
        self.scraper = WebScraper(
            user_agent=config.get('USER_AGENT', 'Mozilla/5.0'),
            timeout=config.get('REQUEST_TIMEOUT', 10)
        )
        self.browser_scraper = BrowserScraper()
        
        # List of domains that need browser-based scraping
        self.problematic_domains = [
            'liquidweb.com',
            'cloudflare.com',
            # Add other domains that block regular scraping
        ]
        
        self.validator = ResponseValidator(
            api_key=config.get('DEEPEVAL_API_KEY', '')
        )
        
        # Current test run status for progress updates
        self.current_test_run = None
        self.current_turn = None
    
    def scrape_urls(self, urls, html_selector=None):
        """Scrape content from multiple URLs, using the appropriate scraper for each domain.
        
        Args:
            urls (list): List of URLs to scrape
            html_selector (str, optional): CSS selector to target specific content
            
        Returns:
            dict: Dictionary mapping URLs to their scraped content
        """
        results = {}
        
        for url in urls:
            try:
                # Check if domain is in problematic list
                if any(domain in url for domain in self.problematic_domains):
                    logger.info(f"Using browser scraper for potentially protected domain: {url}")
                    results[url] = self.browser_scraper.scrape_url(url, html_selector)
                else:
                    # Use regular scraper for other domains
                    results[url] = self.scraper.scrape_url(url, html_selector)
            except Exception as e:
                logger.error(f"Error scraping URL {url}: {str(e)}")
                results[url] = {
                    'url': url,
                    'success': False,
                    'error': str(e),
                    'content': None
                }
        
        return results
    
    def run_test(self, test_case_id, html_selector=None):
        """Run a test case with metrics collection.
        
        Args:
            test_case_id (int): ID of the test case to run
            html_selector (str, optional): CSS selector for web scraping
            
        Returns:
            int: ID of the test run
        """
        import time
        
        # Get the test case
        test_case = TestCase.query.get(test_case_id)
        if not test_case:
            raise ValueError(f"Test case with ID {test_case_id} not found")
        
        # Create a new test run
        test_run = TestRun(
            test_case_id=test_case_id,
            status='running'
        )
        db.session.add(test_run)
        db.session.commit()
        
        # Store current test run info for status updates
        self.current_test_run = test_run.id
        self.current_turn = 0
        
        try:
            # Initialize the agent connector and start a session
            try:
                # Create a session with a unique identifier based on the test run ID
                start_time = time.time()
                session_data = self.agent_connector.start_session(f"testrun_{test_run.id}")
                session_setup_time = int((time.time() - start_time) * 1000)  # in milliseconds
                logger.info(f"Started session: {self.agent_connector.session_id} in {session_setup_time}ms")
            except Exception as e:
                logger.error(f"Failed to start agent session: {str(e)}")
                raise Exception(f"Failed to start a session with the AI Agent: {str(e)}")
            
            # Get all conversation turns for the test case, ordered by turn order
            turns = ConversationTurn.query.filter_by(test_case_id=test_case_id).order_by(ConversationTurn.order).all()
            
            # Process each turn
            for i, turn in enumerate(turns):
                # Update current turn number for status tracking
                self.current_turn = i + 1
                
                # Send message to agent and track response time
                try:
                    start_time = time.time()
                    agent_response_data = self.agent_connector.send_message(turn.user_input)
                    response_time_ms = int((time.time() - start_time) * 1000)  # in milliseconds
                    
                    # Extract agent response text using our helper
                    agent_response = extract_response_text(agent_response_data)
                    logger.info(f"Got response for turn {i+1} in {response_time_ms}ms")
                except Exception as e:
                    logger.error(f"Failed to get response from AI Agent: {str(e)}")
                    raise Exception(f"Failed to get response from AI Agent: {str(e)}")
                
                # Check for URLs in the response
                urls = self.scraper.extract_urls(agent_response)
                scraped_content = None
                scraping_time_ms = 0
                
                # Scrape URLs if found
                if urls:
                    try:
                        # Track scraping time
                        start_time = time.time()
                        
                        # Use the scrape_urls method that handles problematic domains and HTML selectors
                        scrape_results = self.scrape_urls(urls, html_selector)
                        
                        # Calculate scraping time
                        scraping_time_ms = int((time.time() - start_time) * 1000)  # in milliseconds
                        logger.info(f"Scraped {len(urls)} URLs in {scraping_time_ms}ms")
                        
                        # Combine scraped content for validation
                        scraped_texts = []
                        for url, result in scrape_results.items():
                            if result.get('success') and result.get('content'):
                                scraped_texts.append(f"Content from {url}:")
                                scraped_texts.append(result.get('content', ''))
                                scraped_texts.append("---")
                        
                        if scraped_texts:
                            scraped_content = '\n\n'.join(scraped_texts)
                    except Exception as e:
                        logger.warning(f"Error scraping URLs: {str(e)}")
                        # Continue with the test even if scraping fails
                
                # Create turn result with response time
                turn_result = TurnResult(
                    test_run_id=test_run.id,
                    turn_id=turn.id,
                    agent_response=agent_response,
                    scraped_content=scraped_content,
                    response_time_ms=response_time_ms  # Store response time
                )
                db.session.add(turn_result)
                db.session.commit()
                
                # Get expected validations for this turn
                validations = ExpectedValidation.query.filter_by(turn_id=turn.id).all()
                
                # Collect failure details for analysis
                failure_details = []
                
                # Run validations
                for validation in validations:
                    validation_type = validation.validation_type
                    try:
                        parameters = validation.get_parameters()  # This should return a dictionary
                        
                        # Check if parameters is a string and convert it to dictionary if needed
                        if isinstance(parameters, str):
                            try:
                                parameters = json.loads(parameters)
                            except json.JSONDecodeError:
                                parameters = {"raw_input": parameters}  # Fallback to using the string as a raw input
                                
                        # For certain validation types, create defaults or enhanced parameters
                        if validation_type == 'answer_relevancy':
                            # If parameters are empty or minimal, add the question from the user input
                            if not parameters or len(parameters) <= 1:
                                parameters = {
                                    'question': turn.user_input,
                                    'threshold': 0.7  # Default threshold
                                }
                                
                        elif validation_type == 'contextual_relevancy' or validation_type == 'faithfulness':
                            # If parameters are empty, create a base dictionary
                            if not parameters or len(parameters) <= 1:
                                parameters = {
                                    'threshold': 0.7  # Default threshold
                                }
                                
                        # Add scraped content to context if available and appropriate
                        if scraped_content and validation_type in ['contextual_relevancy', 'faithfulness']:
                            if isinstance(parameters, dict):  # Make sure parameters is a dictionary
                                if 'context' in parameters:
                                    parameters['context'] = f"{parameters['context']}\n\n{scraped_content}"
                                else:
                                    parameters['context'] = scraped_content
                        
                        # Run validation and track time
                        start_time = time.time()
                        result = self.validator.validate(validation_type, agent_response, parameters)
                        validation_time_ms = int((time.time() - start_time) * 1000)  # in millisecond
                        
                        # Collect detailed info about failures
                        if not result.get('passed', False):
                            failure_details.append({
                                'type': validation_type,
                                'details': result.get('details', ''),
                                'score': result.get('score', 0.0),
                                'expected': parameters
                            })
                        
                        # Create validation result
                        validation_result = ValidationResult(
                            turn_result_id=turn_result.id,
                            validation_id=validation.id,
                            is_passed=result.get('passed', False),
                            score=result.get('score'),
                            details=json.dumps({
                                **result,
                                'validation_time_ms': validation_time_ms
                            })
                        )
                        db.session.add(validation_result)
                        db.session.commit()
                    except Exception as e:
                        logger.error(f"Validation error for {validation_type}: {str(e)}")
                        # Add a failed validation result
                        validation_result = ValidationResult(
                            turn_result_id=turn_result.id,
                            validation_id=validation.id,
                            is_passed=False,
                            score=0.0,
                            details=json.dumps({
                                'type': validation_type,
                                'passed': False,
                                'score': 0.0,
                                'details': f"Validation error: {str(e)}"
                            })
                        )
                        db.session.add(validation_result)
                        db.session.commit()
                        
                        # Add to failure details
                        failure_details.append({
                            'type': validation_type,
                            'details': f"Validation error: {str(e)}",
                            'score': 0.0,
                            'expected': str(parameters)  # Convert to string to avoid further issues
                        })

                # Save failure analysis to the turn result if any failures occurred
                if failure_details:
                    turn_result.failure_analysis = json.dumps(failure_details)
                    db.session.commit()
            
            # End session and mark test run as completed
            try:
                self.agent_connector.end_session()
                logger.info(f"Ended session for test run {test_run.id}")
            except Exception as e:
                logger.warning(f"Failed to gracefully end session: {str(e)}")
                # Continue to mark the test run as completed
            
            test_run.status = 'completed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            
            # Generate metrics for this test run
            try:
                TestMetrics.create_from_test_run(test_run.id)
            except Exception as e:
                logger.error(f"Error creating test metrics: {str(e)}")
                # Continue even if metrics creation fails
            
            # Clear current test run status
            self.current_test_run = None
            self.current_turn = None
            
            return test_run.id
            
        except Exception as e:
            logger.error(f"Error running test case {test_case_id}: {str(e)}")
            logger.exception(e)  # Log the full stack trace
            
            # Try to end the session if it exists
            if hasattr(self.agent_connector, 'session_id') and self.agent_connector.session_id:
                try:
                    self.agent_connector.end_session()
                except Exception as end_err:
                    logger.warning(f"Failed to end session after error: {str(end_err)}")
            
            test_run.status = 'failed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            
            # Clear current test run status
            self.current_test_run = None
            self.current_turn = None
            
            raise

    def get_test_run_status(self, test_run_id):
        """Get the current status of a test run.
        
        Args:
            test_run_id (int): ID of the test run
            
        Returns:
            dict: Current status information
        """
        test_run = TestRun.query.get(test_run_id)
        if not test_run:
            raise ValueError(f"Test run with ID {test_run_id} not found")
        
        status_info = {
            'id': test_run.id,
            'status': test_run.status,
            'started_at': test_run.started_at.isoformat() if test_run.started_at else None,
            'completed_at': test_run.completed_at.isoformat() if test_run.completed_at else None
        }
        
        # Add current turn information if available and test is still running
        if test_run.status == 'running' and self.current_test_run == test_run_id:
            status_info['current_turn'] = self.current_turn
            turn_count = ConversationTurn.query.filter_by(test_case_id=test_run.test_case_id).count()
            status_info['total_turns'] = turn_count
            status_info['progress_percent'] = int((self.current_turn / turn_count) * 100) if turn_count > 0 else 0
        
        return status_info
    
    def get_test_results(self, test_run_id):
        """Get results for a test run.
        
        Args:
            test_run_id (int): ID of the test run
            
        Returns:
            dict: Test run results
        """
        test_run = TestRun.query.get(test_run_id)
        if not test_run:
            raise ValueError(f"Test run with ID {test_run_id} not found")
        
        # Get all turn results for this test run
        turn_results = TurnResult.query.filter_by(test_run_id=test_run_id).all()
        
        turn_data = []
        overall_passed = True
        validation_counts = {
            'total': 0,
            'passed': 0,
            'failed': 0
        }
        
        for turn_result in turn_results:
            # Get conversation turn
            turn = ConversationTurn.query.get(turn_result.turn_id)
            
            # Get validation results
            validation_results = ValidationResult.query.filter_by(turn_result_id=turn_result.id).all()
            
            validations = []
            turn_passed = True
            
            for validation_result in validation_results:
                # Get expected validation
                expected_validation = ExpectedValidation.query.get(validation_result.validation_id)
                
                validation_data = {
                    'type': expected_validation.validation_type,
                    'parameters': expected_validation.get_parameters(),
                    'passed': validation_result.is_passed,
                    'score': validation_result.score,
                    'details': json.loads(validation_result.details) if validation_result.details else None
                }
                
                validations.append(validation_data)
                
                # Update overall status and counts
                validation_counts['total'] += 1
                if validation_result.is_passed:
                    validation_counts['passed'] += 1
                else:
                    validation_counts['failed'] += 1
                    turn_passed = False
            
            if not turn_passed:
                overall_passed = False
            
            turn_data.append({
                'order': turn.order,
                'user_input': turn.user_input,
                'agent_response': turn_result.agent_response,
                'scraped_content': turn_result.scraped_content,
                'passed': turn_passed,
                'validations': validations
            })
        
        # Calculate pass percentage
        pass_percentage = 0
        if validation_counts['total'] > 0:
            pass_percentage = (validation_counts['passed'] / validation_counts['total']) * 100
        
        return {
            'id': test_run.id,
            'test_case_id': test_run.test_case_id,
            'test_case_name': test_run.test_case.name,
            'started_at': test_run.started_at.isoformat(),
            'completed_at': test_run.completed_at.isoformat() if test_run.completed_at else None,
            'status': test_run.status,
            'overall_passed': overall_passed,
            'validation_counts': validation_counts,
            'pass_percentage': pass_percentage,
            'turns': turn_data
        }
    
    def export_results_csv(self, test_run_id):
        """Export test results as CSV.
        
        Args:
            test_run_id (int): ID of the test run
            
        Returns:
            str: CSV string
        """
        results = self.get_test_results(test_run_id)
        
        csv_rows = []
        
        # Add header row
        csv_rows.append([
            'Test Case ID', 'Test Case Name', 'Test Run ID', 'Started At', 'Completed At',
            'Status', 'Overall Passed', 'Total Validations', 'Passed Validations',
            'Failed Validations', 'Pass Percentage'
        ])
        
        # Add summary row
        csv_rows.append([
            results['test_case_id'],
            results['test_case_name'],
            results['id'],
            results['started_at'],
            results['completed_at'] or '',
            results['status'],
            'Yes' if results['overall_passed'] else 'No',
            results['validation_counts']['total'],
            results['validation_counts']['passed'],
            results['validation_counts']['failed'],
            f"{results['pass_percentage']:.2f}%"
        ])
        
        # Add empty row as separator
        csv_rows.append([])
        
        # Add turn details header
        csv_rows.append([
            'Turn Order', 'User Input', 'Agent Response', 'Turn Passed',
            'Validation Type', 'Validation Passed', 'Validation Score'
        ])
        
        # Add turn details rows
        for turn in results['turns']:
            if not turn['validations']:
                # Add row for turn without validations
                csv_rows.append([
                    turn['order'],
                    turn['user_input'],
                    turn['agent_response'],
                    'Yes' if turn['passed'] else 'No',
                    '', '', ''
                ])
            else:
                # Add first validation with turn details
                first_validation = turn['validations'][0]
                csv_rows.append([
                    turn['order'],
                    turn['user_input'],
                    turn['agent_response'],
                    'Yes' if turn['passed'] else 'No',
                    first_validation['type'],
                    'Yes' if first_validation['passed'] else 'No',
                    f"{first_validation['score']:.2f}" if first_validation['score'] is not None else ''
                ])
                
                # Add remaining validations for this turn
                for validation in turn['validations'][1:]:
                    csv_rows.append([
                        '', '', '', '',
                        validation['type'],
                        'Yes' if validation['passed'] else 'No',
                        f"{validation['score']:.2f}" if validation['score'] is not None else ''
                    ])
        
        # Convert to CSV string
        csv_string = ''
        for row in csv_rows:
            # Escape any commas in the fields
            escaped_row = []
            for field in row:
                if isinstance(field, str) and (',' in field or '"' in field or '\n' in field):
                    escaped_field = '"' + field.replace('"', '""') + '"'
                    escaped_row.append(escaped_field)
                else:
                    escaped_row.append(str(field))
            
            csv_string += ','.join(escaped_row) + '\n'
        
        return csv_string