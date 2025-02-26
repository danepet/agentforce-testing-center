from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# Initialize SQLAlchemy
db = SQLAlchemy()
migrate = Migrate()

def create_app(config_object):
    """Application factory pattern for Flask app."""
    app = Flask(__name__)
    app.config.from_object(config_object)
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Import and register blueprints
    from app.routes import main_bp
    app.register_blueprint(main_bp)
    
    # Create database tables
    with app.app_context():
        db.create_all()
    
    return app