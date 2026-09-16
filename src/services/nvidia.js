'use strict';

// Server-side only. Drafts a cold email via NVIDIA's OpenAI-compatible
// endpoint. The API key never reaches the browser.

const BASE_URL = () => process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

// Model availability on NVIDIA's free tier flips constantly (a model that is
// fast now may return 503 "overloaded" a minute later, or reach end-of-life
// and 410). So instead of one model we keep a list and try them in order,
// using whichever responds first and remembering that winner for next time.
const DEFAULT_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b',
  'openai/gpt-oss-20b',
  'mistralai/mistral-nemotron',
];

function modelList() {
  const raw = process.env.NVIDIA_MODELS || process.env.NVIDIA_MODEL || DEFAULT_MODELS.join(',');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Sticky preference: the last model that answered goes to the front next time.
let lastGoodModel = null;

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

const BUSY_MESSAGE = 'The AI service is busy right now. Please try again in a moment.';

// Several of the free-tier models are reasoning models that otherwise dump
// their chain-of-thought into the answer. Turn that off per model: Nemotron
// models honor a "detailed thinking off" system directive; gpt-oss takes a
// reasoning_effort hint. Returns the request body for a given model.
function buildBody(model, messages, opts) {
  const body = {
    model,
    temperature: opts.temperature != null ? opts.temperature : 0.3,
    max_tokens: opts.maxTokens || 600,
    messages,
  };
  const m = model.toLowerCase();
  if (m.indexOf('nemotron') !== -1) {
    body.messages = [{ role: 'system', content: 'detailed thinking off' }].concat(messages);
  } else if (m.indexOf('gpt-oss') !== -1) {
    body.reasoning_effort = 'low';
  }
  return body;
}

// Safety net: strip any reasoning that still leaks through (<think> blocks,
// gpt-oss "analysis"/"assistantfinal" channel markers).
function stripReasoning(text) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<\/?think>/gi, '');
  if (/assistantfinal/i.test(t)) t = t.split(/assistantfinal/i).pop();
  return t.trim();
}

// Try each model in turn until one returns content. A model that errors (503
// overloaded, 500, 404, 410 end-of-life) or is too slow is skipped and the
// next is tried. `overallTimeoutMs` bounds the whole attempt so user-facing
// calls stay under Cloudflare's ~100s origin limit; `perModelMs` bounds each
// single model so a hung one doesn't eat the whole budget.
async function chatCompletion(messages, opts) {
  opts = opts || {};
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw typedError(
      'NVIDIA_API_KEY is not set. Add it to your .env to enable AI features.',
      'NO_API_KEY'
    );
  }

  const url = `${BASE_URL().replace(/\/$/, '')}/chat/completions`;
  const perModelMs = opts.perModelMs || Number(process.env.NVIDIA_MODEL_TIMEOUT_MS) || 30000;
  const deadline = Date.now() + (opts.overallTimeoutMs || Number(process.env.NVIDIA_TIMEOUT_MS) || 90000);

  // Order models with the last winner first.
  let models = modelList();
  if (lastGoodModel && models.indexOf(lastGoodModel) !== -1) {
    models = [lastGoodModel].concat(models.filter((m) => m !== lastGoodModel));
  }

  let lastErr = null;
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break; // out of overall budget
    const t = abortAfter(Math.min(perModelMs, remaining));
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: t.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildBody(model, messages, opts)),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        lastErr = typedError(`${model}: ${response.status} ${detail.slice(0, 120)}`.trim(), 'API_ERROR');
        continue; // overloaded / gone / not-found -> next model
      }
      const data = await response.json();
      const raw =
        data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const content = stripReasoning(raw);
      if (!content || !content.trim()) {
        lastErr = typedError(`${model}: empty response`, 'EMPTY_RESPONSE');
        continue;
      }
      // Reject output that fails the caller's shape check (e.g. a reasoning
      // model that leaked its chain-of-thought instead of the email/JSON), and
      // fall through to the next model.
      if (opts.validate && !opts.validate(content)) {
        lastErr = typedError(`${model}: output failed validation (likely reasoning leak)`, 'BAD_OUTPUT');
        continue;
      }
      lastGoodModel = model; // remember the winner
      return content.trim();
    } catch (err) {
      lastErr = err.name === 'AbortError'
        ? typedError(`${model}: timed out`, 'TIMEOUT')
        : typedError(`${model}: ${err.message}`, 'REQUEST_FAILED');
      continue;
    } finally {
      t.clear();
    }
  }
  // Nothing worked within budget.
  const err = typedError(BUSY_MESSAGE, 'TIMEOUT');
  err.detail = lastErr ? lastErr.message : 'no models available';
  throw err;
}

const SYSTEM_PROMPT = [
  'You write short, specific, professional cold emails requesting an industrial',
  'attachment (student internship) at a named company.',
  'Rules:',
  '- Start the output with a "Subject:" line, then a blank line, then the email body.',
  '- Plain text only. No markdown, no bullet symbols, no placeholders in brackets.',
  '- Keep the whole email under 220 words.',
  '- Use ONLY the real skills, certifications, and background provided. Never invent',
  '  experience, projects, or qualifications the applicant did not state.',
  '- Be concrete about why this specific company fits the applicant\'s focus.',
  '- Warm but professional. Close with the applicant\'s name and contact details',
  '  exactly as given.',
].join('\n');

function buildUserMessage(profile, company) {
  const p = profile || {};
  const c = company || {};
  const lines = [
    'APPLICANT PROFILE',
    `Full name: ${p.full_name || '(not provided)'}`,
    `Phone: ${p.phone || '(not provided)'}`,
    `Contact email: ${p.contact_email || '(not provided)'}`,
    `University: ${p.university || '(not provided)'}`,
    `Certifications: ${p.certifications || '(none listed)'}`,
    `Focus summary: ${p.focus_summary || '(not provided)'}`,
    `Skills: ${p.skills || '(not provided)'}`,
    `Cloud / infrastructure: ${p.cloud_infra || '(not provided)'}`,
    `Recent activity: ${p.recent_activity || '(not provided)'}`,
    `Availability: ${p.availability_note || '(not provided)'}`,
    '',
    'TARGET COMPANY',
    `Name: ${c.name || '(unknown)'}`,
    `Sector: ${c.sector || '(unknown)'}`,
    `Location: ${c.location || '(unknown)'}`,
    `Notes: ${c.notes || '(none)'}`,
    '',
    'Write the cold email now.',
  ];
  return lines.join('\n');
}

async function draftEmail(profile, company) {
  return chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(profile, company) },
    ],
    {
      temperature: 0.6,
      maxTokens: 600,
      overallTimeoutMs: 90000,
      // A valid draft starts at the Subject line. Anything else is a leak.
      validate: (c) => /^\s*Subject\s*:/i.test(c),
    }
  );
}

// ---- CV -> profile extraction ---------------------------------------------

const PROFILE_FIELDS = [
  'full_name',
  'phone',
  'contact_email',
  'university',
  'certifications',
  'focus_summary',
  'skills',
  'cloud_infra',
  'recent_activity',
];

const CV_SYSTEM_PROMPT = [
  'You extract structured profile details from the raw text of a CV / resume.',
  'Return ONLY a JSON object (no prose, no code fences) with exactly these keys:',
  PROFILE_FIELDS.join(', ') + '.',
  'Guidance for each key:',
  '- full_name: the person\'s full name.',
  '- phone: primary phone number.',
  '- contact_email: primary email address.',
  '- university: degree and institution (e.g. "BSc Computer Science, X University").',
  '- certifications: named certifications, comma-separated.',
  '- focus_summary: 1-2 sentences on their focus area / specialisation.',
  '- skills: key technical skills, comma-separated.',
  '- cloud_infra: cloud / infrastructure experience.',
  '- recent_activity: notable recent roles, projects, or community involvement.',
  'Use ONLY information actually present in the CV. If a field is not found, use an',
  'empty string "". Never invent details. Keep each value concise plain text.',
].join('\n');

function safeJsonExtract(raw) {
  if (!raw) return null;
  // Strip code fences and grab the outermost {...} block.
  var cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  var start = cleaned.indexOf('{');
  var end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

async function extractProfileFromCV(cvText) {
  // Keep the prompt within sane bounds for the model's context window.
  const text = String(cvText || '').slice(0, 12000);
  const content = await chatCompletion(
    [
      { role: 'system', content: CV_SYSTEM_PROMPT },
      { role: 'user', content: 'CV TEXT:\n\n' + text },
    ],
    {
      temperature: 0.1,
      maxTokens: 700,
      overallTimeoutMs: 90000,
      validate: (c) => safeJsonExtract(c) !== null,
    }
  );

  const parsed = safeJsonExtract(content);
  if (!parsed) {
    throw typedError('Could not read structured details from that CV. Try a clearer file.', 'PARSE_FAILED');
  }

  // Whitelist to known fields and coerce to trimmed strings.
  const fields = {};
  PROFILE_FIELDS.forEach(function (k) {
    var v = parsed[k];
    fields[k] = v == null ? '' : String(v).trim();
  });
  return fields;
}

// ---- Reply classification (Gmail tracking) --------------------------------

const REPLY_STATUSES = ['interview', 'accepted', 'rejected', 'pending', 'none'];

const REPLY_SYSTEM_PROMPT = [
  'You classify a single email that may be a reply to a student\'s industrial-',
  'attachment / internship application. You are given the email and a list of',
  'the companies the student applied to.',
  'Return ONLY a JSON object with these keys:',
  '- company: the EXACT company name from the provided list that this email is',
  '  from or about, or "" if it does not clearly relate to any of them.',
  '- status: one of interview, accepted, rejected, pending, none.',
  '    interview = they invite the student to an interview or next step.',
  '    accepted  = the attachment/internship is offered or confirmed.',
  '    rejected  = the application is declined / unsuccessful.',
  '    pending   = a genuine reply acknowledging the application but no decision.',
  '    none      = not related to an application (newsletter, spam, unrelated).',
  '- summary: one short sentence (max 20 words) describing the email.',
  'Only choose a company from the list, matching by sender domain, sender name,',
  'or clear mention. If unsure, use company "" and status none. No prose, no code',
  'fences, JSON only.',
].join('\n');

async function classifyReply(email, companyNames) {
  const list = (companyNames || []).slice(0, 120).map((n, i) => `${i + 1}. ${n}`).join('\n');
  const userMsg = [
    'COMPANIES THE STUDENT APPLIED TO:',
    list || '(none)',
    '',
    'EMAIL:',
    `From: ${email.from || ''}`,
    `Subject: ${email.subject || ''}`,
    `Body: ${String(email.body || email.snippet || '').slice(0, 3000)}`,
    '',
    'Classify it now as JSON.',
  ].join('\n');

  // Runs unattended in the sync job, so give it a more patient overall budget
  // than the user-facing calls; the model fallback still skips overloaded ones.
  const content = await chatCompletion(
    [
      { role: 'system', content: REPLY_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    {
      temperature: 0,
      maxTokens: 512,
      overallTimeoutMs: 150000,
      validate: (c) => safeJsonExtract(c) !== null,
    }
  );

  const parsed = safeJsonExtract(content);
  if (!parsed) return { company: '', status: 'none', summary: '' };

  let status = String(parsed.status || 'none').toLowerCase();
  if (REPLY_STATUSES.indexOf(status) === -1) status = 'none';
  return {
    company: parsed.company ? String(parsed.company).trim() : '',
    status,
    summary: parsed.summary ? String(parsed.summary).trim() : '',
  };
}

module.exports = { draftEmail, extractProfileFromCV, classifyReply, PROFILE_FIELDS };
