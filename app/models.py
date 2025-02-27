import json
from datetime import datetime
from app import db
import logging

logger = logging.getLogger(__name__)


test_case_tags = db.Table('test_case_tags',
    db.Column('test_case_id', db.Integer, db.ForeignKey('test_cases.id'), primary_key=True),
    db.Column('tag_id', db.Integer, db.ForeignKey('tags.id'), primary_key=True)
)

class TestMetrics(db.Model):
    """Model for storing aggregated test metrics for trend analysis."""
    __tablename__ = 'test_metrics'
    
    id = db.Column(db.Integer, primary_key=True)
    test_case_id = db.Column(db.Integer, db.ForeignKey('test_cases.id'), nullable=False)
    test_run_id = db.Column(db.Integer, db.ForeignKey('test_runs.id'), nullable=False)
    date = db.Column(db.Date, default=datetime.utcnow().date)
    
    # Validation metrics
    validation_total = db.Column(db.Integer, default=0)
    validation_passed = db.Column(db.Integer, default=0)
    validation_failed = db.Column(db.Integer, default=0)
    pass_rate = db.Column(db.Float, default=0.0)
    
    # Response time metrics (milliseconds)
    avg_response_time = db.Column(db.Integer)
    min_response_time = db.Column(db.Integer)
    max_response_time = db.Column(db.Integer)
    
    # Common failure categories
    failure_categories = db.Column(db.Text)  # JSON-encoded summary of failure types
    
    # Relationships
    test_case = db.relationship('TestCase', back_populates='metrics')
    test_run = db.relationship('TestRun', back_populates='metrics')
    
    def __repr__(self):
        return f'<TestMetrics for TestCase {self.test_case_id}, Run {self.test_run_id}>'
    
    @classmethod
    def create_from_test_run(cls, test_run_id):
        """Create metrics record from a test run."""
        from app.test_runner import TestRunner
        from flask import current_app
        
        try:
            # Get test run
            test_run = TestRun.query.get(test_run_id)
            if not test_run:
                return None
            
            # Get test results
            test_runner = TestRunner(current_app.config)
            results = test_runner.get_test_results(test_run_id)
            
            # Calculate response times
            response_times = []
            failure_types = {}
            
            for turn_result in TurnResult.query.filter_by(test_run_id=test_run_id).all():
                # Calculate response time if available
                if hasattr(turn_result, 'response_time_ms') and turn_result.response_time_ms:
                    response_times.append(turn_result.response_time_ms)
                
                # Analyze failures
                for validation_result in ValidationResult.query.filter_by(turn_result_id=turn_result.id).all():
                    if not validation_result.is_passed:
                        validation = ExpectedValidation.query.get(validation_result.validation_id)
                        failure_type = validation.validation_type
                        failure_types[failure_type] = failure_types.get(failure_type, 0) + 1
            
            # Create metrics record
            metrics = cls(
                test_case_id=test_run.test_case_id,
                test_run_id=test_run_id,
                validation_total=results['validation_counts']['total'],
                validation_passed=results['validation_counts']['passed'],
                validation_failed=results['validation_counts']['failed'],
                pass_rate=results['pass_percentage'],
                avg_response_time=int(sum(response_times) / len(response_times)) if response_times else None,
                min_response_time=min(response_times) if response_times else None,
                max_response_time=max(response_times) if response_times else None,
                failure_categories=json.dumps(failure_types)
            )
            
            db.session.add(metrics)
            db.session.commit()
            
            return metrics
            
        except Exception as e:
            db.session.rollback()
            return None

class TestCase(db.Model):
    """Test case model that represents a full conversation test with an AI Agent."""
    __tablename__ = 'test_cases'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=True)
    
    tags = db.relationship('Tag', secondary=test_case_tags, back_populates='test_cases')

    # Relationship with conversation turns
    turns = db.relationship('ConversationTurn', backref='test_case', lazy=True, cascade='all, delete-orphan')
    # Relationship with test runs
    runs = db.relationship('TestRun', backref='test_case', lazy=True, cascade='all, delete-orphan')

    metrics = db.relationship('TestMetrics', back_populates='test_case', lazy=True)
    

    def __repr__(self):
        return f'<TestCase {self.name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'turns': [turn.to_dict() for turn in self.turns]
        }
    
    def add_tag(self, tag_name, color='primary'):
        """Add a tag to the test case."""
        tag = Tag.query.filter_by(name=tag_name).first()
        if not tag:
            tag = Tag(name=tag_name, color=color)
            db.session.add(tag)
        
        if tag not in self.tags:
            self.tags.append(tag)
        
        return tag

    def remove_tag(self, tag_name):
        """Remove a tag from the test case."""
        tag = Tag.query.filter_by(name=tag_name).first()
        if tag and tag in self.tags:
            self.tags.remove(tag)
        
        return True

class ConversationTurn(db.Model):
    """Represents a single turn in a conversation test case."""
    __tablename__ = 'conversation_turns'
    
    id = db.Column(db.Integer, primary_key=True)
    test_case_id = db.Column(db.Integer, db.ForeignKey('test_cases.id'), nullable=False)
    order = db.Column(db.Integer, nullable=False)  # Order of the turn in the conversation
    user_input = db.Column(db.Text, nullable=False)
    
    # Expected response validations
    expected_validations = db.relationship('ExpectedValidation', backref='turn', lazy=True, cascade='all, delete-orphan')
    
    def __repr__(self):
        return f'<ConversationTurn {self.order} for TestCase {self.test_case_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'test_case_id': self.test_case_id,
            'order': self.order,
            'user_input': self.user_input,
            'expected_validations': [validation.to_dict() for validation in self.expected_validations]
        }

class ExpectedValidation(db.Model):
    """Represents an expected validation for a conversation turn response."""
    __tablename__ = 'expected_validations'
    
    id = db.Column(db.Integer, primary_key=True)
    turn_id = db.Column(db.Integer, db.ForeignKey('conversation_turns.id'), nullable=False)
    validation_type = db.Column(db.String(50), nullable=False)  # e.g., 'contains', 'regex', 'similarity', etc.
    validation_parameters = db.Column(db.Text, nullable=False)  # JSON-encoded parameters for the validation
    
    def __repr__(self):
        return f'<ExpectedValidation {self.validation_type} for Turn {self.turn_id}>'
    
    def get_parameters(self):
        """Convert JSON-encoded parameters to dictionary."""
        try:
            return json.loads(self.validation_parameters)
        except json.JSONDecodeError:
            logger.error(f"Failed to parse validation parameters as JSON: {self.validation_parameters}")
            return {"raw_input": self.validation_parameters}  # Return a dictionary with the raw string
        except Exception as e:
            logger.error(f"Unexpected error parsing validation parameters: {str(e)}")
            return {}  # Return an empty dictionary as fallback
    
    def to_dict(self):
        return {
            'id': self.id,
            'turn_id': self.turn_id,
            'validation_type': self.validation_type,
            'validation_parameters': self.get_parameters()
        }

class TestRun(db.Model):
    """Represents a specific execution of a test case."""
    __tablename__ = 'test_runs'
    
    id = db.Column(db.Integer, primary_key=True)
    test_case_id = db.Column(db.Integer, db.ForeignKey('test_cases.id'), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default='running')  # 'running', 'completed', 'failed'
    
    # Relationship with turn results
    turn_results = db.relationship('TurnResult', backref='test_run', lazy=True, cascade='all, delete-orphan')
    metrics = db.relationship('TestMetrics', uselist=False, back_populates='test_run', lazy=True)

    def __repr__(self):
        return f'<TestRun {self.id} for TestCase {self.test_case_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'test_case_id': self.test_case_id,
            'started_at': self.started_at.isoformat(),
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'status': self.status,
            'turn_results': [result.to_dict() for result in self.turn_results]
        }

class TurnResult(db.Model):
    """Represents the result of a specific conversation turn in a test run."""
    __tablename__ = 'turn_results'
    
    id = db.Column(db.Integer, primary_key=True)
    test_run_id = db.Column(db.Integer, db.ForeignKey('test_runs.id'), nullable=False)
    turn_id = db.Column(db.Integer, db.ForeignKey('conversation_turns.id'), nullable=False)
    agent_response = db.Column(db.Text, nullable=True)
    scraped_content = db.Column(db.Text, nullable=True)  # Scraped content if URLs were detected
    response_time_ms = db.Column(db.Integer)
    
    # Relationship with validation results
    validation_results = db.relationship('ValidationResult', backref='turn_result', lazy=True, cascade='all, delete-orphan')
    
    def __repr__(self):
        return f'<TurnResult for Turn {self.turn_id} in TestRun {self.test_run_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'test_run_id': self.test_run_id,
            'turn_id': self.turn_id,
            'agent_response': self.agent_response,
            'scraped_content': self.scraped_content,
            'validation_results': [result.to_dict() for result in self.validation_results]
        }

class Tag(db.Model):
    """Tag model for categorizing test cases."""
    __tablename__ = 'tags'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    color = db.Column(db.String(20), nullable=False, default='primary')
    
    # Relationship with test cases
    test_cases = db.relationship('TestCase', secondary=test_case_tags, back_populates='tags')
    
    def __repr__(self):
        return f'<Tag {self.name}>'

class Category(db.Model):
    """Category model for organizing test cases."""
    __tablename__ = 'categories'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    
    # Relationship with test cases
    test_cases = db.relationship('TestCase', backref='category', lazy=True)
    
    def __repr__(self):
        return f'<Category {self.name}>'

# Update TestCase model

# Add methods to TestCase class
def add_tag(self, tag_name, color='primary'):
    """Add a tag to the test case."""
    tag = Tag.query.filter_by(name=tag_name).first()
    if not tag:
        tag = Tag(name=tag_name, color=color)
        db.session.add(tag)
    
    if tag not in self.tags:
        self.tags.append(tag)
    
    return tag

def remove_tag(self, tag_name):
    """Remove a tag from the test case."""
    tag = Tag.query.filter_by(name=tag_name).first()
    if tag and tag in self.tags:
        self.tags.remove(tag)
    
    return True

class ValidationResult(db.Model):
    """Represents the result of a validation check for a turn result."""
    __tablename__ = 'validation_results'
    
    id = db.Column(db.Integer, primary_key=True)
    turn_result_id = db.Column(db.Integer, db.ForeignKey('turn_results.id'), nullable=False)
    validation_id = db.Column(db.Integer, db.ForeignKey('expected_validations.id'), nullable=False)
    is_passed = db.Column(db.Boolean, nullable=False)
    score = db.Column(db.Float, nullable=True)  # For similarity or other numeric scores
    details = db.Column(db.Text, nullable=True)  # Additional details or explanation
    
    def __repr__(self):
        return f'<ValidationResult for Validation {self.validation_id} in TurnResult {self.turn_result_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'turn_result_id': self.turn_result_id,
            'validation_id': self.validation_id,
            'is_passed': self.is_passed,
            'score': self.score,
            'details': self.details
        }