const ProjectShare = require('../models/ProjectShare');

// Middleware to require authentication
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// Middleware to check project ownership or sharing permissions
const requireProjectAccess = (permissionLevel = 'read') => {
  return async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const projectId = req.params.id || req.params.projectId;
      const userId = req.user.id;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID required' });
      }

      // Check if user owns the project (via project model)
      const Project = require('../models/Project');
      const project = await Project.findById(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Owner has all permissions
      if (project.user_id === userId) {
        req.project = project;
        req.userPermission = 'admin';
        return next();
      }

      // Check if project is shared with user
      const hasPermission = await ProjectShare.hasPermission(projectId, userId, permissionLevel);
      
      if (!hasPermission) {
        return res.status(403).json({ error: 'Insufficient permissions for this project' });
      }

      // Get user's permission level for future use
      const share = await ProjectShare.findShare(projectId, userId);
      req.project = project;
      req.userPermission = share.permission_level;
      
      next();
    } catch (error) {
      console.error('Project access check error:', error);
      res.status(500).json({ error: 'Failed to verify project access' });
    }
  };
};

// Middleware to check if user can modify project (write or admin permission)
const requireProjectWrite = requireProjectAccess('write');

// Middleware to check if user can admin project (admin permission only)
const requireProjectAdmin = requireProjectAccess('admin');

// Middleware to add user context to requests
const addUserContext = (req, res, next) => {
  if (req.isAuthenticated()) {
    req.userId = req.user.id;
  }
  next();
};

module.exports = {
  requireAuth,
  requireProjectAccess,
  requireProjectWrite,
  requireProjectAdmin,
  addUserContext
};