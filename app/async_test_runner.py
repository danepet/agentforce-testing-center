import asyncio
import json
import logging
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from app import db
from app.models import TestCase, TestRun, TurnResult, ValidationResult, ConversationTurn, ExpectedValidation, TestMetrics
from app.agent_connector import AgentConnector, AgentConfig, extract_response_text
from app.scraper import WebScraper
from app.browser_scraper import BrowserScraper
from app.validator import ResponseValidator
from threading import Lock

logger = logging.getLogger(__name__)

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
        
        # Progress callback function
        self.progress_callback = None
    
    def set_progress_callback(self, callback):
        """Set a callback function for reporting progress.
        
        Args:
            callback: Function that takes current_turn and total_turns as arguments
        """
        self.progress_callback = callback
    
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
        
        # Create a new test run if one doesn't already exist
        test_run = TestRun.query.filter_by(test_case_id=test_case_id, status='running').order_by(TestRun.started_at.desc()).first()
        
        if not test_run:
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
            total_turns = len(turns)
            
            # Create asyncio event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Report initial progress
            if self.progress_callback:
                self.progress_callback(0, total_turns)
            
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
        total_turns = len(turns)
        
        # Process each turn
        for i, turn in enumerate(turns):
            # Update current turn number for status tracking
            self.current_turn = i + 1
            
            # Report progress if callback is set
            if self.progress_callback:
                self.progress_callback(self.current_turn, total_turns)
            
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