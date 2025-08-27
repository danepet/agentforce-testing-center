const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');

class TestSession {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.goalId = data.goalId || data.goal_id;
    this.batchRunId = data.batchRunId || data.batch_run_id;
    this.status = data.status || 'pending';
    this.conversationLog = data.conversationLog || data.conversation_log;
    this.salesforceDataBefore = data.salesforceDataBefore || data.salesforce_data_before;
    this.salesforceDataAfter = data.salesforceDataAfter || data.salesforce_data_after;
    this.validationResults = data.validationResults || data.validation_results;
    this.score = data.score;
    this.endReason = data.endReason || data.end_reason;
    this.miawSessionId = data.miawSessionId || data.miaw_session_id;
    this.startedAt = data.startedAt || data.started_at;
    this.completedAt = data.completedAt || data.completed_at;
  }

  static async create(sessionData) {
    const session = new TestSession(sessionData);
    
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO test_sessions (id, goal_id, batch_run_id, status, conversation_log, salesforce_data_before, salesforce_data_after, validation_results, score, end_reason, miaw_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        session.id,
        session.goalId,
        session.batchRunId,
        session.status,
        JSON.stringify(session.conversationLog || []),
        JSON.stringify(session.salesforceDataBefore || {}),
        JSON.stringify(session.salesforceDataAfter || {}),
        JSON.stringify(session.validationResults || {}),
        session.score,
        session.endReason,
        session.miawSessionId
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(session);
        }
      });
      
      stmt.finalize();
    });
  }

  static async findAll() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT ts.*, g.name as goal_name, g.description as goal_description
        FROM test_sessions ts
        LEFT JOIN goals g ON ts.goal_id = g.id
        ORDER BY ts.started_at DESC
      `, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const sessions = rows.map(row => {
            const session = new TestSession(row);
            session.goalName = row.goal_name;
            session.goalDescription = row.goal_description;
            session.conversationLog = JSON.parse(row.conversation_log || '[]');
            session.salesforceDataBefore = JSON.parse(row.salesforce_data_before || '{}');
            session.salesforceDataAfter = JSON.parse(row.salesforce_data_after || '{}');
            session.validationResults = JSON.parse(row.validation_results || '{}');
            return session;
          });
          resolve(sessions);
        }
      });
    });
  }

  static async findByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT ts.*, g.name as goal_name, g.description as goal_description
        FROM test_sessions ts
        LEFT JOIN goals g ON ts.goal_id = g.id
        WHERE g.project_id = ?
        ORDER BY ts.started_at DESC
        LIMIT 20
      `, [projectId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const sessions = rows.map(row => {
            const session = new TestSession(row);
            session.goalName = row.goal_name;
            session.goalDescription = row.goal_description;
            session.conversationLog = JSON.parse(row.conversation_log || '[]');
            session.salesforceDataBefore = JSON.parse(row.salesforce_data_before || '{}');
            session.salesforceDataAfter = JSON.parse(row.salesforce_data_after || '{}');
            session.validationResults = JSON.parse(row.validation_results || '{}');
            return session;
          });
          resolve(sessions);
        }
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT ts.*, g.name as goal_name, g.description as goal_description
        FROM test_sessions ts
        LEFT JOIN goals g ON ts.goal_id = g.id
        WHERE ts.id = ?
      `, [id], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const session = new TestSession(row);
          session.goalName = row.goal_name;
          session.goalDescription = row.goal_description;
          session.conversationLog = JSON.parse(row.conversation_log || '[]');
          session.salesforceDataBefore = JSON.parse(row.salesforce_data_before || '{}');
          session.salesforceDataAfter = JSON.parse(row.salesforce_data_after || '{}');
          session.validationResults = JSON.parse(row.validation_results || '{}');
          resolve(session);
        } else {
          resolve(null);
        }
      });
    });
  }

  static async findByBatchRunId(batchRunId) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT ts.*, g.name as goal_name, g.description as goal_description, g.source_conversation_id as goal_source_conversation_id, g.source_conversation_data as goal_source_conversation_data, g.steps as goal_steps, g.validation_criteria as goal_validation_criteria
        FROM test_sessions ts
        LEFT JOIN goals g ON ts.goal_id = g.id
        WHERE ts.batch_run_id = ?
        ORDER BY ts.started_at ASC
      `, [batchRunId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const sessions = rows.map(row => {
            const session = new TestSession(row);
            session.goalName = row.goal_name;
            session.goalDescription = row.goal_description;
            session.goalSourceConversationId = row.goal_source_conversation_id;
            session.goalSourceConversationData = row.goal_source_conversation_data;
            session.goalSteps = row.goal_steps;
            session.goalValidationCriteria = row.goal_validation_criteria;
            session.conversationLog = JSON.parse(row.conversation_log || '[]');
            session.salesforceDataBefore = JSON.parse(row.salesforce_data_before || '{}');
            session.salesforceDataAfter = JSON.parse(row.salesforce_data_after || '{}');
            session.validationResults = JSON.parse(row.validation_results || '{}');
            return session;
          });
          resolve(sessions);
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
      if (updateData.conversationLog) {
        fields.push('conversation_log = ?');
        values.push(JSON.stringify(updateData.conversationLog));
      }
      if (updateData.salesforceDataBefore) {
        fields.push('salesforce_data_before = ?');
        values.push(JSON.stringify(updateData.salesforceDataBefore));
      }
      if (updateData.salesforceDataAfter) {
        fields.push('salesforce_data_after = ?');
        values.push(JSON.stringify(updateData.salesforceDataAfter));
      }
      if (updateData.validationResults) {
        fields.push('validation_results = ?');
        values.push(JSON.stringify(updateData.validationResults));
      }
      if (updateData.score !== undefined) {
        fields.push('score = ?');
        values.push(updateData.score);
      }
      if (updateData.endReason !== undefined) {
        fields.push('end_reason = ?');
        values.push(updateData.endReason);
      }
      if (updateData.miawSessionId !== undefined) {
        fields.push('miaw_session_id = ?');
        values.push(updateData.miawSessionId);
      }
      if (updateData.status === 'completed') {
        fields.push('completed_at = CURRENT_TIMESTAMP');
      }
      
      values.push(id);
      
      const sql = `UPDATE test_sessions SET ${fields.join(', ')} WHERE id = ?`;
      
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
      db.run('DELETE FROM test_sessions WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  async addMessage(sender, message) {
    const conversationLog = this.conversationLog || [];
    conversationLog.push({
      sender,
      message,
      timestamp: new Date().toISOString()
    });

    return TestSession.update(this.id, { conversationLog });
  }
}

module.exports = TestSession;