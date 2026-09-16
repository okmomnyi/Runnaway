'use strict';

const { Pool, types } = require('pg');

// Return DATE columns (OID 1082) as the raw 'YYYY-MM-DD' string instead of a
// JS Date. A Date is created at local midnight and shifts a day when serialized
// to UTC JSON, which would show the wrong day in the date inputs. TIMESTAMPTZ
// values are real instants and are left to parse normally.
types.setTypeParser(1082, (val) => val);

if (!process.env.DATABASE_URL) {
  // Fail loudly and early — a missing connection string is the single most
  // common setup mistake, and a clear message saves a lot of confusion.
  console.error(
    '[db] DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.'
  );
}

// Neon requires SSL. rejectUnauthorized:false is acceptable here because we
// connect by the trusted Neon hostname over TLS; Neon does not present a cert
// chain the default Node bundle validates without extra config.
// If the connection string explicitly opts out (sslmode=disable, e.g. a local
// Postgres), respect that so the app also runs against a non-SSL database.
const url = process.env.DATABASE_URL || '';
const sslDisabled = /sslmode=disable/i.test(url);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
