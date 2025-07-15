// tts.js - Fixed stream reading with events

const { DeepgramClient } = require('@deepgram/sdk');
const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

async function synthesizeBuffer(text) {
  try {
    const response = await deepgram.speak.request(
      { text },
      { model: 'aura-asteria-en' }  // Correct model name
    );
    const stream = response.getStream();
    if (!stream) {
      throw new Error('No stream returned from Deepgram');
    }
    
    return new Promise((resolve, reject) => {
      const buffers = [];
      stream.on('data', (chunk) => buffers.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(buffers)));
      stream.on('error', reject);
    });
  } catch (error) {
    console.error('Deepgram TTS error:', error);
    throw error;
  }
}

module.exports = { synthesizeBuffer };