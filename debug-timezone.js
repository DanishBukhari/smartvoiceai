// Debug timezone handling
console.log('🔍 DEBUGGING TIMEZONE HANDLING');

// Test 1: Create date for tomorrow 2PM
const now = new Date();
const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
const targetDate = new Date(brisbaneTime.getFullYear(), brisbaneTime.getMonth(), brisbaneTime.getDate() + 1);

console.log('📅 Target date (tomorrow):', targetDate.toDateString());

// Test 2: Create 2PM on that date
const startTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 14, 0, 0, 0);

console.log('🕐 Created start time:', startTime);
console.log('🕐 Start time UTC:', startTime.toISOString());
console.log('🕐 Start time local:', startTime.toLocaleString());

// Test 3: Display in Brisbane timezone
console.log('🕐 Brisbane display:', startTime.toLocaleString('en-AU', { 
  timeZone: 'Australia/Brisbane',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
}));

// Test 4: Check what timezone the system thinks it's in
console.log('🌍 System timezone offset:', now.getTimezoneOffset(), 'minutes');
console.log('🌍 System timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);

// Test 5: Create date directly in Brisbane timezone
const brisbaneDate = new Date();
brisbaneDate.setHours(14, 0, 0, 0);
console.log('🕐 Brisbane direct:', brisbaneDate.toLocaleString('en-AU', { 
  timeZone: 'Australia/Brisbane',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
}));
