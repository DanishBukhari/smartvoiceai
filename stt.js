const { OpenAI } = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(audioFilePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      language: 'en',
    });
    return transcription.text || '';
  } catch (error) {
    console.error('OpenAI STT Error:', error);
    return '';
  }
}

module.exports = { transcribeAudio };