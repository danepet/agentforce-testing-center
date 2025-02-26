#!/usr/bin/env python
import os
from app import create_app
from config import config

# Create the Flask application instance
app_config = config[os.getenv('FLASK_ENV', 'default')]
app = create_app(app_config)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=app_config.DEBUG)