// tts.js - Fixed Deepgram constructor

const { DeepgramClient } = require('@deepgram/sdk');
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

async function synthesizeBuffer(text) {
  try {
    const { stream } = await deepgram.speak.request(
      { text },
      { model: 'aura-2-andromeda-en' }  // Adjust model as needed for voice
    );
    
    const buffers = [];
    for await (const chunk of stream) {
      buffers.push(chunk);
    }
    
    return Buffer.concat(buffers);
  } catch (error) {
    console.error('Deepgram TTS error:', error);
    throw error;
  }
}

module.exports = { synthesizeBuffer };