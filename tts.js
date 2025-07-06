//convert the text to speech
const https = require('https');

// Add simple caching
const responseCache = new Map();

async function synthesizeBuffer(text) {
  // Check cache first
  const cacheKey = text.toLowerCase().trim();
  if (responseCache.has(cacheKey)) {
    console.log('TTS: Using cached response');
    return responseCache.get(cacheKey);
  }

  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
  const postData = JSON.stringify({
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { 
      stability: 0.3, // Lower stability for faster generation
      similarity_boost: 0.75 
    },
    // Add optimization settings
    optimize_streaming_latency: 4, // Optimize for speed
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
    // Add timeout
    timeout: 3000, // Reduced timeout for faster fallback
  };

  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Cache the result
        responseCache.set(cacheKey, buffer);
        // Limit cache size
        if (responseCache.size > 100) {
          const firstKey = responseCache.keys().next().value;
          responseCache.delete(firstKey);
        }
        resolve(buffer);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('TTS timeout')));
    req.write(postData);
    req.end();
  });
}

module.exports = { synthesizeBuffer };
