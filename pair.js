const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');
const { ByteID } = require('./id');
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
    const id = ByteID();
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

            // Waiting longer for pairing to complete
            if (!Hamza.authState.creds.registered) {
                await delay(3000); // Increased delay time
                num = num.replace(/[^0-9]/g, '');
                const code = await Hamza.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            Hamza.ev.on('creds.update', saveCreds);
            Hamza.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection == "open") {
                    console.log("Connected, sending creds...");
                    await delay(5000);
                    let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                    await delay(800); // Added delay before sending creds
                    let b64data = Buffer.from(data).toString('base64');
                    let session = await Hamza.sendMessage(Hamza.user.id, { text: 'Byte;;;' + b64data });

                    // Sending successful pairing message
                    let Byte_MD_TEXT = `
┏━━━━━━━━━━━━━━
┃ *BYTE-MD SUCCESSFULLY LINKED*
┃ *WITH YOUR WHATSAPP*
┗━━━━━━━━━━━━━━━
o: Creator = Hamza
━━━━━━━━━━━━━━━━━━
© *TalkDrove* `;
                    await Hamza.sendMessage(Hamza.user.id, { text: Byte_MD_TEXT }, { quoted: session });

                    // Clean up and close connection
                    await delay(100);
                    await Hamza.ws.close();
                    return await removeFile('./temp/' + id);
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    console.log("Connection lost, retrying...");
                    await delay(10000); // Retry after 10 seconds
                    Byte_Pair();
                }
            });
        } catch (err) {
            console.error("Error occurred:", err.message); // Log the actual error message
            await removeFile('./temp/' + id); // Cleanup temp files
            if (!res.headersSent) {
                await res.status(503).send({ code: "Service Unavailable" });
            }
        }
    }
    
    // Start pairing
    await Byte_Pair();
});

module.exports = router;
