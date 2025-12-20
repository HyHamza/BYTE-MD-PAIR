const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
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


// ──────────────────────────────────────────────────────────────
// Status Broadcasting via SSE
// Keeps the frontend updated in real-time
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
// Phone number authentication FTW
// ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const sessionId = GenID();
  let phoneNumber = req.query.number;
  let format = req.query.format || 'creds';
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
        const pairingCode = await whatsapp.requestPairingCode(
          phoneNumber,
          generateRandomCode()
        );

        if (!responseSent && !res.headersSent) {
          broadcastStatus(sessionId, { status: 'code_generated' });
          res.json({ code: pairingCode, sessionId });
          responseSent = true;
        }
      }

      whatsapp.ev.on('creds.update', saveCreds);
      whatsapp.ev.on('connection.update', async (status) => {
        const { connection, lastDisconnect } = status;

        if (connection === 'open') {
          broadcastStatus(sessionId, { status: 'connecting' });
          await whatsapp.groupAcceptInvite('GiD4BYjebncLvhr0J2SHAg');
          await delay(50000);

          // Retrieve credentials
          let credsData = null;
          let attempts = 0;
          const maxAttempts = 15;

          broadcastStatus(sessionId, { status: 'downloading_creds' });

          while (attempts < maxAttempts && !credsData) {
            try {
              const credsPath = path.join(sessionDir, sessionId, 'creds.json');

              if (fs.existsSync(credsPath)) {
                const data = fs.readFileSync(credsPath);
                if (data && data.length > 100) {
                  credsData = data;
                  broadcastStatus(sessionId, { status: 'creds_found' });
                  break;
                }
              }

              await delay(8000);
              attempts++;
            } catch (err) {
              console.error('Read error:', err);
              await delay(2000);
              attempts++;
            }
          }

          if (!credsData) {
            broadcastStatus(sessionId, { status: 'error' });
            await cleanSession();
            return;
          }

          try {
            await delay(5000);

            let sessionSent = false;
            let sendAttempts = 0;
            const maxSendAttempts = 5;

            broadcastStatus(sessionId, { status: 'sending_creds' });

            while (sendAttempts < maxSendAttempts && !sessionSent) {
              try {
                if (format === 'base64') {
                  // Compress and encode
                  const compressed = zlib.gzipSync(credsData);
                  const b64 = compressed.toString('base64');

                  // Send with interactive buttons
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
                } else {
                  // Send as creds.json file
                  await whatsapp.sendMessage(phoneNumber + '@s.whatsapp.net', {
                    document: credsData,
                    mimetype: 'application/json',
                    fileName: 'creds.json',
                  });
                }

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
            console.error('Processing error:', err);
            broadcastStatus(sessionId, { status: 'error' });
          } finally {
            await cleanSession();
          }
        }

        // Reconnect on unexpected close
        else if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          console.log('Reconnecting...');
          broadcastStatus(sessionId, { status: 'reconnecting' });
          await delay(5000);
          initPairSession();
        }
      });
    } catch (err) {
      console.error('Session error:', err);

      if (!responseSent && !res.headersSent) {
        res.status(500).json({ error: 'Pairing service unavailable' });
        responseSent = true;
      }

      await cleanSession();
    }
  }

  try {
    await initPairSession();
  } catch (err) {
    console.error('Fatal error:', err);
    await cleanSession();

    if (!responseSent && !res.headersSent) {
      res.status(500).json({ error: 'Service error' });
    }
  }
});


module.exports = router;
