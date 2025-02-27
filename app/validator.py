import re
import json
import logging
from deepeval.metrics import (
    AnswerRelevancyMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric
)
from deepeval.test_case import LLMTestCase
from deepeval import evaluate

logger = logging.getLogger(__name__)

class ResponseValidator:
    """Validator for evaluating AI Agent responses."""
    
    def __init__(self, api_key=None):
        """Initialize the validator.
        
        Args:
            api_key (str, optional): DeepEval API key
        """
        self.api_key = api_key
        
        # Define standard thresholds for metrics
        self.default_thresholds = {
            'answer_relevancy': 0.7,
            'contextual_relevancy': 0.7,
            'faithfulness': 0.7
        }
    
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
    
    def run_deepeval_metrics(self, response, question=None, context=None, metrics=None, thresholds=None):
        """Run DeepEval metrics on the response.
        
        Args:
            response (str): AI Agent response
            question (str, optional): Question or input that prompted the response
            context (str, optional): Retrieved context used for the response
            metrics (list, optional): List of metric names to run
            thresholds (dict, optional): Custom thresholds for metrics
            
        Returns:
            dict: Results from all run metrics
        """
        if metrics is None:
            # Default to running all available metrics based on inputs
            metrics = []
            if question:
                metrics.append('answer_relevancy')
            if context:
                metrics.append('contextual_relevancy')
                metrics.append('faithfulness')
        
        if thresholds is None:
            thresholds = self.default_thresholds
        
        # Create a test case for DeepEval
        test_case = LLMTestCase(
            input=question or "",
            actual_output=response,
            retrieval_context=[context] if context else []
        )
        
        # Initialize metric instances based on the specified metrics
        metric_instances = []
        
        for metric_name in metrics:
            if metric_name == 'answer_relevancy':
                metric_instances.append(
                    AnswerRelevancyMetric(threshold=thresholds.get('answer_relevancy', self.default_thresholds['answer_relevancy']))
                )
            elif metric_name == 'contextual_relevancy':
                metric_instances.append(
                    ContextualRelevancyMetric(threshold=thresholds.get('contextual_relevancy', self.default_thresholds['contextual_relevancy']))
                )
            elif metric_name == 'faithfulness':
                metric_instances.append(
                    FaithfulnessMetric(threshold=thresholds.get('faithfulness', self.default_thresholds['faithfulness']))
                )
        
        # Run all metrics against the test case
        results = {}
        
        for metric in metric_instances:
            try:
                # Run the metric
                metric.measure(test_case)
                
                # Store the result
                metric_name = metric.__class__.__name__.replace('Metric', '').lower()
                results[metric_name] = {
                    'type': metric_name,
                    'passed': metric.is_successful(),
                    'score': metric.score,
                    'details': metric.reason or "Evaluation completed"
                }
            except Exception as e:
                logger.error(f"Failed to evaluate {metric.__class__.__name__}: {str(e)}")
                metric_name = metric.__class__.__name__.replace('Metric', '').lower()
                results[metric_name] = {
                    'type': metric_name,
                    'passed': False,
                    'score': 0.0,
                    'details': f"Error evaluating {metric_name}: {str(e)}"
                }
        
        return results
    
    def validate_memory_retention(self, response, reference_info, turn_history=None):
        """Check if the response correctly remembers information from earlier turns.
        
        Args:
            response (str): Current AI Agent response to validate
            reference_info (str): Key information that should be remembered
            turn_history (list, optional): List of previous turns for context
            
        Returns:
            dict: Validation result
        """
        # Basic validation - check if the reference info is in the response
        basic_contains = self.validate_contains(
            response=response,
            expected_text=reference_info,
            case_sensitive=False
        )
        
        if basic_contains['passed']:
            return {
                'type': 'memory_retention',
                'passed': True,
                'score': 1.0,
                'details': f"Agent correctly remembered the reference information: '{reference_info}'"
            }
        
        # More advanced - check if semantically similar information is present
        # This would ideally use a semantic similarity check
        try:
            # Create a test case for semantic similarity
            test_case = LLMTestCase(
                input="Recall the following information: " + reference_info,
                actual_output=response
            )
            
            # Use answer relevancy as a proxy for memory recall
            metric = AnswerRelevancyMetric(threshold=0.6)  # Lower threshold for recall
            metric.measure(test_case)
            
            passed = metric.is_successful()
            score = metric.score
            
            return {
                'type': 'memory_retention',
                'passed': passed,
                'score': score,
                'details': f"Memory retention check: Agent {'successfully' if passed else 'failed to'} recall information with score {score:.2f}"
            }
        except Exception as e:
            logger.error(f"Error in memory retention validation: {str(e)}")
            return {
                'type': 'memory_retention',
                'passed': False,
                'score': 0.0,
                'details': f"Error evaluating memory retention: {str(e)}"
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
        # Basic validation types
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
        elif validation_type == 'memory_retention':
            return self.validate_memory_retention(
                response=response,
                reference_info=parameters.get('reference_info', ''),
                turn_history=parameters.get('turn_history', [])
            )
        
        # DeepEval metrics
        elif validation_type in ['answer_relevancy', 'contextual_relevancy', 'faithfulness']:
            # Extract relevant parameters
            question = parameters.get('question', '')
            context = parameters.get('context', '')
            threshold = parameters.get('threshold', self.default_thresholds.get(validation_type, 0.7))
            
            # Create custom thresholds dict for this specific validation
            thresholds = {validation_type: threshold}
            
            # Run the metric
            results = self.run_deepeval_metrics(
                response=response,
                question=question,
                context=context,
                metrics=[validation_type],
                thresholds=thresholds
            )
            
            # Return the result for the requested metric
            return results.get(validation_type.replace('_relevancy', '').replace('_', ''), {
                'type': validation_type,
                'passed': False,
                'score': 0.0,
                'details': f"Failed to evaluate {validation_type}"
            })
        
        # Unknown validation type
        else:
            return {
                'type': validation_type,
                'passed': False,
                'score': 0.0,
                'details': f"Unknown validation type: {validation_type}"
            }