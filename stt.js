const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

async function transcribe(audioBuffer) {
  // ElevenLabs ASR endpoint; adjust model name if needed
  const result = await client.speech.recognize(audioBuffer, {
    model: 'eleven_monolingual_v1',
  });
  return result.text.trim();
}

module.exports = { transcribe };
