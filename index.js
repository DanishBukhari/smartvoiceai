// index.js - Full streaming implementation with Deepgram STT/TTS, Twilio Media Streams, and flow.js integration

require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const twilio = require('twilio');
const WebSocket = require('ws');
const { Deepgram } = require('@deepgram/sdk');
const { handleInput, stateMachine } = require('./flow');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
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
  twiml.say({
    voice: 'alice',
    language: 'en-AU'
  }, "Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");

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

  // Connect to Deepgram for live STT
  const dgSocket = deepgram.transcription.live({
    model: 'nova',
    language: 'en-AU',
    smart_format: true,
    filler_words: false,
    utterances: true,
    interim_results: true,
    endpointing: 250,
  });

  dgSocket.on('open', () => console.log('Deepgram STT connected'));
  dgSocket.on('error', (error) => console.error('Deepgram STT error', error));

  dgSocket.on('transcript', async (data) => {
    if (data.channel.alternatives[0].transcript.length > 0) {
      console.log('STT Transcript:', data.channel.alternatives[0].transcript);
      
      if (data.is_final) {
        const transcript = data.channel.alternatives[0].transcript;
        const reply = await handleInput(transcript);
        console.log('NLP Reply:', reply);
        
        // Generate TTS with Deepgram
        try {
          const ttsResponse = await deepgram.speak.request({ text: reply }, { model: 'aura-asteria-en' });
          const ttsStream = await ttsResponse.getStream();
          const ttsBuffers = [];
          const ttsReader = ttsStream.getReader();
          while (true) {
            const { done, value } = await ttsReader.read();
            if (done) break;
            if (value) ttsBuffers.push(value);
          }
          const ttsAudio = Buffer.concat(ttsBuffers);
          
          // Send TTS audio to Twilio as base64 in chunks (for streaming effect)
          isSpeaking = true;
          const chunkSize = 4096;
          for (let i = 0; i < ttsAudio.length; i += chunkSize) {
            const chunk = ttsAudio.slice(i, i + chunkSize);
            const base64Chunk = chunk.toString('base64');
            ws.send(JSON.stringify({
              event: 'media',
              streamSid: streamSid,
              media: {
                payload: base64Chunk
              }
            }));
            await new Promise(resolve => setTimeout(resolve, 32)); // ~30ms per chunk for real-time
          }
          isSpeaking = false;
          
          ws.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: {
              name: 'endOfResponse'
            }
          }));
        } catch (error) {
          console.error('TTS error:', error);
          // Fallback to Twilio TTS
          const twiml = new VoiceResponse();
          twiml.say({
            voice: 'alice',
            language: 'en-AU'
          }, reply);
          // Send TwiML to Twilio - but since it's streaming, we might need to handle differently
          // For simplicity, assume fallback is text
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
        break;
      case 'media':
        const audioData = Buffer.from(msg.media.payload, 'base64');
        mediaBuffer = Buffer.concat([mediaBuffer, audioData]);
        if (!isSpeaking && dgSocket.getReadyState() === WebSocket.OPEN) {
          dgSocket.send(audioData);
        }
        break;
      case 'stop':
        console.log('Stream stopped');
        break;
    }
  });

  ws.on('close', () => {
    if (dgSocket) dgSocket.finish();
    console.log('WebSocket closed');
  });
});

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
    const audioBuffer = await synthesizeBuffer(testText);
    
    if (audioBuffer && audioBuffer.length > 0) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
    } else {
      res.status(500).json({ error: 'Empty audio buffer' });
    }
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