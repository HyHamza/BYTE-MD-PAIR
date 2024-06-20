const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const {
    default: Byte,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("maher-zubair-baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
};

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function Byte_Pair() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        
        try {
            let Hamza = Byte({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ["Chrome (Linux)", "", ""]
            });

            if (!Hamza.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Hamza.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            } else {
                // If already registered, send a success response
                if (!res.headersSent) {
                    res.send({ message: 'Already linked' });
                }
                return; // Exit early since it's already linked
            }

            Hamza.ev.on('creds.update', saveCreds);

            Hamza.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    await delay(5000);
                    let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                    await delay(800);
                    let b64data = Buffer.from(data).toString('base64');
                    let session = await Hamza.sendMessage(Hamza.user.id, { text: 'Byte;;;' + b64data });

                    let Byte_MD_TEXT = `
*_You have completed the First step!_* \n *Repo Link:* https://github.com/HyHamza/BYTE-MD/ \n *WhatsApp Channel:* https://whatsapp.com/channel/0029VaNRcHSJP2199iMQ4W0l \n *Owner Number:* wa.me/923072380380
*Thanks for choosing BYTE-MD created by _Hamza_ (TalkDrove)*\n \t\t*Have a Nice Day*`;
                    await Hamza.sendMessage(Hamza.user.id, { text: Byte_MD_TEXT }, { quoted: session });

                    await delay(100);
                    await Hamza.ws.close();
                    await removeFile('./temp/' + id);
                    
                    // Ensure that a response is sent to the client
                    if (!res.headersSent) {
                        res.send({ message: 'Session data sent and connection closed' });
                    }
                    return;
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    Byte_Pair();
                }
            });
        } catch (err) {
            console.log("service restarted");
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await Byte_Pair();
});

module.exports = router;
