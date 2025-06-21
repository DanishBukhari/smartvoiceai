const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || '';
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w'; // Your voice ID

  try {
    // Get the audio stream from ElevenLabs
    const stream = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: 'eleven_monolingual_v3',
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // Set headers for streaming audio
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Pipe the stream directly to the response
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).end();
    });

    stream.on('end', () => {
      console.log('Stream ended');
      res.end();
    });
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).end();
  }
}

module.exports = { streamTTS };