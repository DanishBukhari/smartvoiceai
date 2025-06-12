const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs').promises;

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function synthesizeSpeech(text, voiceId = 'aEO01A4wXwd1O8GPgGlF') {
  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text: text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });
    const outputPath = `output_${Date.now()}.mp3`;
    await fs.writeFile(outputPath, audio);
    return outputPath;
  } catch (error) {
    console.error('ElevenLabs Error:', error);
    return null;
  }
}

module.exports = { synthesizeSpeech };