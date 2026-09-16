'use strict';

// Small AES-256-GCM helper for encrypting secrets (Gmail refresh tokens) at
// rest. The key comes from TOKEN_ENC_KEY: either 64 hex chars (32 bytes) or
// any string, which is hashed to 32 bytes. If it is unset we fall back to
// JWT_SECRET so the app still works, but a dedicated key is recommended.

const crypto = require('crypto');

function getKey() {
  const raw = process.env.TOKEN_ENC_KEY || process.env.JWT_SECRET || '';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // Derive a stable 32-byte key from whatever string we were given.
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encrypt(plainText) {
  if (plainText == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store iv:tag:ciphertext, all base64.
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
