# Create a file called manual_migration.py

import sqlite3
import os

# Path to your SQLite database
db_path = 'instance/ai_agent_tests.db'  # Adjust this path to match your actual database location

# Check if database exists
if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

# Connect to the database
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Start a transaction
conn.execute('BEGIN TRANSACTION')

try:
    # Create categories table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT
    )
    ''')
    
    # Create tags table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        color VARCHAR(20) NOT NULL DEFAULT 'primary'
    )
    ''')
    
    # Create test_case_tags association table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS test_case_tags (
        test_case_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (test_case_id, tag_id),
        FOREIGN KEY (test_case_id) REFERENCES test_cases (id),
        FOREIGN KEY (tag_id) REFERENCES tags (id)
    )
    ''')
    
    # Add category_id column to test_cases table
    # First check if the column already exists
    cursor.execute("PRAGMA table_info(test_cases)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'category_id' not in columns:
        cursor.execute('''
        ALTER TABLE test_cases ADD COLUMN category_id INTEGER
        REFERENCES categories (id)
        ''')
    
    # Create test_metrics table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS test_metrics (
        id INTEGER PRIMARY KEY,
        test_case_id INTEGER NOT NULL,
        test_run_id INTEGER NOT NULL,
        date DATE NOT NULL,
        validation_total INTEGER NOT NULL DEFAULT 0,
        validation_passed INTEGER NOT NULL DEFAULT 0,
        validation_failed INTEGER NOT NULL DEFAULT 0,
        pass_rate FLOAT NOT NULL DEFAULT 0,
        avg_response_time INTEGER,
        min_response_time INTEGER,
        max_response_time INTEGER,
        failure_categories TEXT,
        FOREIGN KEY (test_case_id) REFERENCES test_cases (id),
        FOREIGN KEY (test_run_id) REFERENCES test_runs (id)
    )
    ''')
    
    # Add response_time_ms column to turn_results table
    cursor.execute("PRAGMA table_info(turn_results)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'response_time_ms' not in columns:
        cursor.execute('''
        ALTER TABLE turn_results ADD COLUMN response_time_ms INTEGER
        ''')
    
    # Add failure_analysis column to turn_results table
    if 'failure_analysis' not in columns:
        cursor.execute('''
        ALTER TABLE turn_results ADD COLUMN failure_analysis TEXT
        ''')
    
    # Create default category
    cursor.execute('''
    INSERT OR IGNORE INTO categories (name, description) 
    VALUES ('Default', 'Default category for test cases')
    ''')
    
    # Commit the transaction
    conn.commit()
    print("Migration completed successfully")
    
except Exception as e:
    # Rollback on error
    conn.rollback()
    print(f"Migration failed: {str(e)}")
    
finally:
    # Close the connection
    conn.close()