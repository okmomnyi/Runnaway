'use strict';

const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { extractText } = require('../services/cvParser');
const { extractProfileFromCV } = require('../services/nvidia');

const router = express.Router();

// CV uploads are held in memory and parsed on the fly; nothing is written to disk.
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

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

// Parse an uploaded CV and return the extracted fields as JSON. Does not save
// anything — the client fills the form so the user can review before saving.
router.post('/profile/import-cv', requireAuth, (req, res) => {
  cvUpload.single('cv')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg =
        uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'That file is too large (max 5 MB).'
          : 'Could not read the uploaded file.';
      return res.status(400).json({ error: msg });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });

      const text = await extractText(req.file.buffer, req.file.originalname);
      if (!text || text.trim().length < 30) {
        return res
          .status(422)
          .json({ error: 'Could not read enough text from that file. Is it a scanned image?' });
      }

      const fields = await extractProfileFromCV(text);
      return res.json({ fields });
    } catch (err) {
      console.error('[profile] cv import failed:', err.code || '', err.message);
      const message =
        err.code === 'NO_API_KEY'
          ? 'CV import is not configured on the server (missing NVIDIA_API_KEY).'
          : err.code === 'BAD_TYPE'
          ? err.message
          : `Could not import that CV: ${err.message}`;
      const status = err.code === 'BAD_TYPE' ? 415 : 502;
      return res.status(status).json({ error: message });
    }
  });
});

module.exports = router;
