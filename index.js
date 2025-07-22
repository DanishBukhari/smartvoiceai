// server.js
require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Google OAuth2 client (for Calendar)
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `https://${process.env.HEROKU_APP}.herokuapp.com/oauth2callback`
);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ————— Twilio voice webhook —————
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const conn = twiml.connect();
  conn.stream({ url: `wss://${req.headers.host}/media`, name: 'voiceStream' });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// ————— WebSocket for media —————
wss.on('connection', (ws) => {
  let streamSid;
  let isSpeaking = false;
  let sttReady = false;
  let ttsInFlight = false;

  // Reset stateMachine
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
    awaitingAddress: false,
    awaitingTime: false,
    bookingRetryCount: 0
  });

  // STT stream
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
    const alt = data.channel.alternatives[0];
    if (data.is_final && alt.transcript && !isSpeaking) {
      const reply = await handleInput(alt.transcript);
      // TTS reply
      if (ttsInFlight) return;
      ttsInFlight = true;

      const dgTts = deepgram.speak.live({
        model: 'aura-2-andromeda-en',
        encoding: 'mulaw',
        sample_rate: 8000
      });

      dgTts.on(LiveTTSEvents.Open, () => {
        dgTts.sendText(reply);
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
        dgTts.close();
      });
      dgTts.on(LiveTTSEvents.Error, () => {
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
        ttsInFlight = false;
        dgTts.close();
      });
    }
  });

  // Twilio media events
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    switch (msg.event) {
      case 'start':
        streamSid = msg.streamSid;
        sendTTS(ws, streamSid, 'Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?');
        break;
      case 'media':
        if (sttReady && !isSpeaking) {
          dgStt.send(Buffer.from(msg.media.payload, 'base64'));
        }
        break;
      case 'stop':
        dgStt.finish();
        break;
    }
  });

  ws.on('close', () => dgStt.finish());
});

// ————— Helper: one‑off TTS send —————
async function sendTTS(ws, streamSid, text) {
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
    dgTts.close();
  });
  dgTts.on(LiveTTSEvents.Error, () => {
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
    dgTts.close();
  });
}

// ————— OAuth2 callback —————
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Got tokens', tokens);
    res.send('OAuth complete.');
  } catch (e) {
    res.status(500).send('Error exchanging code');
  }
});

app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  });
  res.redirect(url);
});

// ————— Health / test endpoints —————
app.get('/test', (_, res) => res.json({ status:'OK', time: new Date().toISOString() }));
app.get('/',    (_, res) => res.send('SmartVoiceAI is running.'));
app.get('/health', (_, res) => res.json({ status:'ok' }));

// ————— Start server —————
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server up on ${port}`));
