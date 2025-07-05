// Test script to verify environment variables and server startup
require('dotenv').config();

console.log('🔍 Testing Environment Variables...\n');

// Check all required environment variables
const requiredVars = [
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY', 
  'GHL_API_KEY',
  'GHL_LOCATION_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'OUTLOOK_CLIENT_ID',
  'OUTLOOK_TENANT_ID',
  'OUTLOOK_CLIENT_SECRET',
  'APP_URL'
];

let allGood = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: Set (${value.substring(0, 10)}...)`);
  } else {
    console.log(`❌ ${varName}: Missing`);
    allGood = false;
  }
});

console.log('\n🔍 Testing Module Imports...\n');

try {
  console.log('1. Testing express...');
  const express = require('express');
  console.log('✅ express loaded');
} catch (e) {
  console.log('❌ express error:', e.message);
  allGood = false;
}

try {
  console.log('2. Testing twilio...');
  const { handleVoice, handleSpeech } = require('./twilio');
  console.log('✅ twilio handlers loaded');
} catch (e) {
  console.log('❌ twilio error:', e.message);
  allGood = false;
}

try {
  console.log('3. Testing flow...');
  const { handleInput } = require('./flow');
  console.log('✅ flow loaded');
} catch (e) {
  console.log('❌ flow error:', e.message);
  allGood = false;
}

try {
  console.log('4. Testing nlp...');
  const { getResponse } = require('./nlp');
  console.log('✅ nlp loaded');
} catch (e) {
  console.log('❌ nlp error:', e.message);
  allGood = false;
}

try {
  console.log('5. Testing tts...');
  const { synthesizeBuffer } = require('./tts');
  console.log('✅ tts loaded');
} catch (e) {
  console.log('❌ tts error:', e.message);
  allGood = false;
}

try {
  console.log('6. Testing outlook...');
  const { getAccessToken } = require('./outlook');
  console.log('✅ outlook loaded');
} catch (e) {
  console.log('❌ outlook error:', e.message);
  allGood = false;
}

try {
  console.log('7. Testing ghl...');
  const { createOrUpdateContact } = require('./ghl');
  console.log('✅ ghl loaded');
} catch (e) {
  console.log('❌ ghl error:', e.message);
  allGood = false;
}

console.log('\n📊 Test Results:');
if (allGood) {
  console.log('🎉 All tests passed! Your server should work correctly.');
  console.log('\n🚀 Starting server...');
  
  // Start the server
  const app = require('./index');
  
} else {
  console.log('⚠️ Some tests failed. Please check the errors above.');
  console.log('\n💡 Solutions:');
  console.log('1. Create a .env file with your API keys');
  console.log('2. Or set environment variables manually in your terminal');
  console.log('3. Make sure all dependencies are installed: npm install');
} 