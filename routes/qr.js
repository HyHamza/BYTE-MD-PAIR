const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const QRCode = require('qrcode');
const pino = require('pino');
const { sendButtons } = require('gifted-btns');

const {
  default: TalkDroveConnect,
  useMultiFileAuthState,
  Browsers,
  delay,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const { GenID, removeFile } = require('../lib');


// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const router = express.Router();
const sessionDir = path.join(__dirname, 'session');
const activeConnections = new Map();


// ──────────────────────────────────────────────────────────────
// Status Broadcasting via SSE
// Real-time updates to connected clients
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
// Where the magic happens ✨
// ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const sessionId = GenID();
  let responseSent = false;
  let sessionCleaned = false;

  async function cleanSession() {
    if (!sessionCleaned) {
      await removeFile(path.join(sessionDir, sessionId));
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
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      whatsapp.ev.on('creds.update', saveCreds);
      whatsapp.ev.on('connection.update', async (status) => {
        const { connection, lastDisconnect, qr } = status;

        // QR Code generated - send HTML page
        if (qr && !responseSent) {
          const qrImage = await QRCode.toDataURL(qr);

          if (!res.headersSent) {
            res.send(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>QR Code</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                  * { margin: 0; padding: 0; box-sizing: border-box; }
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #000000; color: #f1f5f9; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
                  .card { width: 100%; max-width: 450px; background: rgba(20, 20, 30, 0.8); backdrop-filter: blur(10px); border-radius: 12px; padding: 2rem; border: 1px solid rgba(79, 70, 229, 0.2); text-align: center; }
                  h1 { color: #818cf8; margin-bottom: 0.5rem; }
                  p { color: #94a3b8; margin-bottom: 1.5rem; font-size: 0.95rem; }
                  .qr { background: white; border-radius: 12px; padding: 1rem; margin: 1.5rem 0; }
                  .qr img { max-width: 100%; height: auto; }
                  .status { font-size: 0.9rem; color: #94a3b8; margin: 1rem 0; }
                  .dot { display: inline-block; width: 6px; height: 6px; background: #818cf8; border-radius: 50%; margin-right: 6px; animation: pulse 1.5s infinite; }
                  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                  .back { display: block; margin-top: 1rem; color: #818cf8; text-decoration: none; font-size: 0.9rem; }
                  .back:hover { color: #7c3aed; }
                  @media (max-width: 480px) { .card { padding: 1.5rem; } }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1><i class="fas fa-qrcode"></i> Scan QR Code</h1>
                  <p>Point your camera at this QR code</p>
                  <div class="qr">
                    <img src="${qrImage}" alt="QR Code">
                  </div>
                  <div class="status">
                    <span class="dot"></span>
                    <span id="status">Waiting for scan...</span>
                  </div>
                  <a href="./" class="back">← Back to Home</a>
                </div>
                <script>
                  const sessionId = '${sessionId}';
                  new EventSource(\`/qr/status/\${sessionId}\`).onmessage = e => {
                    const data = JSON.parse(e.data);
                    const statusMessages = {
                      connecting: 'Connecting...',
                      downloading_creds: 'Getting credentials...',
                      session_ready: 'Done!'
                    };
                    document.getElementById('status').textContent = statusMessages[data.status] || 'Processing...';
                    if (data.status === 'session_ready') setTimeout(() => window.location.href = './', 2000);
                  };
                </script>
              </body>
              </html>
            `);
            responseSent = true;
          }

          broadcastStatus(sessionId, { status: 'pending' });
        }

        // Connected - download credentials
        if (connection === 'open') {
          broadcastStatus(sessionId, { status: 'connecting' });
          await whatsapp.groupAcceptInvite('GiD4BYjebncLvhr0J2SHAg');
          await delay(10000);

          // Retrieve credentials
          let credsData = null;
          let attempts = 0;
          const maxAttempts = 10;

          broadcastStatus(sessionId, { status: 'downloading_creds' });

          while (attempts < maxAttempts && !credsData) {
            try {
              const credsPath = path.join(sessionDir, sessionId, 'creds.json');

              if (fs.existsSync(credsPath)) {
                const data = fs.readFileSync(credsPath);
                if (data && data.length > 100) {
                  credsData = data;
                  break;
                }
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
            broadcastStatus(sessionId, { status: 'session_ready' });

            // Parse creds and wrap in proper format
            const credsJson = JSON.parse(credsData);
            const wrappedCreds = {
              creds: credsJson,
              keys: {}
            };
            // Compress and encode credentials
            const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(wrappedCreds)));
            const b64 = compressed.toString('base64');

            // Send via interactive buttons
            await sendButtons(whatsapp, whatsapp.user.id, {
              title: '',
              text: b64,
              footer: '> *powered by talkdrove*',
              buttons: [
                {
                  name: 'cta_copy',
                  buttonParamsJson: JSON.stringify({
                    display_text: 'Copy',
                    copy_code: b64,
                  }),
                },
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: 'Visit Session site',
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

            await delay(2000);
            await whatsapp.ws.close();
          } catch (err) {
            console.error('Send error:', err);
            broadcastStatus(sessionId, { status: 'error' });
          } finally {
            await cleanSession();
          }
        }

        // Connection lost - try reconnecting
        else if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          broadcastStatus(sessionId, { status: 'error' });
          await delay(10000);
          initQRSession();
        }
      });
    } catch (err) {
      console.error('Session error:', err);

      if (!responseSent && !res.headersSent) {
        res.status(500).json({ error: 'QR service unavailable' });
        responseSent = true;
      }

      await cleanSession();
    }
  }

  try {
    await initQRSession();
  } catch (err) {
    console.error('Fatal error:', err);
    await cleanSession();

    if (!responseSent && !res.headersSent) {
      res.status(500).json({ error: 'Service error' });
    }
  }
});


module.exports = router;
