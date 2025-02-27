#!/usr/bin/env python
import os
import click
from flask.cli import FlaskGroup
from app import create_app, db
from config import config

app_config = config[os.getenv('FLASK_ENV', 'default')]
app = create_app(app_config)

cli = FlaskGroup(create_app=lambda: app)

@cli.command('init_db')
def init_db():
    """Initialize the database."""
    click.echo('Initializing the database...')
    with app.app_context():
        db.create_all()
    click.echo('Done.')

if __name__ == '__main__':
    cli()