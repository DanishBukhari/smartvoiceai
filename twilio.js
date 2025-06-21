const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput } = require('./flow');

// Optional override if your APP_URL isn’t coming through correctly
const APP_URL = process.env.APP_URL;  

function baseUrl(req) {
  return APP_URL || `${req.protocol}://${req.get('Host')}`;
}

// 1) Inbound call → Play intro *inside* a Gather
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

  // If no response:
  twiml.redirect('/voice');

  res.type('text/xml').send(twiml.toString());
}

// 2) Gather → STT result → NLP → stream TTS → reopen gather
async function handleSpeech(req, res) {
  const B = baseUrl(req);
  const userText = req.body.SpeechResult || '';
  console.log('User said:', userText);

  let reply;
  try {
    reply = await handleInput(userText);
    console.log('Reply:', reply);

    const ttsUrl = `${B}/tts-stream?text=${encodeURIComponent(reply)}`;
    console.log('TTS URL:', ttsUrl); // Log the exact URL

    const twiml = new VoiceResponse();
    twiml.play({ url: ttsUrl });
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'en-AU',
      action: `${B}/speech`,
      method: 'POST',
    });
    twiml.say('Anything else I can help you with?');
    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Error in handleSpeech:', error);
    const twiml = new VoiceResponse();
    twiml.say("Sorry, I'm having trouble right now. Could you repeat that?");
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'en-AU',
      action: `${B}/speech`,
      method: 'POST',
    });
    res.type('text/xml').send(twiml.toString());
  }
}
module.exports = { handleVoice, handleSpeech };
