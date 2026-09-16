'use strict';

// Seeds the starter company list for an already-registered user.
// Usage:  npm run seed -- your@email.com
//
// Safe to re-run: it only inserts if the user currently has zero companies,
// so it never creates duplicates.

require('dotenv').config();

const { pool } = require('./pool');
const companies = require('./seed-companies');

async function seed() {
  const email = (process.argv[2] || '').trim().toLowerCase();

  if (!email) {
    console.error('[seed] Missing email. Usage: npm run seed -- your@email.com');
    process.exit(1);
  }

  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userRes.rowCount === 0) {
    console.error(
      `[seed] No user found for "${email}". Register that account in the web UI first, then re-run.`
    );
    process.exit(1);
  }
  const userId = userRes.rows[0].id;

  const countRes = await pool.query(
    'SELECT COUNT(*)::int AS n FROM companies WHERE user_id = $1',
    [userId]
  );
  if (countRes.rows[0].n > 0) {
    console.log(
      `[seed] User "${email}" already has ${countRes.rows[0].n} companies. Nothing to do.`
    );
    return;
  }

  let inserted = 0;
  for (const c of companies) {
    await pool.query(
      `INSERT INTO companies
         (user_id, name, sector, location, contact, website, priority, status, notes, source, is_exception)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        userId,
        c.name,
        c.sector || 'Other',
        c.location || '',
        c.contact || '',
        c.website || '',
        c.priority || 'Medium',
        c.status || 'not-applied',
        c.notes || '',
        c.source || 'manual',
        c.is_exception === true,
      ]
    );
    inserted += 1;
  }

  console.log(`[seed] Inserted ${inserted} companies for "${email}".`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err.message);
    process.exit(1);
  });
