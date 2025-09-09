const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');

class Project {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.description = data.description;
    this.userId = data.userId || data.user_id;
    this.createdBy = data.createdBy || data.created_by;
    this.tags = data.tags;
    this.status = data.status || 'active';
    this.miawOrgId = data.miawOrgId || data.miaw_org_id;
    this.miawDeploymentName = data.miawDeploymentName || data.miaw_deployment_name;
    this.miawBaseUrl = data.miawBaseUrl || data.miaw_base_url;
    this.miawRoutingAttributes = data.miawRoutingAttributes || data.miaw_routing_attributes;
    this.goalGenerationPrompt = data.goalGenerationPrompt || data.goal_generation_prompt;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  static async create(projectData) {
    const project = new Project(projectData);
    
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO projects (id, name, description, user_id, created_by, tags, status, miaw_org_id, miaw_deployment_name, miaw_base_url, miaw_routing_attributes, goal_generation_prompt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        project.id,
        project.name,
        project.description,
        project.userId,
        project.createdBy,
        JSON.stringify(project.tags || []),
        project.status,
        project.miawOrgId,
        project.miawDeploymentName,
        project.miawBaseUrl,
        project.miawRoutingAttributes,
        project.goalGenerationPrompt
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(project);
        }
      });
      
      stmt.finalize();
    });
  }

  static async findAll() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT p.*, 
               COUNT(g.id) as goal_count,
               COUNT(CASE WHEN g.enabled = 1 THEN 1 END) as enabled_goals
        FROM projects p
        LEFT JOIN goals g ON p.id = g.project_id
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const projects = rows.map(row => {
            const project = new Project(row);
            project.tags = JSON.parse(row.tags || '[]');
            project.goalCount = row.goal_count;
            project.enabledGoals = row.enabled_goals;
            return project;
          });
          resolve(projects);
        }
      });
    });
  }

  static async findByUserId(userId) {
    const ProjectShare = require('./ProjectShare');
    
    return new Promise((resolve, reject) => {
      // Get projects owned by user
      db.all(`
        SELECT p.*, 
               COUNT(g.id) as goal_count,
               COUNT(CASE WHEN g.enabled = 1 THEN 1 END) as enabled_goals,
               'owner' as user_role
        FROM projects p
        LEFT JOIN goals g ON p.id = g.project_id
        WHERE p.user_id = ? AND p.status = 'active'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, [userId], async (err, ownedRows) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          // Get projects shared with user
          const sharedProjects = await ProjectShare.findByUserId(userId);
          const sharedProjectIds = sharedProjects.map(s => s.project_id);
          
          let sharedRows = [];
          if (sharedProjectIds.length > 0) {
            const placeholders = sharedProjectIds.map(() => '?').join(',');
            sharedRows = await new Promise((resolve, reject) => {
              db.all(`
                SELECT p.*, 
                       COUNT(g.id) as goal_count,
                       COUNT(CASE WHEN g.enabled = 1 THEN 1 END) as enabled_goals,
                       ps.permission_level as user_role
                FROM projects p
                LEFT JOIN goals g ON p.id = g.project_id
                LEFT JOIN project_shares ps ON p.id = ps.project_id AND ps.user_id = ?
                WHERE p.id IN (${placeholders}) AND p.status = 'active'
                GROUP BY p.id
                ORDER BY p.created_at DESC
              `, [userId, ...sharedProjectIds], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
              });
            });
          }

          // Combine and format results
          const allRows = [...ownedRows, ...sharedRows];
          const projects = allRows.map(row => {
            const project = new Project(row);
            project.tags = JSON.parse(row.tags || '[]');
            project.goalCount = row.goal_count;
            project.enabledGoals = row.enabled_goals;
            project.userRole = row.user_role;
            return project;
          });
          
          resolve(projects);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT p.*, 
               COUNT(g.id) as goal_count,
               COUNT(CASE WHEN g.enabled = 1 THEN 1 END) as enabled_goals
        FROM projects p
        LEFT JOIN goals g ON p.id = g.project_id
        WHERE p.id = ?
        GROUP BY p.id
      `, [id], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const project = new Project(row);
          project.tags = JSON.parse(row.tags || '[]');
          project.goalCount = row.goal_count;
          project.enabledGoals = row.enabled_goals;
          resolve(project);
        } else {
          resolve(null);
        }
      });
    });
  }

  static async findWithGoals(id) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT * FROM projects WHERE id = ?
      `, [id], (err, projectRow) => {
        if (err) {
          reject(err);
        } else if (projectRow) {
          const project = new Project(projectRow);
          project.tags = JSON.parse(projectRow.tags || '[]');
          
          // Get goals for this project
          db.all(`
            SELECT * FROM goals 
            WHERE project_id = ?
            ORDER BY created_at ASC
          `, [id], (err, goalRows) => {
            if (err) {
              reject(err);
            } else {
              project.goals = goalRows.map(row => ({
                id: row.id,
                name: row.name,
                description: row.description,
                validationCriteria: JSON.parse(row.validation_criteria || '[]'),
                steps: JSON.parse(row.steps || '[]'),
                enabled: Boolean(row.enabled),
                createdAt: row.created_at,
                updatedAt: row.updated_at
              }));
              resolve(project);
            }
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  static async update(id, updateData) {
    return new Promise((resolve, reject) => {
      console.log('Project.update called with:', { id, updateData });
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
      if (updateData.tags) {
        fields.push('tags = ?');
        values.push(JSON.stringify(updateData.tags));
      }
      if (updateData.status) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      if (updateData.miawOrgId !== undefined) {
        fields.push('miaw_org_id = ?');
        values.push(updateData.miawOrgId);
      }
      if (updateData.miawDeploymentName !== undefined) {
        fields.push('miaw_deployment_name = ?');
        values.push(updateData.miawDeploymentName);
      }
      if (updateData.miawBaseUrl !== undefined) {
        fields.push('miaw_base_url = ?');
        values.push(updateData.miawBaseUrl);
      }
      if (updateData.miawRoutingAttributes !== undefined) {
        fields.push('miaw_routing_attributes = ?');
        values.push(updateData.miawRoutingAttributes);
      }
      if (updateData.goalGenerationPrompt !== undefined) {
        fields.push('goal_generation_prompt = ?');
        values.push(updateData.goalGenerationPrompt);
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      
      const sql = `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`;
      
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
      // Soft delete by setting status to 'deleted'
      db.run('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
        ['deleted', id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  static async getRecentBatchRuns(projectId, limit = 5) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT * FROM batch_test_runs 
        WHERE project_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `, [projectId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => ({
            id: row.id,
            name: row.name,
            status: row.status,
            totalTestCases: row.total_test_cases,
            completedTestCases: row.completed_test_cases,
            successRate: row.success_rate,
            startedAt: row.started_at,
            completedAt: row.completed_at
          })));
        }
      });
    });
  }
}

module.exports = Project;