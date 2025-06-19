const twilio = require('twilio');
const VoiceResponse = require('twilio/lib/twiml/VoiceResponse');
const { transcribeAudio } = require('./stt.js');
const { handleInput } = require('./flow.js');
const { synthesizeSpeech } = require('./tts.js');
const axios = require('axios');
const fs = require('fs').promises;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function handleIncomingCall(req, res) {
  const twiml = new VoiceResponse();
  twiml.play('https://your-heroku-app.herokuapp.com/public/introduction.mp3');
  twiml.record({
    action: '/voice/callback',
    method: 'POST',
    timeout: 10,
    transcribe: false,
    recordingStatusCallback: '/voice/recording-status',
  });
  res.type('text/xml');
  res.send(twiml.toString());
}

async function handleRecordingStatus(req, res) {
  const recordingUrl = req.body.RecordingUrl;
  try {
    // Download recording to a temporary file
    const response = await axios.get(recordingUrl, { responseType: 'stream' });
    const tempFilePath = `temp_recording_${Date.now()}.mp3`;
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const transcription = await transcribeAudio(tempFilePath);
    const responseText = await handleInput(transcription);
    const audioPath = await synthesizeSpeech(responseText);

    const twiml = new VoiceResponse();
    twiml.play(`https://${req.headers.host}/${audioPath}`);
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 10,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());

    // Clean up temporary file
    await fs.unlink(tempFilePath);
  } catch (error) {
    console.error('Recording Status Error:', error);
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna' }, "I'm sorry, I didn't catch that. Could you say it again?");
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 10,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());
  }
}

async function makeOutboundCall(toNumber) {
  try {
    const call = await client.calls.create({
      url: `https://smartvoiceai-fa77bfa7f137.herokuapp.com/voice`,
      to: toNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    console.log('Outbound Call Initiated:', call.sid);
  } catch (error) {
    console.error('Outbound Call Error:', error);
  }
}

module.exports = { handleIncomingCall, handleRecordingStatus, makeOutboundCall };