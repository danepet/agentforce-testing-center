import json
import logging
import time
from datetime import datetime
from app import db
from app.models import TestCase, TestRun, TurnResult, ValidationResult, ConversationTurn, ExpectedValidation
from app.agent_connector import AgentConnector, AgentConfig, extract_response_text
from app.scraper import WebScraper
from app.browser_scraper import BrowserScraper
from app.validator import ResponseValidator

logger = logging.getLogger(__name__)

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
    
    def scrape_urls(self, urls):
        """Scrape content from multiple URLs, using the appropriate scraper for each domain.
        
        Args:
            urls (list): List of URLs to scrape
            
        Returns:
            dict: Dictionary mapping URLs to their scraped content
        """
        results = {}
        
        for url in urls:
            try:
                # Check if domain is in problematic list
                if any(domain in url for domain in self.problematic_domains):
                    logger.info(f"Using browser scraper for potentially protected domain: {url}")
                    results[url] = self.browser_scraper.scrape_url(url)
                else:
                    # Use regular scraper for other domains
                    results[url] = self.scraper.scrape_url(url)
            except Exception as e:
                logger.error(f"Error scraping URL {url}: {str(e)}")
                results[url] = {
                    'url': url,
                    'success': False,
                    'error': str(e),
                    'content': None
                }
        
        return results
    
    def run_test(self, test_case_id):
        """Run a test case.
        
        Args:
            test_case_id (int): ID of the test case to run
            
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
        
        try:
            # Initialize the agent connector and start a session
            try:
                # Create a session with a unique identifier based on the test run ID
                session_data = self.agent_connector.start_session(f"testrun_{test_run.id}")
                logger.info(f"Started session: {self.agent_connector.session_id}")
            except Exception as e:
                logger.error(f"Failed to start agent session: {str(e)}")
                raise Exception(f"Failed to start a session with the AI Agent: {str(e)}")
            
            # Get all conversation turns for the test case, ordered by turn order
            turns = ConversationTurn.query.filter_by(test_case_id=test_case_id).order_by(ConversationTurn.order).all()
            
            # Process each turn
            for turn in turns:
                # Send message to agent
                try:
                    agent_response_data = self.agent_connector.send_message(turn.user_input)
                    
                    # Extract agent response text using our helper
                    agent_response = extract_response_text(agent_response_data)
                except Exception as e:
                    logger.error(f"Failed to get response from AI Agent: {str(e)}")
                    raise Exception(f"Failed to get response from AI Agent: {str(e)}")
                
                # Note: Conversation history is maintained by the Salesforce API session
                # We don't need to pass it explicitly with each message
                
                # Check for URLs in the response
                urls = self.scraper.extract_urls(agent_response)
                scraped_content = None
                
                # Scrape URLs if found
                if urls:
                    try:
                        # Use the new scrape_urls method that handles problematic domains
                        scrape_results = self.scrape_urls(urls)
                        
                        # Combine scraped content for validation
                        scraped_texts = []
                        for url, result in scrape_results.items():
                            if result['success'] and result['content']:
                                scraped_texts.append(result['content'])
                        
                        if scraped_texts:
                            scraped_content = '\n\n'.join(scraped_texts)
                    except Exception as e:
                        logger.warning(f"Error scraping URLs: {str(e)}")
                        # Continue with the test even if scraping fails
                
                # Create turn result
                turn_result = TurnResult(
                    test_run_id=test_run.id,
                    turn_id=turn.id,
                    agent_response=agent_response,
                    scraped_content=scraped_content
                )
                db.session.add(turn_result)
                db.session.commit()
                
                # Get expected validations for this turn
                validations = ExpectedValidation.query.filter_by(turn_id=turn.id).all()
                
                # Run validations
                for validation in validations:
                    validation_type = validation.validation_type
                    parameters = validation.get_parameters()
                    
                    # Add scraped content to context if available
                    if scraped_content and validation_type in ['factual_consistency', 'contextual_relevance', 'faithfulness']:
                        if 'context' in parameters:
                            parameters['context'] = f"{parameters['context']}\n\n{scraped_content}"
                        else:
                            parameters['context'] = scraped_content
                    
                    # Run validation
                    try:
                        result = self.validator.validate(validation_type, agent_response, parameters)
                        
                        # Create validation result
                        validation_result = ValidationResult(
                            turn_result_id=turn_result.id,
                            validation_id=validation.id,
                            is_passed=result['passed'],
                            score=result.get('score'),
                            details=json.dumps(result)
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
            
            return test_run.id
            
        except Exception as e:
            logger.error(f"Error running test case {test_case_id}: {str(e)}")
            
            # Try to end the session if it exists
            if hasattr(self.agent_connector, 'session_id') and self.agent_connector.session_id:
                try:
                    self.agent_connector.end_session()
                except Exception as end_err:
                    logger.warning(f"Failed to end session after error: {str(end_err)}")
            
            test_run.status = 'failed'
            test_run.completed_at = datetime.utcnow()
            db.session.commit()
            raise
    
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