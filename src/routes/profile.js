'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const FIELDS = [
  'full_name',
  'phone',
  'contact_email',
  'university',
  'certifications',
  'focus_summary',
  'skills',
  'cloud_infra',
  'recent_activity',
  'availability_note',
];

async function loadProfile(userId) {
  const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  if (rows.length) return rows[0];
  // Defensive: create one if somehow missing (older accounts, manual DB edits).
  const inserted = await pool.query(
    'INSERT INTO profiles (user_id) VALUES ($1) RETURNING *',
    [userId]
  );
  return inserted.rows[0];
}

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await loadProfile(req.user.id);
    res.render('profile', {
      profile,
      welcome: req.query.welcome === '1',
      saved: req.query.saved === '1',
    });
  } catch (err) {
    console.error('[profile] load failed:', err.message);
    res.status(500).render('profile', {
      profile: null,
      welcome: false,
      saved: false,
      loadError: 'Could not load your profile. Please refresh.',
    });
  }
});

router.post('/profile', requireAuth, async (req, res) => {
  try {
    const values = FIELDS.map((f) => (req.body[f] != null ? String(req.body[f]) : ''));
    // availability_note should keep its default meaning if cleared.
    const assignments = FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
    await pool.query(
      `UPDATE profiles SET ${assignments}, updated_at = now() WHERE user_id = $1`,
      [req.user.id, ...values]
    );
    res.redirect('/profile?saved=1');
  } catch (err) {
    console.error('[profile] save failed:', err.message);
    const profile = await loadProfile(req.user.id).catch(() => null);
    res.status(500).render('profile', {
      profile,
      welcome: false,
      saved: false,
      loadError: 'Could not save your profile. Please try again.',
    });
  }
});

module.exports = router;
