const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');

class Goal {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.description = data.description;
    this.validationCriteria = data.validationCriteria || data.validation_criteria;
    this.steps = data.steps;
    this.projectId = data.projectId || data.project_id;
    this.sourceConversationId = data.sourceConversationId || data.source_conversation_id;
    this.sourceConversationData = data.sourceConversationData || data.source_conversation_data;
    this.enabled = data.enabled !== undefined ? data.enabled : true;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  static async create(goalData) {
    const goal = new Goal(goalData);
    
    
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO goals (id, name, description, validation_criteria, steps, project_id, source_conversation_id, source_conversation_data, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        goal.id,
        goal.name,
        goal.description,
        JSON.stringify(goal.validationCriteria),
        JSON.stringify(goal.steps),
        goal.projectId,
        goal.sourceConversationId,
        goal.sourceConversationData,
        goal.enabled ? 1 : 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(goal);
        }
      });
      
      stmt.finalize();
    });
  }

  static async findAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM goals ORDER BY created_at DESC', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const goals = rows.map(row => {
            const goal = new Goal(row);
            goal.validationCriteria = JSON.parse(row.validation_criteria || '[]');
            goal.steps = JSON.parse(row.steps || '[]');
            goal.enabled = Boolean(row.enabled);
            return goal;
          });
          resolve(goals);
        }
      });
    });
  }

  static async findByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM goals WHERE project_id = ? ORDER BY created_at ASC', [projectId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const goals = rows.map(row => {
            const goal = new Goal(row);
            goal.validationCriteria = JSON.parse(row.validation_criteria || '[]');
            goal.steps = JSON.parse(row.steps || '[]');
            goal.enabled = Boolean(row.enabled);
            return goal;
          });
          resolve(goals);
        }
      });
    });
  }

  static async findEnabledByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM goals WHERE project_id = ? AND enabled = 1 ORDER BY created_at ASC', [projectId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const goals = rows.map(row => {
            const goal = new Goal(row);
            goal.validationCriteria = JSON.parse(row.validation_criteria || '[]');
            goal.steps = JSON.parse(row.steps || '[]');
            goal.enabled = Boolean(row.enabled);
            return goal;
          });
          resolve(goals);
        }
      });
    });
  }

  static async findUnassigned() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM goals WHERE project_id IS NULL ORDER BY created_at DESC', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const goals = rows.map(row => {
            const goal = new Goal(row);
            goal.validationCriteria = JSON.parse(row.validation_criteria || '[]');
            goal.steps = JSON.parse(row.steps || '[]');
            goal.enabled = Boolean(row.enabled);
            return goal;
          });
          resolve(goals);
        }
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM goals WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const goal = new Goal(row);
          goal.validationCriteria = JSON.parse(row.validation_criteria || '[]');
          goal.steps = JSON.parse(row.steps || '[]');
          goal.enabled = Boolean(row.enabled);
          resolve(goal);
        } else {
          resolve(null);
        }
      });
    });
  }

  static async update(id, updateData) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      
      if (updateData.name) {
        fields.push('name = ?');
        values.push(updateData.name);
      }
      if (updateData.description !== undefined) {
        fields.push('description = ?');
        values.push(updateData.description);
      }
      if (updateData.validationCriteria) {
        fields.push('validation_criteria = ?');
        values.push(JSON.stringify(updateData.validationCriteria));
      }
      if (updateData.steps) {
        fields.push('steps = ?');
        values.push(JSON.stringify(updateData.steps));
      }
      if (updateData.projectId !== undefined) {
        fields.push('project_id = ?');
        values.push(updateData.projectId);
      }
      if (updateData.sourceConversationId !== undefined) {
        fields.push('source_conversation_id = ?');
        values.push(updateData.sourceConversationId);
      }
      if (updateData.sourceConversationData !== undefined) {
        fields.push('source_conversation_data = ?');
        values.push(updateData.sourceConversationData);
      }
      if (updateData.enabled !== undefined) {
        fields.push('enabled = ?');
        values.push(updateData.enabled ? 1 : 0);
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      
      const sql = `UPDATE goals SET ${fields.join(', ')} WHERE id = ?`;
      
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
      db.run('DELETE FROM goals WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }
}

module.exports = Goal;