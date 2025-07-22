// server.js
require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `https://${process.env.HEROKU_APP}.herokuapp.com/oauth2callback`
);

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// — Twilio → start streaming voice frames to /media
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const conn = twiml.connect();
  conn.stream({ url: `wss://${req.headers.host}/media`, name: 'voiceStream' });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

wss.on('connection', (ws) => {
  let streamSid;
  let sttReady = false;
  let ttsInFlight = false;
  let greetingSent = false;

  // Reset state
  Object.assign(stateMachine, {
    currentState: 'start',
    questionIndex: 0,
    conversationHistory: [],
    clientData: {},
    issueType: null,
    nextSlot: null,
    bookingRetryCount: 0
  });

  // Setup STT listener
  const dgStt = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-AU',
    smart_format: true,
    interim_results: true,
    utterances: true,
    encoding: 'mulaw',
    sample_rate: 8000
  });
  dgStt.on(LiveTranscriptionEvents.Open, () => sttReady = true);
  dgStt.on(LiveTranscriptionEvents.Transcript, async (data) => {
    if (!data.is_final) return;
    const text = data.channel.alternatives[0].transcript;
    if (!text || ttsInFlight) return;
    const reply = await handleInput(text);
    ttsInFlight = true;
    speak(ws, streamSid, reply);
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.event === 'start') {
      streamSid = msg.streamSid;
      if (!greetingSent) {
        greetingSent = true;
        speak(ws, streamSid, 'Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?');
      }
    }
    if (msg.event === 'media' && sttReady) {
      const audio = Buffer.from(msg.media.payload, 'base64');
      dgStt.send(audio);
    }
    if (msg.event === 'stop') {
      dgStt.finish();
    }
  });

  ws.on('close', () => dgStt.finish());
});

function speak(ws, streamSid, text) {
  const dgTts = deepgram.speak.live({
    model: 'aura-2-andromeda-en',
    encoding: 'mulaw',
    sample_rate: 8000
  });
  dgTts.on(LiveTTSEvents.Open, () => {
    dgTts.sendText(text);
    dgTts.flush();
  });
  dgTts.on(LiveTTSEvents.Audio, (chunk) => {
    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: Buffer.from(chunk).toString('base64') }
    }));
  });
  dgTts.on(LiveTTSEvents.Flushed, () => {
    ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'endOfResponse' } }));
    ttsInFlight = false;
    // no dgTts.close()
  });
  dgTts.on(LiveTTSEvents.Error, () => {
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
    ttsInFlight = false;
  });
}

// OAuth2 for Calendar
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  });
  res.redirect(url);
});
app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    console.log('Calendar tokens:', tokens);
    res.send('OAuth complete.');
  } catch {
    res.status(500).send('OAuth failed.');
  }
});

// Healthchecks
app.get('/', (_, res) => res.send('SmartVoiceAI running'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
