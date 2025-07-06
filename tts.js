//convert the text to speech
const https = require('https');
const path = require('path');
const fs = require('fs');

// Add simple caching
const responseCache = new Map();

// Pre-generate common responses on startup
const commonPhrases = [
  "What's your full name, please?",
  "Could I have your email address?",
  "What's your phone number?",
  "And your full address?",
  "Do you have any hot water at all?",
  "Is it gas, electric, or solar?",
  "What's happening with your toilet?",
  "Would you like to book an appointment for this?"
];

// Add this to your existing tts.js file
const preGeneratedPhrases = [
  "What's your full name, please?",
  "Could I have your email address?",
  "What's your phone number?",
  "And your full address?",
  "Would you like to book an appointment for this?",
  "Great! Any special instructions?",
  "All set! Your appointment is booked.",
  "Do you have any hot water at all?",
  "Is it gas, electric, or solar?",
  "What's happening with your toilet?",
  "Is it still leaking or has it stopped?",
  "How many toilets or showers do you have?"
];

// Pre-generated audio files mapping
const preGeneratedFiles = new Map();

// Pre-generate these phrases when server starts
async function preloadCommonResponses() {
  const commonPhrases = [
    "What's your full name, please?",
    "Could I have your email address?",
    "What's your phone number?",
    "And your full address?",
    "Would you like to book an appointment?",
    "I didn't catch that. Could you please repeat?",
    "Thank you for calling. How can I help you today?"
  ];
  
  for (const phrase of commonPhrases) {
    try {
      const audioBuffer = await synthesizeBuffer(phrase);
      const filename = `pregen_${phrase.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
      const outPath = path.join(__dirname, 'public', filename);
      await fs.promises.writeFile(outPath, audioBuffer);
      console.log(`Pre-generated: ${filename}`);
    } catch (error) {
      console.error(`Failed to pre-generate: ${phrase}`, error);
    }
  }
}

// Call this when server starts
preloadCommonResponses();

async function preloadCoreResponses() {
  console.log('🚀 Starting pre-generation of core responses...');
  
  for (const phrase of preGeneratedPhrases) {
    try {
      console.log(`Generating: ${phrase.substring(0, 30)}...`);
      
      // Generate audio directly without calling synthesizeBuffer to avoid recursion
      const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
      const postData = JSON.stringify({
        text: phrase,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { 
          stability: 0.2,
          similarity_boost: 0.7 
        },
        optimize_streaming_latency: 6,
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
        timeout: 2500,
      };

      const audioBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const req = https.request(options, (res) => {
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('TTS timeout')));
        req.write(postData);
        req.end();
      });
      
      // Save to file with a simple name
      const fileName = `pregen_${phrase.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}.mp3`;
      const filePath = path.join(__dirname, 'public', fileName);
      await fs.promises.writeFile(filePath, audioBuffer);
      
      // Store mapping
      preGeneratedFiles.set(phrase.toLowerCase().trim(), fileName);
      console.log(`✅ Generated: ${fileName}`);
      
    } catch (error) {
      console.log(`❌ Failed to generate: ${phrase.substring(0, 30)}...`);
    }
  }
  
  console.log('🎉 Pre-generation complete!');
  console.log('Generated files:', Array.from(preGeneratedFiles.values()));
}

// Modify your existing synthesizeBuffer function
async function synthesizeBuffer(text) {
  const cacheKey = text.toLowerCase().trim();
  
  // Check pre-generated files first
  if (preGeneratedFiles.has(cacheKey)) {
    console.log('🎯 Using pre-generated audio');
    const fileName = preGeneratedFiles.get(cacheKey);
    const filePath = path.join(__dirname, 'public', fileName);
    return await fs.promises.readFile(filePath);
  }
  
  // Check regular cache
  if (responseCache.has(cacheKey)) {
    console.log('TTS: Using cached response');
    return responseCache.get(cacheKey);
  }

  const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
  const postData = JSON.stringify({
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { 
      stability: 0.2, // Lower for faster generation
      similarity_boost: 0.7 
    },
    optimize_streaming_latency: 4, // Maximum speed optimization
    output_format: 'mp3_44100_128', // Faster encoding
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
    timeout: 2500, // Reduced timeout
  };

  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        responseCache.set(cacheKey, buffer);
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

module.exports = { synthesizeBuffer, preloadCommonResponses, preloadCoreResponses };
