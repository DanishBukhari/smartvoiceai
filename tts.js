const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');


const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});


async function addBackgroundNoise(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter('aecho=0.8:0.9:1000:0.3') // Adds a subtle echo effect; adjust as needed
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}
await addBackgroundNoise('introduction.mp3')

// const fs = require('fs').promises;

async function synthesizeSpeech(text, voiceId = 'LXy8KWda5yk1Vw6sEV6w') {
  try {
    const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
    const client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    const audio = await client.textToSpeech.convert(voiceId, {
      text: text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });
    const outputPath = `output_${Date.now()}.mp3`;
    await fs.writeFile(outputPath, Buffer.from(audio));
    return outputPath;
  } catch (error) {
    console.error('ElevenLabs Error:', error);
    return null;
  }
}

// module.exports = { synthesizeSpeech };

module.exports = { synthesizeSpeech };