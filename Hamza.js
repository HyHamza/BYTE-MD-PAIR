const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

// 
// Session Generator Serverrrrr
// 

const app = express();
const PORT = process.env.PORT || 7000;

// Import routes (because spaghetti code is for beginners)
const qrRoute = require('./routes/qr');
const pairRoute = require('./routes/pair');
const validateRoute = require('./routes/validate');


// ──────────────────────────────────────────────────────────────
// Middleware Setup
// ──────────────────────────────────────────────────────────────

require('events').EventEmitter.defaultMaxListeners = 2000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────

app.use('/qr', qrRoute);
app.use('/code', pairRoute);
app.use('/validate', validateRoute);


// ──────────────────────────────────────────────────────────────
// Page Routes
// ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/validate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'validate.html'));
});

app.get('/decrypt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'decrypt.html'));
});


// ──────────────────────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 200,
    success: true,
    service: 'session-generator',
    timestamp: new Date().toISOString(),
  });
});


// ──────────────────────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nYess, running at http://localhost:${PORT}\n`);
});

module.exports = app;