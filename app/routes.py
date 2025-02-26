import json
import csv
import io
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, Response
from app import db
from app.models import TestCase, ConversationTurn, ExpectedValidation, TestRun, TurnResult, ValidationResult
from app.test_runner import TestRunner
from app.agent_connector import AgentConnector, AgentConfig
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Create a blueprint for the main routes
main_bp = Blueprint('main', __name__)

# Helper functions
def get_sf_credentials():
    """Get Salesforce credentials from the request or config."""
    from flask import current_app
    return {
        'org_domain': request.form.get('sf_org_domain') or current_app.config['SF_ORG_DOMAIN'],
        'client_id': request.form.get('sf_client_id') or current_app.config['SF_CLIENT_ID'],
        'client_secret': request.form.get('sf_client_secret') or current_app.config['SF_CLIENT_SECRET'],
        'agent_id': request.form.get('sf_agent_id') or current_app.config['SF_AGENT_ID']
    }

# Routes
@main_bp.route('/')
def index():
    """Home page."""
    return render_template('index.html')

@main_bp.route('/tests')
def test_list():
    """List all test cases."""
    test_cases = TestCase.query.all()
    return render_template('test_list.html', test_cases=test_cases)

@main_bp.route('/tests/create', methods=['GET', 'POST'])
def create_test():
    """Create a new test case."""
    if request.method == 'POST':
        try:
            # Get form data
            name = request.form.get('name')
            description = request.form.get('description')
            
            # Create test case
            test_case = TestCase(name=name, description=description)
            db.session.add(test_case)
            db.session.commit()
            
            # Get turn data
            turn_count = int(request.form.get('turn_count', 0))
            
            for i in range(turn_count):
                order = i + 1
                user_input = request.form.get(f'turn_{i}_input')
                
                if user_input:
                    # Create conversation turn
                    turn = ConversationTurn(
                        test_case_id=test_case.id,
                        order=order,
                        user_input=user_input
                    )
                    db.session.add(turn)
                    db.session.commit()
                    
                    # Get validation data
                    validation_count = int(request.form.get(f'turn_{i}_validation_count', 0))
                    
                    for j in range(validation_count):
                        validation_type = request.form.get(f'turn_{i}_validation_{j}_type')
                        parameters_json = request.form.get(f'turn_{i}_validation_{j}_parameters')
                        
                        if validation_type and parameters_json:
                            try:
                                parameters = json.loads(parameters_json)
                                
                                # Create validation
                                validation = ExpectedValidation(
                                    turn_id=turn.id,
                                    validation_type=validation_type,
                                    validation_parameters=parameters_json
                                )
                                db.session.add(validation)
                                db.session.commit()
                            except json.JSONDecodeError:
                                flash(f'Invalid JSON for validation parameters in turn {order}', 'error')
            
            flash('Test case created successfully', 'success')
            return redirect(url_for('main.test_list'))
        
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error creating test case: {str(e)}")
            flash(f'Error creating test case: {str(e)}', 'error')
    
    return render_template('create_test.html')

@main_bp.route('/tests/<int:test_id>')
def view_test(test_id):
    """View a test case."""
    test_case = TestCase.query.get_or_404(test_id)
    turns = ConversationTurn.query.filter_by(test_case_id=test_id).order_by(ConversationTurn.order).all()
    return render_template('edit_test.html', test_case=test_case, turns=turns)

@main_bp.route('/tests/<int:test_id>/edit', methods=['GET', 'POST'])
def edit_test(test_id):
    """Edit a test case."""
    test_case = TestCase.query.get_or_404(test_id)
    
    if request.method == 'POST':
        try:
            # Update test case
            test_case.name = request.form.get('name')
            test_case.description = request.form.get('description')
            db.session.commit()
            
            # Get existing turns
            existing_turns = ConversationTurn.query.filter_by(test_case_id=test_id).all()
            existing_turn_ids = [turn.id for turn in existing_turns]
            
            # Get updated turn data
            turn_count = int(request.form.get('turn_count', 0))
            updated_turn_ids = []
            
            for i in range(turn_count):
                turn_id = request.form.get(f'turn_{i}_id')
                order = i + 1
                user_input = request.form.get(f'turn_{i}_input')
                
                if turn_id and turn_id.isdigit():
                    # Update existing turn
                    turn_id = int(turn_id)
                    turn = ConversationTurn.query.get(turn_id)
                    
                    if turn:
                        turn.order = order
                        turn.user_input = user_input
                        updated_turn_ids.append(turn_id)
                    else:
                        # Create new turn
                        turn = ConversationTurn(
                            test_case_id=test_id,
                            order=order,
                            user_input=user_input
                        )
                        db.session.add(turn)
                        db.session.commit()
                        updated_turn_ids.append(turn.id)
                else:
                    # Create new turn
                    turn = ConversationTurn(
                        test_case_id=test_id,
                        order=order,
                        user_input=user_input
                    )
                    db.session.add(turn)
                    db.session.commit()
                    updated_turn_ids.append(turn.id)
                
                # Handle validations for this turn
                if turn_id and turn_id.isdigit():
                    turn_id = int(turn_id)
                    turn = ConversationTurn.query.get(turn_id)
                else:
                    turn = ConversationTurn.query.filter_by(test_case_id=test_id, order=order).first()
                
                if turn:
                    # Clear existing validations
                    ExpectedValidation.query.filter_by(turn_id=turn.id).delete()
                    
                    # Add updated validations
                    validation_count = int(request.form.get(f'turn_{i}_validation_count', 0))
                    
                    for j in range(validation_count):
                        validation_type = request.form.get(f'turn_{i}_validation_{j}_type')
                        parameters_json = request.form.get(f'turn_{i}_validation_{j}_parameters')
                        
                        if validation_type and parameters_json:
                            try:
                                parameters = json.loads(parameters_json)
                                
                                # Create validation
                                validation = ExpectedValidation(
                                    turn_id=turn.id,
                                    validation_type=validation_type,
                                    validation_parameters=parameters_json
                                )
                                db.session.add(validation)
                            except json.JSONDecodeError:
                                flash(f'Invalid JSON for validation parameters in turn {order}', 'error')
            
            # Delete turns that were removed
            for turn_id in existing_turn_ids:
                if turn_id not in updated_turn_ids:
                    ConversationTurn.query.filter_by(id=turn_id).delete()
            
            db.session.commit()
            flash('Test case updated successfully', 'success')
            return redirect(url_for('main.test_list'))
        
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error updating test case: {str(e)}")
            flash(f'Error updating test case: {str(e)}', 'error')
    
    # Get turns for the test case
    turns = ConversationTurn.query.filter_by(test_case_id=test_id).order_by(ConversationTurn.order).all()
    
    return render_template('edit_test.html', test_case=test_case, turns=turns)

@main_bp.route('/tests/<int:test_id>/delete', methods=['POST'])
def delete_test(test_id):
    """Delete a test case."""
    test_case = TestCase.query.get_or_404(test_id)
    
    try:
        db.session.delete(test_case)
        db.session.commit()
        flash('Test case deleted successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting test case: {str(e)}")
        flash(f'Error deleting test case: {str(e)}', 'error')
    
    return redirect(url_for('main.test_list'))

@main_bp.route('/tests/<int:test_id>/run', methods=['GET', 'POST'])
def run_test(test_id):
    """Run a test case."""
    test_case = TestCase.query.get_or_404(test_id)
    
    if request.method == 'POST':
        try:
            # Get Salesforce credentials
            credentials = get_sf_credentials()
            
            # Create test runner
            from flask import current_app
            test_runner = TestRunner(current_app.config)
            
            # Update credentials
            agent_config = AgentConfig(
                sf_org_domain=credentials['org_domain'],
                client_id=credentials['client_id'],
                client_secret=credentials['client_secret'],
                agent_id=credentials['agent_id']
            )
            test_runner.agent_connector = AgentConnector(config=agent_config)
            
            # Run test
            test_run_id = test_runner.run_test(test_id)
            
            flash('Test case executed successfully', 'success')
            return redirect(url_for('main.view_test_results', test_run_id=test_run_id))
        
        except Exception as e:
            logger.error(f"Error running test case: {str(e)}")
            flash(f'Error running test case: {str(e)}', 'error')
    
    return render_template('run_test.html', test_case=test_case)

@main_bp.route('/runs')
def test_runs():
    """List all test runs."""
    test_runs = TestRun.query.order_by(TestRun.started_at.desc()).all()
    return render_template('test_runs.html', test_runs=test_runs)

@main_bp.route('/runs/<int:test_run_id>')
def view_test_results(test_run_id):
    """View test run results."""
    try:
        # Get test run
        test_run = TestRun.query.get_or_404(test_run_id)
        
        # Get results
        from flask import current_app
        test_runner = TestRunner(current_app.config)
        results = test_runner.get_test_results(test_run_id)
        
        return render_template('test_results.html', test_run=test_run, results=results)
    
    except Exception as e:
        logger.error(f"Error viewing test results: {str(e)}")
        flash(f'Error viewing test results: {str(e)}', 'error')
        return redirect(url_for('main.test_runs'))

@main_bp.route('/runs/<int:test_run_id>/export')
def export_test_results(test_run_id):
    """Export test run results as CSV."""
    try:
        # Get test run
        test_run = TestRun.query.get_or_404(test_run_id)
        
        # Get CSV
        from flask import current_app
        test_runner = TestRunner(current_app.config)
        csv_content = test_runner.export_results_csv(test_run_id)
        
        # Create response
        output = io.StringIO()
        output.write(csv_content)
        output.seek(0)
        
        test_case = TestCase.query.get(test_run.test_case_id)
        filename = f"{test_case.name.replace(' ', '_')}_results_{test_run_id}.csv"
        
        return Response(
            output,
            mimetype='text/csv',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Type': 'text/csv'
            }
        )
    
    except Exception as e:
        logger.error(f"Error exporting test results: {str(e)}")
        flash(f'Error exporting test results: {str(e)}', 'error')
        return redirect(url_for('main.view_test_results', test_run_id=test_run_id))

@main_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    """Application settings."""
    from flask import current_app
    
    if request.method == 'POST':
        try:
            # Update settings
            sf_org_domain = request.form.get('sf_org_domain')
            sf_client_id = request.form.get('sf_client_id')
            sf_client_secret = request.form.get('sf_client_secret')
            sf_agent_id = request.form.get('sf_agent_id')
            
            if sf_org_domain:
                current_app.config['SF_ORG_DOMAIN'] = sf_org_domain
            if sf_client_id:
                current_app.config['SF_CLIENT_ID'] = sf_client_id
            if sf_client_secret:
                current_app.config['SF_CLIENT_SECRET'] = sf_client_secret
            if sf_agent_id:
                current_app.config['SF_AGENT_ID'] = sf_agent_id
            
            flash('Settings updated successfully', 'success')
        except Exception as e:
            logger.error(f"Error updating settings: {str(e)}")
            flash(f'Error updating settings: {str(e)}', 'error')
    
    return render_template('settings.html')

# API endpoints for AJAX requests
@main_bp.route('/api/validation_types')
def validation_types():
    """Get available validation types and templates."""
    validation_templates = {
        'contains': {
            'description': 'Check if response contains expected text',
            'parameters': {
                'text': 'Expected text to find in response',
                'case_sensitive': True
            }
        },
        'not_contains': {
            'description': 'Check if response does not contain excluded text',
            'parameters': {
                'text': 'Text that should not appear in response',
                'case_sensitive': True
            }
        },
        'regex': {
            'description': 'Check if response matches a regex pattern',
            'parameters': {
                'pattern': 'Regular expression pattern',
                'expected_match': True
            }
        },
        'factual_consistency': {
            'description': 'Check if response is factually consistent with context',
            'parameters': {
                'context': 'Reference context to check against',
                'threshold': 0.7
            }
        },
        'contextual_relevance': {
            'description': 'Check if response is contextually relevant to provided context',
            'parameters': {
                'context': 'Context to check relevance against',
                'threshold': 0.7
            }
        },
        'answer_relevancy': {
            'description': 'Check if response is relevant to the question',
            'parameters': {
                'question': 'Question to check relevance against',
                'threshold': 0.7
            }
        },
        'correctness': {
            'description': 'Check if response is correct compared to reference answer',
            'parameters': {
                'question': 'Question asked',
                'reference_answer': 'Expected answer',
                'threshold': 0.7
            }
        },
        'harmlessness': {
            'description': 'Check if response is harmless',
            'parameters': {
                'threshold': 0.9
            }
        },
        'linguistic_proficiency': {
            'description': 'Check linguistic proficiency of response',
            'parameters': {
                'threshold': 0.7
            }
        }
    }
    
    return jsonify(validation_templates)