'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { draftEmail } = require('../services/nvidia');

const router = express.Router();

// All routes here are JSON and require auth.
router.use(requireAuth);

const SECTORS = [
  'Cloud & DevOps',
  'Networking & Telecom',
  'Cybersecurity',
  'Fintech & Software',
  'Banking & Finance',
  'Insurance',
  'Government & Parastatal',
  'NGO & Conservation',
  'Other',
];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = [
  'not-applied',
  'applied',
  'pending',
  'interview',
  'accepted',
  'rejected',
  'skip',
];

// Fields a client may PATCH, with a normalizer for each.
const PATCHABLE = {
  name: (v) => String(v).trim(),
  sector: (v) => (SECTORS.includes(v) ? v : 'Other'),
  location: (v) => String(v),
  contact: (v) => String(v),
  website: (v) => String(v).trim(),
  priority: (v) => (PRIORITIES.includes(v) ? v : 'Medium'),
  status: (v) => (STATUSES.includes(v) ? v : 'not-applied'),
  notes: (v) => String(v),
  draft_email: (v) => String(v),
  // Date fields: empty string -> null.
  date_applied: (v) => (v ? String(v) : null),
  follow_up_date: (v) => (v ? String(v) : null),
};

async function findCompany(userId, id) {
  const { rows } = await pool.query(
    'SELECT * FROM companies WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

// ---- List ------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC, id ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[companies] list failed:', err.message);
    res.status(500).json({ error: 'Could not load companies.' });
  }
});

// ---- Create ----------------------------------------------------------------

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Company name is required.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO companies
         (user_id, name, sector, location, contact, website, priority, status, notes, source, is_exception)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10)
       RETURNING *`,
      [
        req.user.id,
        name,
        SECTORS.includes(b.sector) ? b.sector : 'Other',
        b.location || '',
        b.contact || '',
        (b.website || '').trim(),
        PRIORITIES.includes(b.priority) ? b.priority : 'Medium',
        STATUSES.includes(b.status) ? b.status : 'not-applied',
        b.notes || '',
        b.is_exception === true,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[companies] create failed:', err.message);
    res.status(500).json({ error: 'Could not create the company.' });
  }
});

// ---- Update ----------------------------------------------------------------

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

  const updates = [];
  const values = [];
  for (const [key, normalize] of Object.entries(PATCHABLE)) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      values.push(normalize(req.body[key]));
      updates.push(`${key} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'name') && !values[0].length) {
    // name is always first in PATCHABLE order; guard against blanking it.
    return res.status(400).json({ error: 'Company name cannot be empty.' });
  }

  values.push(id, req.user.id);

  try {
    const { rows } = await pool.query(
      `UPDATE companies SET ${updates.join(', ')}, updated_at = now()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[companies] update failed:', err.message);
    res.status(500).json({ error: 'Could not update the company.' });
  }
});

// ---- Delete ----------------------------------------------------------------

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM companies WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Company not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[companies] delete failed:', err.message);
    res.status(500).json({ error: 'Could not delete the company.' });
  }
});

// ---- Draft email -----------------------------------------------------------

router.post('/:id/draft', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

  try {
    const company = await findCompany(req.user.id, id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const profileRes = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [
      req.user.id,
    ]);
    const profile = profileRes.rows[0] || {};

    if (!profile.full_name || !profile.full_name.trim()) {
      return res.status(400).json({
        error: 'Fill in your profile (at least your name) before drafting emails.',
      });
    }

    await pool.query(
      "UPDATE companies SET draft_status = 'generating', updated_at = now() WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    const draft = await draftEmail(profile, company);

    const { rows } = await pool.query(
      `UPDATE companies
         SET draft_email = $1, draft_status = 'ready', updated_at = now()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [draft, id, req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('[companies] draft failed:', err.code || '', err.message);
    // Reset draft_status so the UI doesn't get stuck on "generating".
    await pool
      .query(
        "UPDATE companies SET draft_status = 'failed', updated_at = now() WHERE id = $1 AND user_id = $2",
        [id, req.user.id]
      )
      .catch(() => {});

    const message =
      err.code === 'NO_API_KEY'
        ? 'AI drafting is not configured. Add NVIDIA_API_KEY to your .env.'
        : `Could not generate a draft: ${err.message}`;
    res.status(502).json({ error: message });
  }
});

module.exports = router;
