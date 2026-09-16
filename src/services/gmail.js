'use strict';

// Thin Gmail REST client (raw fetch). Read-only: list message ids matching a
// query, fetch a message, and pull out from/subject/date/body text.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function listMessageIds(accessToken, query, max) {
  const params = new URLSearchParams({ q: query || 'in:inbox', maxResults: String(max || 25) });
  const res = await fetch(`${API}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Gmail list failed (${res.status}): ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return (data.messages || []).map((m) => m.id);
}

function b64urlDecode(data) {
  if (!data) return '';
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
}

// Walk the MIME parts and pull the first text/plain (fallback text/html stripped).
function extractBody(payload) {
  if (!payload) return '';
  let plain = '';
  let html = '';
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body && part.body.data && !plain) {
      plain = b64urlDecode(part.body.data);
    } else if (mime === 'text/html' && part.body && part.body.data && !html) {
      html = b64urlDecode(part.body.data);
    }
    (part.parts || []).forEach(walk);
  }
  walk(payload);
  if (plain) return plain;
  if (html) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return '';
}

async function getMessage(accessToken, id) {
  const res = await fetch(`${API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Gmail get failed (${res.status}): ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const headers = (data.payload && data.payload.headers) || [];
  const h = (name) => {
    const found = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : '';
  };
  return {
    id: data.id,
    threadId: data.threadId,
    from: h('From'),
    subject: h('Subject'),
    date: h('Date'),
    snippet: data.snippet || '',
    body: extractBody(data.payload).slice(0, 4000),
    internalDate: Number(data.internalDate) || 0,
  };
}

// Pull a bare email address out of a "Name <addr@x.com>" header value.
function parseAddress(fromHeader) {
  if (!fromHeader) return { name: '', email: '' };
  const m = fromHeader.match(/<([^>]+)>/);
  const email = (m ? m[1] : fromHeader).trim().toLowerCase();
  const name = (m ? fromHeader.slice(0, m.index) : '').replace(/["']/g, '').trim();
  return { name, email };
}

module.exports = { listMessageIds, getMessage, parseAddress };
