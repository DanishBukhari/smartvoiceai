const { OpenAI } = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(audioFilePath) {
  console.log('transcribeAudio: Transcribing', audioFilePath);
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      language: 'en',
    });
    console.log('transcribeAudio: Transcription', transcription.text);
    return transcription.text || '';
  } catch (error) {
    console.error('transcribeAudio: OpenAI STT error', error.message, error.stack);
    return '';
  }
}

module.exports = { transcribeAudio };