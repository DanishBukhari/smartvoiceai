require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleIncomingCall, handleRecording } = require('./twilio');

const app = express();
app.enable('trust proxy');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/voice', handleIncomingCall);
app.post('/recording', handleRecording);   // receives RecordingUrl from Twilio

app.get('/test', (_, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
