const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './data/testing_center.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

const initializeTables = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        validation_criteria TEXT,
        steps TEXT,
        project_id TEXT,
        priority INTEGER DEFAULT 1,
        enabled BOOLEAN DEFAULT 1,
        expected_duration INTEGER,
        source_conversation_id TEXT,
        source_conversation_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS test_sessions (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        batch_run_id TEXT,
        status TEXT DEFAULT 'pending',
        conversation_log TEXT,
        salesforce_data_before TEXT,
        salesforce_data_after TEXT,
        validation_results TEXT,
        score REAL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (goal_id) REFERENCES goals (id),
        FOREIGN KEY (batch_run_id) REFERENCES batch_test_runs (id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        test_session_id TEXT,
        sender TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (test_session_id) REFERENCES test_sessions (id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS validation_rules (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        rule_type TEXT,
        rule_config TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals (id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT,
        tags TEXT,
        status TEXT DEFAULT 'active',
        miaw_org_id TEXT,
        miaw_deployment_name TEXT,
        miaw_base_url TEXT,
        miaw_routing_attributes TEXT,
        goal_generation_prompt TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);


      db.run(`CREATE TABLE IF NOT EXISTS batch_test_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        total_test_cases INTEGER DEFAULT 0,
        completed_test_cases INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        error_details TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (project_id) REFERENCES projects (id)
      )`, (err) => {
        if (err) {
          reject(err);
        } else {
          // Add MIAW columns to existing projects table if they don't exist
          db.run(`ALTER TABLE projects ADD COLUMN miaw_org_id TEXT`, () => {});
          db.run(`ALTER TABLE projects ADD COLUMN miaw_deployment_name TEXT`, () => {});
          db.run(`ALTER TABLE projects ADD COLUMN miaw_base_url TEXT`, () => {});
          db.run(`ALTER TABLE projects ADD COLUMN miaw_routing_attributes TEXT`, () => {});
          
          // Add new enhancement columns (goal_generation_prompt now in main table creation)
          db.run(`ALTER TABLE test_sessions ADD COLUMN end_reason TEXT`, () => {});
          db.run(`ALTER TABLE test_sessions ADD COLUMN miaw_session_id TEXT`, () => {});
          db.run(`ALTER TABLE goals ADD COLUMN source_conversation_id TEXT`, () => {});
          db.run(`ALTER TABLE goals ADD COLUMN source_conversation_data TEXT`, () => {});
          
          resolve();
        }
      });
    });
  });
};

if (require.main === module) {
  initializeTables()
    .then(() => {
      console.log('Database initialized successfully');
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Database initialization failed:', err);
      process.exit(1);
    });
}

module.exports = { db, initializeTables };