// Development authentication bypass
// This creates a fake user session for local development
const User = require('../models/User');

const createDevUser = async () => {
  try {
    // Check if dev user already exists
    let user = await User.findByEmail('dev@localhost');
    
    if (!user) {
      // Create a dev user
      user = await User.create({
        googleId: 'dev-user-123',
        email: 'dev@localhost',
        name: 'Development User',
        picture: null
      });
    }
    
    return user;
  } catch (error) {
    console.error('Error creating dev user:', error);
    return null;
  }
};

const devAuthBypass = async (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return next();
  }

  if (!req.isAuthenticated()) {
    const user = await createDevUser();
    if (user) {
      req.login(user, (err) => {
        if (err) {
          console.error('Dev login error:', err);
          return next();
        }
        console.log('🔧 Development user auto-logged in');
        next();
      });
    } else {
      next();
    }
  } else {
    next();
  }
};

module.exports = { devAuthBypass };