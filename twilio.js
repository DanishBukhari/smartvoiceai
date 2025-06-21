// twilio.js
const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput } = require('./flow');
const { synthesizeBuffer } = require('./tts');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL;
function baseUrl(req) {
  return APP_URL || `${req.protocol}://${req.get('Host')}`;
}

async function handleVoice(req, res) {
  const B = baseUrl(req);
  const twiml = new VoiceResponse();
  const g = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'en-AU',
    action: `${B}/speech`,
    method: 'POST',
  });
  g.play(`${B}/Introduction.mp3`);
  g.say('Hi, I’m Robyn from Usher Fix Plumbing. How can I help you today?');
  twiml.redirect('/voice');
  res.type('text/xml').send(twiml.toString());
}

async function handleSpeech(req, res) {
  const B = baseUrl(req);
  const userText = req.body.SpeechResult || '';
  console.log('User said:', userText);

  let reply;
  try {
    reply = await handleInput(userText);
  } catch (e) {
    console.error('NL error:', e);
    reply = "Sorry, I'm having trouble. Could you please repeat that?";
  }

  // 1) Generate the audio buffer
  let audioBuffer;
  try {
    audioBuffer = await synthesizeBuffer(reply);
  } catch (e) {
    console.error('TTS error:', e);
  }

  // 2) Write it to a file named by CallSid
  let filename = 'fallback.mp3';
  if (audioBuffer) {
    const callSid = req.body.CallSid || Date.now().toString();
    filename = `${callSid}.mp3`;
    const outPath = path.join(__dirname, 'public', filename);
    await fs.promises.writeFile(outPath, audioBuffer);
  }

  // 3) Respond with a tiny TwiML that plays the static URL
  const twiml = new VoiceResponse();
  twiml.play(`${B}/${filename}`);

  // 4) Re‑open gather for the next turn
  const g = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'en-AU',
    action: `${B}/speech`,
    method: 'POST',
  });
  g.say('Anything else I can help you with?');

  res.type('text/xml').send(twiml.toString());
}

module.exports = { handleVoice, handleSpeech };
