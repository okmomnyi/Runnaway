'use strict';

// Google OAuth connect/callback/disconnect for Gmail reply-tracking.

const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const google = require('../services/google');
const { encrypt } = require('../services/crypto');

const router = express.Router();

// Sign a short-lived state token so the callback can trust which user started
// the flow and guard against CSRF.
function makeState(userId) {
  return jwt.sign({ uid: userId, p: 'gmail_oauth' }, process.env.JWT_SECRET, { expiresIn: '15m' });
}
function readState(state) {
  try {
    const d = jwt.verify(state, process.env.JWT_SECRET);
    return d && d.p === 'gmail_oauth' ? d.uid : null;
  } catch (e) {
    return null;
  }
}

// Start the flow.
router.get('/oauth/google/connect', requireAuth, (req, res) => {
  if (!google.isConfigured()) {
    return res.redirect('/profile?gmail=notconfigured');
  }
  const url = google.buildAuthUrl(makeState(req.user.id));
  res.redirect(url);
});

// Google redirects back here with ?code & ?state.
router.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/profile?gmail=denied');
  const uid = readState(state);
  if (!code || !uid) return res.redirect('/profile?gmail=error');

  try {
    const tokens = await google.exchangeCode(String(code));
    if (!tokens.refresh_token) {
      // No refresh token means we can't poll later. Ask them to reconnect.
      return res.redirect('/profile?gmail=norefresh');
    }
    const email = await google.getProfileEmail(tokens.access_token).catch(() => null);

    await pool.query(
      `UPDATE users
         SET google_email = $1,
             google_refresh_token = $2,
             gmail_connected_at = now(),
             gmail_last_sync = NULL
       WHERE id = $3`,
      [email, encrypt(tokens.refresh_token), uid]
    );
    res.redirect('/profile?gmail=connected');
  } catch (err) {
    console.error('[oauth] callback failed:', err.message);
    res.redirect('/profile?gmail=error');
  }
});

// Disconnect: forget the stored token.
router.post('/oauth/google/disconnect', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users
         SET google_email = NULL, google_refresh_token = NULL,
             gmail_connected_at = NULL, gmail_last_sync = NULL
       WHERE id = $1`,
      [req.user.id]
    );
  } catch (err) {
    console.error('[oauth] disconnect failed:', err.message);
  }
  res.redirect('/profile?gmail=disconnected');
});

module.exports = router;
