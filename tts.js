const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

async function synthesizeBuffer(text) {
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
  const stream = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: 'eleven_monolingual_v1',
    voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
  });
  // Buffer the entire stream
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { synthesizeBuffer };
