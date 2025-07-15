//convert the text to speech
// const https = require('https');
// const path = require('path');
// const fs = require('fs');
// const crypto = require('crypto');
// const DYNAMIC_TTS_LOG = path.join(__dirname, 'tts-dynamic.log');

// Add simple caching
// const responseCache = new Map();

// Enhanced pre-generation with many more common phrases
// const preGeneratedPhrases = [
//   // Core booking phrases
//   "What's your full name, please?",
//   "Could I have your email address?",
//   "What's your phone number?",
//   "And your full address?",
//   "Would you like to book an appointment?",
//   "I didn't catch that. Could you please repeat?",
//   "Thank you for calling. How can I help you today?",
//   // Diagnostic questions
//   "Do you have any hot water at all?",
//   "Is it gas, electric, or solar?",
//   "Any leaks—steady drip or fast?",
//   "How old is it—under 10 years or over?",
//   "What size tank do you have?",
//   "Is the water shut off or still running?",
//   "Is the pump standalone or submersible?",
//   "Is water dripping inside right now?",
//   "What would you like us to quote—new installation, repair, or inspection?",
//   // Booking flow phrases
//   "When would you like your appointment?",
//   "When would you like your appointment? Our day starts at 7 AM UTC.",
//   "Does that work for you?",
//   "Great! Any special instructions?",
//   "Great! Any special instructions, like gate codes or security details?",
//   "Perfect! Your appointment is booked.",
//   "What time works best for you?",
//   "Morning or afternoon?",
//   "I have a slot available at",
//   "Would that time work for you?",
//   "Excellent! I'll book you in for",
//   "Your appointment is confirmed for",
//   // Confirmation phrases
//   "Thank you for booking with us.",
//   "We'll see you then.",
//   "Is there anything else I can help you with?",
//   "Have a great day!",
//   "Goodbye!",
//   // Error handling
//   "I'm sorry, I didn't understand that.",
//   "Could you please speak more clearly?",
//   "Let me try that again.",
//   "One moment please.",
//   "I'm having trouble understanding.",
//   "I'm sorry, I'm taking too long to respond. Please try again.",
//   "I'm sorry, there was an error. Please try again.",
//   "I'm sorry, I'm having technical difficulties. Please try again.",
//   // Issue identification
//   "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
//   "Is it still leaking or has it stopped?",
//   "How many toilets or showers do you have?",
//   "Has the water been shut off, or is it still running?",
//   "Is there flooding inside or outside?",
//   "Is the pump standalone or submersible?",
//   "Does it supply toilets, laundry, or garden?",
//   "Are those fixtures still getting water?",
//   "Is water dripping inside right now?",
//   "Is the ceiling bulging or sagging?",
//   "Can you describe the issue or what you need?",
//   // Time preferences
//   "Would you prefer morning or afternoon?",
//   "What time works best for you?",
//   "I have availability in the morning.",
//   "I have availability in the afternoon.",
//   "Let me check our available slots.",
//   // Special instructions
//   "Any special instructions for our technician?",
//   "Is there anything specific we should know?",
//   "Do you have any pets we should be aware of?",
//   "Is there a gate code or special access?",
//   // Pricing and quotes
//   "I can provide you with a quote for that.",
//   "The cost will depend on the specific issue.",
//   "Would you like a quote for the repair?",
//   "I'll need to assess the situation first.",
//   // Emergency phrases
//   "Is this an emergency?",
//   "Is water currently flooding?",
//   "Do you need immediate assistance?",
//   "I can prioritize this for you.",
//   "This sounds urgent. Would you like me to book an emergency appointment for you?",
//   // Follow-up phrases
//   "We'll call you to confirm.",
//   "You'll receive a confirmation text.",
//   "Our technician will call when on the way.",
//   "Is this the best number to reach you?",
//   // Service types
//   "Are you looking for repair or replacement?",
//   "Is this for residential or commercial?",
//   "Do you need installation or just repair?",
//   "Is this a new installation?",
//   // Location phrases
//   "What suburb are you located in?",
//   "Is this a house or apartment?",
//   "Do you have easy access to the area?",
//   "Is there parking available?",
//   // Payment phrases
//   "We accept cash, card, or bank transfer.",
//   "Payment is due on completion.",
//   "We can provide an invoice.",
//   "Do you have any payment preferences?",
//   // Additional booking/confirmation/error phrases
//   "Okay, how else can I assist you today?",
//   "No worries! When would you prefer instead?",
//   "All set! Your appointment is booked. Anything else I can help with?",
//   "Sorry, no slots are available today. Would you like to try another day?",
//   "Sorry, I can't access the calendar right now. Please try again later.",
//   "I'm sorry, I couldn't book the appointment due to a technical issue. Please try calling back later or contact us directly.",
//   "It seems like you're not responding. Is there anything else I can help you with today?",
//   "Yep, I'm an AI assistant for Usher Fix Plumbing! How can I help you?"
// ];

// Pre-generated audio files mapping
// const preGeneratedFiles = new Map();

// Pre-generate these phrases when server starts
// async function preloadCommonResponses() {
//   console.log('🚀 Starting enhanced pre-generation...');
//   console.log(`📝 Will generate ${preGeneratedPhrases.length} audio files`);
  
//   let successCount = 0;
//   let failCount = 0;
  
//   for (const phrase of preGeneratedPhrases) {
//     try {
//       console.log(`🎵 Generating: ${phrase.substring(0, 40)}...`);
      
//       // Generate audio directly without calling synthesizeBuffer to avoid recursion
//       const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
//       const postData = JSON.stringify({
//         text: phrase,
//         model_id: 'eleven_multilingual_v2',
//         voice_settings: { 
//           stability: 0.2,
//           similarity_boost: 0.7 
//         },
//         optimize_streaming_latency: 6,
//       });

//       const options = {
//         hostname: 'api.elevenlabs.io',
//         path: `/v1/text-to-speech/${voiceId}/stream`,
//         method: 'POST',
//         headers: {
//           'xi-api-key': process.env.ELEVENLABS_API_KEY,
//           'Content-Type': 'application/json',
//           'Accept': 'audio/mpeg',
//           'Content-Length': Buffer.byteLength(postData),
//         },
//         timeout: 5000, // Increased timeout for pre-generation
//       };

//       const audioBuffer = await new Promise((resolve, reject) => {
//         const chunks = [];
//         const req = https.request(options, (res) => {
//           res.on('data', (c) => chunks.push(c));
//           res.on('end', () => resolve(Buffer.concat(chunks)));
//         });
//         req.on('error', reject);
//         req.on('timeout', () => reject(new Error('TTS timeout')));
//         req.write(postData);
//         req.end();
//       });
      
//       // Check if it's actually audio (not an error)
//       const asString = audioBuffer.toString('utf8');
//       if (asString.includes('quota_exceeded') || asString.includes('status') && asString.includes('message')) {
//         console.log(`❌ Quota exceeded, skipping: ${phrase.substring(0, 30)}...`);
//         failCount++;
//         continue;
//       }
      
//       // Save to file with a simple name
//       const fileName = `pregen_${phrase.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 25)}.mp3`;
//       const filePath = path.join(__dirname, 'public', fileName);
//       await fs.promises.writeFile(filePath, audioBuffer);
      
//       // Store mapping
//       preGeneratedFiles.set(phrase.toLowerCase().trim(), fileName);
//       successCount++;
//       console.log(`✅ Generated: ${fileName}`);
      
//       // Small delay to avoid overwhelming the API
//       await new Promise(resolve => setTimeout(resolve, 100));
      
//     } catch (error) {
//       console.log(`❌ Failed to generate: ${phrase.substring(0, 30)}...`);
//       failCount++;
//     }
//   }
  
//   console.log('🎉 Pre-generation complete!');
//   console.log(`✅ Success: ${successCount} files`);
//   console.log(`❌ Failed: ${failCount} files`);
//   console.log('📁 Generated files:', Array.from(preGeneratedFiles.values()));
// }

// // Call this when server starts
// preloadCommonResponses();

// // Add this function to pre-populate fast responses
// async function preloadFastPathResponses() {
//   const fastResponses = {
//     'toilet': "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
//     'hot water': "Do you have any hot water at all?",
//     'water': "Do you have any hot water at all?",
//     'leak': "Has the water been shut off, or is it still running?",
//     'pipe': "Has the water been shut off, or is it still running?",
//     'pump': "Is the pump standalone or submersible?",
//     'roof': "Is water dripping inside right now?",
//     'quote': "What would you like us to quote—new installation, repair, or inspection?"
//   };
  
//   // Pre-generate audio for these responses
//   for (const [keyword, response] of Object.entries(fastResponses)) {
//     try {
//       const audioBuffer = await synthesizeBuffer(response);
//       const fileName = `fast_${keyword}.mp3`;
//       const filePath = path.join(__dirname, 'public', fileName);
//       await fs.promises.writeFile(filePath, audioBuffer);
//       console.log(`✅ Pre-generated fast response: ${fileName}`);
//     } catch (error) {
//       console.error(`❌ Failed to pre-generate: ${keyword}`, error);
//     }
//   }
// }

// // Call this in your preloadCoreResponses function
// async function preloadCoreResponses() {
//   console.log('🚀 Starting pre-generation...');
  
//   // Pre-generate fast responses first
//   await preloadFastPathResponses();
  
//   // Then pre-generate other responses
//   for (const phrase of preGeneratedPhrases) {
//     try {
//       console.log(`Generating: ${phrase.substring(0, 30)}...`);
      
//       // Generate audio directly without calling synthesizeBuffer to avoid recursion
//       const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
//       const postData = JSON.stringify({
//         text: phrase,
//         model_id: 'eleven_multilingual_v2',
//         voice_settings: { 
//           stability: 0.2,
//           similarity_boost: 0.7 
//         },
//         optimize_streaming_latency: 6,
//       });

//       const options = {
//         hostname: 'api.elevenlabs.io',
//         path: `/v1/text-to-speech/${voiceId}/stream`,
//         method: 'POST',
//         headers: {
//           'xi-api-key': process.env.ELEVENLABS_API_KEY,
//           'Content-Type': 'application/json',
//           'Accept': 'audio/mpeg',
//           'Content-Length': Buffer.byteLength(postData),
//         },
//         timeout: 2500,
//       };

//       const audioBuffer = await new Promise((resolve, reject) => {
//         const chunks = [];
//         const req = https.request(options, (res) => {
//           res.on('data', (c) => chunks.push(c));
//           res.on('end', () => resolve(Buffer.concat(chunks)));
//         });
//         req.on('error', reject);
//         req.on('timeout', () => reject(new Error('TTS timeout')));
//         req.write(postData);
//         req.end();
//       });
      
//       // Save to file with a simple name
//       const fileName = `pregen_${phrase.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}.mp3`;
//       const filePath = path.join(__dirname, 'public', fileName);
//       await fs.promises.writeFile(filePath, audioBuffer);
      
//       // Store mapping
//       preGeneratedFiles.set(phrase.toLowerCase().trim(), fileName);
//       console.log(`✅ Generated: ${fileName}`);
      
//     } catch (error) {
//       console.log(`❌ Failed to generate: ${phrase.substring(0, 30)}...`);
//     }
//   }
  
//   console.log('🎉 Pre-generation complete!');
//   console.log('Generated files:', Array.from(preGeneratedFiles.values()));
// }

// function hashText(text) {
//   return crypto.createHash('sha256').update(text).digest('hex');
// }

// async function synthesizeBuffer(text) {
//   const cacheKey = text.toLowerCase().trim();
  
//   // Check pre-generated files first
//   if (preGeneratedFiles.has(cacheKey)) {
//     console.log('🎯 Using pre-generated audio');
//     const fileName = preGeneratedFiles.get(cacheKey);
//     const filePath = path.join(__dirname, 'public', fileName);
//     return await fs.promises.readFile(filePath);
//   }
  
//   // Check dynamic cache (hashed filename)
//   const hash = hashText(text);
//   const dynamicFile = `dyn_${hash}.mp3`;
//   const dynamicPath = path.join(__dirname, 'public', dynamicFile);
//   if (fs.existsSync(dynamicPath)) {
//     console.log('🎯 Using cached dynamic TTS');
//     return await fs.promises.readFile(dynamicPath);
//   }
  
//   // Check regular cache
//   if (responseCache.has(cacheKey)) {
//     console.log('TTS: Using cached response');
//     return responseCache.get(cacheKey);
//   }

//   // Log dynamic TTS request
//   fs.appendFile(DYNAMIC_TTS_LOG, `${new Date().toISOString()}|${text}\n`, () => {});

//   // Optimize ElevenLabs settings for speed
//   const postData = JSON.stringify({
//     text,
//     model_id: 'eleven_multilingual_v2',
//     voice_settings: { 
//       stability: 0.1, // Very low for maximum speed
//       similarity_boost: 0.6 
//     },
//     optimize_streaming_latency: 6, // Maximum optimization
//     output_format: 'mp3_44100_128', // Faster encoding
//   });

//   const voiceId = 'LXy8KWda5yk1Vw6sEV6w';
//   const options = {
//     hostname: 'api.elevenlabs.io',
//     path: `/v1/text-to-speech/${voiceId}/stream`,
//     method: 'POST',
//     headers: {
//       'xi-api-key': process.env.ELEVENLABS_API_KEY,
//       'Content-Type': 'application/json',
//       'Accept': 'audio/mpeg',
//       'Content-Length': Buffer.byteLength(postData),
//     },
//     timeout: 2500, // Reduced timeout
//   };

//   return new Promise((resolve, reject) => {
//     const chunks = [];
//     const req = https.request(options, (res) => {
//       res.on('data', (c) => chunks.push(c));
//       res.on('end', () => {
//         const buffer = Buffer.concat(chunks);
//         // Check if buffer is actually audio or an error JSON
//         const asString = buffer.toString('utf8');
//         if (asString.includes('quota_exceeded') || (asString.includes('status') && asString.includes('message'))) {
//           console.error('❌ ElevenLabs quota exceeded or error');
//           reject(new Error('ElevenLabs quota exceeded or error'));
//         } else {
//           responseCache.set(cacheKey, buffer);
//           if (responseCache.size > 100) {
//             const firstKey = responseCache.keys().next().value;
//             responseCache.delete(firstKey);
//           }
//           // Save dynamic TTS to file
//           fs.promises.writeFile(dynamicPath, buffer).catch(() => {});
//           resolve(buffer);
//         }
//       });
//     });
//     req.on('error', (err) => {
//       console.error('❌ ElevenLabs error', err);
//       reject(err);
//     });
//     req.on('timeout', () => {
//       console.error('❌ ElevenLabs timeout');
//       reject(new Error('ElevenLabs timeout'));
//     });
//     req.write(postData);
//     req.end();
//   });
// }

// module.exports = { synthesizeBuffer, preloadCommonResponses, preloadCoreResponses };
// tts.js - Corrected Deepgram import and usage

const { DeepgramClient } = require('@deepgram/sdk');
const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

async function synthesizeBuffer(text) {
  try {
    const { stream } = await deepgram.speak.request(
      { text },
      { model: 'aura-asteria-en' }  // Adjust model as needed for voice
    );
    
    const buffers = [];
    for await (const chunk of stream) {
      buffers.push(chunk);
    }
    
    return Buffer.concat(buffers);
  } catch (error) {
    console.error('Deepgram TTS error:', error);
    throw error;
  }
}

module.exports = { synthesizeBuffer };
