const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || './data/testing_center.db';
const db = new sqlite3.Database(dbPath);

const runMigration = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      console.log('Running database migrations...');
      
      // Add new columns to goals table
      db.run(`ALTER TABLE goals ADD COLUMN project_id TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding project_id column:', err.message);
        } else {
          console.log('✓ Added project_id column to goals table');
        }
      });
      
      db.run(`ALTER TABLE goals ADD COLUMN priority INTEGER DEFAULT 1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding priority column:', err.message);
        } else {
          console.log('✓ Added priority column to goals table');
        }
      });
      
      db.run(`ALTER TABLE goals ADD COLUMN enabled BOOLEAN DEFAULT 1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding enabled column:', err.message);
        } else {
          console.log('✓ Added enabled column to goals table');
        }
      });
      
      db.run(`ALTER TABLE goals ADD COLUMN expected_duration INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding expected_duration column:', err.message);
        } else {
          console.log('✓ Added expected_duration column to goals table');
        }
      });
      
      // Update test_sessions table to remove test_case_id column
      // Note: SQLite doesn't support DROP COLUMN, so we'll just leave it for compatibility
      
      // Drop test_cases table if it exists
      db.run(`DROP TABLE IF EXISTS test_cases`, (err) => {
        if (err) {
          console.error('Error dropping test_cases table:', err.message);
        } else {
          console.log('✓ Dropped test_cases table');
        }
        
        // Final step
        console.log('Database migration completed successfully!');
        resolve();
      });
    });
  });
};

if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration completed successfully');
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      db.close();
      process.exit(1);
    });
}

module.exports = { runMigration };