// // tts.js - Updated for Deepgram SDK v3

// const { createClient } = require('@deepgram/sdk');
// const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// async function synthesizeBuffer(text) {
//   try {
//     const { result, error } = await deepgram.speak.text(
//       { text },
//       { model: 'aura-asteria-en', encoding: 'linear16', container: 'wav' }
//     );
//     if (error) throw error;
    
//     const stream = await result;
//     if (!stream) {
//       throw new Error('No stream returned from Deepgram');
//     }
    
//     const reader = stream.getReader();
//     const buffers = [];
//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       if (value) buffers.push(value);
//     }
    
//     return Buffer.concat(buffers);
//   } catch (error) {
//     console.error('Deepgram TTS error:', error);
//     throw error;
//   }
// }

// module.exports = { synthesizeBuffer };