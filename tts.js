// tts.js - Corrected to use Deepgram TTS without stream iterator issue

const { DeepgramClient } = require('@deepgram/sdk');
const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

async function synthesizeBuffer(text) {
  try {
    const response = await deepgram.speak.request(
      { text },
      { model: 'aura-2-andromeda-en' }  // Adjust model as needed
    );
    const stream = response.getStream();
    if (!stream) {
      throw new Error('No stream returned from Deepgram');
    }
    
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