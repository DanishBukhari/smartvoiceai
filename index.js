require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  handleIncomingCall,
  processSpeech
} = require('./twilio');
const { streamTTS } = require('./tts');

const app = express();

// Serve your static assets (including Introduction.mp3) from /public
app.use(express.static(path.join(__dirname, 'public')));

// Twilio will POST form‑encoded data
app.use(express.urlencoded({ extended: true }));

// Incoming call entrypoint
app.post('/voice', handleIncomingCall);

// Twilio will POST speech results here
app.post('/process-speech', processSpeech);

// Twilio will GET this to stream TTS audio
app.get('/tts-stream', streamTTS);

// Healthcheck
app.get('/test', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
