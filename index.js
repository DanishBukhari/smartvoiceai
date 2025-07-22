// index.js - Full streaming implementation with Deepgram v2 STT/TTS, Twilio Media Streams, and flow.js integration

require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { Deepgram } = require('@deepgram/sdk');      // v2 SDK
const { handleInput, stateMachine } = require('./flow');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Instantiate v2 Deepgram client
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// 1) Twilio /voice webhook to open a media stream
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.connect()
    .stream({
      url: `wss://${req.headers.host}/media`,
      name: 'voiceStream',
    });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// 2) WebSocket endpoint for Twilio MediaStream
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  let streamSid;
  let isSpeaking = false;

  // reset your state machine
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // -- LIVE STT --
  const dgStt = deepgram.transcription.live({
    model:          'nova-2',
    language:       'en-AU',
    smart_format:   true,
    filler_words:   false,
    utterances:     true,
    interim_results:true,
    endpointing:    250,
    encoding:       'mulaw',
    sample_rate:    8000,
  });

  dgStt.on('open', () => {
    console.log('Deepgram STT connected');
  });
  dgStt.on('error', (err) => {
    console.error('Deepgram STT error', err);
  });
  dgStt.on('transcriptionReceived', async (transcription) => {
    // transcription is the raw JSON from DG: { channel: { alternatives: [...] }, is_final: bool, ... }
    const alt = transcription.channel.alternatives[0];
    if (alt && alt.transcript && transcription.is_final) {
      console.log('STT Transcript:', alt.transcript);
      const reply = await handleInput(alt.transcript);
      console.log('NLP Reply:', reply);

      // -- LIVE TTS --
      const dgTts = deepgram.tts.live({
        model:       'aura-2-andromeda-en',
        encoding:    'mulaw',
        sample_rate: 8000,
      });

      dgTts.on('open', () => {
        console.log('Deepgram TTS connected');
        dgTts.sendText(reply);
        dgTts.flush();
      });
      dgTts.on('audio', (audio) => {
        console.log('Sending TTS chunk', audio.length);
        ws.send(JSON.stringify({
          event:    'media',
          streamSid,
          media: { payload: Buffer.from(audio).toString('base64') }
        }));
      });
      dgTts.on('end', () => {
        console.log('TTS stream end');
        ws.send(JSON.stringify({
          event:    'mark',
          streamSid,
          mark: { name: 'endOfResponse' }
        }));
        isSpeaking = false;
        dgTts.close();
      });
      dgTts.on('error', (err) => {
        console.error('Deepgram TTS error', err);
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
        isSpeaking = false;
        dgTts.close();
      });

      isSpeaking = true;
    }
  });

  // Twilio media events in
  ws.on('message', (msg) => {
    const m = JSON.parse(msg);
    switch (m.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = m.streamSid;
        console.log('Stream started:', streamSid);
        // initial greeting
        sendTTS(ws, streamSid, "Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");
        break;
      case 'media':
        const audio = Buffer.from(m.media.payload, 'base64');
        if (!isSpeaking) dgStt.send(audio);
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

// Utility to send initial or fallback TTS
async function sendTTS(ws, streamSid, text) {
  try {
    const dgTts = deepgram.tts.live({
      model:       'aura-2-andromeda-en',
      encoding:    'mulaw',
      sample_rate: 8000,
    });
    dgTts.on('open', () => {
      dgTts.sendText(text);
      dgTts.flush();
    });
    dgTts.on('audio', (audio) => {
      ws.send(JSON.stringify({
        event:    'media',
        streamSid,
        media: { payload: Buffer.from(audio).toString('base64') }
      }));
    });
    dgTts.on('end', () => {
      ws.send(JSON.stringify({
        event:    'mark',
        streamSid,
        mark: { name: 'endOfResponse' }
      }));
      dgTts.close();
    });
    dgTts.on('error', (err) => {
      console.error('Initial TTS error', err);
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
      dgTts.close();
    });
  } catch (e) {
    console.error('sendTTS threw', e);
  }
}

// All your other endpoints (health, test, test‑tts, OAuth, root…)
app.get('/test', (_, res) => {
  res.json({
    status:    'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM_API_KEY: !!process.env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY:   !!process.env.OPENAI_API_KEY,
      PORT:             process.env.PORT || 3000,
      NODE_ENV:         process.env.NODE_ENV || 'development',
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

app.get('/test-tts', async (req, res) => {
  try {
    const text = req.query.text || "Hello, this is a test.";
    const { audio } = await deepgram.tts.preRecorded(
      { text },
      { model: 'aura-2-andromeda-en', encoding: 'wav' }
    );
    res.set('Content-Type', 'audio/wav');
    res.send(audio);
  } catch (err) {
    console.error('TTS test error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', responseTime: 0 }));

app.use((err, _, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).send('Server error');
});

// Google OAuth2 for Calendar
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://smartvoiceai-fa77bfa7f137.herokuapp.com/oauth2callback'
);
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.redirect(url);
});
app.get('/oauth2callback', async (req, res) => {
  if (!req.query.code) return res.status(400).send('No code provided');
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    console.log('Access Token:',  tokens.access_token);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`OAuth complete. Refresh Token: ${tokens.refresh_token}. Copy this to your .env`);
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('Error exchanging code');
  }
});

// start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
