/**
 * Time Preference Handler
 * Handles customer time preferences and finds available appointment slots
 */

/**
 * Parse customer time preference and find available slots
 */
async function findAvailableSlots(timePreference, customerData = {}) {
  console.log('🔍 Finding available slots for preference:', timePreference);
  
  try {
    const preference = parseTimePreference(timePreference);
    console.log('📅 Parsed preference:', preference);
    
    // Check if preference is too vague and needs clarification
    if (isPreferenceVague(preference, timePreference)) {
      console.log('❓ Preference too vague, needs clarification');
      return { needsClarification: true, preference };
    }
    
    // Get existing appointments to check availability
    const { getExistingAppointments } = require('./smartScheduler');
    const existingAppointments = await getExistingAppointments();
    
    // Generate possible slots based on preference
    const possibleSlots = generateTimeSlots(preference);
    
    // Filter out conflicting appointments
    const availableSlots = filterAvailableSlots(possibleSlots, existingAppointments);
    
    // Sort by preference match and time
    const sortedSlots = sortSlotsByPreference(availableSlots, preference);
    
    console.log(`✅ Found ${sortedSlots.length} available slots`);
    return { 
      slots: sortedSlots.slice(0, 3), // Return top 3 options
      preference,
      needsClarification: false 
    };
    
  } catch (error) {
    console.error('Error finding available slots:', error);
    // Return fallback slots
    return { 
      slots: generateFallbackSlots(), 
      needsClarification: false 
    };
  }
}

/**
 * Parse natural language time preference
 */
function parseTimePreference(input) {
  const inputLower = input.toLowerCase();
  
  const preference = {
    timeOfDay: null, // 'morning', 'afternoon', 'evening'
    urgency: 'normal', // 'urgent', 'today', 'normal'
    dayPreference: null, // 'today', 'tomorrow', 'this_week', 'next_week'
    specificTime: null,
    flexibleDays: []
  };
  
  // Parse time of day
  if (inputLower.includes('morning') || inputLower.includes('am') || 
      inputLower.includes('early') || inputLower.includes('8') || 
      inputLower.includes('9') || inputLower.includes('10')) {
    preference.timeOfDay = 'morning';
  } else if (inputLower.includes('afternoon') || inputLower.includes('pm') || 
             inputLower.includes('1') || inputLower.includes('2') || 
             inputLower.includes('3') || inputLower.includes('4')) {
    preference.timeOfDay = 'afternoon';
  } else if (inputLower.includes('evening') || inputLower.includes('night') || 
             inputLower.includes('5') || inputLower.includes('6')) {
    preference.timeOfDay = 'evening';
  }
  
  // Parse urgency and day preference
  if (inputLower.includes('today') || inputLower.includes('now') || 
      inputLower.includes('asap') || inputLower.includes('urgent')) {
    preference.urgency = 'urgent';
    preference.dayPreference = 'today';
  } else if (inputLower.includes('tomorrow')) {
    preference.dayPreference = 'tomorrow';
  } else if (inputLower.includes('this week') || inputLower.includes('soon')) {
    preference.dayPreference = 'this_week';
  } else if (inputLower.includes('next week')) {
    preference.dayPreference = 'next_week';
  }
  
  // Parse specific days
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  days.forEach(day => {
    if (inputLower.includes(day)) {
      preference.flexibleDays.push(day);
    }
  });
  
  return preference;
}

/**
 * Check if the preference is too vague and needs clarification
 */
function isPreferenceVague(preference, originalInput) {
  const inputLower = originalInput.toLowerCase().trim();
  
  // Very short responses that don't provide useful info
  if (inputLower.length < 5) return true;
  
  // Generic responses that don't specify preference
  const vagueResponses = [
    'i would like', 'i want', 'i prefer', 'i need', 'maybe', 'not sure',
    'anytime', 'whenever', 'flexible', 'doesn\'t matter'
  ];
  
  const isVague = vagueResponses.some(vague => inputLower.includes(vague));
  
  // If no specific time preference was detected
  const hasNoTimeInfo = !preference.timeOfDay && !preference.dayPreference && 
                       !preference.specificTime && preference.flexibleDays.length === 0;
  
  return isVague || hasNoTimeInfo;
}

/**
 * Generate time slots based on preference
 */
function generateTimeSlots(preference) {
  const slots = [];
  const now = new Date();
  const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
  
  // Determine start date based on preference
  let startDate = new Date(brisbaneTime);
  
  if (preference.dayPreference === 'today') {
    // Check if it's still reasonable to book today (before 4 PM)
    if (brisbaneTime.getHours() >= 16) {
      startDate.setDate(startDate.getDate() + 1); // Move to tomorrow
    }
  } else if (preference.dayPreference === 'tomorrow') {
    startDate.setDate(startDate.getDate() + 1);
  } else if (preference.dayPreference === 'next_week') {
    startDate.setDate(startDate.getDate() + 7);
  }
  
  // Generate slots for the next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const slotDate = new Date(startDate);
    slotDate.setDate(slotDate.getDate() + dayOffset);
    
    // Skip weekends unless specifically requested
    if (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
      if (!preference.flexibleDays.includes('saturday') && 
          !preference.flexibleDays.includes('sunday')) {
        continue;
      }
    }
    
    // Generate time slots based on preference
    const timeSlots = generateDayTimeSlots(slotDate, preference);
    slots.push(...timeSlots);
  }
  
  return slots;
}

/**
 * Generate time slots for a specific day
 */
function generateDayTimeSlots(date, preference) {
  const slots = [];
  const workingHours = {
    morning: [9, 10, 11],          // 9am-12pm 
    afternoon: [13, 14, 15, 16],   // 1pm-5pm (FIXED: was including evening)
    evening: [17, 18, 19]          // 5pm-8pm (FIXED: proper evening hours)
  };
  
  let hoursToGenerate = [];
  
  if (preference.timeOfDay === 'morning') {
    hoursToGenerate = workingHours.morning;
  } else if (preference.timeOfDay === 'afternoon') {
    hoursToGenerate = workingHours.afternoon;
    console.log('🕐 Generating AFTERNOON slots for hours:', hoursToGenerate);
  } else if (preference.timeOfDay === 'evening') {
    hoursToGenerate = workingHours.evening;
  } else {
    // No specific preference, offer all times but prioritize morning/afternoon
    hoursToGenerate = [...workingHours.morning, ...workingHours.afternoon];
  }
  
  // CRITICAL FIX: For tomorrow preference, ensure we're generating for tomorrow IN BRISBANE TIME
  let targetDate;
  if (preference.dayPreference === 'tomorrow') {
    // Create date in Brisbane timezone
    const now = new Date();
    const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
    targetDate = new Date(brisbaneTime.getFullYear(), brisbaneTime.getMonth(), brisbaneTime.getDate() + 1);
    console.log('📅 Generating slots for TOMORROW:', targetDate.toDateString());
    date = targetDate;
  } else {
    // Use the provided date, but ensure it's in Brisbane context
    const brisbaneTime = new Date(date.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
    targetDate = new Date(brisbaneTime.getFullYear(), brisbaneTime.getMonth(), brisbaneTime.getDate());
    date = targetDate;
  }
  
  hoursToGenerate.forEach(hour => {
    // Generate slots at 00 and 30 minutes - CRITICAL FIX: Create in Brisbane timezone
    [0, 30].forEach(minute => {
      // Create the date object properly in Brisbane timezone
      // Brisbane is UTC+10, so we need to create the date correctly
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+10:00`;
      const startTime = new Date(dateStr);
      
      const endTime = new Date(startTime.getTime() + 75 * 60000); // 1h 15m default duration
      
      slots.push({
        start: startTime,
        end: endTime,
        duration: 75,
        type: 'customer_preferred',
        preferenceMatch: calculatePreferenceMatch(hour, preference)
      });
    });
  });
  
  return slots;
}

/**
 * Calculate how well a time slot matches customer preference
 */
function calculatePreferenceMatch(hour, preference) {
  let score = 50; // Base score
  
  if (preference.timeOfDay === 'morning' && hour <= 11) score += 30;
  else if (preference.timeOfDay === 'afternoon' && hour >= 13 && hour <= 16) score += 30;
  else if (preference.timeOfDay === 'evening' && hour >= 17) score += 30;
  
  if (preference.urgency === 'urgent') score += 20;
  
  return score;
}

/**
 * Filter slots to remove conflicts with existing appointments
 */
function filterAvailableSlots(possibleSlots, existingAppointments) {
  return possibleSlots.filter(slot => {
    return !existingAppointments.some(existing => {
      const existingStart = new Date(existing.start);
      const existingEnd = new Date(existing.end);
      
      // Check for any overlap
      return (slot.start < existingEnd && slot.end > existingStart);
    });
  });
}

/**
 * Sort slots by preference match and time
 */
function sortSlotsByPreference(slots, preference) {
  return slots.sort((a, b) => {
    // First priority: preference match score
    if (b.preferenceMatch !== a.preferenceMatch) {
      return b.preferenceMatch - a.preferenceMatch;
    }
    
    // Second priority: earlier time for urgent requests
    if (preference.urgency === 'urgent') {
      return a.start - b.start;
    }
    
    // Third priority: normal chronological order
    return a.start - b.start;
  });
}

/**
 * Generate fallback slots when main system fails
 */
function generateFallbackSlots() {
  const slots = [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Generate a few basic slots for tomorrow
  [9, 14, 16].forEach(hour => {
    const startTime = new Date(tomorrow);
    startTime.setHours(hour, 0, 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 1, 15);
    
    slots.push({
      start: startTime,
      end: endTime,
      duration: 75,
      type: 'fallback',
      preferenceMatch: 50
    });
  });
  
  return slots;
}

module.exports = {
  findAvailableSlots,
  parseTimePreference,
  generateTimeSlots,
  filterAvailableSlots,
  sortSlotsByPreference,
  isPreferenceVague
};
