'use strict';

// Server-side only. Drafts a cold email via NVIDIA's OpenAI-compatible
// endpoint. The API key never reaches the browser.

const BASE_URL = () => process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const MODEL = () => process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct';

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
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
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw typedError(
      'NVIDIA_API_KEY is not set. Add it to your .env to enable AI drafting.',
      'NO_API_KEY'
    );
  }

  const url = `${BASE_URL().replace(/\/$/, '')}/chat/completions`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0.6,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(profile, company) },
        ],
      }),
    });
  } catch (err) {
    throw typedError(`Could not reach the NVIDIA API: ${err.message}`, 'REQUEST_FAILED');
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (_) {
      /* ignore */
    }
    throw typedError(
      `NVIDIA API returned ${response.status}. ${detail.slice(0, 300)}`.trim(),
      'API_ERROR'
    );
  }

  const data = await response.json();
  const content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!content || !content.trim()) {
    throw typedError('NVIDIA API returned an empty draft.', 'EMPTY_RESPONSE');
  }

  return content.trim();
}

module.exports = { draftEmail };
