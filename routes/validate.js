const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pino = require('pino');

const {
  default: whatsAppConnect,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');


// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });


// ──────────────────────────────────────────────────────────────
// Session Validation Route
// Checks if sessions are actually alive (spoiler: most aren't)
// ──────────────────────────────────────────────────────────────

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { format, data } = req.body;

    if (format === 'base64') {
      return validateBase64(data, res);
    } else if (format === 'file' && req.file) {
      return validateFile(req.file.buffer, res);
    } else {
      return res.status(400).json({
        valid: false,
        message: 'Invalid request format',
      });
    }
  } catch (err) {
    console.error('Validation error:', err);

    return res.status(500).json({
      valid: false,
      message: 'Server error during validation',
      details: err.message,
    });
  }
});


// ──────────────────────────────────────────────────────────────
// Base64 Validation
// Decodes and validates Base64 encoded credentials
// ──────────────────────────────────────────────────────────────

async function validateBase64(base64Str, res) {
  try {
    const credsBuffer = Buffer.from(base64Str.trim(), 'base64');
    const credsData = JSON.parse(credsBuffer.toString('utf8'));

    await testConnection(credsData);

    return res.json({
      valid: true,
      message: 'Session is valid and working!',
      details: 'Successfully connected to WhatsApp',
    });
  } catch (err) {
    console.error('Base64 validation error:', err);

    return res.status(400).json({
      valid: false,
      message: `Invalid session: ${err.message}`,
      details: err.message,
    });
  }
}


// ──────────────────────────────────────────────────────────────
// File Validation
// Validates uploaded creds.json files
// ──────────────────────────────────────────────────────────────

async function validateFile(fileBuffer, res) {
  try {
    const credsData = JSON.parse(fileBuffer.toString('utf8'));

    await testConnection(credsData);

    return res.json({
      valid: true,
      message: 'Credentials file is valid and working!',
      details: 'Successfully connected to WhatsApp',
    });
  } catch (err) {
    console.error('File validation error:', err);

    return res.status(400).json({
      valid: false,
      message: `Invalid file: ${err.message}`,
      details: err.message,
    });
  }
}


// ──────────────────────────────────────────────────────────────
// Connection Test
// Actually tries to connect to WhatsApp to verify session
// ──────────────────────────────────────────────────────────────

async function testConnection(credsData) {
  const tempDir = path.join(__dirname, `.temp-${Date.now()}`);

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Write credentials to temp location
    const credsPath = path.join(tempDir, 'creds.json');
    fs.writeFileSync(credsPath, JSON.stringify(credsData));

    const { version } = await fetchLatestBaileysVersion();
    const { state } = await useMultiFileAuthState(tempDir);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout - session may be expired'));
      }, 10000);

      (async () => {
        try {
          const socket = whatsAppConnect({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 5000,
            keepAliveIntervalMs: 5000,
          });

          socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
              clearTimeout(timeout);
              socket.ws.close();
              resolve('Connected');
            } else if (connection === 'close') {
              clearTimeout(timeout);

              const statusCode = lastDisconnect?.error?.output?.statusCode;

              if (statusCode === 401 || statusCode === 403) {
                reject(new Error('Session expired or invalidated'));
              } else {
                reject(new Error(lastDisconnect?.error?.message || 'Connection closed'));
              }
            }
          });

          socket.ev.on('connection.failure', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      })();
    });
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}


module.exports = router;
