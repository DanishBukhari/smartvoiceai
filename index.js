// index.js – Deepgram STT + streaming TTS over Twilio Media Streams + all your endpoints

require('dotenv').config();

const express               = require('express');
const { VoiceResponse }     = require('twilio').twiml;
const WebSocket             = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OpenAI }            = require('openai');
const path                  = require('path');
const fs                    = require('fs');
const { OAuth2Client }      = require('google-auth-library');

const app    = express();
const server = require('http').createServer(app);

// --- Deepgram, OpenAI, OAuth2 setup ---
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL.replace(/\/$/, '')}/oauth2callback`
);

// --- Middleware & static files ---
app.enable('trust proxy');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1) Twilio /voice webhook ---
app.post('/voice', (req, res) => {
  const twiml   = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/media`,
    name: 'voiceStream'
  });
  twiml.pause({ length: 1 }); // ensure WS ready
  res.type('text/xml').send(twiml.toString());
});

// --- 2) Upgrade to WebSocket for /media ---
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/media')) {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// --- 3) Handle Twilio Media Stream WebSocket ---
wss.on('connection', (ws /*, req */) => {
  console.log('New WS media connection');
  let streamSid;
  let isSpeaking = false;

  // Reset your state machine
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // Deepgram STT
  const dgStt = deepgram.listen.live({
    model:           'nova-2',
    language:        'en-AU',
    encoding:        'mulaw',
    sample_rate:     8000,
    interim_results: false,
    smart_format:    true,
    filler_words:    false,
    utterances:      true,
    endpointing:     250
  });

  dgStt.on(LiveTranscriptionEvents.Open,    () => console.log('▶️ STT connected'));
  dgStt.on(LiveTranscriptionEvents.Error,   e => console.error('❌ STT error', e));
  dgStt.on(LiveTranscriptionEvents.Transcript, async data => {
    if (!data.is_final) return;
    const text = data.channel.alternatives[0].transcript.trim();
    console.log('🎙️ STT final:', text);

    // process via your flow.js
    const reply = await handleInput(text);
    console.log('💬 Reply:', reply);

    // Deepgram streaming TTS
    const dgTts = deepgram.speak.live({
      model:       'aura-asteria-en',
      encoding:    'mulaw',
      sample_rate: 8000
    });

    dgTts.on(LiveTTSEvents.Open, () => {
      dgTts.sendText(reply);
      dgTts.flush();
    });

    dgTts.on(LiveTTSEvents.Audio, chunk => {
      const b64 = Buffer.from(chunk).toString('base64');
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: b64 }
      }));
    });

    dgTts.on(LiveTTSEvents.Flushed, () => {
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name: 'endOfResponse' }
      }));
      isSpeaking = false;
      if (dgTts.ws) dgTts.ws.close();
    });

    dgTts.on(LiveTTSEvents.Error, err => {
      console.error('❌ TTS error', err);
      ws.send(JSON.stringify({ event:'clear', streamSid }));
      isSpeaking = false;
      if (dgTts.ws) dgTts.ws.close();
    });

    isSpeaking = true;
  });

  ws.on('message', msgStr => {
    const msg = JSON.parse(msgStr);
    switch (msg.event) {
      case 'connected':
        console.log('🔗 Twilio media WS connected');
        break;

      case 'start':
        streamSid = msg.streamSid;
        console.log('🆔 StreamSid:', streamSid);
        // initial greeting
        (async () => {
          const greeting = 'Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?';
          const dgInitTts = deepgram.speak.live({ model:'aura-asteria-en', encoding:'mulaw', sample_rate:8000 });
          dgInitTts.on(LiveTTSEvents.Open, () => {
            dgInitTts.sendText(greeting);
            dgInitTts.flush();
          });
          dgInitTts.on(LiveTTSEvents.Audio, ch => {
            ws.send(JSON.stringify({
              event:'media',
              streamSid,
              media:{ payload: Buffer.from(ch).toString('base64') }
            }));
          });
          dgInitTts.on(LiveTTSEvents.Flushed, () => {
            ws.send(JSON.stringify({ event:'mark', streamSid, mark:{ name:'endOfResponse' }}));
            if (dgInitTts.ws) dgInitTts.ws.close();
          });
        })();
        break;

      case 'media':
        const audio = Buffer.from(msg.media.payload, 'base64');
        if (!isSpeaking && dgStt.ws.readyState === WebSocket.OPEN) {
          dgStt.send(audio);
        }
        break;

      case 'stop':
        console.log('⏹️ Stream stopped');
        dgStt.finish();
        break;
    }
  });

  ws.on('close', () => console.log('❌ WS media closed'));
});

// --- 4) “Test TTS” endpoint (streaming audio via REST) ---
app.get('/test-tts', async (req, res) => {
  try {
    const text = req.query.text || 'Hello, this is a test.';
    const { result, error } = await deepgram.speak.speak({ text }, { model:'aura-asteria-en' });
    if (error) throw error;
    const stream = result.stream;
    if (!stream) return res.status(500).json({ error:'Empty stream' });
    res.set('Content-Type','audio/wav');
    stream.pipe(res);
  } catch (err) {
    console.error('TTS test error', err);
    res.status(500).json({ error: err.message });
  }
});

// --- 5) Simple health & root endpoints ---
app.get('/health', (req, res) => res.json({ status:'ok', uptime: process.uptime() }));
app.get('/test',   (req, res) => res.json({ status:'OK', timestamp: new Date().toISOString() }));
app.get('/',       (req, res) => res.send('SmartVoiceAI is running.'));

// --- 6) OAuth2 for Google Calendar refresh token ---
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  });
  res.redirect(url);
});
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Access Token:',  tokens.access_token);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`OAuth complete. Refresh Token: ${tokens.refresh_token}`);
  } catch (err) {
    console.error('OAuth error', err);
    res.status(500).send('Token exchange failed');
  }
});

// --- 7) Global error handler ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).send('Server error');
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
