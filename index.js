require('dotenv').config();
const express = require('express');
const path = require('path');
const { handleVoice, handleSpeech } = require('./twilio');
const { VoiceResponse } = require('twilio').twiml;

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
    twiml.say({
      voice: 'alice',
      language: 'en-AU'
    }, "I'm sorry, I'm having technical difficulties. Please try again.");
    
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'en-AU',
      action: `${req.protocol}://${req.get('Host')}/speech`,
      method: 'POST',
      timeout: 10,
    });
    
    twiml.redirect('/voice');
    res.type('text/xml').send(twiml.toString());
  }
});

// Healthcheck
app.get('/test', (_, res) => res.send('OK'));

// Add this for root path
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));

// Add this before app.listen
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  if (!res.headersSent) {
    const twiml = new VoiceResponse();
    twiml.play(`${req.protocol}://${req.get('Host')}/Introduction.mp3`); // Use static file
    
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

app.listen(process.env.PORT || 3000, () =>
  console.log(`Listening on ${process.env.PORT || 3000}`)
);
