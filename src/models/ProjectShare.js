const { db } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

class ProjectShare {
  static async findByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT ps.*, u.name as user_name, u.email as user_email 
         FROM project_shares ps 
         JOIN users u ON ps.user_id = u.id 
         WHERE ps.project_id = ?`,
        [projectId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  static async findByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT ps.*, p.name as project_name, p.description as project_description 
         FROM project_shares ps 
         JOIN projects p ON ps.project_id = p.id 
         WHERE ps.user_id = ?`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  static async findShare(projectId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM project_shares WHERE project_id = ? AND user_id = ?',
        [projectId, userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  }

  static async create({ projectId, userId, permissionLevel = 'read', sharedBy }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO project_shares (id, project_id, user_id, permission_level, shared_by, created_at) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, projectId, userId, permissionLevel, sharedBy, now],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id, projectId, userId, permissionLevel, sharedBy, createdAt: now });
          }
        }
      );
    });
  }

  static async updatePermission(projectId, userId, permissionLevel) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE project_shares SET permission_level = ? WHERE project_id = ? AND user_id = ?',
        [permissionLevel, projectId, userId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  static async remove(projectId, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM project_shares WHERE project_id = ? AND user_id = ?',
        [projectId, userId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  static async hasPermission(projectId, userId, requiredPermission = 'read') {
    const share = await this.findShare(projectId, userId);
    if (!share) return false;
    
    const permissions = {
      'read': 1,
      'write': 2,
      'admin': 3
    };
    
    const userLevel = permissions[share.permission_level] || 0;
    const requiredLevel = permissions[requiredPermission] || 0;
    
    return userLevel >= requiredLevel;
  }
}

module.exports = ProjectShare;