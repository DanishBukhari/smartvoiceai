// Debug the generateDayTimeSlots function to see why no slots are generated
const timeHandler = require('./modules/timePreferenceHandler');

console.log('🔍 DEBUGGING generateDayTimeSlots function\n');

// Test preference
const preference = {
  timeOfDay: 'afternoon',
  urgency: 'urgent',
  dayPreference: 'today',
  specificTime: null,
  flexibleDays: []
};

console.log('🧠 Testing preference:', preference);

// Create a test date
const now = new Date();
const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
console.log('🕰️ Current Brisbane time:', brisbaneTime.toLocaleString());

// Test generateDayTimeSlots directly
console.log('\n🧪 Testing generateDayTimeSlots with Brisbane time...');

// Import the internal function for testing
const fs = require('fs');
const timeHandlerCode = fs.readFileSync('./modules/timePreferenceHandler.js', 'utf8');

// Extract the function by evaluating a subset
const functionMatch = timeHandlerCode.match(/function generateDayTimeSlots[\s\S]*?^}/m);
if (functionMatch) {
  eval(functionMatch[0]);
  
  // Test the function
  const testSlots = generateDayTimeSlots(brisbaneTime, preference);
  console.log(`📊 Direct test generated ${testSlots.length} slots`);
  
  if (testSlots.length > 0) {
    console.log('🎯 First slot details:', testSlots[0]);
  }
} else {
  console.log('❌ Could not extract generateDayTimeSlots function');
}

// Also test the full generateTimeSlots function 
console.log('\n🧪 Testing full generateTimeSlots function...');
const fullSlots = timeHandler.generateTimeSlots(preference);
console.log(`📊 Full test generated ${fullSlots.length} slots`);

console.log('\n=== DEBUG COMPLETE ===');
