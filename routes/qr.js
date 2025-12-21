const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const { sendButtons } = require('gifted-btns');

const {
  default: TalkDroveConnect,
  useMultiFileAuthState,
  Browsers,
  delay,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const { GenID, removeFile } = require('../lib');

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const router = express.Router();
const sessionDir = path.join(__dirname, 'session');
const activeConnections = new Map();

// ──────────────────────────────────────────────────────────────
// Validation Utilities
// ──────────────────────────────────────────────────────────────

function validateCredsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const stats = fs.statSync(filePath);
    
    if (stats.size < 1000) {
      return false;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
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
// QR Code Generation Route
// ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const sessionId = GenID();
  let responseSent = false;
  let sessionCleaned = false;

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

  async function initQRSession() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(
      path.join(sessionDir, sessionId)
    );

    try {
      const whatsapp = TalkDroveConnect({
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
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: (jid) => !!jid?.endsWith('@g.us'),
        getMessage: async () => undefined,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      whatsapp.ev.on('creds.update', saveCreds);
      whatsapp.ev.on('connection.update', async (status) => {
        const { connection, lastDisconnect, qr } = status;

        // QR Code generated - send HTML page
        if (qr && !responseSent) {
          try {
            const qrImage = await QRCode.toDataURL(qr);

            if (!res.headersSent) {
              res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Scan QR Code - TalkDrove</title>
                  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                  <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                      color: #f1f5f9; 
                      min-height: 100vh; 
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      padding: 20px; 
                    }
                    .card { 
                      width: 100%; 
                      max-width: 450px; 
                      background: rgba(255, 255, 255, 0.95); 
                      backdrop-filter: blur(10px); 
                      border-radius: 16px; 
                      padding: 2.5rem; 
                      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                      text-align: center; 
                    }
                    h1 { 
                      color: #667eea; 
                      margin-bottom: 0.5rem; 
                      font-size: 1.75rem;
                    }
                    .subtitle { 
                      color: #64748b; 
                      margin-bottom: 1.5rem; 
                      font-size: 0.95rem; 
                    }
                    .qr-container { 
                      background: white; 
                      border-radius: 12px; 
                      padding: 1.5rem; 
                      margin: 1.5rem 0; 
                      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    }
                    .qr-container img { 
                      max-width: 100%; 
                      height: auto; 
                      display: block;
                    }
                    .status { 
                      font-size: 0.95rem; 
                      color: #64748b; 
                      margin: 1.5rem 0; 
                      padding: 1rem;
                      background: #f1f5f9;
                      border-radius: 8px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      gap: 0.5rem;
                    }
                    .spinner { 
                      display: inline-block; 
                      width: 16px; 
                      height: 16px; 
                      border: 2px solid #e2e8f0;
                      border-top: 2px solid #667eea;
                      border-radius: 50%; 
                      animation: spin 1s linear infinite; 
                    }
                    @keyframes spin { 
                      0% { transform: rotate(0deg); } 
                      100% { transform: rotate(360deg); } 
                    }
                    .instructions {
                      text-align: left;
                      margin: 1.5rem 0;
                      padding: 1rem;
                      background: #f8fafc;
                      border-radius: 8px;
                      border-left: 3px solid #667eea;
                    }
                    .instructions h3 {
                      color: #334155;
                      font-size: 0.9rem;
                      margin-bottom: 0.5rem;
                      font-weight: 600;
                    }
                    .instructions ol {
                      color: #64748b;
                      font-size: 0.85rem;
                      padding-left: 1.25rem;
                      line-height: 1.6;
                    }
                    .instructions li {
                      margin-bottom: 0.25rem;
                    }
                    .back { 
                      display: inline-block;
                      margin-top: 1rem; 
                      color: #667eea; 
                      text-decoration: none; 
                      font-size: 0.9rem;
                      padding: 0.5rem 1rem;
                      border-radius: 6px;
                      transition: all 0.2s;
                    }
                    .back:hover { 
                      background: #f1f5f9;
                    }
                    .success { 
                      background: #dcfce7; 
                      color: #166534;
                      border-left-color: #22c55e;
                    }
                    .error { 
                      background: #fee2e2; 
                      color: #991b1b;
                      border-left-color: #ef4444;
                    }
                    @media (max-width: 480px) { 
                      .card { padding: 1.5rem; }
                      h1 { font-size: 1.5rem; }
                    }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <h1><i class="fas fa-qrcode"></i> Scan QR Code</h1>
                    <p class="subtitle">Open WhatsApp on your phone and scan this code</p>
                    
                    <div class="qr-container">
                      <img src="${qrImage}" alt="QR Code">
                    </div>
                    
                    <div class="instructions">
                      <h3><i class="fas fa-info-circle"></i> How to scan:</h3>
                      <ol>
                        <li>Open WhatsApp on your phone</li>
                        <li>Tap <strong>Menu</strong> or <strong>Settings</strong></li>
                        <li>Tap <strong>Linked Devices</strong></li>
                        <li>Tap <strong>Link a Device</strong></li>
                        <li>Point your phone at this screen to scan the code</li>
                      </ol>
                    </div>
                    
                    <div class="status" id="status-container">
                      <span class="spinner"></span>
                      <span id="status">Waiting for scan...</span>
                    </div>
                    
                    <a href="./" class="back"><i class="fas fa-arrow-left"></i> Back to Home</a>
                  </div>
                  
                  <script>
                    const sessionId = '${sessionId}';
                    const statusEl = document.getElementById('status');
                    const statusContainer = document.getElementById('status-container');
                    
                    const eventSource = new EventSource(\`/qr/status/\${sessionId}\`);
                    
                    eventSource.onmessage = (e) => {
                      try {
                        const data = JSON.parse(e.data);
                        
                        const statusMessages = {
                          pending: 'Waiting for scan...',
                          connecting: 'Connecting to WhatsApp...',
                          syncing_session: 'Syncing your session...',
                          downloading_creds: 'Downloading credentials...',
                          sending_session: 'Sending session to your WhatsApp...',
                          session_ready: '✓ Session created successfully!',
                          error: '✗ Something went wrong. Please try again.'
                        };
                        
                        statusEl.textContent = statusMessages[data.status] || 'Processing...';
                        
                        if (data.status === 'session_ready') {
                          statusContainer.classList.add('success');
                          statusContainer.querySelector('.spinner')?.remove();
                          setTimeout(() => window.location.href = './', 3000);
                        } else if (data.status === 'error') {
                          statusContainer.classList.add('error');
                          statusContainer.querySelector('.spinner')?.remove();
                        }
                      } catch (err) {
                        console.error('SSE parse error:', err);
                      }
                    };
                    
                    eventSource.onerror = () => {
                      statusEl.textContent = 'Connection lost. Please refresh.';
                      statusContainer.classList.add('error');
                      statusContainer.querySelector('.spinner')?.remove();
                    };
                  </script>
                </body>
                </html>
              `);
              responseSent = true;
            }

            broadcastStatus(sessionId, { status: 'pending' });
          } catch (err) {
            console.error('QR generation error:', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Failed to generate QR code' });
            }
          }
        }

        // Connected - download credentials
        if (connection === 'open') {
          broadcastStatus(sessionId, { status: 'connecting' });
          
      
          await delay(5000);

          let credsData = null;
          let attempts = 0;
          const maxAttempts = 20;

          broadcastStatus(sessionId, { status: 'syncing_session' });

          while (attempts < maxAttempts && !credsData) {
            try {
              const credsPath = path.join(sessionDir, sessionId, 'creds.json');

              if (validateCredsFile(credsPath)) {
                credsData = fs.readFileSync(credsPath);
                break;
              }

              await delay(2000);
              attempts++;
            } catch (err) {
              console.error('Read error:', err);
              await delay(2000);
              attempts++;
            }
          }

          if (!credsData) {
            await cleanSession();
            broadcastStatus(sessionId, { status: 'error' });
            return;
          }

          try {
            broadcastStatus(sessionId, { status: 'sending_session' });

            const b64 = credsData.toString('base64');

            let sessionSent = false;
            let sendAttempts = 0;
            const maxSendAttempts = 5;

            while (sendAttempts < maxSendAttempts && !sessionSent) {
              try {
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
                        url: 'https://whatsapp.com/channel/0029Vb3hlgX5kg7G0nFggl0Y',
                      }),
                    },
                  ],
                });

                sessionSent = true;
                broadcastStatus(sessionId, { status: 'session_ready' });
              } catch (err) {
                console.error('Send error:', err);
                sendAttempts++;

                if (sendAttempts < maxSendAttempts) {
                  await delay(3000);
                }
              }
            }

            if (!sessionSent) {
              broadcastStatus(sessionId, { status: 'error' });
              await cleanSession();
              return;
            }

            await delay(3000);
            await whatsapp.ws.close();
          } catch (err) {
            console.error('Send error:', err);
            broadcastStatus(sessionId, { status: 'error' });
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
            initQRSession();
          } else {
            console.log('Session closed:', statusCode);
            broadcastStatus(sessionId, { status: 'error' });
            await cleanSession();
          }
        }
      });
    } catch (err) {
      console.error('Session error:', err);

      if (!responseSent && !res.headersSent) {
        res.status(500).json({ 
          error: 'QR service unavailable',
          message: err.message 
        });
        responseSent = true;
      }

      broadcastStatus(sessionId, { status: 'error' });
      await cleanSession();
    }
  }

  try {
    await initQRSession();
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