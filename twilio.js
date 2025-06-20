const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;
const { handleInput } = require('./flow');
const { synthesizeSpeech } = require('./tts');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function handleIncomingCall(req, res) {
  console.log('handleIncomingCall: Function called');
  const twiml = new VoiceResponse();
  twiml.play('https://smartvoiceai-fa77bfa7f137.herokuapp.com/public/Introduction.mp3');
  twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: '/process-speech',
    method: 'POST',
  });
  res.type('text/xml');
  res.send(twiml.toString());
  console.log('handleIncomingCall: TwiML sent', twiml.toString());
}

async function processSpeech(req, res) {
  console.log('processSpeech: Function called');
  const transcription = req.body.SpeechResult;
  console.log('Transcription received:', transcription);

  try {
    const responseText = await handleInput(transcription);
    console.log('Response text:', responseText);
    const audioPath = await synthesizeSpeech(responseText);
    if (!audioPath) throw new Error('Failed to synthesize speech');
    const audioUrl = `https://${req.headers.host}/${audioPath}`;
    console.log('Audio URL:', audioUrl);

    const twiml = new VoiceResponse();
    twiml.play(audioUrl);
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      action: '/process-speech',
      method: 'POST',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('processSpeech: TwiML sent', twiml.toString());
  } catch (error) {
    console.error('processSpeech: Error', error.message, error.stack);
    const twiml = new VoiceResponse();
    twiml.say("I'm sorry, I didn't catch that. Could you say it again?");
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      action: '/process-speech',
      method: 'POST',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('processSpeech: Error TwiML sent', twiml.toString());
  }
}

async function makeOutboundCall(toNumber) {
  console.log('makeOutboundCall: Function called', toNumber);
  try {
    const call = await client.calls.create({
      url: `https://smartvoiceai-fa77bfa7f137.herokuapp.com/voice`,
      to: toNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    console.log('makeOutboundCall: Outbound call initiated', call.sid);
  } catch (error) {
    console.error('makeOutboundCall: Error', error.message, error.stack);
  }
}

module.exports = { handleIncomingCall, processSpeech, makeOutboundCall };