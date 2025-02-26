import re
import json
import logging
from deepeval.metrics import (
    AnswerRelevancyMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric
)
from deepeval.test_case import LLMTestCase

logger = logging.getLogger(__name__)

class ResponseValidator:
    """Validator for evaluating AI Agent responses."""
    
    def __init__(self, api_key=None):
        """Initialize the validator.
        
        Args:
            api_key (str, optional): DeepEval API key
        """
        self.api_key = api_key
    
    def validate_contains(self, response, expected_text, case_sensitive=True):
        """Check if response contains expected text.
        
        Args:
            response (str): AI Agent response
            expected_text (str): Text expected to be in the response
            case_sensitive (bool): Whether to perform case-sensitive matching
            
        Returns:
            dict: Validation result
        """
        if not case_sensitive:
            response = response.lower()
            expected_text = expected_text.lower()
        
        is_contained = expected_text in response
        
        return {
            'type': 'contains',
            'passed': is_contained,
            'score': 1.0 if is_contained else 0.0,
            'details': f"Expected text {'found' if is_contained else 'not found'} in response"
        }
    
    def validate_not_contains(self, response, excluded_text, case_sensitive=True):
        """Check if response does not contain excluded text.
        
        Args:
            response (str): AI Agent response
            excluded_text (str): Text expected to be absent from the response
            case_sensitive (bool): Whether to perform case-sensitive matching
            
        Returns:
            dict: Validation result
        """
        if not case_sensitive:
            response = response.lower()
            excluded_text = excluded_text.lower()
        
        is_excluded = excluded_text not in response
        
        return {
            'type': 'not_contains',
            'passed': is_excluded,
            'score': 1.0 if is_excluded else 0.0,
            'details': f"Excluded text {'not found' if is_excluded else 'found'} in response"
        }
    
    def validate_regex(self, response, pattern, expected_match=True):
        """Check if response matches a regex pattern.
        
        Args:
            response (str): AI Agent response
            pattern (str): Regex pattern to match
            expected_match (bool): Whether a match is expected
            
        Returns:
            dict: Validation result
        """
        try:
            matches = re.findall(pattern, response)
            has_match = len(matches) > 0
            
            passed = has_match if expected_match else not has_match
            
            return {
                'type': 'regex',
                'passed': passed,
                'score': 1.0 if passed else 0.0,
                'details': f"Pattern {'matched' if has_match else 'not matched'} in response",
                'matches': matches if has_match else []
            }
        except re.error as e:
            return {
                'type': 'regex',
                'passed': False,
                'score': 0.0,
                'details': f"Invalid regex pattern: {str(e)}",
                'matches': []
            }
    
    def validate_answer_relevancy(self, response, question, threshold=0.7):
        """Check if response is relevant to the question.
        
        Args:
            response (str): AI Agent response
            question (str): Question to check relevance against
            threshold (float): Minimum score to pass
            
        Returns:
            dict: Validation result
        """
        try:
            # Create a test case
            test_case = LLMTestCase(
                input=question,
                actual_output=response
            )
            
            # Create the metric with the threshold
            metric = AnswerRelevancyMetric(threshold=threshold)
            
            # Measure using the test case
            metric.measure(test_case)
            
            # Get results
            passed = metric.is_successful()
            score = metric.score
            reason = metric.reason
            
            return {
                'type': 'answer_relevancy',
                'passed': passed,
                'score': score,
                'details': reason if reason else "Evaluation completed"
            }
        except Exception as e:
            logger.error(f"Failed to evaluate answer relevancy: {str(e)}")
            return {
                'type': 'answer_relevancy',
                'passed': False,
                'score': 0.0,
                'details': f"Error evaluating answer relevancy: {str(e)}"
            }
    
    def validate_contextual_relevancy(self, response, context, threshold=0.7):
        """Check if response is contextually relevant.
        
        Args:
            response (str): AI Agent response
            context (str): Context to check relevance against
            threshold (float): Minimum score to pass
            
        Returns:
            dict: Validation result
        """
        try:
            # Create a test case
            # For context, we need to provide it as a list
            test_case = LLMTestCase(
                input="",  # Empty input as we're just testing contextual relevance
                actual_output=response,
                retrieval_context=[context]
            )
            
            # Create metric
            metric = ContextualRelevancyMetric(threshold=threshold)
            
            # Measure using the test case
            metric.measure(test_case)
            
            # Get results
            passed = metric.is_successful()
            score = metric.score
            reason = metric.reason
            
            return {
                'type': 'contextual_relevancy',
                'passed': passed,
                'score': score,
                'details': reason if reason else "Evaluation completed"
            }
        except Exception as e:
            logger.error(f"Failed to evaluate contextual relevancy: {str(e)}")
            return {
                'type': 'contextual_relevancy',
                'passed': False,
                'score': 0.0,
                'details': f"Error evaluating contextual relevancy: {str(e)}"
            }
    
    def validate_faithfulness(self, response, context, threshold=0.7):
        """Check if response is faithful to the context (factually consistent).
        
        Args:
            response (str): AI Agent response
            context (str): Context to check faithfulness against
            threshold (float): Minimum score to pass
            
        Returns:
            dict: Validation result
        """
        try:
            # Create a test case
            test_case = LLMTestCase(
                input="",  # Empty input as we're just testing faithfulness
                actual_output=response,
                retrieval_context=[context]
            )
            
            # Create the metric
            metric = FaithfulnessMetric(threshold=threshold)
            
            # Measure using the test case
            metric.measure(test_case)
            
            # Get results
            passed = metric.is_successful()
            score = metric.score
            reason = metric.reason
            
            return {
                'type': 'faithfulness',
                'passed': passed,
                'score': score,
                'details': reason if reason else "Evaluation completed"
            }
        except Exception as e:
            logger.error(f"Failed to evaluate faithfulness: {str(e)}")
            return {
                'type': 'faithfulness',
                'passed': False,
                'score': 0.0,
                'details': f"Error evaluating faithfulness: {str(e)}"
            }
    
    def validate(self, validation_type, response, parameters):
        """General validation method that dispatches to specific validation methods.
        
        Args:
            validation_type (str): Type of validation to perform
            response (str): AI Agent response
            parameters (dict): Parameters for the validation
            
        Returns:
            dict: Validation result
        """
        if validation_type == 'contains':
            return self.validate_contains(
                response,
                parameters.get('text', ''),
                parameters.get('case_sensitive', True)
            )
        elif validation_type == 'not_contains':
            return self.validate_not_contains(
                response,
                parameters.get('text', ''),
                parameters.get('case_sensitive', True)
            )
        elif validation_type == 'regex':
            return self.validate_regex(
                response,
                parameters.get('pattern', ''),
                parameters.get('expected_match', True)
            )
        elif validation_type == 'answer_relevancy':
            return self.validate_answer_relevancy(
                response,
                parameters.get('question', ''),
                parameters.get('threshold', 0.7)
            )
        elif validation_type == 'contextual_relevance' or validation_type == 'contextual_relevancy':
            return self.validate_contextual_relevancy(
                response,
                parameters.get('context', ''),
                parameters.get('threshold', 0.7)
            )
        elif validation_type == 'factual_consistency' or validation_type == 'faithfulness':
            return self.validate_faithfulness(
                response,
                parameters.get('context', ''),
                parameters.get('threshold', 0.7)
            )
        else:
            return {
                'type': validation_type,
                'passed': False,
                'score': 0.0,
                'details': f"Unknown validation type: {validation_type}"
            }
    
    def run_all_metrics(self, response, context=None, question=None, thresholds=None):
        """Run all available metrics on a response.
        
        Args:
            response (str): AI Agent response
            context (str, optional): Context for context-based metrics
            question (str, optional): Question for question-based metrics
            thresholds (dict, optional): Custom thresholds for each metric
            
        Returns:
            dict: Results for all metrics that were run
        """
        if thresholds is None:
            thresholds = {}
            
        results = {}
        
        # Run metrics that require a question
        if question:
            results['answer_relevancy'] = self.validate_answer_relevancy(
                response, question, thresholds.get('answer_relevancy', 0.7)
            )
        
        # Run metrics that require context
        if context:
            results['contextual_relevancy'] = self.validate_contextual_relevancy(
                response, context, thresholds.get('contextual_relevancy', 0.7)
            )
            
            results['faithfulness'] = self.validate_faithfulness(
                response, context, thresholds.get('faithfulness', 0.7)
            )
        
        return results
    
    def get_overall_score(self, results):
        """Calculate overall score based on individual metric results.
        
        Args:
            results (dict): Results from running metrics
            
        Returns:
            dict: Overall evaluation including score and passed status
        """
        if not results:
            return {
                'overall_score': 0.0,
                'overall_passed': False,
                'details': "No metrics were evaluated"
            }
        
        total_score = 0.0
        passed_count = 0
        total_count = len(results)
        
        for metric_name, result in results.items():
            if result['passed']:
                passed_count += 1
            total_score += result['score']
        
        average_score = total_score / total_count
        overall_passed = passed_count / total_count >= 0.7  # Pass if at least 70% of metrics passed
        
        return {
            'overall_score': average_score,
            'overall_passed': overall_passed,
            'metrics_passed': passed_count,
            'metrics_total': total_count,
            'details': f"Passed {passed_count}/{total_count} metrics with average score of {average_score:.2f}"
        }