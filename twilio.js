// twilio.js
const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const { handleInput, stateMachine } = require('./flow');
const { synthesizeBuffer } = require('./tts');
const fs = require('fs');
const path = require('path');

function baseUrl(req) {
  // Use environment variable or fall back to request URL
  return process.env.APP_URL || `${req.protocol}://${req.get('Host')}`;
}

// Add state transition logging
function logStateTransition(from, to, reason) {
  console.log(`[STATE] ${from} -> ${to} (${reason})`);
}

async function handleVoice(req, res) {
  // Reset state for new call
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  const B = baseUrl(req);
  const twiml = new VoiceResponse();
  
  // Generate intro with Deepgram
  try {
    const introBuffer = await synthesizeBuffer("Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");
    const introFile = `intro_${Date.now()}.mp3`;
    const introPath = path.join(__dirname, 'public', introFile);
    await fs.promises.writeFile(introPath, introBuffer);
    twiml.play(`${B}/${introFile}`);
  } catch (e) {
    twiml.say({
      voice: 'alice',
      language: 'en-AU'
    }, "Hello, this is Robyn from Usher Fix Plumbing. How can I help you today?");
  }
  
  // Gather speech
  twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'en-AU',
    action: `${B}/speech`,
    method: 'POST',
    timeout: 15, // Give more time for initial response
  });

  // Generate goodbye with Deepgram
  try {
    const goodbyeBuffer = await synthesizeBuffer("Thank you for calling. Goodbye.");
    const goodbyeFile = `goodbye_${Date.now()}.mp3`;
    const goodbyePath = path.join(__dirname, 'public', goodbyeFile);
    await fs.promises.writeFile(goodbyePath, goodbyeBuffer);
    twiml.play(`${B}/${goodbyeFile}`);
  } catch (e) {
    twiml.say({
      voice: 'alice',
      language: 'en-AU'
    }, "Thank you for calling. Goodbye.");
  }

  res.type('text/xml').send(twiml.toString());
}

const firstResponseCache = new Map();

async function handleSpeech(req, res) {
  const startTime = Date.now();
  console.log('=== Speech Request Started ===');
  
  // Check environment variables
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('❌ Missing DEEPGRAM_API_KEY environment variable');
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY environment variable');
  }
  
  const B = baseUrl(req);
  const userText = req.body.SpeechResult || '';
  const speechConfidence = parseFloat(req.body.Confidence) || 0;
  
  console.log('Environment check - DEEPGRAM_API_KEY:', !!process.env.DEEPGRAM_API_KEY);
  console.log('Environment check - OPENAI_API_KEY:', !!process.env.OPENAI_API_KEY);
  
  // Check if this is a first interaction
  const isFirstInteraction = stateMachine.currentState === 'start';
  
  if (isFirstInteraction) {
    // Check fast-path cache for common first responses
    const cacheKey = userText.toLowerCase().trim();
    if (firstResponseCache.has(cacheKey)) {
      console.log('🚀 Using fast-path cached response');
      const cachedResponse = firstResponseCache.get(cacheKey);
      const twiml = new VoiceResponse();
      try {
        const buffer = await synthesizeBuffer(cachedResponse);
        const file = `fastpath_${Date.now()}.mp3`;
        const outPath = path.join(__dirname, 'public', file);
        await fs.promises.writeFile(outPath, buffer);
        twiml.play(`${B}/${file}`);
      } catch (e) {
        twiml.say({
          voice: 'alice',
          language: 'en-AU'
        }, "I'm sorry, I didn't understand that.");
      }
      twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        language: 'en-AU',
        action: `${B}/speech`,
        method: 'POST',
        timeout: 10,
      });
      console.log(`⏱️ Fast-path response time: ${Date.now() - startTime}ms`);
      return res.type('text/xml').send(twiml.toString());
    }
  }

  // Add timeout protection with proper race condition handling
  let responseSent = false;
  const requestTimeout = setTimeout(async () => {
    if (!responseSent) {
      console.error('❌ Request timeout - sending fallback response');
      responseSent = true;
      const twiml = new VoiceResponse();
      try {
        const buffer = await synthesizeBuffer("I'm sorry, I'm taking too long to respond. Please try again.");
        const file = `timeout_${Date.now()}.mp3`;
        const outPath = path.join(__dirname, 'public', file);
        await fs.promises.writeFile(outPath, buffer);
        twiml.play(`${req.protocol}://${req.get('Host')}/${file}`);
      } catch (e) {
        twiml.say({
          voice: 'alice',
          language: 'en-AU'
        }, "I'm sorry, I'm taking too long to respond. Please try again.");
      }
      twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        language: 'en-AU',
        action: `${req.protocol}://${req.get('Host')}/speech`,
        method: 'POST',
        timeout: 10,
      });
      res.type('text/xml').send(twiml.toString());
    }
  }, 8000); // 8-second timeout

  try {
    console.log('=== Speech Request ===');
    console.log('CallSid:', req.body.CallSid);
    console.log('SpeechResult:', req.body.SpeechResult);
    console.log('Confidence:', req.body.Confidence);
    console.log('Current State:', stateMachine.currentState);
    console.log('=====================');
    
    console.log('User said:', userText, 'Confidence:', speechConfidence);

    // Handle low confidence speech - don't reset conversation
    if (userText && speechConfidence < 0.3) {
      clearTimeout(requestTimeout);
      responseSent = true;
      const twiml = new VoiceResponse();
      try {
        const buffer = await synthesizeBuffer("I didn't catch that clearly. Could you please repeat?");
        const file = `repeat_${Date.now()}.mp3`;
        const outPath = path.join(__dirname, 'public', file);
        await fs.promises.writeFile(outPath, buffer);
        twiml.play(`${B}/${file}`);
      } catch (e) {
        twiml.say({
          voice: 'alice',
          language: 'en-AU'
        }, "I didn't catch that clearly. Could you please repeat?");
      }
      twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        language: 'en-AU',
        action: `${B}/speech`,
        method: 'POST',
        timeout: 10,
      });
      
      return res.type('text/xml').send(twiml.toString());
    }

    // Add timing logs
    const nlpStart = Date.now();
    let reply;
    try {
      console.log('🔄 Calling handleInput...');
      reply = await handleInput(userText);
      console.log('✅ handleInput completed, reply:', reply);
    } catch (e) {
      console.error('❌ NLP error:', e);
      reply = "Sorry, I'm having trouble understanding. Could you please repeat that?";
    }
    const nlpTime = Date.now() - nlpStart;
    console.log(`NLP processing time: ${nlpTime}ms`);

    // Generate audio with better timeout protection
    let audioBuffer;
    let filename;
    try {
      console.log('🔄 Starting TTS generation...');
      // Match the timeout with tts.js (4 seconds)
      const ttsPromise = synthesizeBuffer(reply);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TTS timeout')), 2000)
      );
      
      audioBuffer = await Promise.race([ttsPromise, timeoutPromise]);
      console.log('✅ TTS generation completed, buffer size:', audioBuffer?.length);
      if (audioBuffer && audioBuffer.length > 0) {
        const callSid = req.body.CallSid || Date.now().toString();
        filename = `${callSid}.mp3`;
        const outPath = path.join(__dirname, 'public', filename);
        // Ensure public directory exists
        const publicDir = path.dirname(outPath);
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        await fs.promises.writeFile(outPath, audioBuffer);
        console.log('✅ Audio file saved:', filename);
      } else {
        throw new Error('Empty audio buffer');
      }
    } catch (e) {
      console.error('❌ TTS error:', e);
      filename = null;
    }

    // Create TwiML response
    const twiml = new VoiceResponse();
    
    if (filename) {
      console.log('🎵 Using generated audio file:', filename);
      twiml.play(`${B}/${filename}`);
    } else {
      console.log('🔤 Using Twilio TTS fallback');
      // Use Twilio TTS as fallback
      twiml.say({
        voice: 'alice',
        language: 'en-AU'
      }, reply);
    }

    // Add gather with better timeout handling
    twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'en-AU',
      action: `${B}/speech`,
      method: 'POST',
      timeout: 10,
    });

    const totalTime = Date.now() - startTime;
    console.log(`=== Total response time: ${totalTime}ms ===`);
    
    clearTimeout(requestTimeout); // Clear timeout on success
    if (!responseSent) {
      responseSent = true;
      console.log('📤 Sending TwiML response...');
      res.type('text/xml').send(twiml.toString());
      console.log('✅ Response sent successfully');
    }
    
  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('❌ Speech handler error:', error);
    console.error('Error stack:', error.stack);
    
    if (!responseSent) {
      responseSent = true;
      const twiml = new VoiceResponse();
      try {
        const buffer = await synthesizeBuffer("I'm sorry, there was an error. Please try again.");
        const file = `error_${Date.now()}.mp3`;
        const outPath = path.join(__dirname, 'public', file);
        await fs.promises.writeFile(outPath, buffer);
        twiml.play(`${req.protocol}://${req.get('Host')}/${file}`);
      } catch (e) {
        twiml.say({
          voice: 'alice',
          language: 'en-AU'
        }, "I'm sorry, there was an error. Please try again.");
      }
      twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        language: 'en-AU',
        action: `${req.protocol}://${req.get('Host')}/speech`,
        method: 'POST',
        timeout: 10,
      });
      
      res.type('text/xml').send(twiml.toString());
    }
  }
}

async function cleanupAudioFiles() {
  try {
    const publicDir = path.join(__dirname, 'public');
    const files = await fs.promises.readdir(publicDir);
    
    for (const file of files) {
      if (file.endsWith('.mp3')) {
        const filePath = path.join(publicDir, file);
        const stats = await fs.promises.stat(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        
        // Delete files older than 1 hour
        if (fileAge > 60 * 60 * 1000) {
          await fs.promises.unlink(filePath);
          console.log('Cleaned up audio file:', file);
        }
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupAudioFiles, 60 * 60 * 1000);

module.exports = { handleVoice, handleSpeech };