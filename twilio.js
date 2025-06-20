const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;
const { transcribeAudio } = require('./stt');
const { handleInput } = require('./flow');
const axios = require('axios');
const fs = require('fs');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function handleIncomingCall(req, res) {
  console.log('handleIncomingCall called');
  const twiml = new VoiceResponse();
  twiml.play('https://smartvoiceai-fa77bfa7f137.herokuapp.com/public/introduction.mp3');
  twiml.record({
    action: '/voice/callback',
    method: 'POST',
    timeout: 30,
    transcribe: false,
    recordingStatusCallback: '/voice/recording-status',
  });
  res.type('text/xml');
  res.send(twiml.toString());
  console.log('TwiML sent:', twiml.toString());
}

async function handleRecordingStatus(req, res) {
  console.log('handleRecordingStatus called');
  const recordingUrl = req.body.RecordingUrl;
  console.log('Recording URL:', recordingUrl);
  try {
    const { synthesizeSpeech } = require('./tts');
    const response = await axios.get(recordingUrl, { responseType: 'stream' });
    const tempFilePath = `temp_recording_${Date.now()}.mp3`;
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log('Recording downloaded:', tempFilePath);

    const transcription = await transcribeAudio(tempFilePath);
    console.log('Transcription:', transcription);
    const responseText = await handleInput(transcription);
    console.log('Response Text:', responseText);
    const audioPath = await synthesizeSpeech(responseText);
    console.log('Audio Path:', audioPath);

    const twiml = new VoiceResponse();
    twiml.play(`https://${req.headers.host}/${audioPath}`);
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 30,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('TwiML sent:', twiml.toString());

    fs.unlinkSync(tempFilePath);
    console.log('Temporary file deleted:', tempFilePath);
  } catch (error) {
    console.error('Recording Status Error:', error);
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna' }, "I'm sorry, I didn't catch that. Could you say it again?");
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 30,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('Error TwiML sent:', twiml.toString());
  }
}

async function makeOutboundCall(toNumber) {
  console.log('makeOutboundCall called for:', toNumber);
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