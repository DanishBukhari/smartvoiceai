const { DeepgramClient } = require('@deepgram/sdk');
const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

async function synthesizeBuffer(text) {
try {
const response = await deepgram.speak.request(
{ text },
{ model: 'aura-asteria-en' }  // Adjust model as needed
);
const stream = await response.getStream();
if (!stream) {
throw new Error('No stream returned from Deepgram');
}

const reader = stream.getReader();
const buffers = [];
while (true) {
const { done, value } = await reader.read();
if (done) break;
if (value) buffers.push(value);
}

return Buffer.concat(buffers);
} catch (error) {
console.error('Deepgram TTS error:', error);
throw error;
}
}

module.exports = { synthesizeBuffer };