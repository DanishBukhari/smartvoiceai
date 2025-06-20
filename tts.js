const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

function addBackgroundNoise(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter('aecho=0.8:0.9:1000:0.3')
      .save(outputPath)
      .on('end', () => {
        console.log('addBackgroundNoise: Noise added', outputPath);
        resolve();
      })
      .on('error', (err) => {
        console.error('addBackgroundNoise: FFmpeg error', err.message, err.stack);
        reject(err);
      });
  });
}

async function synthesizeSpeech(text, voiceId = 'LXy8KWda5yk1Vw6sEV6w') {
  console.log('synthesizeSpeech: Called with text', text);
  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text: text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });
    const tempPath = `temp_${Date.now()}.mp3`;
    await fs.writeFile(tempPath, Buffer.from(audio));
    console.log('synthesizeSpeech: Audio generated', tempPath);

    const outputPath = `public/output_${Date.now()}.mp3`;
    await addBackgroundNoise(tempPath, outputPath);
    await fs.unlink(tempPath);
    console.log('synthesizeSpeech: Final audio with noise', outputPath);
    return outputPath;
  } catch (error) {
    console.error('synthesizeSpeech: ElevenLabs error', error.message, error.stack);
    return null;
  }
}

module.exports = { synthesizeSpeech };