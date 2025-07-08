require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleVoice, handleSpeech } = require('./twilio');
const { VoiceResponse } = require('twilio').twiml;
const { preloadCoreResponses } = require('./tts');
const https = require('https');

const app = express();
app.enable('trust proxy');

// Serve your intro MP3
app.use(express.static(path.join(__dirname, 'public')));

// Parse Twilio's POSTs
app.use(express.urlencoded({ extended: true }));

// Incoming call → welcome & gather
app.post('/voice', handleVoice);

// Twilio gather result → NLP + inline TTS
app.post('/speech', async (req, res, next) => {
  try {
    await handleSpeech(req, res);
  } catch (error) {
    console.error('Speech handler error:', error);
    const twiml = new VoiceResponse();
    try {
      const { synthesizeBuffer } = require('./tts');
      const buffer = await synthesizeBuffer("I'm sorry, I'm having technical difficulties. Please try again.");
      const file = `speech_error_${Date.now()}.mp3`;
      const outPath = path.join(__dirname, 'public', file);
      await require('fs').promises.writeFile(outPath, buffer);
      twiml.play(`${req.protocol}://${req.get('Host')}/${file}`);
    } catch (e) {
      twiml.play(`${req.protocol}://${req.get('Host')}/pregen_i_m_sorry__i_didn_t_under.mp3`);
    }
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'en-AU',
      action: `${req.protocol}://${req.get('Host')}/speech`,
      method: 'POST',
      timeout: 10,
    });
    res.type('text/xml').send(twiml.toString());
  }
});

// Healthcheck
app.get('/test', (_, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: {
      ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
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
    const { synthesizeBuffer } = require('./tts');
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
  // Check ElevenLabs quota
  const options = {
    hostname: 'api.elevenlabs.io',
    path: '/v1/user',
    method: 'GET',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Accept': 'application/json',
    },
    timeout: 5000,
  };
  const reqTime = Date.now();
  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', (chunk) => data += chunk);
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.subscription && json.subscription.character_limit) {
          const used = json.subscription.character_count;
          const limit = json.subscription.character_limit;
          const pct = (used / limit) * 100;
          if (pct > 90) {
            console.warn('⚠️ ElevenLabs quota above 90%');
          }
          res.json({
            status: 'ok',
            quota: { used, limit, percent: pct },
            responseTime: Date.now() - reqTime
          });
        } else {
          res.status(500).json({ status: 'error', error: 'No quota info', responseTime: Date.now() - reqTime });
        }
      } catch (e) {
        res.status(500).json({ status: 'error', error: e.message, responseTime: Date.now() - reqTime });
      }
    });
  });
  apiReq.on('error', (err) => {
    res.status(500).json({ status: 'error', error: err.message, responseTime: Date.now() - reqTime });
  });
  apiReq.on('timeout', () => {
    res.status(500).json({ status: 'error', error: 'timeout', responseTime: Date.now() - reqTime });
  });
  apiReq.end();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    const twiml = new VoiceResponse();
    try {
      const { synthesizeBuffer } = require('./tts');
      (async () => {
        const buffer = await synthesizeBuffer("I'm sorry, there was an error. Please try again.");
        const file = `global_error_${Date.now()}.mp3`;
        const outPath = path.join(__dirname, 'public', file);
        await require('fs').promises.writeFile(outPath, buffer);
        twiml.play(`${req.protocol}://${req.get('Host')}/${file}`);
        twiml.gather({
          input: 'speech',
          speechTimeout: 'auto',
          language: 'en-AU',
          action: `${req.protocol}://${req.get('Host')}/speech`,
          method: 'POST',
          timeout: 10,
        });
        res.type('text/xml').send(twiml.toString());
      })();
    } catch (e) {
      twiml.play(`${req.protocol}://${req.get('Host')}/pregen_i_m_sorry__i_didn_t_under.mp3`);
      twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        language: 'en-AU',
        action: `${req.protocol}://${req.get('Host')}/speech`,
        method: 'POST',
        timeout: 10,
      });
      res.type('text/xml').send(twiml.toString());
    }
  }
});

// Start server first, then pre-generate in background
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server started on ${process.env.PORT || 3000}`);
  
  // Start pre-generation in background (non-blocking)
  setTimeout(() => {
    console.log('🔄 Starting pre-generation in background...');
    preloadCoreResponses().then(() => {
      console.log('✅ Pre-generation complete!');
    }).catch(error => {
      console.error('❌ Pre-generation failed (non-critical):', error);
    });
  }, 2000); // Wait 2 seconds after server starts
});

