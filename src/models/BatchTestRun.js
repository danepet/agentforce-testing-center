const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');

class BatchTestRun {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.projectId = data.projectId || data.project_id;
    this.name = data.name;
    this.status = data.status || 'pending';
    this.totalTestCases = data.totalTestCases || data.total_test_cases || 0;
    this.completedTestCases = data.completedTestCases || data.completed_test_cases || 0;
    this.successRate = data.successRate || data.success_rate || 0;
    this.errorDetails = data.errorDetails || data.error_details;
    this.startedAt = data.startedAt || data.started_at;
    this.completedAt = data.completedAt || data.completed_at;
  }

  static async create(batchRunData) {
    const batchRun = new BatchTestRun(batchRunData);
    
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO batch_test_runs (id, project_id, name, status, total_test_cases)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        batchRun.id,
        batchRun.projectId,
        batchRun.name,
        batchRun.status,
        batchRun.totalTestCases
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(batchRun);
        }
      });
      
      stmt.finalize();
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT btr.*, p.name as project_name
        FROM batch_test_runs btr
        LEFT JOIN projects p ON btr.project_id = p.id
        WHERE btr.id = ?
      `, [id], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const batchRun = new BatchTestRun(row);
          batchRun.projectName = row.project_name;
          batchRun.errorDetails = JSON.parse(row.error_details || '[]');
          resolve(batchRun);
        } else {
          resolve(null);
        }
      });
    });
  }

  static async findByProjectId(projectId, limit = 10) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT btr.*, p.name as project_name
        FROM batch_test_runs btr
        LEFT JOIN projects p ON btr.project_id = p.id
        WHERE btr.project_id = ?
        ORDER BY btr.started_at DESC
        LIMIT ?
      `, [projectId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const batchRuns = rows.map(row => {
            const batchRun = new BatchTestRun(row);
            batchRun.projectName = row.project_name;
            batchRun.errorDetails = JSON.parse(row.error_details || '[]');
            return batchRun;
          });
          resolve(batchRuns);
        }
      });
    });
  }

  static async update(id, updateData) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      
      if (updateData.status) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      if (updateData.completedTestCases !== undefined) {
        fields.push('completed_test_cases = ?');
        values.push(updateData.completedTestCases);
      }
      if (updateData.successRate !== undefined) {
        fields.push('success_rate = ?');
        values.push(updateData.successRate);
      }
      if (updateData.errorDetails) {
        fields.push('error_details = ?');
        values.push(JSON.stringify(updateData.errorDetails));
      }
      if (updateData.status === 'completed' || updateData.status === 'failed') {
        fields.push('completed_at = CURRENT_TIMESTAMP');
      }
      
      values.push(id);
      
      const sql = `UPDATE batch_test_runs SET ${fields.join(', ')} WHERE id = ?`;
      
      db.run(sql, values, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  static async delete(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM batch_test_runs WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  static async getRunningBatchRuns() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT btr.*, p.name as project_name
        FROM batch_test_runs btr
        LEFT JOIN projects p ON btr.project_id = p.id
        WHERE btr.status IN ('pending', 'running')
        ORDER BY btr.started_at ASC
      `, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const batchRuns = rows.map(row => {
            const batchRun = new BatchTestRun(row);
            batchRun.projectName = row.project_name;
            batchRun.errorDetails = JSON.parse(row.error_details || '[]');
            return batchRun;
          });
          resolve(batchRuns);
        }
      });
    });
  }

  getProgressPercentage() {
    if (this.totalTestCases === 0) return 0;
    return Math.round((this.completedTestCases / this.totalTestCases) * 100);
  }

  getRemainingTestCases() {
    return Math.max(0, this.totalTestCases - this.completedTestCases);
  }

  getEstimatedTimeRemaining(avgTestDuration = 60000) {
    const remaining = this.getRemainingTestCases();
    return remaining * avgTestDuration;
  }
}

module.exports = BatchTestRun;