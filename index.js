require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleVoice, handleSpeech } = require('./twilio');

const app = express();
app.enable('trust proxy');

// Serve your intro MP3
app.use(express.static(path.join(__dirname, 'public')));

// Parse Twilio’s POSTs
app.use(express.urlencoded({ extended: true }));

// Incoming call → welcome & gather
app.post('/voice', handleVoice);

// Twilio gather result → NLP + inline TTS
app.post('/speech', handleSpeech);

// Healthcheck
app.get('/test', (_, res) => res.send('OK'));

// Add this for root path
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

app.listen(process.env.PORT || 3000, () =>
  console.log(`Listening on ${process.env.PORT || 3000}`)
);
