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
  
  // Play intro audio first
  twiml.play(`${B}/Introduction.mp3`);
  
  // Then gather speech
  twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'en-AU',
    action: `${B}/speech`,
    method: 'POST',
    timeout: 15, // Give more time for initial response
  });
  
  // Better fallback - just end the call gracefully
  twiml.say({
    voice: 'alice',
    language: 'en-AU'
  }, "Thank you for calling. Goodbye.");
  
  res.type('text/xml').send(twiml.toString());
}

async function handleSpeech(req, res) {
  const startTime = Date.now();
  console.log('=== Speech Request Started ===');
  
  console.log('=== Speech Request ===');
  console.log('CallSid:', req.body.CallSid);
  console.log('SpeechResult:', req.body.SpeechResult);
  console.log('Confidence:', req.body.Confidence);
  console.log('Current State:', stateMachine.currentState);
  console.log('=====================');
  
  const B = baseUrl(req);
  const userText = req.body.SpeechResult || '';
  const speechConfidence = parseFloat(req.body.Confidence) || 0;
  
  console.log('User said:', userText, 'Confidence:', speechConfidence);

  // Handle low confidence speech - don't reset conversation
  if (userText && speechConfidence < 0.3) {
    const twiml = new VoiceResponse();
    // Use a simple "please repeat" message instead of intro
    twiml.say({
      voice: 'alice',
      language: 'en-AU'
    }, "I didn't catch that clearly. Could you please repeat?");
    
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
    reply = await handleInput(userText);
  } catch (e) {
    console.error('NL error:', e);
    reply = "Sorry, I'm having trouble understanding. Could you please repeat that?";
  }
  const nlpTime = Date.now() - nlpStart;
  console.log(`NLP processing time: ${nlpTime}ms`);

  // Generate audio with better timeout protection
  let audioBuffer;
  let filename;
  try {
    // Match the timeout with tts.js (4 seconds)
    const ttsPromise = synthesizeBuffer(reply);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TTS timeout')), 2000)
    );
    
    audioBuffer = await Promise.race([ttsPromise, timeoutPromise]);
    
    if (audioBuffer && audioBuffer.length > 0) {
      const callSid = req.body.CallSid || Date.now().toString();
      filename = `${callSid}.mp3`;
      const outPath = path.join(__dirname, 'public', filename);
      await fs.promises.writeFile(outPath, audioBuffer);
    } else {
      throw new Error('Empty audio buffer');
    }
  } catch (e) {
    console.error('TTS error:', e);
    filename = null;
  }

  // Create TwiML response
  const twiml = new VoiceResponse();
  
  if (filename) {
    twiml.play(`${B}/${filename}`);
  } else {
    // Use Twilio TTS as fallback - this is the key fix
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
  
  res.type('text/xml').send(twiml.toString());
}

async function cleanupAudioFiles() {
  try {
    const publicDir = path.join(__dirname, 'public');
    const files = await fs.promises.readdir(publicDir);
    
    for (const file of files) {
      if (file.endsWith('.mp3') && file !== 'Introduction.mp3') {
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

