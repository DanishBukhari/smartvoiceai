const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput } = require('./flow');
const { synthesizeBuffer } = require('./tts');

// Base URL override if needed
const APP_URL = process.env.APP_URL;
function baseUrl(req) {
  return APP_URL || `${req.protocol}://${req.get('Host')}`;
}

// 1) Inbound call → play intro inside a Gather
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
  twiml.redirect('/voice'); // retry on silence
  res.type('text/xml').send(twiml.toString());
}

// 2) Gather → STT result → NLP → inline TTS → reopen Gather
async function handleSpeech(req, res) {
  const userText = req.body.SpeechResult || '';
  console.log('User said:', userText);

  let reply;
  try {
    reply = await handleInput(userText);
  } catch (e) {
    console.error('NL error:', e);
    reply = "Sorry, I'm having trouble. Could you please repeat that?";
  }
  console.log('Reply:', reply);

  // Synthesize ElevenLabs TTS into a Buffer
  let audioBuffer;
  try {
    audioBuffer = await synthesizeBuffer(reply);
  } catch (e) {
    console.error('TTS error:', e);
  }

  const twiml = new VoiceResponse();
  if (audioBuffer) {
    const b64 = audioBuffer.toString('base64');
    // Inline data URI; Twilio will play it immediately
    twiml.play(`data:audio/mpeg;base64,${b64}`);
  } else {
    twiml.say(reply);
  }

  // Reopen Gather for the next turn
  const g = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'en-AU',
    action: `${baseUrl(req)}/speech`,
    method: 'POST',
  });
  g.say('Anything else I can help you with?');

  res.type('text/xml').send(twiml.toString());
}

module.exports = { handleVoice, handleSpeech };
