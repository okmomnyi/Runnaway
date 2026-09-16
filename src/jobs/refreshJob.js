'use strict';

const cron = require('node-cron');
const { pool } = require('../db/pool');
const { checkLink } = require('../services/linkChecker');

// Re-checks every company that has a website and stamps site_status +
// last_checked_at. Runs across all users' companies.
async function runRefresh() {
  const startedAt = new Date();
  console.log(`[refresh] Starting link check at ${startedAt.toISOString()}`);

  const { rows } = await pool.query(
    "SELECT id, website FROM companies WHERE website <> '' ORDER BY id"
  );

  let checked = 0;
  for (const row of rows) {
    const status = await checkLink(row.website);
    await pool.query(
      'UPDATE companies SET site_status = $1, last_checked_at = now(), updated_at = now() WHERE id = $2',
      [status, row.id]
    );
    checked += 1;
  }

  console.log(`[refresh] Done. Checked ${checked} companies.`);
}

function startRefreshJob() {
  const schedule = process.env.CRON_SCHEDULE || '0 3 * * 1';

  if (!cron.validate(schedule)) {
    console.error(`[refresh] Invalid CRON_SCHEDULE "${schedule}" — job not started.`);
    return;
  }

  cron.schedule(schedule, () => {
    runRefresh().catch((err) => console.error('[refresh] Failed:', err.message));
  });

  console.log(`[refresh] Weekly link-check job scheduled: "${schedule}"`);
}

module.exports = { startRefreshJob, runRefresh };
