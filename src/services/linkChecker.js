'use strict';

// Checks whether a company website is reachable. Returns:
//   'ok'      — responded successfully
//   'broken'  — reachable check failed (bad status or network error)
//   'unknown' — no URL to check

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'AttachmentRunway-LinkChecker/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkLink(url) {
  if (!url || !url.trim()) return 'unknown';

  const target = url.trim();

  // Try HEAD first (cheap), fall back to GET if HEAD isn't ok or errors —
  // some servers reject or mishandle HEAD.
  try {
    const head = await fetchWithTimeout(target, 'HEAD');
    if (head.ok) return 'ok';
  } catch (_) {
    /* fall through to GET */
  }

  try {
    const get = await fetchWithTimeout(target, 'GET');
    return get.ok ? 'ok' : 'broken';
  } catch (_) {
    return 'broken';
  }
}

module.exports = { checkLink };
