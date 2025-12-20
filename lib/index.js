const fs = require('fs');


// ──────────────────────────────────────────────────────────────
// Session ID Generator
// Random string generator for unique session identifiers
// ──────────────────────────────────────────────────────────────

function GenID(length = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}


// ──────────────────────────────────────────────────────────────
// Pairing Code Generator
// Generates 8-character random codes for WhatsApp pairing
// ──────────────────────────────────────────────────────────────

function generateRandomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}


// ──────────────────────────────────────────────────────────────
// File Cleanup Utility
// Removes directories recursively (no survivors)
// ──────────────────────────────────────────────────────────────

async function removeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  await fs.promises.rm(filePath, {
    recursive: true,
    force: true,
  });

  return true;
}


module.exports = {
  GenID,
  generateRandomCode,
  removeFile,
};
