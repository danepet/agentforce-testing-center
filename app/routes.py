import json
import csv
import io
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, Response
from app import db
from app.models import TestCase, ConversationTurn, ExpectedValidation, TestRun, TurnResult, ValidationResult, Tag, Category, TestMetrics
from app.test_runner import TestRunner
from app.agent_connector import AgentConnector, AgentConfig
from datetime import datetime
from app.test_runner import TestRunner, ParallelTestRunner
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
    """List all test cases with filtering options."""
    # Get filter parameters
    tag_id = request.args.get('tag_id')
    category_id = request.args.get('category_id')
    search = request.args.get('search')
    
    # Base query
    query = TestCase.query
    
    # Apply filters
    if tag_id:
        tag = Tag.query.get(int(tag_id))
        if tag:
            query = query.filter(TestCase.tags.contains(tag))
    
    if category_id:
        query = query.filter(TestCase.category_id == int(category_id))
    
    if search:
        query = query.filter(TestCase.name.ilike(f'%{search}%') | TestCase.description.ilike(f'%{search}%'))
    
    # Get test cases
    test_cases = query.all()
    
    # Get all tags and categories for filtering
    all_tags = Tag.query.all()
    all_categories = Category.query.all()
    
    return render_template(
        'test_list.html', 
        test_cases=test_cases,
        all_tags=all_tags,
        all_categories=all_categories,
        selected_tag_id=tag_id,
        selected_category_id=category_id,
        search=search
    )

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
            
            # Get HTML selector if provided
            html_selector = request.form.get('html_selector')
            
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
            
            # Run test with HTML selector if provided
            test_run_id = test_runner.run_test(test_id, html_selector)
            
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

@main_bp.route('/dashboard')
def dashboard():
    """Dashboard showing test metrics and trends."""
    from sqlalchemy import func
    from datetime import datetime, timedelta
    
    # Get time range from query parameter or default to 30 days
    time_range = request.args.get('time_range', 'Last 30 Days')
    
    # Calculate date range based on selected time range
    today = datetime.utcnow().date()
    if time_range == 'Last 7 Days':
        start_date = today - timedelta(days=7)
    elif time_range == 'Last 30 Days':
        start_date = today - timedelta(days=30)
    elif time_range == 'Last 90 Days':
        start_date = today - timedelta(days=90)
    else:  # All Time
        start_date = None
    
    # Base query for metrics
    metrics_query = TestMetrics.query
    
    # Apply date filter if not "All Time"
    if start_date:
        metrics_query = metrics_query.filter(TestMetrics.date >= start_date)
    
    # Get metrics for charts
    metrics_data = metrics_query.order_by(TestMetrics.date).all()
    
    # Prepare data for success rate trend chart
    dates = []
    success_rates = []
    response_times = []
    
    # Group metrics by date for trends
    date_metrics = {}
    for metric in metrics_data:
        date_str = metric.date.strftime('%Y-%m-%d')
        if date_str not in date_metrics:
            date_metrics[date_str] = {
                'pass_rates': [],
                'response_times': []
            }
        
        date_metrics[date_str]['pass_rates'].append(metric.pass_rate)
        if metric.avg_response_time:
            date_metrics[date_str]['response_times'].append(metric.avg_response_time)
    
    # Calculate averages for each date
    for date_str, data in sorted(date_metrics.items()):
        dates.append(date_str)
        success_rates.append(sum(data['pass_rates']) / len(data['pass_rates']) if data['pass_rates'] else 0)
        response_times.append(sum(data['response_times']) / len(data['response_times']) if data['response_times'] else 0)
    
    # Get test case performance data
    test_case_data = {}
    for metric in metrics_data:
        if metric.test_case_id not in test_case_data:
            test_case_data[metric.test_case_id] = {
                'name': TestCase.query.get(metric.test_case_id).name,
                'pass_rates': []
            }
        
        test_case_data[metric.test_case_id]['pass_rates'].append(metric.pass_rate)
    
    # Calculate average pass rate for each test case
    test_case_names = []
    test_case_pass_rates = []
    
    for test_id, data in test_case_data.items():
        test_case_names.append(data['name'])
        test_case_pass_rates.append(sum(data['pass_rates']) / len(data['pass_rates']) if data['pass_rates'] else 0)
    
    # Get failure category data
    failure_types = {}
    for metric in metrics_data:
        if metric.failure_categories:
            failures = json.loads(metric.failure_categories)
            for failure_type, count in failures.items():
                failure_types[failure_type] = failure_types.get(failure_type, 0) + count
    
    # Sort and limit to top 5 failure types
    top_failures = sorted(failure_types.items(), key=lambda x: x[1], reverse=True)[:5]
    failure_type_labels = [item[0] for item in top_failures]
    failure_type_counts = [item[1] for item in top_failures]
    
    # Get summary metrics
    total_runs = len(set(metric.test_run_id for metric in metrics_data))
    avg_pass_rate = sum(success_rates) / len(success_rates) if success_rates else 0
    avg_response_time = int(sum(response_times) / len(response_times)) if response_times else 0
    top_failure_type = failure_type_labels[0] if failure_type_labels else 'None'
    
    # Get recent test runs
    recent_runs = TestRun.query.order_by(TestRun.started_at.desc()).limit(10).all()
    
    # Prepare chart data
    chart_data = {
        'dates': dates,
        'success_rates': success_rates,
        'response_times': response_times,
        'test_case_names': test_case_names,
        'test_case_pass_rates': test_case_pass_rates,
        'failure_types': failure_type_labels,
        'failure_counts': failure_type_counts
    }
    
    # Prepare summary metrics
    metrics_summary = {
        'total_runs': total_runs,
        'avg_pass_rate': avg_pass_rate,
        'avg_response_time': avg_response_time,
        'top_failure_type': top_failure_type
    }
    
    return render_template(
        'dashboard.html', 
        time_range=time_range,
        chart_data=chart_data,
        metrics=metrics_summary,
        recent_runs=recent_runs
    )

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
        'answer_relevancy': {
            'description': 'Check if response is relevant to the question',
            'parameters': {
                'question': 'Question asked to the agent'
            }
        },
        'contextual_relevancy': {
            'description': 'Check if response is contextually relevant to provided context and/or scraped content',
            'parameters': {
                'context': 'Optional baseline context (automatically supplemented with scraped content)'
            }
        },
        'faithfulness': {
            'description': 'Check if response is factually consistent with the context and/or scraped content',
            'parameters': {
                'context': 'Optional baseline context (automatically supplemented with scraped content)'
            }
        }
    }
    
    return jsonify(validation_templates)

# TAGS AND CATEGORIES
@main_bp.route('/tags')
def manage_tags():
    """Manage tags."""
    tags = Tag.query.all()
    return render_template('manage_tags.html', tags=tags)

@main_bp.route('/tags/create', methods=['POST'])
def create_tag():
    """Create a new tag."""
    try:
        name = request.form.get('name')
        color = request.form.get('color', 'primary')
        
        if not name:
            flash('Tag name is required', 'error')
            return redirect(url_for('main.manage_tags'))
        
        # Check if tag already exists
        existing_tag = Tag.query.filter_by(name=name).first()
        if existing_tag:
            flash(f'Tag "{name}" already exists', 'warning')
            return redirect(url_for('main.manage_tags'))
        
        # Create tag
        tag = Tag(name=name, color=color)
        db.session.add(tag)
        db.session.commit()
        
        flash(f'Tag "{name}" created successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creating tag: {str(e)}")
        flash(f'Error creating tag: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_tags'))

@main_bp.route('/tags/<int:tag_id>/edit', methods=['POST'])
def edit_tag(tag_id):
    """Edit a tag."""
    try:
        tag = Tag.query.get_or_404(tag_id)
        
        name = request.form.get('name')
        color = request.form.get('color')
        
        if not name:
            flash('Tag name is required', 'error')
            return redirect(url_for('main.manage_tags'))
        
        # Check if name is already used by another tag
        existing_tag = Tag.query.filter(Tag.name == name, Tag.id != tag_id).first()
        if existing_tag:
            flash(f'Tag name "{name}" is already in use', 'warning')
            return redirect(url_for('main.manage_tags'))
        
        # Update tag
        tag.name = name
        tag.color = color
        db.session.commit()
        
        flash(f'Tag "{name}" updated successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating tag: {str(e)}")
        flash(f'Error updating tag: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_tags'))

@main_bp.route('/tags/<int:tag_id>/delete', methods=['POST'])
def delete_tag(tag_id):
    """Delete a tag."""
    try:
        tag = Tag.query.get_or_404(tag_id)
        
        # Check if tag is in use
        if tag.test_cases:
            flash(f'Cannot delete tag "{tag.name}" because it is used by {len(tag.test_cases)} test cases', 'warning')
            return redirect(url_for('main.manage_tags'))
        
        db.session.delete(tag)
        db.session.commit()
        
        flash(f'Tag "{tag.name}" deleted successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting tag: {str(e)}")
        flash(f'Error deleting tag: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_tags'))

@main_bp.route('/categories')
def manage_categories():
    """Manage categories."""
    categories = Category.query.all()
    return render_template('manage_categories.html', categories=categories)

@main_bp.route('/categories/create', methods=['POST'])
def create_category():
    """Create a new category."""
    try:
        name = request.form.get('name')
        description = request.form.get('description')
        
        if not name:
            flash('Category name is required', 'error')
            return redirect(url_for('main.manage_categories'))
        
        # Check if category already exists
        existing_category = Category.query.filter_by(name=name).first()
        if existing_category:
            flash(f'Category "{name}" already exists', 'warning')
            return redirect(url_for('main.manage_categories'))
        
        # Create category
        category = Category(name=name, description=description)
        db.session.add(category)
        db.session.commit()
        
        flash(f'Category "{name}" created successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creating category: {str(e)}")
        flash(f'Error creating category: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_categories'))
@main_bp.route('/categories/<int:category_id>/edit', methods=['POST'])
def edit_category(category_id):
    """Edit a category."""
    try:
        category = Category.query.get_or_404(category_id)
        
        name = request.form.get('name')
        description = request.form.get('description')
        
        if not name:
            flash('Category name is required', 'error')
            return redirect(url_for('main.manage_categories'))
        
        # Check if name is already used by another category
        existing_category = Category.query.filter(Category.name == name, Category.id != category_id).first()
        if existing_category:
            flash(f'Category name "{name}" is already in use', 'warning')
            return redirect(url_for('main.manage_categories'))
        
        # Update category
        category.name = name
        category.description = description
        db.session.commit()
        
        flash(f'Category "{name}" updated successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating category: {str(e)}")
        flash(f'Error updating category: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_categories'))

@main_bp.route('/categories/<int:category_id>/delete', methods=['POST'])
def delete_category(category_id):
    """Delete a category."""
    try:
        category = Category.query.get_or_404(category_id)
        
        # Check if category is in use
        test_cases = TestCase.query.filter_by(category_id=category_id).all()
        if test_cases:
            flash(f'Cannot delete category "{category.name}" because it is used by {len(test_cases)} test cases', 'warning')
            return redirect(url_for('main.manage_categories'))
        
        db.session.delete(category)
        db.session.commit()
        
        flash(f'Category "{category.name}" deleted successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting category: {str(e)}")
        flash(f'Error deleting category: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_categories'))

@main_bp.route('/categories/<int:category_id>/delete', methods=['POST'])
def delete_category(category_id):
    """Delete a category."""
    try:
        category = Category.query.get_or_404(category_id)
        
        # Check if category is in use
        test_cases = TestCase.query.filter_by(category_id=category_id).all()
        if test_cases:
            flash(f'Cannot delete category "{category.name}" because it is used by {len(test_cases)} test cases', 'warning')
            return redirect(url_for('main.manage_categories'))
        
        db.session.delete(category)
        db.session.commit()
        
        flash(f'Category "{category.name}" deleted successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting category: {str(e)}")
        flash(f'Error deleting category: {str(e)}', 'error')
    
    return redirect(url_for('main.manage_categories'))

@main_bp.route('/tests/<int:test_id>/tags', methods=['POST'])
def update_test_tags(test_id):
    """Update tags for a test case."""
    try:
        test_case = TestCase.query.get_or_404(test_id)
        
        # Get selected tags
        tag_ids = request.form.getlist('tag_ids')
        
        # Clear existing tags
        test_case.tags = []
        
        # Add selected tags
        for tag_id in tag_ids:
            tag = Tag.query.get(int(tag_id))
            if tag:
                test_case.tags.append(tag)
        
        db.session.commit()
        
        flash('Test case tags updated successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating test case tags: {str(e)}")
        flash(f'Error updating test case tags: {str(e)}', 'error')
    
    return redirect(url_for('main.view_test', test_id=test_id))

@main_bp.route('/tests/<int:test_id>/category', methods=['POST'])
def update_test_category(test_id):
    """Update category for a test case."""
    try:
        test_case = TestCase.query.get_or_404(test_id)
        
        # Get selected category
        category_id = request.form.get('category_id')
        
        if category_id:
            test_case.category_id = int(category_id)
        else:
            test_case.category_id = None
        
        db.session.commit()
        
        flash('Test case category updated successfully', 'success')
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating test case category: {str(e)}")
        flash(f'Error updating test case category: {str(e)}', 'error')
    
    return redirect(url_for('main.view_test', test_id=test_id))

# Add this to your app/routes.py file

@main_bp.route('/tests/run-multiple', methods=['GET', 'POST'])
def run_multiple_tests():
    """Run multiple test cases in parallel."""
    if request.method == 'POST':
        try:
            # Get selected test cases
            selected_test_ids = request.form.getlist('test_ids')
            if not selected_test_ids:
                flash('No test cases selected', 'warning')
                return redirect(url_for('main.test_list'))
            
            # Convert to integers
            test_ids = [int(id) for id in selected_test_ids]
            
            # Get credentials
            credentials = get_sf_credentials()
            
            # Get HTML selector
            html_selector = request.form.get('html_selector')
            
            # Create parallel test runner
            from flask import current_app
            parallel_runner = ParallelTestRunner(current_app.config)
            
            # Start test execution in a background thread to avoid blocking
            import threading
            thread = threading.Thread(
                target=parallel_runner.run_multiple_tests,
                args=(test_ids, html_selector, credentials)
            )
            thread.daemon = True
            thread.start()
            
            # Store the parallel runner in app context for status checks
            if not hasattr(current_app, 'parallel_runners'):
                current_app.parallel_runners = {}
            
            # Generate a batch ID for this run
            import uuid
            batch_id = str(uuid.uuid4())
            current_app.parallel_runners[batch_id] = parallel_runner
            
            flash(f'Started execution of {len(test_ids)} test cases', 'success')
            return redirect(url_for('main.batch_status', batch_id=batch_id))
            
        except Exception as e:
            logger.error(f"Error starting parallel test execution: {str(e)}")
            flash(f'Error starting tests: {str(e)}', 'error')
            return redirect(url_for('main.test_list'))
    
    # GET request - show form to select test cases
    test_cases = TestCase.query.all()
    return render_template('run_multiple_tests.html', test_cases=test_cases)

@main_bp.route('/tests/batch/<batch_id>')
def batch_status(batch_id):
    """Show status of a batch of tests."""
    from flask import current_app
    
    if not hasattr(current_app, 'parallel_runners') or batch_id not in current_app.parallel_runners:
        flash('Batch not found or expired', 'warning')
        return redirect(url_for('main.test_runs'))
    
    parallel_runner = current_app.parallel_runners[batch_id]
    status = parallel_runner.get_status()
    
    return render_template('batch_status.html', batch_id=batch_id, status=status)

@main_bp.route('/api/tests/batch/<batch_id>/status')
def batch_status_api(batch_id):
    """API endpoint to get batch status."""
    from flask import current_app
    
    if not hasattr(current_app, 'parallel_runners') or batch_id not in current_app.parallel_runners:
        return jsonify({'error': 'Batch not found or expired'}), 404
    
    parallel_runner = current_app.parallel_runners[batch_id]
    status = parallel_runner.get_status()
    
    return jsonify({
        'batch_id': batch_id,
        'status': status,
        'completed': all(test['status'] in ['completed', 'failed'] for test in status.values()),
        'tests_total': len(status),
        'tests_completed': sum(1 for test in status.values() if test['status'] == 'completed'),
        'tests_failed': sum(1 for test in status.values() if test['status'] == 'failed'),
        'tests_running': sum(1 for test in status.values() if test['status'] == 'running'),
        'tests_queued': sum(1 for test in status.values() if test['status'] == 'queued')
    })