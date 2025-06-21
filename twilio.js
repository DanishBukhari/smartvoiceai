const twilio = require('twilio');
const axios = require('axios');
const { VoiceResponse } = twilio.twiml;
const { transcribe } = require('./stt');
const { handleInput } = require('./flow');
const { synthesizeBuffer } = require('./tts');

const APP_URL = process.env.APP_URL;

function getBaseUrl(req) {
  return APP_URL || `${req.protocol}://${req.get('Host')}`;
}

// 1) Incoming call → play intro, then RECORD 5s (or until silence)
async function handleIncomingCall(req, res) {
  const base = getBaseUrl(req);
  const twiml = new VoiceResponse();

  twiml.play(`${base}/Introduction.mp3`);
  twiml.say('Hi, I’m Robyn from Usher Fix Plumbing. After the beep, please tell me how I can help.');
  twiml.record({
    action: `${base}/recording`,
    method: 'POST',
    maxLength: 5,
    finishOnKey: '',
    playBeep: true,
    timeout: 1,
  });
  // If no input:
  twiml.say("Sorry, I didn't hear anything. Let's try again.");
  twiml.redirect('/voice');

  res.type('text/xml').send(twiml.toString());
}

// 2) Recording webhook: Twilio sends us RecordingUrl
async function handleRecording(req, res) {
  const recordingUrl = req.body.RecordingUrl + '.mp3';
  console.log('Received Recording:', recordingUrl);

  // 2a) Fetch recording, transcribe via ElevenLabs
  let transcription = '';
  try {
    const audioResp = await axios.get(recordingUrl, { responseType: 'arraybuffer' });
    transcription = await transcribe(audioResp.data);
    console.log('Transcription:', transcription);
  } catch (e) {
    console.error('STT error:', e);
    transcription = '';
  }

  // 2b) Run through your NLP/flow to get Robyn’s reply text
  let reply;
  try {
    reply = transcription
      ? await handleInput(transcription)
      : "Sorry, I didn't catch that. Could you please repeat?";
  } catch (e) {
    console.error('Flow error:', e);
    reply = "Sorry, something went wrong. Let's try again.";
  }
  console.log('Reply text:', reply);

  // 2c) Synthesize TTS into a Buffer (with proper Content-Length)
  let audioBuffer;
  try {
    audioBuffer = await synthesizeBuffer(reply);
  } catch (e) {
    console.error('TTS Buffer error:', e);
    audioBuffer = null;
  }

  // 2d) Respond TwiML: play the buffer, then RECORD again
  const twiml = new VoiceResponse();
  if (audioBuffer) {
    // Twilio <Play> supports base64-encoded data URIs up to ~1MB
    const b64 = audioBuffer.toString('base64');
    twiml.play(`data:audio/mpeg;base64,${b64}`);
  } else {
    twiml.say(reply);
  }
  // Loop back into recording for the next turn
  twiml.record({
    action: `${getBaseUrl(req)}/recording`,
    method: 'POST',
    maxLength: 5,
    finishOnKey: '',
    playBeep: true,
    timeout: 1,
  });
  twiml.say("Thank you. Goodbye.");
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
}

module.exports = { handleIncomingCall, handleRecording };
