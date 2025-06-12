require('dotenv').config();
const twilio = require('twilio');
const { handleInput } = require('./flow');
const { synthesizeSpeech } = require('./tts');
const fs = require('fs');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function simulateCall(testInput) {
  try {
    // Simulate user input
    console.log('Simulated User Input:', testInput);
    const responseText = await handleInput(testInput);
    console.log('Robyn Response:', responseText);
    const audioPath = await synthesizeSpeech(responseText);
    console.log('Audio Generated:', audioPath);

    // Simulate Twilio call to log in GHL (optional)
    await client.calls.create({
      url: `https://smartvoiceai-fa77bfa7f137.herokuapp.com/voice`,
      to: process.env.TWILIO_PHONE_NUMBER,
      from: process.env.TWILIO_PHONE_NUMBER,
      record: true,
    });
    console.log('Simulated Call Initiated');
  } catch (error) {
    console.error('Simulated Call Error:', error);
  }
}

// Test with sample input
simulateCall('My toilet is leaking');