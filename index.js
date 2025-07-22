// index.js - Full streaming implementation with Deepgram v2 STT/TTS, Twilio Media Streams, and flow.js integration

require('dotenv').config();
const express       = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket     = require('ws');
const { Deepgram }  = require('@deepgram/sdk');      // v2 SDK
const { handleInput, stateMachine } = require('./flow');
const { OpenAI }    = require('openai');
const path          = require('path');
const fs            = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app    = express();
const server = require('http').createServer(app);
const wss    = new WebSocket.Server({ server });

// --------------
// 1) Clients
// --------------
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------------
// 2) Express
// --------------
app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --------------
// 3) /voice -> TwiML Start MediaStream
// --------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.connect()
    .stream({
      url:  `wss://${req.headers.host}/media`,
      name: 'voiceStream'
    });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// --------------
// 4) WebSocket for Twilio MediaStream
// --------------
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  let streamSid;
  let isSpeaking = false;

  // reset state
  Object.assign(stateMachine, {
    currentState:       'start',
    conversationHistory: [],
    clientData:         {},
    issueType:          null,
    questionIndex:      0,
    nextSlot:           null
  });

  // 4a) Deepgram Live STT
  const dgStt = deepgram.transcription.live({
    model:           'nova-2',
    language:        'en-AU',
    smart_format:    true,
    filler_words:    false,
    utterances:      true,
    interim_results: true,
    endpointing:     250,
    encoding:        'mulaw',
    sample_rate:     8000
  });
  dgStt.on('open',   () => console.log('Deepgram STT connected'));
  dgStt.on('error',  (err) => console.error('Deepgram STT error', err));
  dgStt.on('transcriptionReceived', async (transcription) => {
    const alt = transcription.channel.alternatives[0];
    if (alt && alt.transcript && transcription.is_final) {
      console.log('STT Transcript:', alt.transcript);
      const reply = await handleInput(alt.transcript);
      console.log('NLP Reply:', reply);

      // 4b) Deepgram Live TTS (v2 API)
      const dgTts = deepgram.textToSpeech.synthesizeLive({
        voice:      'alloy',           // or any supported voice
        format:     'wav',
        sample_rate: 8000,
        text:        reply
      });
      dgTts.on('open', () => console.log('Deepgram TTS connected'));
      dgTts.on('data', (audioChunk) => {
        ws.send(JSON.stringify({
          event:    'media',
          streamSid,
          media:    { payload: audioChunk.toString('base64') }
        }));
      });
      dgTts.on('end', () => {
        console.log('TTS streaming ended');
        ws.send(JSON.stringify({
          event:    'mark',
          streamSid,
          mark:     { name: 'endOfResponse' }
        }));
        isSpeaking = false;
      });
      dgTts.on('error', (err) => {
        console.error('Deepgram TTS error', err);
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
        isSpeaking = false;
      });

      isSpeaking = true;
    }
  });

  // 4c) Twilio MediaStream events in
  ws.on('message', (msg) => {
    const m = JSON.parse(msg);
    switch (m.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = m.streamSid;
        console.log('Stream started:', streamSid);
        // send initial greeting
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

// --------------
// 5) Helper to send an arbitrary TTS string
// --------------
async function sendTTS(ws, streamSid, text) {
  try {
    const dgTts = deepgram.textToSpeech.synthesizeLive({
      voice:       'alloy',
      format:      'wav',
      sample_rate: 8000,
      text
    });
    dgTts.on('open',  () => console.log('Initial TTS connected'));
    dgTts.on('data',  (chunk) => {
      ws.send(JSON.stringify({
        event:    'media',
        streamSid,
        media:    { payload: chunk.toString('base64') }
      }));
    });
    dgTts.on('end',   () => {
      ws.send(JSON.stringify({
        event:    'mark',
        streamSid,
        mark:     { name: 'endOfResponse' }
      }));
    });
    dgTts.on('error', (err) => {
      console.error('Initial TTS error', err);
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    });
  } catch (e) {
    console.error('sendTTS threw', e);
  }
}

// --------------
// 6) All your existing endpoints
// --------------
app.get('/test', (_,res) => {
  res.json({
    status:    'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM: !!process.env.DEEPGRAM_API_KEY,
      OPENAI:   !!process.env.OPENAI_API_KEY,
      PORT:     process.env.PORT||3000,
      NODE_ENV: process.env.NODE_ENV||'development'
    },
    uptime:   process.uptime(),
    memory:   process.memoryUsage()
  });
});

app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

app.get('/test-tts', async (req, res) => {
  try {
    const text = req.query.text || "Test TTS";
    const audio = await deepgram.textToSpeech.synthesize(
      { voice:'alloy', format:'wav', sample_rate:8000, text }
    );
    res.set('Content-Type','audio/wav').send(audio);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_,res) => res.json({ status:'ok', responseTime:0 }));

app.use((err,_,res,next) => {
  console.error('Unhandled error', err);
  if (!res.headersSent) res.status(500).send('Server error');
});

// Google OAuth2 endpoints
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://your-app.herokuapp.com/oauth2callback'
);
app.get('/auth', (req,res) => {
  res.redirect(oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  }));
});
app.get('/oauth2callback', async (req,res) => {
  if (!req.query.code) return res.status(400).send('No code');
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`Copy this to .env GOOGLE_REFRESH_TOKEN: ${tokens.refresh_token}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error exchanging code');
  }
});

// Start server
const PORT = process.env.PORT||3000;
server.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
