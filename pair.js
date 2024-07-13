const PastebinAPI = require('pastebin-js'),
pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL')
const {Hamza_make_id} = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router()
const pino = require("pino");
const {
    default: Hamza,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("maher-zubair-bailey");

function removeFile(FilePath){
    if(!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true })
 };
router.get('/', async (req, res) => {
    const id = Hamza_make_id();
    let num = req.query.number;
        async function Byte_Pair() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState('./temp/'+id)
     try {
            let TalkDrove_Pair_code = Hamza({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({level: "fatal"}).child({level: "fatal"})),
                },
                printQRInTerminal: false,
                logger: pino({level: "fatal"}).child({level: "fatal"}),
                browser: ["Chrome (Linux)", "", ""]
             });
             if(!TalkDrove_Pair_code.authState.creds.registered) {
                await delay(1500);
                        num = num.replace(/[^0-9]/g,'');
                            const code = await TalkDrove_Pair_code.requestPairingCode(num)
                 if(!res.headersSent){
                 await res.send({code});
                     }
                 }
            TalkDrove_Pair_code.ev.on('creds.update', saveCreds)
            TalkDrove_Pair_code.ev.on("connection.update", async (s) => {
                const {
                    connection,
                    lastDisconnect
                } = s;
                if (connection == "open") {
                await delay(5000);
                let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                await delay(800);
               let b64data = Buffer.from(data).toString('base64');
               let session = await TalkDrove_Pair_code.sendMessage(TalkDrove_Pair_code.user.id, { text: "Byte;;;" + b64data });

               let Hamza_Text = `
┏━━━━━━━━━━━━━━
┃*BYTE-MD SUCCESSFULLY LINKED*
┃*WITH YOUR WHATSAPP*
┗━━━━━━━━━━━━━━━
▬▬▬▬▬▬▬▬▬▬▬▬▬▬
o: || Creator = Hamza
▬▬▬▬▬▬▬▬▬▬▬▬▬▬
o: || Owner = https://wa.me/923072380380
▬▬▬▬▬▬▬▬▬▬▬▬▬▬
©*TalkDrove*`
 await TalkDrove_Pair_code.sendMessage(TalkDrove_Pair_code.user.id,{text:Hamza_Text},{quoted:session})
 

        await delay(100);
        await TalkDrove_Pair_code.ws.close();
        return await removeFile('./temp/'+id);
            } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    Byte_Pair();
                }
            });
        } catch (err) {
            console.log("service restated");
            await removeFile('./temp/'+id);
         if(!res.headersSent){
            await res.send({code:"Service Unavailable"});
         }
        }
    }
    return await Byte_Pair()
});
module.exports = router
