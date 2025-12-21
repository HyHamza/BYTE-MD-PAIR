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
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const router = express.Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ──────────────────────────────────────────────────────────────
// Session Validation Route
// ──────────────────────────────────────────────────────────────

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { format, data } = req.body;

    if (format === 'base64' && data) {
      return await validateBase64(data, res);
    } else if (format === 'file' && req.file) {
      return await validateFile(req.file.buffer, res);
    } else {
      return res.status(400).json({
        valid: false,
        message: 'Invalid request format. Provide either base64 data or file upload.',
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
// ──────────────────────────────────────────────────────────────

async function validateBase64(base64Str, res) {
  try {
    const cleanedBase64 = base64Str.trim().replace(/[\s\n\r`]/g, '');
    
    if (!cleanedBase64) {
      return res.status(400).json({
        valid: false,
        message: 'Empty base64 data provided',
      });
    }

    const credsBuffer = Buffer.from(cleanedBase64, 'base64');
    const credsData = JSON.parse(credsBuffer.toString('utf8'));

    if (!isValidCredsStructure(credsData)) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid credentials structure',
        details: 'Missing required fields in credentials',
      });
    }

    const result = await testConnection(credsData);

    return res.json({
      valid: true,
      message: 'Session is valid and working!',
      details: result.details,
      phoneNumber: result.phoneNumber,
    });
  } catch (err) {
    console.error('Base64 validation error:', err);

    return res.status(400).json({
      valid: false,
      message: getErrorMessage(err),
      details: err.message,
    });
  }
}

// ──────────────────────────────────────────────────────────────
// File Validation
// ──────────────────────────────────────────────────────────────

async function validateFile(fileBuffer, res) {
  try {
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        valid: false,
        message: 'Empty file provided',
      });
    }

    const credsData = JSON.parse(fileBuffer.toString('utf8'));

    if (!isValidCredsStructure(credsData)) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid credentials structure',
        details: 'Missing required fields in credentials file',
      });
    }

    const result = await testConnection(credsData);

    return res.json({
      valid: true,
      message: 'Credentials file is valid and working!',
      details: result.details,
      phoneNumber: result.phoneNumber,
    });
  } catch (err) {
    console.error('File validation error:', err);

    return res.status(400).json({
      valid: false,
      message: getErrorMessage(err),
      details: err.message,
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Credentials Structure Validation
// ──────────────────────────────────────────────────────────────

function isValidCredsStructure(creds) {
  if (!creds || typeof creds !== 'object') {
    return false;
  }

  // Check required fields
  const requiredFields = [
    'noiseKey',
    'signedIdentityKey',
    'signedPreKey',
    'registrationId',
    'advSecretKey',
    'me'
  ];

  for (const field of requiredFields) {
    if (!creds[field]) {
      console.log(`Missing required field: ${field}`);
      return false;
    }
  }

  // Validate 'me' object
  if (!creds.me.id || !creds.me.name) {
    console.log('Invalid me object');
    return false;
  }

  return true;
}

// ──────────────────────────────────────────────────────────────
// Connection Test
// ──────────────────────────────────────────────────────────────

async function testConnection(credsData) {
  const tempDir = path.join(__dirname, `.temp-${Date.now()}-${Math.random().toString(36).substring(7)}`);

  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const credsPath = path.join(tempDir, 'creds.json');
    fs.writeFileSync(credsPath, JSON.stringify(credsData, null, 2));

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timeout (15s) - session may be expired or network issue'));
      }, 15000);

      let socket = null;
      let cleaned = false;

      const cleanup = () => {
        if (!cleaned) {
          cleaned = true;
          clearTimeout(timeout);
          
          if (socket?.ws) {
            try {
              socket.ws.close();
            } catch (err) {
              console.error('Error closing socket:', err);
            }
          }
        }
      };

      (async () => {
        try {
          socket = whatsAppConnect({
            version,
            auth: {
              creds: state.creds,
              keys: makeCacheableSignalKeyStore(
                state.keys,
                pino({ level: 'silent' })
              ),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 10000,
            keepAliveIntervalMs: 10000,
            syncFullHistory: false,
            shouldIgnoreJid: (jid) => jid?.endsWith('@g.us'),
            getMessage: async () => undefined,
          });

          socket.ev.on('creds.update', saveCreds);

          socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
              cleanup();
              reject(new Error('Session requires QR code - credentials are invalid or expired'));
              return;
            }

            if (connection === 'open') {
              cleanup();
              
              // FIX: Extract phone number from authenticated user
              const phoneNumber = socket.user?.id?.split(':')[0] || 'Unknown';
              
              resolve({
                details: 'Successfully connected to WhatsApp',
                phoneNumber: phoneNumber,
              });
            } else if (connection === 'close') {
              cleanup();

              const statusCode = lastDisconnect?.error?.output?.statusCode;
              const errorMessage = lastDisconnect?.error?.message;

              // FIX: Better error categorization with clear user instructions
              if (statusCode === 401) {
                reject(new Error('SESSION_EXPIRED: Your session has expired or been logged out. Please generate a new session using the pairing code.'));
              } else if (statusCode === 403) {
                reject(new Error('SESSION_BANNED: Your WhatsApp account is banned or restricted. Contact WhatsApp support.'));
              } else if (statusCode === 440) {
                reject(new Error('SESSION_DISCONNECTED: Session disconnected. Try generating a new session.'));
              } else if (statusCode === 515) {
                reject(new Error('SESSION_RESTART_REQUIRED: Session needs to be restarted. Please generate a new session.'));
              } else {
                reject(new Error(`SESSION_ERROR: Connection closed unexpectedly (Status: ${statusCode || 'Unknown'}). ${errorMessage || 'Please try generating a new session.'}`));
              }
            }
          });

          socket.ev.on('connection.failure', (error) => {
            cleanup();
            reject(new Error(`Connection failed: ${error?.message || 'Unknown error'}`));
          });

        } catch (err) {
          cleanup();
          reject(err);
        }
      })();
    });
  } catch (err) {
    throw new Error(`Setup error: ${err.message}`);
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Error Message Helper
// ──────────────────────────────────────────────────────────────

function getErrorMessage(err) {
  const message = err.message || 'Unknown error';

  if (message.includes('SESSION_EXPIRED')) {
    return '❌ Session Expired: Your WhatsApp session has expired. Please generate a new session using the pairing code method.';
  }
  if (message.includes('SESSION_BANNED')) {
    return '❌ Account Banned: Your WhatsApp account is banned or restricted. Contact WhatsApp support for assistance.';
  }
  if (message.includes('SESSION_DISCONNECTED') || message.includes('SESSION_RESTART_REQUIRED')) {
    return '❌ Session Invalid: Your session is no longer active. Please generate a new session.';
  }
  
  if (message.includes('Invalid base64')) {
    return '❌ Invalid Format: The session data is not properly encoded. Please copy the complete session string.';
  }
  if (message.includes('JSON')) {
    return '❌ Corrupted File: The credentials file is corrupted or incomplete. Please generate a new session.';
  }
  if (message.includes('timeout')) {
    return '❌ Connection Timeout: Could not connect to WhatsApp servers. The session may be expired or there may be a network issue. Try again or generate a new session.';
  }
  if (message.includes('QR code')) {
    return '❌ Session Invalid: The credentials require QR code authentication. Please generate a new session using the pairing code method.';
  }
  if (message.includes('Missing required field')) {
    return '❌ Incomplete Credentials: The session file is missing required data. Please generate a new session.';
  }

  return `❌ Validation Failed: ${message}. If the problem persists, please generate a new session.`;
}

module.exports = router;