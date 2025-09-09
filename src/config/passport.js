const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google OAuth profile received:', {
      id: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName
    });

    // Check if user already exists
    let user = await User.findByGoogleId(profile.id);
    
    if (user) {
      console.log('Existing user found:', user.email);
      return done(null, user);
    }

    // Create new user
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('No email provided by Google'), null);
    }

    user = await User.create({
      googleId: profile.id,
      email: email,
      name: profile.displayName || 'Unknown User',
      picture: profile.photos?.[0]?.value || null
    });

    console.log('New user created:', user.email);
    return done(null, user);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;