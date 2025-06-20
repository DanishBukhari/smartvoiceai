require('dotenv').config();
const express = require('express');
const { handleIncomingCall, handleRecordingStatus, makeOutboundCall } = require('./twilio');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3') || filePath.endsWith('.txt')) {
      res.set('Content-Type', filePath.endsWith('.mp3') ? 'audio/mpeg' : 'text/plain');
    }
  }
}));

app.post('/voice', handleIncomingCall);
app.post('/voice/callback', handleRecordingStatus);
app.post('/voice/recording-status', handleRecordingStatus);
app.get('/test', (req, res) => {
  res.send('Test successful');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});