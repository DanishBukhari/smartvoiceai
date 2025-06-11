require('dotenv').config();
const express = require('express');
const { handleIncomingCall, handleRecordingStatus } = require('./twilio');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // Serve static files (e.g., audio)

app.post('/voice', handleIncomingCall);
app.post('/voice/callback', handleRecordingStatus);
app.post('/voice/recording-status', handleRecordingStatus);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});