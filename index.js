// index.js
require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const twilio = require('twilio');
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.enable('trust proxy');

// Serve public files if needed
app.use(express.static(path.join(__dirname, 'public')));

// Parse Twilio POSTs
app.use(express.urlencoded({ extended: true }));

// Handle incoming calls - Start media stream
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/media`,
    name: 'voiceStream',
  });
  twiml.pause({ length: 1 });  // Small pause to ensure stream is ready

  res.type('text/xml').send(twiml.toString());
});

// WebSocket for media stream
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  let streamSid;
  let mediaBuffer = Buffer.alloc(0);
  let isSpeaking = false;
  
  // Reset state for new call
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  // Connect to Deepgram for live STT (v3 syntax)
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
  dgConnection.on(LiveTranscriptionEvents.Error, (error) => console.error('Deepgram STT error', error));

  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    if (data.channel.alternatives[0].transcript.length > 0) {
      console.log('STT Transcript:', data.channel.alternatives[0].transcript);
      
      if (data.is_final) {
        const transcript = data.channel.alternatives[0].transcript;
        const reply = await handleInput(transcript);
        console.log('NLP Reply:', reply);
        
        // Generate TTS with Deepgram (v3 syntax)
        try {
          const ttsConnection = deepgram.speak.live({
            model: 'aura-asteria-en',
            encoding: 'mulaw',
            sample_rate: 8000,
          });

          ttsConnection.on(LiveTTSEvents.Open, () => {
            ttsConnection.sendText(reply);
            ttsConnection.flush();
          });

          ttsConnection.on(LiveTTSEvents.Audio, (audioChunk) => {
              if (Buffer.isBuffer(audioChunk)) {
              const base64Chunk = audioChunk.toString('base64');
              ws.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: base64Chunk }
              
            }));
            }
          });

          ttsConnection.on(LiveTTSEvents.Flushed, () => {
            ws.send(JSON.stringify({
              event: 'mark',
              streamSid: streamSid,
              mark: {
                name: 'endOfResponse'
              }
            }));
            isSpeaking = false;
            
          
          });

          ttsConnection.on(LiveTTSEvents.Error, (err) => {
            console.error('Deepgram TTS error:', err);
            ws.send(JSON.stringify({
              event: 'clear',
              streamSid: streamSid
            }));
            isSpeaking = false;
            // ttsConnection.close();
          });

          isSpeaking = true;
        } catch (error) {
          console.error('TTS error:', error);
          // Fallback to Twilio TTS
          ws.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
        }
      }
    }
  });

  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = msg.streamSid;
        console.log('Stream started, Sid:', streamSid);
        // Send initial greeting when stream starts
        sendTTS(ws, streamSid, "Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");
        break;
      case 'media':
        if (!isSpeaking && dgConnection.readyState === WebSocket.OPEN) {
          const audioData = Buffer.from(msg.media.payload, 'base64');
          mediaBuffer = Buffer.concat([mediaBuffer, audioData]);
          dgConnection.send(audioData);
        }
        break;
      case 'stop':
        console.log('Stream stopped');
        break;
    }
  });

  ws.on('close', () => {
    if (dgConnection) dgConnection.finish();
    console.log('WebSocket closed');
  });
});

// Function to send TTS audio via WebSocket
async function sendTTS(ws, streamSid, text) {
  try {
    const ttsConnection = deepgram.speak.live({
      model: 'aura-asteria-en',
      encoding: 'mulaw',
      sample_rate: 8000,
    });

    ttsConnection.on(LiveTTSEvents.Open, () => {
      ttsConnection.sendText(text);
      ttsConnection.flush();
    });

    ttsConnection.on(LiveTTSEvents.Audio, (audioChunk) => {
      if (Buffer.isBuffer(audioChunk)) {
              const base64Chunk = audioChunk.toString('base64');
              ws.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: base64Chunk }
              
            }));
            }
    });

    ttsConnection.on(LiveTTSEvents.Flushed, () => {
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid: streamSid,
        mark: {
          name: 'endOfResponse'
        }
      }));

      
    });

    ttsConnection.on(LiveTTSEvents.Error, (err) => {
      console.error('Initial TTS error:', err);
      ws.send(JSON.stringify({
        event: 'clear',
        streamSid: streamSid
      }));
      // ttsConnection.close();
    });
  } catch (error) {
    console.error('Initial TTS error:', error);
    // Fallback if needed
  }
}

// Healthcheck
app.get('/test', (_, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM_API_KEY: !!process.env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      PORT: process.env.PORT || 3000,
      NODE_ENV: process.env.NODE_ENV || 'development'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  res.json(health);
});

// Root path
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

// TTS test endpoint
app.get('/test-tts', async (req, res) => {
  try {
    const testText = req.query.text || "Hello, this is a test.";
    
    console.log('Testing TTS with text:', testText);
    const { result, error } = await deepgram.speak.speak({ text: testText }, { model: 'aura-asteria-en' });
    if (error) throw error;
    const stream = result.stream;
    if (!stream) {
      res.status(500).json({ error: 'Empty audio stream' });
      return;
    }
    
    res.set('Content-Type', 'audio/wav');
    stream.pipe(res);
  } catch (error) {
    console.error('TTS test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health endpoint
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    responseTime: 0
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).send('Server error');
  }
});

// OAuth2 callback for Google Calendar refresh token (production)
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://smartvoiceai-fa77bfa7f137.herokuapp.com/oauth2callback'  // Your Heroku URL
);

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('Access Token:', tokens.access_token);
      console.log('Refresh Token:', tokens.refresh_token);
      res.send(`OAuth complete. Refresh Token: ${tokens.refresh_token}. Copy this to your .env GOOGLE_REFRESH_TOKEN.`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.status(500).send('Error exchanging code for tokens');
    }
  } else {
    res.status(400).send('No code provided');
  }
});

app.get('/auth', (req, res) => {
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.redirect(authorizeUrl);
});

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 Server started on ${port}`);
});