'use strict';

const cron = require('node-cron');
const { pool } = require('../db/pool');
const { decrypt } = require('../services/crypto');
const google = require('../services/google');
const gmail = require('../services/gmail');
const { classifyReply } = require('../services/nvidia');

// Status ranking so an auto-update never downgrades a stronger outcome.
const RANK = { 'not-applied': 0, applied: 1, pending: 2, interview: 3, accepted: 4, rejected: 4, skip: -1 };
const STOPWORDS = new Set([
  'the', 'and', 'of', 'ltd', 'limited', 'company', 'group', 'kenya', 'east',
  'africa', 'bank', 'plc', 'inc', 'co', 'technologies', 'technology', 'services',
  'authority', 'county', 'government', 'national',
]);

function domainOf(value) {
  if (!value) return '';
  const at = value.indexOf('@');
  if (at !== -1) return value.slice(at + 1).trim().toLowerCase();
  const m = String(value).match(/^https?:\/\/([^/]+)/i);
  if (m) return m[1].replace(/^www\./, '').toLowerCase();
  return '';
}
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }

function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

// Which of this user's companies plausibly relate to an email (cheap prefilter
// before spending an LLM call).
function candidateCompanies(companies, msg) {
  const addr = gmail.parseAddress(msg.from);
  const senderDomain = domainOf(addr.email);
  const hay = (addr.name + ' ' + msg.subject).toLowerCase();
  const out = [];
  for (const c of companies) {
    let hit = false;
    if (isEmail(c.contact) && c.contact.trim().toLowerCase() === addr.email) hit = true;
    if (!hit && senderDomain) {
      const cd = domainOf(c.website) || (isEmail(c.contact) ? domainOf(c.contact) : '');
      if (cd && (cd === senderDomain || senderDomain.endsWith('.' + cd) || cd.endsWith('.' + senderDomain))) hit = true;
    }
    if (!hit) {
      const toks = nameTokens(c.name);
      if (toks.some((t) => hay.includes(t))) hit = true;
    }
    if (hit) out.push(c);
  }
  return out;
}

async function getAccessToken(user) {
  const refresh = decrypt(user.google_refresh_token);
  if (!refresh) throw Object.assign(new Error('No refresh token'), { disconnect: true });
  try {
    const tok = await google.refreshAccessToken(refresh);
    return tok.access_token;
  } catch (err) {
    // Revoked / invalid grant -> stop trying for this user.
    if (err.status === 400 || err.status === 401) err.disconnect = true;
    throw err;
  }
}

async function syncUser(user) {
  const accessToken = await getAccessToken(user);

  const { rows: companies } = await pool.query(
    'SELECT id, name, contact, website, status, notes FROM companies WHERE user_id = $1',
    [user.id]
  );
  if (companies.length === 0) return { processed: 0, updated: 0 };

  const ids = await gmail.listMessageIds(accessToken, 'in:inbox newer_than:30d', 30);
  const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c]));

  let processed = 0;
  let updated = 0;

  for (const msgId of ids) {
    // Skip messages already handled.
    const seen = await pool.query(
      'SELECT 1 FROM gmail_seen WHERE user_id = $1 AND gmail_msg_id = $2',
      [user.id, msgId]
    );
    if (seen.rowCount) continue;

    let appliedStatus = null;
    let companyId = null;
    let handled = false; // only mark "seen" when the message was fully processed
    try {
      const msg = await gmail.getMessage(accessToken, msgId);
      const candidates = candidateCompanies(companies, msg);

      if (candidates.length > 0) {
        const result = await classifyReply(msg, candidates.map((c) => c.name));
        const match =
          byName.get(String(result.company || '').toLowerCase()) ||
          candidates.find((c) => result.company && c.name.toLowerCase().includes(result.company.toLowerCase()));

        if (match && ['interview', 'accepted', 'rejected', 'pending'].includes(result.status)) {
          companyId = match.id;
          const newRank = RANK[result.status];
          const curRank = RANK[match.status] != null ? RANK[match.status] : 0;
          const terminal = match.status === 'accepted' || match.status === 'rejected';
          // Apply unless it would downgrade a stronger/terminal outcome.
          if (!terminal && newRank >= curRank) {
            appliedStatus = result.status;
            const stamp = new Date().toISOString().slice(0, 10);
            const note = `[${stamp}] Auto from email: ${result.summary || 'reply detected'}`.trim();
            const newNotes = match.notes ? `${match.notes}\n${note}` : note;
            await pool.query(
              'UPDATE companies SET status = $1, notes = $2, updated_at = now() WHERE id = $3 AND user_id = $4',
              [result.status, newNotes, match.id, user.id]
            );
            updated += 1;
            // keep local copy fresh in case another message hits the same company
            match.status = result.status;
            match.notes = newNotes;
          }
        }
      }
      processed += 1;
      handled = true;
    } catch (err) {
      // Transient failure (Gmail hiccup, model timeout/overload): leave the
      // message unseen so the next run retries it rather than silently dropping
      // a real reply.
      console.error(`[gmail] message ${msgId} failed (will retry):`, err.message);
    }

    // Only mark seen once the message was fully processed.
    if (handled) {
      await pool
        .query(
          `INSERT INTO gmail_seen (user_id, gmail_msg_id, company_id, applied_status)
           VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, gmail_msg_id) DO NOTHING`,
          [user.id, msgId, companyId, appliedStatus]
        )
        .catch(() => {});
    }
  }

  await pool.query('UPDATE users SET gmail_last_sync = now() WHERE id = $1', [user.id]);
  return { processed, updated };
}

async function runGmailSync() {
  if (!google.isConfigured()) return; // no OAuth creds -> nothing to do
  const { rows: users } = await pool.query(
    'SELECT id, google_refresh_token FROM users WHERE google_refresh_token IS NOT NULL'
  );
  if (users.length === 0) return;

  console.log(`[gmail] Sync starting for ${users.length} connected user(s).`);
  for (const user of users) {
    try {
      const r = await syncUser(user);
      console.log(`[gmail] user ${user.id}: processed ${r.processed}, updated ${r.updated}`);
    } catch (err) {
      if (err.disconnect) {
        console.warn(`[gmail] user ${user.id}: token invalid, disconnecting.`);
        await pool
          .query(
            'UPDATE users SET google_refresh_token = NULL, google_email = NULL, gmail_connected_at = NULL WHERE id = $1',
            [user.id]
          )
          .catch(() => {});
      } else {
        console.error(`[gmail] user ${user.id} sync failed:`, err.message);
      }
    }
  }
}

function startGmailSyncJob() {
  const schedule = process.env.GMAIL_SYNC_SCHEDULE || '*/30 * * * *'; // every 30 min
  if (!cron.validate(schedule)) {
    console.error(`[gmail] Invalid GMAIL_SYNC_SCHEDULE "${schedule}" — job not started.`);
    return;
  }
  if (!google.isConfigured()) {
    console.log('[gmail] Google OAuth not configured; reply-tracking job idle.');
    return;
  }
  cron.schedule(schedule, () => {
    runGmailSync().catch((err) => console.error('[gmail] sync failed:', err.message));
  });
  console.log(`[gmail] Reply-tracking job scheduled: "${schedule}"`);
}

module.exports = { startGmailSyncJob, runGmailSync };
