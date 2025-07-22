require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// incoming call webhook
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

// WebSocket for media
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  let streamSid;
  let isSpeaking = false;
  let mediaBuffer = Buffer.alloc(0);

  // reset per-call state
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // Deepgram STT
  const dgConnection = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-AU',
    smart_format: true,
    filler_words: false,
    utterances: true,
    interim_results: true,
    endpointing: 250,
  });
  dgConnection.on(LiveTranscriptionEvents.Open, () => console.log('Deepgram STT connected'));
  dgConnection.on(LiveTranscriptionEvents.Error, (err) => console.error('Deepgram STT error', err));
  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && data.is_final) {
      console.log('STT Transcript:', transcript);
      const reply = await handleInput(transcript);
      console.log('NLP Reply:', reply);
      sendTTS(reply);
    }
  });

  // TTS helper (inside connection so it shares isSpeaking & streamSid)
  async function sendTTS(text) {
    const tts = deepgram.speak.live({
      model: 'aura-asteria-en',
      encoding: 'mulaw',
      sample_rate: 8000,
    });

    tts.on(LiveTTSEvents.Open, () => {
      isSpeaking = true;
      tts.sendText(text);
      tts.flush();
    });

    tts.on(LiveTTSEvents.Audio, (chunk) => {
      if (Buffer.isBuffer(chunk)) {
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: chunk.toString('base64') }
        }));
      }
    });

    tts.on(LiveTTSEvents.Flushed, () => {
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name: 'endOfResponse' }
      }));
      isSpeaking = false;
    });

    tts.on(LiveTTSEvents.Error, (err) => {
      console.error('Deepgram TTS error:', err);
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
      isSpeaking = false;
    });
  }

  // Twilio media events
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    switch (msg.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = msg.streamSid;
        console.log('Stream started, Sid:', streamSid);
        sendTTS("Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");
        break;
      case 'media':
        if (!isSpeaking && dgConnection.readyState === WebSocket.OPEN) {
          const audioData = Buffer.from(msg.media.payload, 'base64');
          dgConnection.send(audioData);
        }
        break;
      case 'stop':
        console.log('Stream stopped');
        break;
    }
  });

  ws.on('close', () => {
    dgConnection.finish();
    console.log('WebSocket closed');
  });
});

// health & misc endpoints
app.get('/test', (_, res) => {
  res.json({ status: 'OK', time: new Date().toISOString() });
});
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));
app.get('/auth', (req, res) => {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI
  );
  res.redirect(oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  }));
});
app.get('/oauth2callback', async (req, res) => {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI
  );
  const { tokens } = await oauth2Client.getToken(req.query.code);
  console.log('OAuth tokens:', tokens);
  res.send('OAuth complete, check logs.');
});
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).send('Server error');
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`🚀 Server started on ${port}`));
