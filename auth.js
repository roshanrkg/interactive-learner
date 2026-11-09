const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./db');
require('dotenv').config();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.query('SELECT id, google_id, email, name, avatar_url, created_at FROM users WHERE id = ?', [id]);
    if (rows.length > 0) {
      done(null, rows[0]);
    } else {
      done(null, false);
    }
  } catch (err) {
    done(err, null);
  }
});

const clientID = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8081/auth/google/callback';

const isGoogleConfigured = clientID && !clientID.includes('your-google-client-id') &&
                           clientSecret && !clientSecret.includes('your-google-client-secret');

if (isGoogleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
          const name = profile.displayName || 'Google User';
          const avatarUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : '';

          const [rows] = await pool.query('SELECT * FROM users WHERE google_id = ?', [googleId]);

          if (rows.length > 0) {
            await pool.query('UPDATE users SET name = ?, avatar_url = ?, email = ? WHERE id = ?', [
              name,
              avatarUrl,
              email,
              rows[0].id,
            ]);
            return done(null, { ...rows[0], name, avatar_url: avatarUrl, email });
          }

          const [result] = await pool.query(
            'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)',
            [googleId, email, name, avatarUrl]
          );

          return done(null, {
            id: result.insertId,
            google_id: googleId,
            email,
            name,
            avatar_url: avatarUrl,
          });
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
} else {
  console.log('⚠️ Notice: Google OAuth credentials in .env are placeholders. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable live Google Sign-In.');
}

module.exports = {
  passport,
  isGoogleConfigured: () => Boolean(isGoogleConfigured),
};
