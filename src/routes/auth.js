'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { pool } = require('../db/pool');
const { COOKIE_NAME, cookieOptions, signToken } = require('../middleware/auth');

const router = express.Router();

// 20 requests / 15 min per IP on the auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- Register --------------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { error: null, values: { email: '' } });
});

router.post('/register', authLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';

  const render = (error) =>
    res.status(400).render('register', { error, values: { email } });

  if (!isValidEmail(email)) return render('Enter a valid email address.');
  if (password.length < 8) return render('Password must be at least 8 characters.');
  if (password !== confirm) return render('Passwords do not match.');

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return render('An account with that email already exists.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      );
      user = inserted.rows[0];
      // Every user gets a blank profile row so /profile always has something to load.
      await client.query('INSERT INTO profiles (user_id) VALUES ($1)', [user.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
    return res.redirect('/profile?welcome=1');
  } catch (err) {
    console.error('[auth] register failed:', err.message);
    return render('Something went wrong creating your account. Please try again.');
  }
});

// ---- Login -----------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { error: null, values: { email: '' } });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const render = () =>
    res
      .status(401)
      .render('login', { error: 'Invalid email or password.', values: { email } });

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (result.rowCount === 0) return render();

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return render();

    res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('[auth] login failed:', err.message);
    return res
      .status(500)
      .render('login', { error: 'Something went wrong. Please try again.', values: { email } });
  }
});

// ---- Logout ----------------------------------------------------------------

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login');
});

module.exports = router;
