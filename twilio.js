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

  // Handle low confidence speech - use static file instead of Twilio voice
  if (userText && speechConfidence < 0.3) {
    const twiml = new VoiceResponse();
    twiml.play(`${B}/Introduction.mp3`); // Use static file instead of Twilio TTS
    
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

  let reply;
  try {
    reply = await handleInput(userText);
  } catch (e) {
    console.error('NL error:', e);
    reply = "Sorry, I'm having trouble understanding. Could you please repeat that?";
  }

  // Generate audio with timeout protection for faster response
  let audioBuffer;
  let filename;
  try {
    // Add 2-second timeout to TTS generation
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
    // Use a static file instead of Twilio TTS
    twiml.play(`${B}/Introduction.mp3`);
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

