// tts.js
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Buffer the entire MP3 so we can set Content-Length
async function streamTTS(req, res) {
  const text = req.query.text || '';
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';

  try {
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });

    // Accumulate chunks
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    });
    audioStream.on('error', (err) => {
      console.error('TTS streaming error:', err);
      res.status(500).end();
    });

  } catch (err) {
    console.error('TTS setup error:', err);
    res.status(500).end();
  }
}

module.exports = { streamTTS };
