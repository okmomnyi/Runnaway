'use strict';

// Extracts plain text from an uploaded CV. Supports PDF, DOCX, and TXT.
// Requiring pdf-parse via its lib path avoids the package's debug wrapper,
// which otherwise tries to read a bundled sample file on import.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const mammoth = require('mammoth');

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function extractText(buffer, filename) {
  const name = (filename || '').toLowerCase();

  if (name.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  }
  if (name.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return buffer.toString('utf8').trim();
  }
  throw typedError('Unsupported file type. Upload a PDF, DOCX, or TXT file.', 'BAD_TYPE');
}

module.exports = { extractText };
