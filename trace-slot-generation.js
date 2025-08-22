// Simple debug test to trace the generateTimeSlots function flow
const timeHandler = require('./modules/timePreferenceHandler');

console.log('🔍 TRACING generateTimeSlots execution\n');

// Test preference - exactly what the live system sees
const preference = {
  timeOfDay: 'afternoon',
  urgency: 'urgent', 
  dayPreference: 'today',
  specificTime: null,
  flexibleDays: []
};

console.log('🧠 Testing preference:', preference);

// Show current time
const now = new Date();
const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
console.log('🕰️ Current Brisbane time:', brisbaneTime.toLocaleString());
console.log('🕰️ Current hour:', brisbaneTime.getHours());

// Test with manual timezone check
if (brisbaneTime.getHours() >= 20) {
  console.log('⏰ Too late for today (after 8 PM) - system should move to tomorrow');
} else {
  console.log('✅ Still accepting today bookings (before 8 PM)');
}

// Generate slots with full context
console.log('\n🔧 Calling generateTimeSlots...');
try {
  const slots = timeHandler.generateTimeSlots(preference);
  console.log(`📊 Generated ${slots.length} slots`);
  
  if (slots.length > 0) {
    console.log('🎯 Sample slots:');
    slots.slice(0, 3).forEach((slot, i) => {
      const startDate = new Date(slot.start);
      console.log(`  ${i + 1}. ${startDate.toDateString()} ${startDate.toLocaleTimeString()}`);
    });
  }
} catch (error) {
  console.error('❌ Error generating slots:', error.message);
}

console.log('\n=== TRACE COMPLETE ===');
