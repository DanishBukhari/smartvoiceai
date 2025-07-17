// index.js - Full streaming implementation with Deepgram v3 STT/TTS, Twilio Media Streams, and flow.js integration

require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const twilio = require('twilio');
const WebSocket = require('ws');
const { createClient, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');

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

  dgConnection.on('open', () => console.log('Deepgram STT connected'));
  dgConnection.on('error', (error) => console.error('Deepgram STT error', error));

  dgConnection.on('transcript', async (data) => {
    if (data.channel.alternatives[0].transcript.length > 0) {
      console.log('STT Transcript:', data.channel.alternatives[0].transcript);

      if (data.is_final) {
        const transcript = data.channel.alternatives[0].transcript;
        const reply = await handleInput(transcript);
        console.log('NLP Reply:', reply);

        // Generate streaming TTS with Deepgram v3
        const ttsConnection = deepgram.speak.live({
          model: 'aura-asteria-en',
          encoding: 'linear16',
          sample_rate: 8000,
        });

        ttsConnection.on(LiveTTSEvents.Open, () => {
          // send text and then flush
          ttsConnection.sendText(reply);
          ttsConnection.flush();
        });

        ttsConnection.on(LiveTTSEvents.Audio, (audioChunk) => {
          console.log('Sending audio chunk, bytes:', audioChunk.length);
          const base64Chunk = Buffer.from(audioChunk).toString('base64');
          ws.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: { payload: base64Chunk }
          }));
        });


        ttsConnection.on(LiveTTSEvents.Flushed, () => {
          ws.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: { name: 'endOfResponse' }
          }));
          isSpeaking = false;
          // correctly close the Deepgram TTS WebSocket
          if (ttsConnection.ws && ttsConnection.ws.close) {
            ttsConnection.ws.close();
          }
        });

        ttsConnection.on(LiveTTSEvents.Error, (err) => {
          console.error('Deepgram TTS error:', err);
          // Fallback to Twilio TTS if desired
          ws.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
          isSpeaking = false;
          if (ttsConnection.ws && ttsConnection.ws.close) {
            ttsConnection.ws.close();
          }
        });

        isSpeaking = true;
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
        const audioData = Buffer.from(msg.media.payload, 'base64');
        mediaBuffer = Buffer.concat([mediaBuffer, audioData]);
        if (!isSpeaking && dgConnection.readyState === WebSocket.OPEN) {
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
  const ttsConnection = deepgram.speak.live({
    model: 'aura-asteria-en',
    encoding: 'linear16',
    sample_rate: 8000,
  });

  ttsConnection.on(LiveTTSEvents.Open, () => {
    ttsConnection.sendText(text);
    ttsConnection.flush();
  });

  ttsConnection.on(LiveTTSEvents.Audio, (audioChunk) => {
    const base64Chunk = Buffer.from(audioChunk).toString('base64');
    ws.send(JSON.stringify({
      event: 'media',
      streamSid: streamSid,
      media: { payload: base64Chunk }
    }));
  });

  ttsConnection.on(LiveTTSEvents.Flushed, () => {
    ws.send(JSON.stringify({
      event: 'mark',
      streamSid: streamSid,
      mark: { name: 'endOfResponse' }
    }));
    if (ttsConnection.ws && ttsConnection.ws.close) {
      ttsConnection.ws.close();
    }
  });

  ttsConnection.on(LiveTTSEvents.Error, (err) => {
    console.error('Initial TTS error:', err);
    ws.send(JSON.stringify({
      event: 'clear',
      streamSid: streamSid
    }));
    if (ttsConnection.ws && ttsConnection.ws.close) {
      ttsConnection.ws.close();
    }
  });
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

    const { result, error } = await deepgram.tts.speech(
      { text: testText },
      { model: 'aura-asteria-en', encoding: 'linear16', sample_rate: 8000 }
    );
    if (error) throw error;
    const audioBuffer = result.audio;
    res.set('Content-Type', 'audio/wav');
    res.send(audioBuffer);
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

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 Server started on ${port}`);
});

