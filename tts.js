const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTTS(req, res) {
  const text = req.query.text || '';
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w'; // your preferred voice

  try {
    // 1) Ask ElevenLabs for a stream
    const stream = await client.textToSpeech.convert(voiceId, {
      text,
      modelId: 'eleven_monolingual_v3',    // v3 model
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
    });

    // 2) Buffer the entire response
    const buffers = [];
    for await (const chunk of stream) buffers.push(chunk);
    const audio = Buffer.concat(buffers);

    // 3) Send with correct headers so Twilio will play
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audio.length);
    res.end(audio);

  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).end();
  }
}

module.exports = { streamTTS };
