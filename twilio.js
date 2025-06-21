const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput } = require('./flow');

// Use an explicit APP_URL if you have one, otherwise build from incoming request
const APP_URL = "https://smartvoiceai-fa77bfa7f137.herokuapp.com";   // e.g. "https://your-heroku-app.herokuapp.com"

function getBaseUrl(req) {
  if (APP_URL) return APP_URL;
  // req.protocol is now trustworthy because of trust proxy
  return `${req.protocol}://${req.get('Host')}`;
}

async function handleIncomingCall(req, res) {
  const baseUrl = getBaseUrl(req);
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: `${baseUrl}/process-speech`,
    method: 'POST',
  });
  // Play your intro while listening
  gather.play(`${baseUrl}/Introduction.mp3`);
  gather.say('Hi, I’m Robyn from Usher Fix Plumbing. How can I help you today?');

  // If silence/fail → retry
  twiml.redirect('/voice');

  res.type('text/xml').send(twiml.toString());
}

async function processSpeech(req, res) {
  const baseUrl = getBaseUrl(req);
  const transcription = req.body.SpeechResult || '';
  console.log('User said:', transcription);

  let reply;
  try {
    reply = await handleInput(transcription);
  } catch (err) {
    console.error('handleInput error:', err);
    reply = "Sorry, I'm having trouble right now. Could you repeat that?";
  }
  console.log('Reply text:', reply);

  const twiml = new VoiceResponse();

  // Stream ElevenLabs TTS
  twiml.play({
    url: `${baseUrl}/tts-stream?text=${encodeURIComponent(reply)}`,
  });

  // Immediately reopen the gather for the next turn
  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: `${baseUrl}/process-speech`,
    method: 'POST',
  });
  gather.say('Anything else I can help you with?');

  res.type('text/xml').send(twiml.toString());
}

module.exports = {
  handleIncomingCall,
  processSpeech,
};
