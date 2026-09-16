'use strict';

// Google OAuth 2.0 (web flow) using raw fetch — no extra dependencies.
// Scope is gmail.readonly: the app only reads messages to detect replies,
// it never sends or modifies mail.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function clientId() { return process.env.GOOGLE_CLIENT_ID || ''; }
function clientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ''; }
function redirectUri() { return process.env.GOOGLE_REDIRECT_URI || ''; }

function isConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // get a refresh token
    prompt: 'consent', // ensure a refresh token is returned
    // NOTE: deliberately no include_granted_scopes. If this OAuth client was
    // ever granted other scopes (Drive/YouTube), merging them in makes Google
    // reject the request ("scopes that cannot be requested together"). We only
    // ever want gmail.readonly.
    state: state || '',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code: code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${t.slice(0, 200)}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Token refresh failed (${res.status}): ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json(); // { access_token, expires_in, ... }
}

// Fetch the connected account's email address (for display + matching).
// Uses the Gmail profile endpoint, which works with the gmail.readonly scope.
async function getProfileEmail(accessToken) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.emailAddress || null;
}

module.exports = {
  SCOPE,
  isConfigured,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getProfileEmail,
};
