// index.js – Deepgram v3 STT & TTS + Twilio + flow.js + OpenAI + Google OAuth

require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

// Express setup
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Deepgram v3 client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google OAuth2 client (for Calendar)
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://YOUR_HEROKU_APP.herokuapp.com/oauth2callback'
);

// —————————
// 1) Twilio /voice endpoint → start media stream
// —————————
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/media`,
    name: 'voiceStream',
  });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// —————————
// 2) WebSocket handler for Twilio media
// —————————
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  let streamSid;
  let isSpeaking = false;
  let sttReady = false;

  // Reset your conversation state
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // —— Deepgram streaming STT ——
  const dgStt = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-AU',
    smart_format: true,
    filler_words: false,
    interim_results: true,
    utterances: true,
    endpointing: 250,
    encoding: 'mulaw',
    sample_rate: 8000,
  });

  dgStt.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram STT connected');
    sttReady = true;
  });
  dgStt.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('Deepgram STT error', err);
  });
  dgStt.on(LiveTranscriptionEvents.Transcript, async (data) => {
    // only handle final transcripts
    const alt = data.channel.alternatives[0];
    if (alt.transcript && data.is_final) {
      console.log('STT Transcript:', alt.transcript);
      const reply = await handleInput(alt.transcript);
      console.log('NLP Reply:', reply);

      // —— Deepgram streaming TTS ——
      const dgTts = deepgram.speak.live({
        model: 'aura-2-andromeda-en',
        encoding: 'mulaw',
        sample_rate: 8000,
      });
      dgTts.on(LiveTTSEvents.Open, () => {
        console.log('Deepgram TTS connected');
        dgTts.sendText(reply);
        dgTts.flush();
      });
      dgTts.on(LiveTTSEvents.Audio, (chunk) => {
        const payload = Buffer.from(chunk).toString('base64');
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload }
        }));
      });
      dgTts.on(LiveTTSEvents.Flushed, () => {
        // signal end of response
        ws.send(JSON.stringify({
          event: 'mark',
          streamSid,
          mark: { name: 'endOfResponse' }
        }));
        isSpeaking = false;
        // no explicit close() needed
      });
      dgTts.on(LiveTTSEvents.Error, (err) => {
        console.error('Deepgram TTS error', err);
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
        isSpeaking = false;
      });

      isSpeaking = true;
    }
  });

  // —— Twilio media frames in
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    switch (msg.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = msg.streamSid;
        console.log('Stream started:', streamSid);
        // send your own TTS greeting
        sendTTS(ws, streamSid, 'Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?');
        break;
      case 'media':
        if (sttReady && !isSpeaking) {
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

// —————————
// Helper: send TTS greeting or any text
// —————————
async function sendTTS(ws, streamSid, text) {
  try {
    const dgTts = deepgram.speak.live({
      model: 'aura-2-andromeda-en',
      encoding: 'mulaw',
      sample_rate: 8000,
    });
    dgTts.on(LiveTTSEvents.Open, () => {
      dgTts.sendText(text);
      dgTts.flush();
    });
    dgTts.on(LiveTTSEvents.Audio, (chunk) => {
      const payload = Buffer.from(chunk).toString('base64');
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
    });
    dgTts.on(LiveTTSEvents.Flushed, () => {
      ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'endOfResponse' } }));
    });
    dgTts.on(LiveTTSEvents.Error, (err) => {
      console.error('sendTTS error', err);
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    });
  } catch (err) {
    console.error('sendTTS threw', err);
  }
}

// —————————
// Misc endpoints
// —————————

// Health + debug
app.get('/test', (_, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM_API_KEY: !!process.env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      PORT: process.env.PORT || 3000,
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Root
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

// on‑demand TTS (not streaming)
app.get('/test-tts', async (req, res) => {
  try {
    const text = req.query.text || 'Hello, test.';
    const { audio } = await deepgram.speak.text({ text }, { model: 'aura-2-andromeda-en' });
    res.set('Content-Type', 'audio/wav').send(Buffer.from(audio, 'base64'));
  } catch (err) {
    console.error('test-tts error', err);
    res.status(500).json({ error: err.message });
  }
});

// Simple health check
app.get('/health', (_, res) => res.json({ status: 'ok', responseTime: 0 }));

// Global error handler
app.use((err, _, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).send('Server error');
});

// Google OAuth2 for Calendar
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.redirect(url);
});
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Access:', tokens.access_token);
    console.log('Refresh:', tokens.refresh_token);
    res.send(`OAuth complete. Refresh Token: ${tokens.refresh_token}`);
  } catch (e) {
    console.error('OAuth error', e);
    res.status(500).send('Error exchanging code');
  }
});

// Start HTTP+WS server
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`🚀 Server started on ${port}`));
