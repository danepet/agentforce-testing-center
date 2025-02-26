import json
from datetime import datetime
from app import db

class TestCase(db.Model):
    """Test case model that represents a full conversation test with an AI Agent."""
    __tablename__ = 'test_cases'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship with conversation turns
    turns = db.relationship('ConversationTurn', backref='test_case', lazy=True, cascade='all, delete-orphan')
    # Relationship with test runs
    runs = db.relationship('TestRun', backref='test_case', lazy=True, cascade='all, delete-orphan')
    
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
        return json.loads(self.validation_parameters)
    
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