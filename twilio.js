const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput } = require('./flow');

async function handleIncomingCall(req, res) {
  const baseUrl = `${req.protocol}://${req.get('Host')}`;
  const twiml = new VoiceResponse();

  // Gather + Play intro + prompt
  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: `${baseUrl}/process-speech`,
    method: 'POST',
  });
  gather.play(`${baseUrl}/Introduction.mp3`);
  gather.say('Hi, I’m Robyn from Usher Fix Plumbing. How can I help you today?');

  // Fallback if no speech detected
  twiml.redirect('/voice');

  res.type('text/xml').send(twiml.toString());
}

async function processSpeech(req, res) {
  const baseUrl = `${req.protocol}://${req.get('Host')}`;
  const transcription = req.body.SpeechResult || '';
  console.log('User said:', transcription);

  // Get response text from your NLP flow
  let reply;
  try {
    reply = await handleInput(transcription);
  } catch (err) {
    console.error('Error in handleInput:', err);
    reply = "Sorry, I'm having trouble right now. Can you try again?";
  }
  console.log('Reply text:', reply);

  // Build TwiML that streams the TTS and re-opens the gather
  const twiml = new VoiceResponse();

  // Stream ElevenLabs audio
  twiml.play({ 
    url: `${baseUrl}/tts-stream?text=${encodeURIComponent(reply)}`
  });

  // Re-open a gather for the next user remark
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
