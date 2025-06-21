const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Streams ElevenLabs TTS directly to Twilio
async function streamTTS(req, res) {
  const text = req.query.text || '';
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';  // your preferred ElevenLabs voice

  res.setHeader('Content-Type', 'audio/mpeg');
  try {
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });
    // Pipe ElevenLabs HTTP stream straight into Twilio
    audioStream.pipe(res);
  } catch (err) {
    console.error('TTS streaming error:', err);
    res.status(500).end();
  }
}

module.exports = { streamTTS };
