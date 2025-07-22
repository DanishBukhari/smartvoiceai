// index.js
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

// Serve static assets (if any)
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// —————————
// 1) Twilio voice webhook → start media stream
// —————————
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: `wss://${req.headers.host}/media`, name: 'voiceStream' });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// —————————
// 2) WebSocket handler for media & Deepgram STT/TTS
// —————————
wss.on('connection', (ws) => {
  let streamSid;
  let sttReady = false;
  let ttsInFlight = false;
  let greetingSent = false;

  // Reset state machine
  Object.assign(stateMachine, {
    currentState: 'start',
    questionIndex: 0,
    conversationHistory: [],
    clientData: {},
    issueType: null,
    nextSlot: null,
    bookingRetryCount: 0
  });

  // Setup deepgram STT listener
  const dgStt = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-AU',
    smart_format: true,
    interim_results: true,
    utterances: true,
    encoding: 'mulaw',
    sample_rate: 8000
  });

  dgStt.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram STT connected');
    sttReady = true;
  });

  dgStt.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('Deepgram STT error', err);
  });

  dgStt.on(LiveTranscriptionEvents.Transcript, async (data) => {
    if (!data.is_final) return;
    const transcript = data.channel.alternatives[0].transcript.trim();
    if (!transcript || ttsInFlight) return;

    console.log('STT Transcript:', transcript);
    const reply = await handleInput(transcript);
    console.log('NLP Reply:', reply);

    ttsInFlight = true;
    speak(ws, streamSid, reply);
  });

  // Handle incoming Twilio media messages
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    switch (msg.event) {
      case 'start':
        streamSid = msg.streamSid;
        console.log('Stream started, SID:', streamSid);
        if (!greetingSent) {
          greetingSent = true;
          // Send initial greeting exactly once
          speak(ws, streamSid, 'Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?');
        }
        break;
      case 'media':
        if (sttReady && !ttsInFlight) {
          const audio = Buffer.from(msg.media.payload, 'base64');
          dgStt.send(audio);
        }
        break;
      case 'stop':
        console.log('Stream stopped');
        dgStt.finish();
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    dgStt.finish();
  });
});

// Helper to speak via Deepgram TTS
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
  });

  dgTts.on(LiveTTSEvents.Error, (err) => {
    console.error('Deepgram TTS error', err);
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
    ttsInFlight = false;
  });
}

// —————————
// 3) OAuth2 endpoints for Google Calendar
// —————————
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
    console.log('Received tokens:', tokens);
    res.send('OAuth complete. You can close this window.');
  } catch (e) {
    console.error('OAuth error', e);
    res.status(500).send('OAuth failed');
  }
});

// —————————
// Health & test endpoints
// —————————
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Start HTTP + WS server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
