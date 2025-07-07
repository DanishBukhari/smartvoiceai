// pregen-audio.js - Standalone script to pre-generate MP3 files
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

// Enhanced pre-generation with many more common phrases
const preGeneratedPhrases = [
  // Core booking phrases
  "What's your full name, please?",
  "Could I have your email address?",
  "What's your phone number?",
  "And your full address?",
  "Would you like to book an appointment?",
  "I didn't catch that. Could you please repeat?",
  "Thank you for calling. How can I help you today?",
  
  // Diagnostic questions
  "Do you have any hot water at all?",
  "Is it gas, electric, or solar?",
  "Any leaks—steady drip or fast?",
  "How old is it—under 10 years or over?",
  "What size tank do you have?",
  "Is the water shut off or still running?",
  "Is the pump standalone or submersible?",
  "Is water dripping inside right now?",
  "What would you like us to quote—new installation, repair, or inspection?",
  
  // Booking flow phrases
  "When would you like your appointment?",
  "Does that work for you?",
  "Great! Any special instructions?",
  "Perfect! Your appointment is booked.",
  "What time works best for you?",
  "Morning or afternoon?",
  "I have a slot available at",
  "Would that time work for you?",
  "Excellent! I'll book you in for",
  "Your appointment is confirmed for",
  
  // Confirmation phrases
  "Thank you for booking with us.",
  "We'll see you then.",
  "Is there anything else I can help you with?",
  "Have a great day!",
  "Goodbye!",
  
  // Error handling
  "I'm sorry, I didn't understand that.",
  "Could you please speak more clearly?",
  "Let me try that again.",
  "One moment please.",
  "I'm having trouble understanding.",
  
  // Issue identification
  "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
  "Has the water been shut off, or is it still running?",
  "Is the pump standalone or submersible?",
  "Is water dripping inside right now?",
  
  // Time preferences
  "Would you prefer morning or afternoon?",
  "What time works best for you?",
  "I have availability in the morning.",
  "I have availability in the afternoon.",
  "Let me check our available slots.",
  
  // Special instructions
  "Any special instructions for our technician?",
  "Is there anything specific we should know?",
  "Do you have any pets we should be aware of?",
  "Is there a gate code or special access?",
  
  // Pricing and quotes
  "I can provide you with a quote for that.",
  "The cost will depend on the specific issue.",
  "Would you like a quote for the repair?",
  "I'll need to assess the situation first.",
  
  // Emergency phrases
  "Is this an emergency?",
  "Is water currently flooding?",
  "Do you need immediate assistance?",
  "I can prioritize this for you.",
  
  // Follow-up phrases
  "We'll call you to confirm.",
  "You'll receive a confirmation text.",
  "Our technician will call when on the way.",
  "Is this the best number to reach you?",
  
  // Service types
  "Are you looking for repair or replacement?",
  "Is this for residential or commercial?",
  "Do you need installation or just repair?",
  "Is this a new installation?",
  
  // Location phrases
  "What suburb are you located in?",
  "Is this a house or apartment?",
  "Do you have easy access to the area?",
  "Is there parking available?",
  
  // Payment phrases
  "We accept cash, card, or bank transfer.",
  "Payment is due on completion.",
  "We can provide an invoice.",
  "Do you have any payment preferences?"
];

async function generateAudioFile(phrase) {
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
    timeout: 10000, // 10 second timeout
  };

  return new Promise((resolve, reject) => {
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
}

async function preGenerateAllAudio() {
  console.log('🚀 Starting enhanced pre-generation...');
  console.log(`📝 Will generate ${preGeneratedPhrases.length} audio files`);
  console.log(`💰 Estimated cost: ${preGeneratedPhrases.length * 0.3} credits`);
  
  // Ensure public directory exists
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  let successCount = 0;
  let failCount = 0;
  const generatedFiles = [];
  
  for (let i = 0; i < preGeneratedPhrases.length; i++) {
    const phrase = preGeneratedPhrases[i];
    try {
      console.log(`🎵 [${i + 1}/${preGeneratedPhrases.length}] Generating: ${phrase.substring(0, 40)}...`);
      
      const audioBuffer = await generateAudioFile(phrase);
      
      // Check if it's actually audio (not an error)
      const asString = audioBuffer.toString('utf8');
      if (asString.includes('quota_exceeded') || asString.includes('status') && asString.includes('message')) {
        console.log(`❌ Quota exceeded, stopping generation`);
        console.log(`✅ Successfully generated: ${successCount} files`);
        console.log(`❌ Failed: ${failCount} files`);
        break;
      }
      
      // Save to file with a simple name
      const fileName = `pregen_${phrase.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 25)}.mp3`;
      const filePath = path.join(publicDir, fileName);
      await fs.promises.writeFile(filePath, audioBuffer);
      
      generatedFiles.push(fileName);
      successCount++;
      console.log(`✅ Generated: ${fileName}`);
      
      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.log(`❌ Failed to generate: ${phrase.substring(0, 30)}...`);
      console.log(`   Error: ${error.message}`);
      failCount++;
    }
  }
  
  console.log('\n🎉 Pre-generation complete!');
  console.log(`✅ Success: ${successCount} files`);
  console.log(`❌ Failed: ${failCount} files`);
  console.log('📁 Generated files:');
  generatedFiles.forEach(file => console.log(`   - ${file}`));
  
  // Create a mapping file for easy reference
  const mapping = {};
  preGeneratedPhrases.forEach((phrase, index) => {
    if (index < successCount) {
      const fileName = generatedFiles[index];
      mapping[phrase.toLowerCase().trim()] = fileName;
    }
  });
  
  const mappingPath = path.join(publicDir, 'pregen-mapping.json');
  await fs.promises.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`📄 Mapping saved to: pregen-mapping.json`);
}

// Check if API key is available
if (!process.env.ELEVENLABS_API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY not found in environment variables');
  console.log('Please add your ElevenLabs API key to your .env file');
  process.exit(1);
}

// Run the pre-generation
preGenerateAllAudio().catch(console.error); 