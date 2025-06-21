require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  handleIncomingCall,
  processSpeech
} = require('./twilio');
const { streamTTS } = require('./tts');

const app = express();

// Trust the Heroku proxy so req.protocol is correct
app.enable('trust proxy');

// Serve static assets (Introduction.mp3 lives in /public)
app.use(express.static(path.join(__dirname, 'public')));

// Parse Twilio POSTs
app.use(express.urlencoded({ extended: true }));

// Incoming call → /voice
app.post('/voice', handleIncomingCall);

// Speech result → /process-speech
app.post('/process-speech', processSpeech);

// Twilio fetches TTS stream here
app.get('/tts-stream', streamTTS);

// Health check
app.get('/test', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
