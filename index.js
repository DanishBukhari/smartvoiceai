require('dotenv').config();
const express = require('express');
const { handleIncomingCall, makeOutboundCall, processSpeech } = require('./twilio');
const path = require('path');

const app = express();

// Serve static files first
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) {
      res.set('Content-Type', 'audio/mpeg');
    } else if (filePath.endsWith('.txt')) {
      res.set('Content-Type', 'text/plain');
    }
  }
}));
app.get('/public/Introduction.mp3', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'Introduction.mp3');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving file:', err);
      res.status(404).send('File not found');
    }
  });
});

// Then other middleware
app.use(express.urlencoded({ extended: true }));

// Routes
app.post('/voice', handleIncomingCall);
// app.post('/voice/callback', handleRecordingStatus);
app.post('process-speech', processSpeech)
app.use(express.static('public'));
// app.post('/voice/recording-status', handleRecordingStatus);
app.get('/test', (req, res) => {
  res.send('Test successful');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});