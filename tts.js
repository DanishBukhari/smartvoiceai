const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs');

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function synthesizeSpeech(text, voiceId = 'aEO01A4wXwd1O8GPgGlF') {
  try {
    const audio = await client.textToSpeech({
      voiceId: voiceId,
      text: text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    });
    const outputPath = `output_${Date.now()}.mp3`;
    const writer = fs.createWriteStream(outputPath);
    audio.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('ElevenLabs Error:', error);
    return null;
  }
}

module.exports = { synthesizeSpeech };