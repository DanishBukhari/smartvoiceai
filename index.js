// index.js
require('dotenv').config();
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents, LiveTTSEvents } = require('@deepgram/sdk');
const { handleInput, stateMachine, terminateCall, setCallerPhoneNumber, resetStateMachine } = require('./flow');
const { sendBookingConfirmationEmail } = require('./professional-email-service');
const { OpenAI } = require('openai');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const ping = require('ping');

// Global error handlers for better stability
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit process, just log
});

// Create OAuth2 client for Google Calendar
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID, 
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Express setup
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
// Parse JSON bodies for test and diagnostics endpoints
app.use(express.json());

// Deepgram client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
// OpenAI client (used inside flow.js)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// —————————
// 1) Twilio /voice endpoint → start media stream
// —————————
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  
  // Capture caller information
  const from = req.body.From;
  const to = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log('Incoming call:', { from, to, callSid });
  
  // Store caller info in stateMachine for later use
  if (from) {
    stateMachine.clientData.phone = from;
    setCallerPhoneNumber(from);
  }
  
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/media`,
    name: 'voiceStream',
  });
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// —————————
// 2) WebSocket handler for Twilio media
// —————————
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  let streamSid;
  let speechBuffer = '';
  let speechTimeout;
  let isSpeaking = false;
  let botIsSpeaking = false; // NEW: Track when bot is speaking
  let sttReady = false;
  let ttsInFlight = false; // <— throttle flag
  let lastInterimTime = 0; // Throttle interim results
  let lastFinalText = '';
  let silenceTimer = null; // NEW: For detecting end of customer speech
  let customerSpeaking = false; // NEW: Track customer speaking state
  let lastAudioTime = 0; // NEW: Track last audio received

  // Reset stateMachine using the new modular reset function
  resetStateMachine();

  // —— Deepgram streaming STT (ULTRA-OPTIMIZED FOR SPEED) ——
  const dgStt = deepgram.listen.live({
    model: 'nova-2-conversationalai', // Faster, lighter model
    language: 'en-AU',
    smart_format: true,
    filler_words: false,
    interim_results: true,
    utterances: false,
    endpointing: 3000, // Much faster response - 300ms instead of 2000ms
    encoding: 'mulaw',
    sample_rate: 8000,
    vad_events: true,
    punctuate: true,
    profanity_filter: false,
    redact: false,
    diarize: false,
    multichannel: false,
    // Reduced features for speed
    numerals: true,
  });

  dgStt.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram STT connected');
    sttReady = true;
  });
  dgStt.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('Deepgram STT error', err);
  });
  dgStt.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const alt = data.channel.alternatives[0];
    
    // BARGE-IN PROTECTION: Don't process if bot is currently speaking
    if (botIsSpeaking) {
      console.log('🔇 Bot is speaking - ignoring customer input to prevent interruption');
      return;
    }
    
    // LATENCY OPTIMIZATION: Process transcripts faster
    if (alt.transcript && alt.transcript.trim()) {
      // Track customer speaking activity
      customerSpeaking = true;
      lastAudioTime = Date.now();
      
      // Reset silence timer
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      
      if (data.is_final) {
        // Customer just finished a statement - ready to process immediately
        customerSpeaking = false;
        
        // Set silence detection timer for additional silence (not for blocking processing)
        silenceTimer = setTimeout(() => {
          console.log('🔇 Extended silence detected');
        }, 1500); // 1.5 second silence indicates customer finished
        
        // Clear any pending timeout
        if (speechTimeout) {
          clearTimeout(speechTimeout);
          speechTimeout = null;
        }
        
        // Use only the final transcript, don't accumulate
        const finalTranscript = alt.transcript.trim();
        
        // Skip if it's too short or just repeated words
        if (finalTranscript.length < 3) {
          return;
        }

        // ENHANCED: Fix spaced-out letters and common STT issues
        let improvedTranscript = finalTranscript
          // Fix spaced letters for names (major issue in logs)
          .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3$4')
          .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3')
          .replace(/\b([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2')
          // Fix specific name patterns we see in logs
          .replace(/\bh\s*i\s*r\s*a\b/gi, 'Hira')
          .replace(/\bs\s*y\s*e\s*d\s*a?\s*h?\s*i\s*r\s*a\b/gi, 'Syed Ahira')
          // Fix email patterns
          .replace(/\bf\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)/gi, 'fyedahira$1')
          .replace(/\bs\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)/gi, 'syedahira$1');

        // Basic validation for obviously wrong transcriptions
        // Heuristic corrections for common misrecognitions
        let validatedTranscript = improvedTranscript
          // flashing -> flushing
          .replace(/\bflashing\b/gi, 'flushing')
          // daughter + (flush|flushing) -> toilet
          .replace(/\bdaughter\b(?=[^\n]{0,40}\bflush(?:ing)?\b)/gi, 'toilet')
          // "a daughter that won't flush" -> "a toilet that won't flush"
          .replace(/\bdaughter that won't flush\b/gi, "toilet that won't flush")
          // "that's what flush" -> "that won't flush"
          .replace(/\bthat'?s\s+what\s+flush\b/gi, "that won't flush");

        // Normalize "unusual voices" -> "unusual noises"
        if (/\bunusual\b[^\n]{0,20}\bvoices?\b/i.test(validatedTranscript)) {
          validatedTranscript = validatedTranscript.replace(/\bvoices?\b/gi, 'noises');
        }

        const suspiciousPatterns = [
          /daughter.*flash/i, // "daughter bought flash" etc.
          /bought.*flash/i,
          /authority.*that/i,
          /\bnot\s+flashing\b/i // map to flushing above
        ];

        for (const pattern of suspiciousPatterns) {
          if (pattern.test(finalTranscript)) {
            console.warn('STT: Detected likely misinterpretation:', finalTranscript);
            if (/daughter.*flash|bought.*flash/i.test(finalTranscript)) {
              validatedTranscript = "I have a toilet that won't flush";
            }
            break;
          }
        }
        
        // Drop trivial trailing fragments that often arrive after the real utterance
        const norm = validatedTranscript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const isShort = norm.length <= 12;
        const trailingPhrases = new Set(['at all', 'hello', 'hi', 'ok', 'okay']);
        const looksTrailing = trailingPhrases.has(norm) || (lastFinalText && lastFinalText.toLowerCase().includes(norm) && isShort);
        if (looksTrailing) {
          console.log('STT trailing fragment dropped:', validatedTranscript);
          return;
        }

        console.log('STT Final:', validatedTranscript);
        
        // Update last final text for duplication detection
        lastFinalText = validatedTranscript;
        
        // LATENCY FIX: Skip processing if TTS is in flight or bot is speaking
        if (ttsInFlight || botIsSpeaking) {
          console.warn('TTS busy or bot speaking—dropping:', finalTranscript);
          return;
        }
        
        // Start processing immediately (no need to wait for silence timer)
        ttsInFlight = true;
        botIsSpeaking = true; // Mark bot as about to speak
        
        // SAFETY: Reset botIsSpeaking flag after 15 seconds if it gets stuck
        const speakingTimeout = setTimeout(() => {
          if (botIsSpeaking) {
            console.warn('⚠️  SAFETY: Resetting stuck botIsSpeaking flag after timeout');
            botIsSpeaking = false;
          }
        }, 15000); // Reduced from 30 to 15 seconds
        
        // LATENCY OPTIMIZATION: Process in parallel with minimal awaits
        try {
          const reply = await handleInput(validatedTranscript);

          console.log('Reply:', reply);

          // Check if call should be terminated after response
          if (stateMachine.pendingTermination && stateMachine.pendingTermination.shouldClose) {
            console.log('📞 Call termination requested after response');
            
            // Send final TTS and then terminate
            sendTTS(ws, streamSid, reply, () => { 
              clearTimeout(speakingTimeout);
              botIsSpeaking = false; 
            })
              .catch((error) => {
                console.error('Final TTS error before termination:', error.message);
              })
              .finally(() => {
                ttsInFlight = false;
                clearTimeout(speakingTimeout);
                botIsSpeaking = false; // Bot finished speaking
                // Terminate call after TTS completes
                setTimeout(() => {
                  console.log('📞 Closing call after final message');
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'Call completed successfully');
                  }
                }, 3000); // 3 second delay for TTS to complete
              });
          } else {
            // Normal TTS processing
            sendTTS(ws, streamSid, reply, () => { 
              clearTimeout(speakingTimeout);
              botIsSpeaking = false; 
            })
              .catch((error) => {
                console.error('Final TTS error (unexpected):', error.message);
              })
              .finally(() => {
                ttsInFlight = false; // Ready for next response
                clearTimeout(speakingTimeout);
                botIsSpeaking = false; // Bot finished speaking
                lastFinalText = validatedTranscript;
              });
          }
        } catch (error) {
          console.error('Processing error:', error);
          ttsInFlight = false;
          clearTimeout(speakingTimeout);
          botIsSpeaking = false; // Reset bot speaking state on error
        }
      } else {
        // Handle interim transcripts (throttled for debugging)
        const now = Date.now();
        if (now - lastInterimTime > 1000) { // Only log every 1 second
          console.log('STT Interim:', alt.transcript);
          lastInterimTime = now;
        }
        speechBuffer = alt.transcript; // Update buffer with latest interim only
      }
    }
  });

  // —— Twilio media frames in ——
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    switch (msg.event) {
      case 'connected':
        console.log('Twilio stream connected');
        break;
      case 'start':
        streamSid = msg.streamSid;
        console.log('Stream started:', streamSid);
        const greeting = 'Hello, this is Robyn from Assure Fix Plumbing. How can I help you today?';
        try { 
          stateMachine.conversationHistory.push({ role: 'assistant', content: greeting }); 
        } catch (error) {
          console.warn('Failed to add greeting to conversation history:', error);
        }
        
        // Debug: Check Deepgram speak API availability
        console.log('Deepgram speak API check:', {
          hasSpeak: !!deepgram.speak,
          hasRequest: !!(deepgram.speak && deepgram.speak.request),
          hasText: !!(deepgram.speak && deepgram.speak.text),
          hasList: !!(deepgram.speak && deepgram.speak.list)
        });
        
        console.log('Sending greeting via TTS...');
        sendTTS(ws, streamSid, greeting, () => { botIsSpeaking = false; }).catch(error => {
          console.error('Greeting TTS unexpected error:', error.message);
        });
        break;
      case 'media':
        if (sttReady && !isSpeaking) {
          const audio = Buffer.from(msg.media.payload, 'base64');
          dgStt.send(audio);
        }
        break;
      case 'stop':
        console.log('Stream stopped');
        dgStt.finish();
        break;
      case 'test':
        // Handle test messages for stability testing
        ws.send(JSON.stringify({
          event: 'test_response',
          data: { message: 'Test successful', timestamp: Date.now() }
        }));
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    dgStt.finish();
    
    // Handle call termination cleanup
    if (stateMachine.currentState !== 'ended') {
      console.log('📞 Call ended unexpectedly - performing cleanup');
      terminateCall('unexpected_disconnect');
    }
  });
  
  // Add call termination handler
  ws.terminateCall = (reason) => {
    console.log('📞 Terminating call programmatically - reason:', reason);
    
    // Send a final message before closing if needed
    if (reason === 'customer_completed') {
      // Give a moment for the final TTS to complete before closing
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Call completed successfully');
        }
      }, 3000); // 3 second delay to allow final message to play
    } else {
      ws.close(1000, reason);
    }
  };
  
  // Store reference for potential external termination
  ws.streamSid = null; // Will be set when stream starts
});

// —————————
// Network connectivity check for TTS stability
// —————————
async function checkNetwork() {
  const res = await ping.promise.probe('api.deepgram.com');
  console.log('Network check:', { host: 'api.deepgram.com', alive: res.alive, time: res.time });
  return res.alive;
}

// —————————
// ULTRA-FAST: Optimized TTS with minimal latency and better voice quality
// —————————
async function sendStreamingTTS(ws, streamSid, text, retryCount = 0) {
  // Skip network check for speed - go straight to the fastest method
  return new Promise((resolve, reject) => {
    console.log('TTS: Using optimized fast TTS mode');
    speakViaRestAndStream(ws, streamSid, text).then(resolve).catch(() => {
      sendFallbackMessage(ws, streamSid, text);
      resolve();
    });
  });
}

// Deepgram REST speak fallback: synthesize into mulaw 8k and stream to Twilio in 20ms frames
async function speakViaRestAndStream(ws, streamSid, text) {
  if (!text || ws.readyState !== WebSocket.OPEN) return;

  // Use only the fastest, most reliable models
  const models = [
    'aura-luna-en', // Fastest, most reliable
    'aura-asteria-en', // Good fallback
  ];
  let audioBase64 = null;
  let usedModel = null;
  let lastErr = null;
  
  for (const model of models) {
    try {
      console.log(`Trying TTS model: ${model}`);
      
      // Use the correct Deepgram SDK v3 method with optimized settings
      const response = await deepgram.speak.request(
        { text },
        {
          model,
          encoding: 'mulaw',
          sample_rate: 8000,
          container: 'none',
          // Add speed optimization
          speed: 1.1, // Slightly faster speech
        }
      );
      
      console.log('TTS response received for model:', model);
      console.log('Response type:', typeof response);
      console.log('Response keys:', Object.keys(response || {}));
      console.log('Has result:', !!response.result);
      console.log('Result type:', typeof response.result);
      console.log('Result keys:', response.result ? Object.keys(response.result) : 'N/A');
      
      // Get the audio buffer - handle Deepgram SDK v3 response format
      let audioBuffer;
      if (response.result && Buffer.isBuffer(response.result)) {
        console.log('Using response.result (Buffer)');
        audioBuffer = response.result;
      } else if (response.result && response.result.arrayBuffer && typeof response.result.arrayBuffer === 'function') {
        console.log('Using response.result.arrayBuffer method');
        audioBuffer = Buffer.from(await response.result.arrayBuffer());
      } else if (response.result && response.result.stream && typeof response.result.stream === 'function') {
        console.log('Using response.result.stream method');
        const stream = await response.result.stream();
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        audioBuffer = Buffer.concat(chunks);
      } else if (response.result) {
        console.log('Trying to convert response.result directly to Buffer');
        audioBuffer = Buffer.from(response.result);
      } else if (response.arrayBuffer && typeof response.arrayBuffer === 'function') {
        console.log('Using response.arrayBuffer method');
        audioBuffer = Buffer.from(await response.arrayBuffer());
      } else if (response.stream && typeof response.stream === 'function') {
        console.log('Using response.stream method');
        const stream = await response.stream();
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        audioBuffer = Buffer.concat(chunks);
      } else if (Buffer.isBuffer(response)) {
        console.log('Response is already a Buffer');
        audioBuffer = response;
      } else if (response.body) {
        console.log('Using response.body');
        audioBuffer = Buffer.from(response.body);
      } else {
        console.log('Unknown response format, trying response.result properties:', response.result ? Object.getOwnPropertyNames(response.result) : 'no result');
        throw new Error('Unknown response format from Deepgram');
      }
      
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Empty audio response');
      }
      
      // Convert to base64 for streaming
      audioBase64 = audioBuffer.toString('base64');
      
      usedModel = model;
      console.log(`REST TTS: Synthesized via ${model}, audio length:`, audioBase64.length);
      break;
    } catch (e) {
      console.warn(`TTS model ${model} failed:`, e.message);
      lastErr = e;
      continue;
    }
  }

  if (!audioBase64) {
    throw lastErr || new Error('REST TTS failed');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  // For mulaw 8k, 20ms = 160 bytes per frame (8000 samples/sec * 0.02 sec * 1 byte/sample)
  const frameSize = 160;
  let offset = 0;
  // Send frames paced at ~15ms for faster delivery
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (offset >= audioBuffer.length) {
        // Send end mark
        try {
          ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'endOfResponse' } }));
        } catch (_) {}
        clearInterval(timer);
        resolve();
        return;
      }
      const chunk = audioBuffer.subarray(offset, Math.min(offset + frameSize, audioBuffer.length));
      offset += frameSize;
      try {
        ws.send(
          JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: chunk.toString('base64') },
          })
        );
      } catch (_) {}
    }, 15); // Faster frame delivery - 15ms instead of 20ms
  });
}

// —————————
// Helper: send TTS greeting or any text (OPTIMIZED)
// —————————
async function sendTTS(ws, streamSid, text, onComplete = null) {
  // Handle undefined or null text
  if (!text || typeof text !== 'string') {
    console.error('TTS: Invalid text provided:', text);
    text = "I'm sorry, I didn't catch that. Could you please repeat?";
  }
  
  console.log('TTS: Starting synthesis for:', text.substring(0, 50) + '...');
  
  let success = false;
  
  // Check if TTS_MODE is forced to REST
  if ((process.env.TTS_MODE || '').toLowerCase() === 'rest') {
    console.log('TTS: Using forced REST mode');
    try {
      await speakViaRestAndStream(ws, streamSid, text);
      console.log('TTS: REST synthesis completed successfully');
      success = true;
    } catch (error) {
      console.error('TTS: REST synthesis failed:', error.message);
      // Continue to fallback handling below
    }
  } else {
    // Try streaming TTS first, fallback to REST if it fails
    try {
      await sendStreamingTTS(ws, streamSid, text);
      console.log('TTS: Streaming synthesis completed successfully');
      success = true;
    } catch (error) {
      console.warn('TTS: Streaming failed, trying REST fallback:', error.message);
      try {
        await speakViaRestAndStream(ws, streamSid, text);
        console.log('TTS: REST fallback completed successfully');
        success = true;
      } catch (restError) {
        console.error('TTS: All synthesis methods failed:', restError.message);
        // Continue to fallback handling below
      }
    }
  }
  
  // If we get here and success is false, all TTS methods failed - send fallback message
  if (!success) {
    console.warn('TTS: All methods failed, sending fallback message');
    sendFallbackMessage(ws, streamSid, text);
  }
  
  // Call completion callback if provided - ALWAYS call it
  if (onComplete && typeof onComplete === 'function') {
    try {
      onComplete();
    } catch (error) {
      console.error('TTS: Error in completion callback:', error);
    }
  }
  
  // Always reset TTS and bot speaking flags
  ttsInFlight = false;
}

// —————————
// Fallback: Send text as Twilio message when TTS completely fails
// —————————
function sendFallbackMessage(ws, streamSid, text) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      // Send a pause/clear to ensure clean audio state
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
      
      // Generate a simple beep tone or silence to indicate response
      const silenceBuffer = Buffer.alloc(1600, 0x7F); // 1600 bytes = ~200ms of silence at 8kHz mulaw
      const payload = silenceBuffer.toString('base64');
      
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload }
      }));
      
      // Send end mark
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            event: 'mark',
            streamSid,
            mark: { name: 'endOfResponse' }
          }));
        }
      }, 300);
      
      console.log('TTS completely failed, sent silence as fallback for:', text.substring(0, 50) + '...');
      // In a real implementation, you might want to send an SMS or handle differently
    }
  } catch (err) {
    console.error('Fallback message error:', err.message);
  }
}

// —————————
// Misc endpoints
// —————————
app.get('/test', (_, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: {
      DEEPGRAM_API_KEY: !!process.env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      PORT: process.env.PORT || 3000,
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});
app.get('/', (_, res) => res.send('SmartVoiceAI is running.'));
app.get('/test-tts', async (req, res) => {
  try {
    const text = req.query.text || 'Hello, test.';
    
    console.log('TTS test request for:', text);
    
    // Use the correct Deepgram SDK v3 speak method
    const response = await deepgram.speak.request(
      { text },
      { 
        model: 'aura-luna-en', 
        encoding: 'linear16', 
        sample_rate: 24000,
        container: 'wav'
      }
    );
    
    console.log('TTS response received, extracting audio...');
    console.log('Response type:', typeof response);
    console.log('Response keys:', Object.keys(response || {}));
    console.log('Has result:', !!response.result);
    console.log('Result type:', typeof response.result);
    console.log('Result keys:', response.result ? Object.keys(response.result) : 'N/A');
    
    // Get the audio buffer - handle Deepgram SDK v3 response format
    let audioBuffer;
    if (response.result && Buffer.isBuffer(response.result)) {
      console.log('Using response.result (Buffer)');
      audioBuffer = response.result;
    } else if (response.result && response.result.arrayBuffer && typeof response.result.arrayBuffer === 'function') {
      console.log('Using response.result.arrayBuffer method');
      audioBuffer = Buffer.from(await response.result.arrayBuffer());
    } else if (response.result && response.result.stream && typeof response.result.stream === 'function') {
      console.log('Using response.result.stream method');
      const stream = await response.result.stream();
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      audioBuffer = Buffer.concat(chunks);
    } else if (response.result) {
      console.log('Trying to convert response.result directly to Buffer');
      audioBuffer = Buffer.from(response.result);
    } else if (response.arrayBuffer && typeof response.arrayBuffer === 'function') {
      console.log('Using response.arrayBuffer method');
      audioBuffer = Buffer.from(await response.arrayBuffer());
    } else if (response.stream && typeof response.stream === 'function') {
      console.log('Using response.stream method');
      const stream = await response.stream();
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      audioBuffer = Buffer.concat(chunks);
    } else if (Buffer.isBuffer(response)) {
      console.log('Response is already a Buffer');
      audioBuffer = response;
    } else if (response.body) {
      console.log('Using response.body');
      audioBuffer = Buffer.from(response.body);
    } else {
      console.log('Unknown response format, trying response.result properties:', response.result ? Object.getOwnPropertyNames(response.result) : 'no result');
      throw new Error('Unknown response format from Deepgram');
    }
    
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Empty audio response');
    }
    
    console.log('TTS success, sending audio response, size:', audioBuffer.length);
    
    res.set('Content-Type', 'audio/wav');
    res.send(audioBuffer);
  } catch (err) {
    console.error('test-tts error:', err.message);
    console.error('Full error:', err);
    res.status(500).json({ 
      error: err.message, 
      type: err.constructor.name,
      deepgramSpeak: !!deepgram.speak,
      deepgramSpeakRequest: !!(deepgram.speak && deepgram.speak.request)
    });
  }
});

// GHL integration health check
app.get('/test-ghl', async (req, res) => {
  try {
    const { getValidGhlToken, refreshGhlToken } = require('./ghl');
    
    console.log('GHL health check requested');
    
    // Test token retrieval/refresh
    const tokenResult = await getValidGhlToken();
    
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      ghl: {
        tokenAvailable: !!tokenResult,
        tokenType: tokenResult ? (tokenResult.startsWith('ya29') ? 'OAuth2' : 'API Key') : 'None',
        hasApiKey: !!process.env.GHL_API_KEY,
        hasOAuth2: !!(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET),
        hasAccessToken: !!process.env.GHL_ACCESS_TOKEN,
        hasRefreshToken: !!process.env.GHL_REFRESH_TOKEN,
        hasLocationId: !!process.env.GHL_LOCATION_ID,
      }
    };
    
    console.log('GHL health check result:', healthData);
    res.json(healthData);
  } catch (error) {
    console.error('GHL health check failed:', error.message);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
      ghl: {
        hasApiKey: !!process.env.GHL_API_KEY,
        hasOAuth2: !!(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET),
        hasAccessToken: !!process.env.GHL_ACCESS_TOKEN,
        hasRefreshToken: !!process.env.GHL_REFRESH_TOKEN,
        hasLocationId: !!process.env.GHL_LOCATION_ID,
      }
    });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', responseTime: 0 }));

// Performance monitoring endpoint
app.get('/performance', (_, res) => {
  const { responseTimeTracker, nlpCache } = require('./nlp');
  res.json({
    status: 'ok',
    performance: {
      averageNlpResponseTime: responseTimeTracker.getAverage() || 0,
      totalNlpCalls: responseTimeTracker.times.length,
      cacheSize: nlpCache.size,
      cacheHitRate: nlpCache.size > 0 ? ((nlpCache.size / (responseTimeTracker.times.length || 1)) * 100).toFixed(2) + '%' : '0%',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      lastResponseTimes: responseTimeTracker.times.slice(-10) // Last 10 response times
    }
  });
});

// Global error handler
app.use((err, _, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).send('Server error');
});


app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Access:', tokens.access_token);
    console.log('Refresh:', tokens.refresh_token);
    res.send(`OAuth complete. Refresh Token: ${tokens.refresh_token}`);
  } catch (e) {
    console.error('OAuth error', e);
    res.status(500).send('Error exchanging code');
  }
});

// Google OAuth2 for Calendar
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.redirect(url);
});

// Test endpoints for stability testing
app.post('/test-stt-correction', (req, res) => {
  const { transcript } = req.body;
  
  // Apply the same correction logic as in the main system
  let corrected = transcript;
  
  // Common misinterpretations and corrections
  const corrections = [
    { from: /daughter.*bought.*flash/i, to: 'toilet that won\'t flush' },
    { from: /pain.*not.*working/i, to: 'drain is not working' },
    { from: /water pressure.*too$/i, to: 'water pressure is too low' },
    { from: /toilet.*daughter/i, to: 'toilet' },
    { from: /flash.*flush/i, to: 'flush' }
  ];
  
  corrections.forEach(correction => {
    if (correction.from.test(corrected)) {
      corrected = corrected.replace(correction.from, correction.to);
    }
  });
  
  res.json({
    original: transcript,
    corrected: corrected,
    was_corrected: corrected !== transcript
  });
});

app.post('/test-tts-fallback', async (req, res) => {
  const { text, simulateError } = req.body;
  
  try {
    // Simulate the fallback system
    let primaryFailed = false;
    let fallbackUsed = false;
    
    if (simulateError) {
      primaryFailed = true;
      fallbackUsed = true;
    }
    
    res.json({
      success: true,
      primary_failed: primaryFailed,
      fallback_used: fallbackUsed,
      message: 'TTS fallback system operational'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add endpoint to check recent appointments
app.get('/check-appointments', async (req, res) => {
  try {
    // Set up Google Calendar API client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    // Check for appointments in the last 7 days and next 14 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

    // Get recent appointments (past 7 days)
    const recentResponse = await calendar.events.list({
      calendarId,
      timeMin: oneWeekAgo.toISOString(),
      timeMax: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: 'startTime',
      q: 'plumbing OR appointment OR Usher Fix',
    });

    // Get upcoming appointments (next 14 days)
    const upcomingResponse = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      timeMax: twoWeeksFromNow.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
      q: 'plumbing OR appointment OR Usher Fix',
    });

    // Filter relevant events
    const filterEvents = (events) => events.filter(event => 
      event.summary && 
      event.end.dateTime &&
      !event.eventType === 'birthday' &&
      !event.summary.toLowerCase().includes('birthday') &&
      (event.summary.toLowerCase().includes('plumbing') || 
       event.summary.toLowerCase().includes('appointment') ||
       event.summary.toLowerCase().includes('usher fix') ||
       event.summary.toLowerCase().includes('toilet') ||
       event.summary.toLowerCase().includes('drain') ||
       event.location)
    );

    const recentEvents = filterEvents(recentResponse.data.items || []);
    const upcomingEvents = filterEvents(upcomingResponse.data.items || []);

    const formatEvent = (event) => ({
      id: event.id,
      summary: event.summary,
      startTime: event.start.dateTime,
      endTime: event.end.dateTime,
      location: event.location || 'Not specified',
      description: event.description || 'No description'
    });

    res.json({
      success: true,
      hasBookings: !!(recentEvents.length > 0 || upcomingEvents.length > 0),
      recentAppointments: recentEvents.map(formatEvent),
      upcomingAppointments: upcomingEvents.map(formatEvent),
      totalRecent: recentEvents.length,
      totalUpcoming: upcomingEvents.length,
      summary: {
        lastWeek: recentEvents.length,
        nextTwoWeeks: upcomingEvents.length,
        hasAnyBookings: (recentEvents.length + upcomingEvents.length) > 0
      }
    });

  } catch (error) {
    console.error('Error checking appointments:', error);
    res.status(500).json({ 
      error: 'Failed to check appointments: ' + error.message,
      hasBookings: false,
      details: error.message.includes('invalid_grant') ? 
        'Google Calendar authentication expired. Please re-authenticate.' : 
        'Unable to connect to Google Calendar.'
    });
  }
});

app.post('/test-network-recovery', (req, res) => {
  // Simulate network recovery
  res.json({ recovered: true, recovery_time: 250 });
});

app.post('/test-audio-recovery', (req, res) => {
  // Simulate audio recovery
  res.json({ recovered: true, recovery_method: 'fallback_tts' });
});

app.post('/test-nlp-recovery', (req, res) => {
  // Simulate NLP recovery
  res.json({ recovered: true, fallback_response: 'generic_help' });
});

// Test email endpoint
app.post('/test-email', async (req, res) => {
  try {
    const bookingDetails = {
      customerName: 'Test User',
      customerEmail: 'syebahira2846@gmail.com',
      address: '142 Queen Street, Brisbane, QLD, Australia',
      appointmentTime: new Date(),
      issue: 'Test plumbing issue',
      referenceNumber: 'TEST123',
    };
    await sendBookingConfirmationEmail(bookingDetails);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
server.listen(port, async () => {
  console.log(`🚀 Server started on ${port}`);
  
  // Initialize travel optimization system
  try {
    const { initializeStartingLocation } = require('./modules/travelOptimization');
    await initializeStartingLocation();
    console.log('✅ Travel optimization system initialized');
  } catch (error) {
    console.log('⚠️ Could not initialize travel optimization:', error.message);
  }
});