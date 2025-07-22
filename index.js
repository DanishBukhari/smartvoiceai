// index.js – Deepgram v2 streaming STT/TTS + Twilio + flow.js + OAuth2

require('dotenv').config();
const express       = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket     = require('ws');
const { Deepgram }  = require('@deepgram/sdk');      // v2 SDK
const { handleInput, stateMachine } = require('./flow');
const { OpenAI }    = require('openai');
const path          = require('path');
const { OAuth2Client } = require('google-auth-library');

const app    = express();
const server = require('http').createServer(app);
const wss    = new WebSocket.Server({ server });

const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Twilio /voice → start media stream
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.connect()
       .stream({ url: `wss://${req.headers.host}/media`, name: 'voiceStream' });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// Media WebSocket
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  let streamSid, isSpeaking = false;

  // reset flow.js
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // STT
  const dgStt = deepgram.transcription.live({
    model: 'nova-2',
    language: 'en-AU',
    smart_format: true,
    filler_words: false,
    utterances: true,
    interim_results: true,
    endpointing: 250,
    encoding: 'mulaw',
    sample_rate: 8000
  });
  dgStt.on('open',   () => console.log('Deepgram STT connected'));
  dgStt.on('error',  (err) => console.error('Deepgram STT error', err));
  dgStt.on('transcript', async (data) => {
    const alt = data.channel.alternatives[0];
    if (data.is_final && alt.transcript) {
      console.log('STT Transcript:', alt.transcript);
      const reply = await handleInput(alt.transcript);
      console.log('NLP Reply:', reply);

      // TTS via textToSpeech.synthesizeLive
      const dgTts = deepgram.textToSpeech.synthesizeLive({
        voice:       'alloy',
        encoding:    'mulaw',
        sample_rate: 8000,
        text:        reply
      });
      dgTts.on('open', () => console.log('Deepgram TTS connected'));
      dgTts.on('data', (audioChunk) => {
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: audioChunk.toString('base64') }
        }));
      });
      dgTts.on('end', () => {
        ws.send(JSON.stringify({
          event: 'mark',
          streamSid,
          mark: { name: 'endOfResponse' }
        }));
        isSpeaking = false;
      });
      dgTts.on('error', (err) => {
        console.error('Deepgram TTS error', err);
        ws.send(JSON.stringify({
          event: 'clear',
          streamSid
        }));
        isSpeaking = false;
      });

      isSpeaking = true;
    }
  });

  // Twilio events
  ws.on('message', (msg) => {
    const m = JSON.parse(msg);
    switch (m.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;

      case 'start':
        streamSid = m.streamSid;
        console.log('Stream started:', streamSid);
        sendTTS(ws, streamSid,
          "Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?"
        );
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

// Helper to send initial or manual TTS
async function sendTTS(ws, streamSid, text) {
  try {
    const dgTts = deepgram.textToSpeech.synthesizeLive({
      voice:       'alloy',
      encoding:    'mulaw',
      sample_rate: 8000,
      text
    });
    dgTts.on('open', () => console.log('Initial TTS connected'));
    dgTts.on('data', (chunk) => {
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: chunk.toString('base64') }
      }));
    });
    dgTts.on('end', () => {
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name: 'endOfResponse' }
      }));
    });
    dgTts.on('error', (err) => {
      console.error('Initial TTS error', err);
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    });
  } catch (e) {
    console.error('sendTTS thrown', e);
  }
}

// Other endpoints
app.get('/test', (_, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM: !!process.env.DEEPGRAM_API_KEY,
      OPENAI:   !!process.env.OPENAI_API_KEY,
      PORT:     process.env.PORT || 3000,
      NODE_ENV: process.env.NODE_ENV || 'dev'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

app.get('/test-tts', async (req, res) => {
  try {
    const audio = await deepgram.textToSpeech.synthesize({
      voice:       'alloy',
      encoding:    'wav',
      sample_rate: 8000,
      text:        req.query.text || 'Hello'
    });
    res.set('Content-Type','audio/wav').send(audio);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// OAuth2 for Google Calendar
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://your-app.herokuapp.com/oauth2callback'
);
app.get('/auth', (req, res) =>
  res.redirect(oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  }))
);
app.get('/oauth2callback', async (req, res) => {
  if (!req.query.code) return res.status(400).send('No code');
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`Refresh Token: ${tokens.refresh_token}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error exchanging code');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
