const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;
const { transcribeAudio } = require('./stt');
const { handleInput } = require('./flow');
const axios = require('axios');
const fs = require('fs');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function handleIncomingCall(req, res) {
  console.log('handleIncomingCall: Function called');
  const twiml = new VoiceResponse();
  twiml.play('https://smartvoiceai-fa77bfa7f137.herokuapp.com/public/Introduction.mp3');
  twiml.record({
    action: '/voice/callback',
    method: 'POST',
    timeout: 60,
    transcribe: false,
    recordingStatusCallback: '/voice/recording-status',
  });
  res.type('text/xml');
  res.send(twiml.toString());
  console.log('handleIncomingCall: TwiML sent', twiml.toString());
}

async function handleRecordingStatus(req, res) {
  console.log('handleRecordingStatus: Function called');
  const recordingUrl = req.body.RecordingUrl;
  const callSid = req.body.CallSid;
  console.log('handleRecordingStatus: Recording URL', recordingUrl, 'Call SID', callSid);
  try {
    console.log('handleRecordingStatus: Downloading recording');
    const response = await axios.get(recordingUrl, { responseType: 'stream', auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN } });
    const recordingPath = `public/recording_${callSid}_${Date.now()}.mp3`;
    const writer = fs.createWriteStream(recordingPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log('handleRecordingStatus: Recording saved', recordingPath);

    console.log('handleRecordingStatus: Transcribing audio');
    const transcription = await transcribeAudio(recordingPath);
    fs.writeFileSync(`public/transcript_${callSid}_${Date.now()}.txt`, transcription);
    console.log('handleRecordingStatus: Transcription', transcription, 'Saved to file');

    console.log('handleRecordingStatus: Processing input');
    const responseText = await handleInput(transcription);
    console.log('handleRecordingStatus: Response text', responseText);

    console.log('handleRecordingStatus: Synthesizing speech');
    const { synthesizeSpeech } = require('./tts');
    const audioPath = await synthesizeSpeech(responseText);
    console.log('handleRecordingStatus: Audio path', audioPath);

    const twiml = new VoiceResponse();
    twiml.play(`https://${req.headers.host}/${audioPath}`);
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 60,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('handleRecordingStatus: TwiML sent', twiml.toString());
  } catch (error) {
    console.error('handleRecordingStatus: Error', error.message, error.stack);
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna' }, "I'm sorry, I didn't catch that. Could you say it again?");
    twiml.record({
      action: '/voice/callback',
      method: 'POST',
      timeout: 60,
      transcribe: false,
      recordingStatusCallback: '/voice/recording-status',
    });
    res.type('text/xml');
    res.send(twiml.toString());
    console.log('handleRecordingStatus: Error TwiML sent', twiml.toString());
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

module.exports = { handleIncomingCall, handleRecordingStatus, makeOutboundCall };