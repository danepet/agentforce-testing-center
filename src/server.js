console.log('Starting Agentforce Testing Center...');

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const morgan = require('morgan');

console.log('Loading environment variables...');
require('dotenv').config();
console.log('Environment loaded. NODE_ENV:', process.env.NODE_ENV);

// Initialize logging
const logger = require('./config/logger');
logger.info('Starting Agentforce Testing Center...');

// Initialize database
const { initializeTables } = require('./database/init');

console.log('Loading passport configuration...');
const passport = require('./config/passport');

console.log('Loading route modules...');
const goalRoutes = require('./routes/goals');
console.log('✓ Goal routes loaded');
const testRoutes = require('./routes/tests');
console.log('✓ Test routes loaded');  
const agentRoutes = require('./routes/agent');
console.log('✓ Agent routes loaded');
const projectRoutes = require('./routes/projects');
console.log('✓ Project routes loaded');
const conversationRoutes = require('./routes/conversations');
console.log('✓ Conversation routes loaded');
const authRoutes = require('./routes/auth');
console.log('✓ Auth routes loaded');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.openai.com"]
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || false
    : true,
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  store: new SQLiteStore({
    db: process.env.DB_PATH || './data/testing_center.db',
    table: 'sessions'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// HTTP request logging
app.use(morgan('combined', { stream: logger.stream }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Add user context middleware
const { addUserContext } = require('./middleware/auth');
app.use(addUserContext);

// Development authentication bypass (only in development)
if (process.env.NODE_ENV === 'development') {
  const { devAuthBypass } = require('./middleware/dev-auth');
  app.use(devAuthBypass);
}

// Mount routes
app.use('/auth', authRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/conversations', conversationRoutes);

// Comprehensive error handling middleware
app.use((error, req, res, next) => {
  // Log error with context
  logger.error('Application error', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't leak sensitive information in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({ 
    error: error.status === 400 ? error.message : 'Internal server error',
    ...(isDevelopment && { 
      message: error.message,
      stack: error.stack,
      path: req.path 
    })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Handle favicon requests
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Initialize database and start server
console.log('Initializing database...');
initializeTables()
  .then(() => {
    logger.info('Database initialized successfully');
    
    console.log('Starting server...');
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Agentforce Testing Center started on port ${PORT}`);
      console.log(`🚀 Agentforce Testing Center running on port ${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`🔍 API Health: http://localhost:${PORT}/health`);
      console.log(`🔐 Auth required: Google OAuth 2.0 enabled`);
      console.log('🌐 Environment PORT:', process.env.PORT);
      console.log('⚙️  Using PORT:', PORT);
      console.log('✅ Server started successfully!');
    });

    // Graceful shutdown handlers (move this inside the then block)
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      server.close((err) => {
        if (err) {
          logger.error('Error during server shutdown:', err);
          process.exit(1);
        }
        logger.info('Server closed successfully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Keep process alive with better error handling
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection:', { reason, promise });
      gracefulShutdown('unhandledRejection');
    });

  })
  .catch((err) => {
    logger.error('Database initialization failed:', err);
    console.error('Database initialization failed:', err);
    process.exit(1);
  });