const { body, param, query, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// Project validation rules
const validateProject = [
  body('name')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Project name must be between 1 and 255 characters')
    .trim()
    .escape(),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Description must not exceed 1000 characters')
    .trim()
    .escape(),
  body('miaw_org_id')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('MIAW Org ID must not exceed 100 characters')
    .trim(),
  body('miaw_deployment_name')
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage('MIAW Deployment Name must not exceed 255 characters')
    .trim(),
  body('miaw_base_url')
    .optional()
    .isURL({ require_protocol: true })
    .withMessage('MIAW Base URL must be a valid URL'),
  handleValidationErrors
];

// Goal validation rules
const validateGoal = [
  body('name')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Goal name must be between 1 and 255 characters')
    .trim()
    .escape(),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Description must not exceed 2000 characters')
    .trim()
    .escape(),
  body('validationCriteria')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Validation criteria must not exceed 2000 characters')
    .trim()
    .escape(),
  body('steps')
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage('Steps must not exceed 5000 characters')
    .trim()
    .escape(),
  body('priority')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Priority must be between 1 and 5'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  body('expectedDuration')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Expected duration must be a non-negative integer'),
  handleValidationErrors
];

// Batch run validation rules
const validateBatchRun = [
  body('name')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Batch run name must be between 1 and 255 characters')
    .trim()
    .escape(),
  body('maxConcurrency')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Max concurrency must be between 1 and 10'),
  handleValidationErrors
];

// UUID parameter validation
const validateUUID = [
  param('id')
    .isUUID()
    .withMessage('Invalid ID format'),
  handleValidationErrors
];

// Project sharing validation
const validateProjectShare = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  body('permissionLevel')
    .isIn(['read', 'write', 'admin'])
    .withMessage('Permission level must be read, write, or admin'),
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

module.exports = {
  validateProject,
  validateGoal,
  validateBatchRun,
  validateUUID,
  validateProjectShare,
  validatePagination,
  handleValidationErrors
};