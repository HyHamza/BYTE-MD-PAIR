const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const { sendButtons } = require('gifted-btns');

const {
  default: whatsAppConnect,
  useMultiFileAuthState,
  Browsers,
  delay,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const { GenID, removeFile, generateRandomCode } = require('../lib');

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const router = express.Router();
const sessionDir = path.join(__dirname, 'session');
const activeConnections = new Map();

// Encryption configuration (store in environment variables)
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || crypto.randomBytes(32);
const ENCRYPTION_IV_LENGTH = 16;

// ──────────────────────────────────────────────────────────────
// Encryption Utilities
// ──────────────────────────────────────────────────────────────

function encryptSessionId(sessionId) {
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(sessionId, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Combine IV and encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

function decryptSessionId(encryptedData) {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ──────────────────────────────────────────────────────────────
// Validation Utilities
// ──────────────────────────────────────────────────────────────

function validateCredsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const stats = fs.statSync(filePath);
    
    // Check minimum file size (valid creds.json is typically > 500 bytes)
    if (stats.size < 500) {
      return false;
    }

    // Validate JSON structure
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Check for required fields
    if (!data.me || !data.me.id || !data.noiseKey || !data.signedIdentityKey) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('Validation error:', err);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Status Broadcasting via SSE
// ──────────────────────────────────────────────────────────────

router.get('/status/:id', (req, res) => {
  const { id } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  if (!activeConnections.has(id)) {
    activeConnections.set(id, []);
  }

  const connections = activeConnections.get(id);
  connections.push(res);
  res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);

  req.on('close', () => {
    const idx = connections.indexOf(res);
    if (idx > -1) {
      connections.splice(idx, 1);
    }
    if (connections.length === 0) {
      activeConnections.delete(id);
    }
  });
});

function broadcastStatus(id, status) {
  if (activeConnections.has(id)) {
    const connections = activeConnections.get(id);
    connections.forEach((res) => {
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Pair Code Generation Route
// ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const sessionId = GenID();
  let phoneNumber = req.query.number;
  let format = req.query.format || 'creds';
  let responseSent = false;
  let sessionCleaned = false;

  // Validate phone number
  if (!phoneNumber || phoneNumber.replace(/[^0-9]/g, '').length < 10) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  async function cleanSession() {
    if (!sessionCleaned) {
      try {
        await removeFile(path.join(sessionDir, sessionId));
      } catch (err) {
        console.error('Cleanup error:', err);
      }
      sessionCleaned = true;
    }
  }

  async function initPairSession() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(
      path.join(sessionDir, sessionId)
    );

    try {
      const whatsapp = whatsAppConnect({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'fatal' }).child({ level: 'fatal' })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        browser: Browsers.macOS('Safari'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: (jid) => !!jid?.endsWith('@g.us'),
        getMessage: async () => undefined,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      // Generate pairing code
      if (!whatsapp.authState.creds.registered) {
        await delay(1500);

        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        // FIX: Don't pass generateRandomCode() - it's not needed
        const pairingCode = await whatsapp.requestPairingCode(phoneNumber);

        if (!responseSent && !res.headersSent) {
          broadcastStatus(sessionId, { status: 'code_generated' });
          
          // FIX: Encrypt session ID before sending
          const encryptedSessionId = encryptSessionId(sessionId);
          
          res.json({ 
            code: pairingCode, 
            sessionId: encryptedSessionId 
          });
          responseSent = true;
        }
      }

      whatsapp.ev.on('creds.update', saveCreds);
      whatsapp.ev.on('connection.update', async (status) => {
        const { connection, lastDisconnect } = status;

        if (connection === 'open') {
          broadcastStatus(sessionId, { status: 'connecting' });
          
          await delay(10000);

          let credsData = null;
          let attempts = 0;
          const maxAttempts = 3;

          broadcastStatus(sessionId, { status: 'waiting_for_creds' });

          while (attempts < maxAttempts && !credsData) {
            try {
              const credsPath = path.join(sessionDir, sessionId, 'creds.json');

              if (validateCredsFile(credsPath)) {
                credsData = fs.readFileSync(credsPath);
                broadcastStatus(sessionId, { status: 'creds_validated' });
                break;
              }

              await delay(3000);
              attempts++;
            } catch (err) {
              console.error('Read error:', err);
              await delay(2000);
              attempts++;
            }
          }

          if (!credsData) {
            broadcastStatus(sessionId, { 
              status: 'error',
              message: 'Failed to retrieve session credentials'
            });
            await cleanSession();
            return;
          }

          try {
            await delay(2000);

            let sessionSent = false;
            let sendAttempts = 0;
            const maxSendAttempts = 5;

            broadcastStatus(sessionId, { status: 'sending_creds' });

            while (sendAttempts < maxSendAttempts && !sessionSent) {
              try {
                if (format === 'base64') {
                  // Encode credentials to base64
                  const b64 = credsData.toString('base64');

                  // FIX: Send to authenticated user (whatsapp.user.id)
                  await sendButtons(whatsapp, whatsapp.user.id, {
                    title: '✅ Session Ready',
                    text: `\`\`\`${b64}\`\`\``,
                    footer: '> *Powered By TalkDrove*\n> ⚠️ Keep this session private and secure!',
                    buttons: [
                      {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                          display_text: 'Copy Session',
                          copy_code: b64,
                        }),
                      },
                      {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                          display_text: 'Visit Session Site',
                          url: 'https://session.talkdrove.com',
                        }),
                      },
                      {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                          display_text: 'Source Code',
                          url: 'https://github.com/HyHamza/Session-Generator',
                        }),
                      },
                      {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                          display_text: 'WaChannel',
                          url: 'https://whatsapp.com/channel/0029VaNRcHSJP2199iMQ4W0l',
                        }),
                      },
                    ],
                  });
                } else {

                  await whatsapp.sendMessage(whatsapp.user.id, {
                    document: credsData,
                    mimetype: 'application/json',
                    fileName: 'creds.json',
                    caption: '✅ Your WhatsApp session credentials\n\n⚠️ Keep this file secure and private!',
                  });
                }

                sessionSent = true;
                broadcastStatus(sessionId, { status: 'session_delivered' });
              } catch (err) {
                console.error('Send error:', err);
                sendAttempts++;

                if (sendAttempts < maxSendAttempts) {
                  await delay(3000);
                }
              }
            }

            if (!sessionSent) {
              broadcastStatus(sessionId, { 
                status: 'error',
                message: 'Failed to send session file'
              });
              await cleanSession();
              return;
            }

            //////////////////////// Wait a bit before closing connection
            await delay(3000);
            await whatsapp.ws.close();
          } catch (err) {
            console.error('Processing error:', err);
            broadcastStatus(sessionId, { 
              status: 'error',
              message: 'Session processing failed'
            });
          } finally {
            await cleanSession();
          }
        }

        // Handle connection close
        else if (connection === 'close') {
          // FIX: Better error handling
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== 401 && statusCode !== 403;
          
          if (shouldReconnect && !sessionCleaned) {
            console.log('Connection closed unexpectedly, reconnecting...');
            broadcastStatus(sessionId, { status: 'reconnecting' });
            await delay(5000);
            initPairSession();
          } else {
            if (statusCode === 401 || statusCode === 403) {
              console.log('Authentication failed');
              broadcastStatus(sessionId, { 
                status: 'error',
                message: 'Authentication failed - invalid pairing code'
              });
            }
            await cleanSession();
          }
        }
      });
    } catch (err) {
      console.error('Session error:', err);

      if (!responseSent && !res.headersSent) {
        res.status(500).json({ 
          error: 'Pairing service unavailable',
          message: err.message 
        });
        responseSent = true;
      }

      broadcastStatus(sessionId, { 
        status: 'error',
        message: err.message 
      });
      await cleanSession();
    }
  }

  try {
    await initPairSession();
  } catch (err) {
    console.error('Fatal error:', err);
    await cleanSession();

    if (!responseSent && !res.headersSent) {
      res.status(500).json({ 
        error: 'Service error',
        message: err.message 
      });
    }
  }
});

module.exports = router;