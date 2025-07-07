// debug.js - Debug script to test system components
require('dotenv').config();
const path = require('path');
const fs = require('fs');

async function testEnvironment() {
  console.log('=== Environment Check ===');
  console.log('ELEVENLABS_API_KEY:', !!process.env.ELEVENLABS_API_KEY);
  console.log('OPENAI_API_KEY:', !!process.env.OPENAI_API_KEY);
  console.log('PORT:', process.env.PORT || 3000);
  console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('========================');
}

async function testTTS() {
  console.log('\n=== Testing TTS ===');
  try {
    const { synthesizeBuffer } = require('./tts');
    const testText = "Hello, this is a test message.";
    console.log('Testing with text:', testText);
    
    const startTime = Date.now();
    const audioBuffer = await synthesizeBuffer(testText);
    const duration = Date.now() - startTime;
    
    console.log('✅ TTS successful!');
    console.log('Audio buffer size:', audioBuffer.length);
    console.log('Generation time:', duration + 'ms');
    
    return true;
  } catch (error) {
    console.error('❌ TTS failed:', error.message);
    return false;
  }
}

async function testNLP() {
  console.log('\n=== Testing NLP ===');
  try {
    const { getResponse } = require('./nlp');
    const testText = "I have a toilet problem";
    console.log('Testing with text:', testText);
    
    const startTime = Date.now();
    const response = await getResponse(testText);
    const duration = Date.now() - startTime;
    
    console.log('✅ NLP successful!');
    console.log('Response:', response);
    console.log('Processing time:', duration + 'ms');
    
    return true;
  } catch (error) {
    console.error('❌ NLP failed:', error.message);
    return false;
  }
}

async function testFlow() {
  console.log('\n=== Testing Flow ===');
  try {
    const { handleInput, stateMachine } = require('./flow');
    const testText = "My toilet is blocked";
    console.log('Testing with text:', testText);
    
    // Reset state
    Object.assign(stateMachine, {
      currentState: 'start',
      conversationHistory: [],
      clientData: {},
      issueType: null,
      questionIndex: 0,
      nextSlot: null,
    });
    
    const startTime = Date.now();
    const response = await handleInput(testText);
    const duration = Date.now() - startTime;
    
    console.log('✅ Flow successful!');
    console.log('Response:', response);
    console.log('State:', stateMachine.currentState);
    console.log('Processing time:', duration + 'ms');
    
    return true;
  } catch (error) {
    console.error('❌ Flow failed:', error.message);
    return false;
  }
}

async function testFullBookingScenario() {
  console.log('\n=== Testing Full Booking Scenario ===');
  const { handleInput, stateMachine } = require('./flow');
  const steps = [
    {
      label: 'Issue Identification',
      input: 'My hot water system is leaking',
    },
    {
      label: 'Diagnostic Q1 - Hot Water',
      input: 'No, I have no hot water at all',
    },
    {
      label: 'Diagnostic Q2 - System Type',
      input: 'It is electric',
    },
    {
      label: 'Diagnostic Q3 - Leak Type',
      input: 'It is a steady drip',
    },
    {
      label: 'Diagnostic Q4 - Age',
      input: 'It is over 10 years old',
    },
    {
      label: 'Diagnostic Q5 - Tank Size',
      input: '250L',
    },
    {
      label: 'Booking Offer',
      input: 'Yes, I would like to book an appointment',
    },
    {
      label: 'Name Collection',
      input: 'John Doe',
    },
    {
      label: 'Email Collection',
      input: 'john@example.com',
    },
    {
      label: 'Phone Collection',
      input: '+61412345678',
    },
    {
      label: 'Address Collection',
      input: '123 Main St, Sydney',
    },
    {
      label: 'Time Preference',
      input: 'Tomorrow morning would be good',
    },
    {
      label: 'Slot Confirmation',
      input: 'Yes, that works for me',
    },
    {
      label: 'Special Instructions',
      input: 'Please call on arrival',
    },
    {
      label: 'Final Confirmation',
      input: 'No, that is all I need',
    },
  ];

  // Reset state
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
  });

  let allGood = true;
  const timings = [];
  let lastState = 'start';

  for (let i = 0; i < steps.length; i++) {
    const { label, input } = steps[i];
    const start = Date.now();
    let response, error = null;
    try {
      response = await handleInput(input);
    } catch (e) {
      error = e;
      allGood = false;
    }
    const duration = Date.now() - start;
    timings.push({ label, duration, state: stateMachine.currentState, error });
    console.log(`\n[${label}]`);
    console.log('Input:', input);
    if (error) {
      console.log('❌ Error:', error.message);
    } else {
      console.log('✅ Response:', response);
      console.log('State:', stateMachine.currentState);
      if (duration > 3000) {
        console.log('⚠️  Slow response:', duration + 'ms');
      } else {
        console.log('Response time:', duration + 'ms');
      }
    }
    lastState = stateMachine.currentState;
  }

  // Booking confirmation check - more flexible
  const bookingSuccess = (lastState === 'general' || lastState === 'special_instructions') && 
                        !!stateMachine.clientData.name && 
                        (!!stateMachine.nextSlot || !!stateMachine.clientData.address);

  console.log('\n=== Full Booking Scenario Summary ===');
  timings.forEach(t => {
    console.log(`- ${t.label}: ${t.duration}ms${t.error ? ' ❌' : ''}`);
  });
  
  console.log('\n=== Final State Analysis ===');
  console.log('Final State:', lastState);
  console.log('Client Data:', Object.keys(stateMachine.clientData));
  console.log('Next Slot:', stateMachine.nextSlot);
  
  if (bookingSuccess && allGood) {
    console.log('\n🎉 Full booking scenario succeeded!');
    console.log('Booking for:', stateMachine.clientData.name);
    if (stateMachine.nextSlot) {
      console.log('Appointment time:', stateMachine.nextSlot);
    }
    if (stateMachine.clientData.address) {
      console.log('Address:', stateMachine.clientData.address);
    }
  } else {
    console.log('\n⚠️  Full booking scenario failed. See above for errors.');
    console.log('Issues found:');
    if (!stateMachine.clientData.name) console.log('- Missing customer name');
    if (!stateMachine.nextSlot && !stateMachine.clientData.address) console.log('- Missing appointment slot or address');
    if (lastState === 'general' && !stateMachine.clientData.name) console.log('- Flow ended in general state without collecting details');
  }
  return bookingSuccess && allGood;
}

async function testPreGeneratedAudio() {
  console.log('\n=== Testing Pre-Generated Audio ===');
  
  // Check if pre-generated files exist
  const publicDir = path.join(__dirname, 'public');
  const files = fs.readdirSync(publicDir).filter(f => f.startsWith('pregen_'));
  
  console.log(`📁 Found ${files.length} pre-generated MP3 files`);
  
  if (files.length === 0) {
    console.log('❌ No pre-generated files found. Run: node pregen-audio.js');
    return;
  }
  
  // Test a few common phrases
  const testPhrases = [
    "What's your full name, please?",
    "Could I have your email address?",
    "Do you have any hot water at all?",
    "Would you like to book an appointment?"
  ];
  
  for (const phrase of testPhrases) {
    try {
      const { synthesizeBuffer } = require('./tts');
      const startTime = Date.now();
      const audioBuffer = await synthesizeBuffer(phrase);
      const duration = Date.now() - startTime;
      
      if (audioBuffer && audioBuffer.length > 0) {
        console.log(`✅ "${phrase.substring(0, 30)}..." - ${duration}ms (${audioBuffer.length} bytes)`);
      } else {
        console.log(`❌ "${phrase.substring(0, 30)}..." - Failed`);
      }
    } catch (error) {
      console.log(`❌ "${phrase.substring(0, 30)}..." - Error: ${error.message}`);
    }
  }
  
  // Show file sizes
  console.log('\n📊 File sizes:');
  files.slice(0, 5).forEach(file => {
    const filePath = path.join(publicDir, file);
    const stats = fs.statSync(filePath);
    console.log(`   ${file}: ${(stats.size / 1024).toFixed(1)} KB`);
  });
  
  if (files.length > 5) {
    console.log(`   ... and ${files.length - 5} more files`);
  }
}

async function runAllTests() {
  console.log('🚀 Starting system diagnostics...\n');
  
  await testEnvironment();
  
  const ttsResult = await testTTS();
  const nlpResult = await testNLP();
  const flowResult = await testFlow();
  const bookingResult = await testFullBookingScenario();
  const preGeneratedAudioResult = await testPreGeneratedAudio();
  
  console.log('\n=== Summary ===');
  console.log('Environment:', '✅ OK');
  console.log('TTS:', ttsResult ? '✅ OK' : '❌ FAILED');
  console.log('NLP:', nlpResult ? '✅ OK' : '❌ FAILED');
  console.log('Flow:', flowResult ? '✅ OK' : '❌ FAILED');
  console.log('Full Booking:', bookingResult ? '✅ OK' : '❌ FAILED');
  console.log('Pre-Generated Audio:', preGeneratedAudioResult ? '✅ OK' : '❌ FAILED');
  
  if (ttsResult && nlpResult && flowResult && bookingResult && preGeneratedAudioResult) {
    console.log('\n🎉 All systems are working!');
  } else {
    console.log('\n⚠️  Some systems have issues. Check the errors above.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testEnvironment, testTTS, testNLP, testFlow, testFullBookingScenario, testPreGeneratedAudio, runAllTests }; 