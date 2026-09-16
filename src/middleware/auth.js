'use strict';

const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'runway_token';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

// Reads the JWT cookie into req.user when valid. Never blocks — pages that
// require auth use requireAuth below.
function attachUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      // Invalid/expired token — treat as logged out and clear the stale cookie.
      res.clearCookie(COOKIE_NAME, { path: '/' });
    }
  }
  res.locals.user = req.user || null;
  next();
}

// Guards protected routes. API routes get JSON 401; pages get a redirect.
function requireAuth(req, res, next) {
  if (req.user) return next();
  // Use originalUrl: inside a mounted router req.path is relative to the mount
  // point, so it would not include the /api prefix.
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

module.exports = {
  COOKIE_NAME,
  cookieOptions,
  signToken,
  attachUser,
  requireAuth,
};
