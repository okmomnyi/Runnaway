'use strict';

// Applies schema.sql against the configured database. Idempotent — safe to
// run as many times as you like. Usage: `npm run migrate`.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[migrate] Applying schema...');
  await pool.query(sql);
  console.log('[migrate] Done. Tables and indexes are in place.');
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] Failed:', err.message);
    process.exit(1);
  });
