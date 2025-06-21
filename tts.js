const https = require('https');

async function synthesizeBuffer(text) {
  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
  const postData = JSON.stringify({
    text,
    model_id: 'eleven_multilingual_v2', // or v3 if available
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  const options = {
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${voiceId}/stream`,
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { synthesizeBuffer };
