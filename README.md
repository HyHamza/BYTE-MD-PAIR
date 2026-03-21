# Session Generator

A well maintained session generator. Supports both **Pair Code** and **QR Code** methods. Deploy it, forget it, let it do the work while you sleep.

---

## Quick Start

### Prerequisites
- **Node.js** v14+ (seriously, if you're still on v12, we can't be friends)
- **npm** or **yarn**
- A cup of coffee ☕

### Installation

```bash
# Clone this bad boy
git clone https://github.com/HyHamza/Session-Generator.git
cd Session-Generator

# Install dependencies (yes, you need them)
npm install

# Or if you're fancy
yarn install
```

### Running Locally

```bash
# Start the server
npm start

# Server running at http://localhost:7000
# Open in browser and generate sessions like magic ✨
```

**That's it.** Seriously. No 47-step setup guide. Just npm start and you're done.

---

## 📋 Features

- **Pair Code Generation** - Traditional WhatsApp pairing
- **QR Code Scanning** - The cool kids method
- **Session Validation** - Verify your sessions actually work (you'd be surprised how many don't)
- **Base64 Decryption** - Decrypt those gnarly Base64 strings
- **Real-time Status Updates** - Watch the magic happen with SSE
- **Dual Format Delivery** - Get creds.json file OR Base64 compressed ID
- **Interactive Buttons** - Copy & share like a boss 🔥

---

## 🛠️ Dependencies

Here's what's under the hood (you're welcome):

| Library | Purpose | Why We Use It |
|---------|---------|---------------|
| **@whiskeysockets/baileys** | WhatsApp API magic | The OG. Does the heavy lifting. |
| **express** | Web server framework | Fast, minimal, gets the job done |
| **zlib** | Compression/decompression | Smaller files = faster transfers |
| **pino** | Logging | Clean logs without the noise |
| **multer** | File uploads | Handle those creds.json uploads |
| **qrcode** | QR generation | Makes pretty codes |
| **gifted-btns** | Interactive buttons | Makes messages clickable & cool |

---

## 📲 How to Use

### Method 1: Direct Browser Access

1. **Open:** `http://localhost:7000`
2. **Choose:** Pair Code or QR Code
3. **Select:** creds.json file or Base64 format
4. **Wait:** The magic happens ✨
5. **Receive:** Your session via WhatsApp

### Method 2: Using in Your Bot

Got a bot? Here's how to integrate the session:

```javascript
// 1. Load the session in your bot
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

async function loadSession(sessionID) {
    try {
        if (!sessionID) throw new Error('❌ No session ID provided');

        // If it's Base64 (compressed)
        const compressedData = Buffer.from(sessionID, 'base64');
        const decompressed = zlib.gunzipSync(compressedData);
        
        // Write to creds.json
        const sessionDir = path.join(__dirname, 'session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(sessionDir, 'creds.json'),
            decompressed,
            'utf8'
        );
        
        console.log('✅ Session loaded successfully');
        return true;
    } catch (error) {
        console.error('❌ Session Error:', error.message);
        throw error;
    }
}

module.exports = { loadSession };
```

```javascript
// 2. In your bot's main file
const { loadSession } = require('./lib');
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

async function startBot() {
    try {
        // Load session from Base64
        await loadSession(process.env.SESSION_ID);

        // Initialize connection
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const { version } = await fetchLatestBaileysVersion();

        // Your bot logic here...
        console.log('🤖 Bot started!');
    } catch (error) {
        console.error('Failed to start bot:', error);
    }
}

startBot();
```

---

## 🔌 API Endpoints

### Web Pages
| Endpoint | Purpose |
|----------|---------|
| `GET /` | Home page with options |
| `GET /pair` | Pair code generation page |
| `GET /qr` | QR code generation page |
| `GET /validate` | Validate existing sessions |
| `GET /decrypt` | Decrypt Base64 session IDs |

### API Routes
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/code` | `GET` | Generate pair code & get session |
| `/code/status/:id` | `GET` | SSE stream for pair code status |
| `/qr` | `GET` | Generate QR code & get session |
| `/qr/status/:id` | `GET` | SSE stream for QR code status |
| `/validate` | `POST` | Validate creds.json or Base64 session |
| `/health` | `GET` | Health check endpoint |

### Query Parameters

**Pair Code Generation:**
```
GET /code?number=2347012345678&format=base64
```
- `number` - WhatsApp number (0712189037 )
- `format` - `creds` (file) or `base64` (compressed string)

---

## 🎯 Project Structure

```
├── index.js                 # Main server file
├── lib/
│   └── index.js            # Utility functions (GenID, removeFile, etc)
├── routes/
│   ├── qr.js              # QR code generation logic
│   ├── pair.js            # Pair code generation logic
│   └── validate.js        # Session validation logic
├── public/
│   ├── index.html         # Home page
│   ├── pair.html          # Pair code UI
│   ├── qr.html            # QR code UI (generated dynamically)
│   ├── validate.html      # Session validation UI
│   └── decrypt.html       # Base64 decryption UI
└── package.json           # Dependencies
```

---

## 🚢 Deployment

### Heroku
```bash
git push heroku main
```

### Render
1. Connect your GitHub repo
2. Set environment variables
3. Deploy

### Self-Hosting
```bash
npm start
# Or use PM2
pm2 start index.js
```

---

## ⚙️ Environment Variables

```env
PORT=7000              # Server port (default: 7000)
NODE_ENV=production    # production or development
```

That's literally it. We don't do complicated.

---

## 💡 Pro Tips

- **Sessions expire:** Don't hoard them like Pokemon cards. Generate fresh ones regularly.
- **Base64 format is compact:** If bandwidth matters, use Base64. It's compressed with zlib.
- **Validate before using:** Use the validation feature to check if a session is alive (saves you from headaches).
- **Check logs:** If something breaks, look at the logs. They're not there for decoration.

---

## 🐛 Common Issues

### "Session expired"
The session is dead. Generate a new one. That's literally the only fix.

### "Connection timeout"
Your WhatsApp got locked. Wait a few minutes and try again.

### "Invalid Base64"
You probably copy-pasted it wrong. Try again, carefully this time.

---

## 📝 License

Do whatever you want with it. Fork it, modify it, break it, fix it. Just don't sue me if it breaks your bot at 3 AM on a Sunday.

---

## 👨‍💻 Author

**Hamza** - Yess, This is me, thanks to Gifted for buttons.

- GitHub: [@HyHamza](https://github.com/HyHamza)
- YouTube: [@talkdrove](https://youtube.com/@talkdrove)
- WhatsApp Channel: [Join Here](https://whatsapp.com/channel/0029VaNRcHSJP2199iMQ4W0l)

---

## Support

Jus follow me on my profiles/channels/accounts

---

**Happy coding.** May your sessions never expire.
