require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleVoice, handleSpeech } = require('./twilio');
const { streamTTS } = require('./tts');

const app = express();
// Trust Heroku proxy so req.protocol is accurate
app.enable('trust proxy');

// Serve static (Introduction.mp3 in /public)
app.use(express.static(path.join(__dirname, 'public')));

// Parse Twilio POST
app.use(express.urlencoded({ extended: true }));

// Twilio calls here on inbound
app.post('/voice', handleVoice);

// Twilio Gather posts here with SpeechResult
app.post('/speech', handleSpeech);

// Twilio fetches TTS here
app.get('/tts-stream', streamTTS);

// Healthcheck
app.get('/test', (_, res) => res.send('OK'));

app.listen(process.env.PORT||3000, () => 
  console.log(`Listening on ${process.env.PORT||3000}`)
);
