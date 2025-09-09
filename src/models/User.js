const { db } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

class User {
  static async findByGoogleId(googleId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE google_id = ?',
        [googleId],
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

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE id = ?',
        [id],
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

  static async findByEmail(email) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
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

  static async create({ googleId, email, name, picture }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (id, google_id, email, name, picture, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, googleId, email, name, picture, now, now],
        function(err) {
          if (err) {
            reject(err);
          } else {
            // Return the created user
            User.findById(id).then(resolve).catch(reject);
          }
        }
      );
    });
  }

  static async update(id, updates) {
    const allowedFields = ['name', 'picture', 'email'];
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    
    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values,
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
}

module.exports = User;