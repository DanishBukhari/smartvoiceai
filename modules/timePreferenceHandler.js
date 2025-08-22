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
    
    // CRITICAL FIX: Return specific time request information for better customer communication
    const result = { 
      slots: sortedSlots.slice(0, 3), // Return top 3 options
      preference,
      needsClarification: false 
    };
    
    // Include specific time request info if customer requested a specific time
    if (preference.specificTime) {
      result.requestedSpecificTime = preference.specificTime;
      console.log(`🎯 Customer requested specific time: ${preference.specificTime.hour}:${preference.specificTime.minute.toString().padStart(2, '0')}`);
    }
    
    return result;
    
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
 * Parse natural language time preference - ENHANCED FOR SPECIFIC TIMES
 */
function parseTimePreference(input) {
  const inputLower = input.toLowerCase();
  
  const preference = {
    timeOfDay: null, // 'morning', 'afternoon', 'evening'
    urgency: 'normal', // 'urgent', 'today', 'normal'
    dayPreference: null, // 'today', 'tomorrow', 'this_week', 'next_week'
    specificTime: null, // ENHANCED: Store specific time requests like "2pm", "14:00"
    flexibleDays: []
  };
  
  // CRITICAL FIX: Parse specific time requests (2PM, 3PM, 14:00, etc.)
  const timePatterns = [
    // Pattern for times with minutes and PM/AM (e.g., "3:30 PM", "2:15 am")
    /(\d{1,2}):(\d{2})\s*(pm|p\.m\.|p\.m|am|a\.m\.|a\.m)/i,
    // Pattern for hour-only times with PM/AM (e.g., "2pm", "9 am")
    /(\d{1,2})\s*(pm|p\.m\.|p\.m|am|a\.m\.|a\.m)/i,
    // Pattern for 24-hour format (e.g., "14:30", "09:00")
    /(\d{1,2}):(\d{2})(?!\s*(?:pm|am))/i
  ];
  
  for (const pattern of timePatterns) {
    const match = inputLower.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      let minute = 0;
      let meridian = null;
      
      // Handle different pattern captures based on match groups
      if (match[2] && match[3]) {
        // Pattern with minutes and meridian (e.g., "3:30 PM")
        minute = parseInt(match[2]);
        meridian = match[3];
      } else if (match[2] && !match[3]) {
        // Pattern with only meridian (e.g., "2 PM") or only minutes (24-hour)
        if (isNaN(parseInt(match[2]))) {
          // It's a meridian (PM/AM)
          meridian = match[2];
        } else {
          // It's minutes (24-hour format)
          minute = parseInt(match[2]);
        }
      }
      
      // Convert to 24-hour format if meridian is present
      if (meridian) {
        const isPM = meridian.toLowerCase().includes('pm') || meridian.toLowerCase().includes('p.m');
        const isAM = meridian.toLowerCase().includes('am') || meridian.toLowerCase().includes('a.m');
        
        if (isPM && hour !== 12) {
          hour += 12;
        } else if (isAM && hour === 12) {
          hour = 0;
        }
      }
      
      preference.specificTime = { hour, minute };
      console.log(`🕐 Specific time parsed: ${hour}:${minute.toString().padStart(2, '0')}`);
      break;
    }
  }
  
  // Parse time of day (if no specific time)
  if (!preference.specificTime) {
    if (inputLower.includes('morning') || inputLower.includes('am') || 
        inputLower.includes('early')) {
      preference.timeOfDay = 'morning';
    } else if (inputLower.includes('afternoon') || 
               (inputLower.includes('pm') && !inputLower.includes('evening'))) {
      preference.timeOfDay = 'afternoon';
    } else if (inputLower.includes('evening') || inputLower.includes('night')) {
      preference.timeOfDay = 'evening';
    }
  } else {
    // Determine time of day based on specific time
    const hour = preference.specificTime.hour;
    if (hour >= 5 && hour < 12) {
      preference.timeOfDay = 'morning';
    } else if (hour >= 12 && hour < 16) {
      preference.timeOfDay = 'afternoon';
    } else {
      preference.timeOfDay = 'evening';
    }
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
  
  // If we have clear day preference (today, tomorrow) OR time preference, NOT vague
  if (preference.dayPreference || preference.timeOfDay || preference.specificTime) {
    console.log('🎯 Clear preference detected:', { 
      day: preference.dayPreference, 
      time: preference.timeOfDay 
    });
    return false;
  }
  
  // Generic responses that don't provide useful info
  const actuallyVagueResponses = [
    'maybe', 'not sure', 'anytime', 'whenever', 'flexible', 'doesn\'t matter',
    'neither', 'i don\'t know'
  ];
  
  const isVague = actuallyVagueResponses.some(vague => inputLower.includes(vague));
  
  // If no specific time preference was detected AND it's a vague response
  const hasNoTimeInfo = !preference.timeOfDay && !preference.dayPreference && 
                       !preference.specificTime && preference.flexibleDays.length === 0;
  
  console.log('🔍 Vague check:', {
    input: inputLower,
    hasTimeInfo: !hasNoTimeInfo,
    isVagueResponse: isVague,
    result: isVague && hasNoTimeInfo
  });
  
  return isVague && hasNoTimeInfo;
}

/**
 * Generate time slots based on preference - FIXED FOR TODAY PREFERENCE
 */
function generateTimeSlots(preference) {
  const slots = [];
  const now = new Date();
  const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
  
  // Determine start date based on preference
  let startDate = new Date(brisbaneTime);
  let maxDays = 7; // Generate slots for the next 7 days
  
  if (preference.dayPreference === 'today') {
    // CRITICAL FIX: For today, generate slots for TODAY if possible
    if (brisbaneTime.getHours() >= 20) {
      console.log('🕰️ Too late for today (after 8 PM), moving to tomorrow');
      startDate.setDate(startDate.getDate() + 1); // Move to tomorrow
      maxDays = 6; // Only need 6 more days since we skipped today
    } else {
      console.log('🕰️ Checking TODAY availability at', brisbaneTime.getHours() + ':' + brisbaneTime.getMinutes());
      // Keep startDate as today, but only generate TODAY slots
      maxDays = 1; // Only generate for today
    }
  } else if (preference.dayPreference === 'tomorrow') {
    startDate.setDate(startDate.getDate() + 1);
    maxDays = 1; // Only generate for tomorrow
  } else if (preference.dayPreference === 'next_week') {
    startDate.setDate(startDate.getDate() + 7);
  }
  
  // Generate slots for the determined number of days
  for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
    const slotDate = new Date(startDate);
    slotDate.setDate(slotDate.getDate() + dayOffset);
    
    // CRITICAL FIX: For specific "today" or "tomorrow" requests, ALWAYS honor them regardless of weekend
    const isSpecificDayRequest = (preference.dayPreference === 'today' || preference.dayPreference === 'tomorrow');
    
    // Skip weekends ONLY if it's not a specific day request and not flexible
    if (!isSpecificDayRequest && (slotDate.getDay() === 0 || slotDate.getDay() === 6)) {
      if (!preference.flexibleDays.includes('saturday') && 
          !preference.flexibleDays.includes('sunday')) {
        console.log(`⏩ Skipping weekend day: ${slotDate.toDateString()}`);
        continue;
      }
    }
    
    // If it's a specific day request and a weekend, inform but proceed
    if (isSpecificDayRequest && (slotDate.getDay() === 0 || slotDate.getDay() === 6)) {
      const dayName = slotDate.getDay() === 0 ? 'Sunday' : 'Saturday';
      console.log(`📅 Customer specifically requested ${preference.dayPreference.toUpperCase()} which is ${dayName} - honoring request`);
    }
    
    // CRITICAL FIX: For today preference, ensure we only generate TODAY slots
    if (preference.dayPreference === 'today' && dayOffset === 0) {
      const todaySlots = generateDayTimeSlots(slotDate, preference);
      slots.push(...todaySlots);
      console.log(`📅 Generated ${todaySlots.length} slots for TODAY: ${slotDate.toDateString()}`);
      break; // Only generate for today
    } else if (preference.dayPreference === 'tomorrow' && dayOffset === 0) {
      const tomorrowSlots = generateDayTimeSlots(slotDate, preference);
      slots.push(...tomorrowSlots);
      console.log(`📅 Generated ${tomorrowSlots.length} slots for TOMORROW: ${slotDate.toDateString()}`);
      break; // Only generate for tomorrow
    } else if (!preference.dayPreference || (preference.dayPreference !== 'today' && preference.dayPreference !== 'tomorrow')) {
      // Generate time slots for multiple days (normal case)
      const daySlots = generateDayTimeSlots(slotDate, preference);
      slots.push(...daySlots);
    }
  }
  
  return slots;
}

/**
 * Generate time slots for a specific day - ENHANCED FOR SPECIFIC TIMES
 */
function generateDayTimeSlots(date, preference) {
  const slots = [];
  const workingHours = {
    morning: [9, 10, 11],          // 9am-12pm 
    afternoon: [12, 13, 14, 15],   // 12pm-4pm (FIXED: True afternoon hours)
    evening: [16, 17, 18, 19]      // 4pm-8pm (FIXED: Evening starts at 4pm)
  };
  
  let hoursToGenerate = [];
  
  // CRITICAL FIX: Handle specific time requests first
  if (preference.specificTime) {
    const requestedHour = preference.specificTime.hour;
    const requestedMinute = preference.specificTime.minute;
    
    console.log(`🎯 Customer requested specific time: ${requestedHour}:${requestedMinute.toString().padStart(2, '0')}`);
    
    // Check if requested time is within working hours
    const allWorkingHours = [...workingHours.morning, ...workingHours.afternoon, ...workingHours.evening];
    if (allWorkingHours.includes(requestedHour)) {
      hoursToGenerate = [requestedHour];
      console.log(`✅ Requested time ${requestedHour}:${requestedMinute.toString().padStart(2, '0')} is within working hours`);
    } else {
      console.log(`❌ Requested time ${requestedHour}:${requestedMinute.toString().padStart(2, '0')} is outside working hours`);
      // Fall back to time of day
      if (preference.timeOfDay === 'morning') {
        hoursToGenerate = workingHours.morning;
      } else if (preference.timeOfDay === 'afternoon') {
        hoursToGenerate = workingHours.afternoon;
      } else if (preference.timeOfDay === 'evening') {
        hoursToGenerate = workingHours.evening;
      } else {
        hoursToGenerate = workingHours.afternoon; // Default to afternoon
      }
    }
  } else {
    // Original logic for time of day
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
  }
  
  // CRITICAL FIX: Proper date handling for Brisbane timezone
  const now = new Date();
  const brisbaneTime = new Date(now.toLocaleString("en-US", {timeZone: "Australia/Brisbane"}));
  let targetDate;
  
  if (preference.dayPreference === 'today') {
    // Use today's date in Brisbane timezone
    targetDate = new Date(brisbaneTime.getFullYear(), brisbaneTime.getMonth(), brisbaneTime.getDate());
    console.log('📅 Generating slots for TODAY:', targetDate.toDateString());
  } else if (preference.dayPreference === 'tomorrow') {
    // Use tomorrow's date in Brisbane timezone
    targetDate = new Date(brisbaneTime.getFullYear(), brisbaneTime.getMonth(), brisbaneTime.getDate() + 1);
    console.log('📅 Generating slots for TOMORROW:', targetDate.toDateString());
  } else {
    // Use the provided date, but normalize to Brisbane timezone
    targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    console.log('📅 Generating slots for DATE:', targetDate.toDateString());
  }
  
  hoursToGenerate.forEach(hour => {
    let minutesToGenerate;
    
    // If customer requested specific time, generate that exact time
    if (preference.specificTime && preference.specificTime.hour === hour) {
      minutesToGenerate = [preference.specificTime.minute];
      console.log(`🎯 Generating SPECIFIC requested time: ${hour}:${preference.specificTime.minute.toString().padStart(2, '0')}`);
    } else {
      // Generate standard 30-minute intervals
      minutesToGenerate = [0, 30];
    }
    
    minutesToGenerate.forEach(minute => {
      // CRITICAL FIX: Create date in Brisbane timezone (UTC+10)
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      const day = targetDate.getDate();
      
      // Create a date string in Brisbane timezone format and parse it
      const brisbaneTimeString = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00+10:00`;
      const startTime = new Date(brisbaneTimeString);
      
      const endTime = new Date(startTime.getTime() + 75 * 60000); // 1h 15m default duration
      
      console.log(`🕐 Generated slot: ${startTime.toLocaleString('en-AU', { 
        timeZone: 'Australia/Brisbane',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}`);
      
      slots.push({
        start: startTime,
        end: endTime,
        duration: 75,
        type: 'customer_preferred',
        preferenceMatch: calculatePreferenceMatch(hour, preference, minute)
      });
    });
  });
  
  return slots;
}

/**
 * Calculate how well a time slot matches customer preference
 */
function calculatePreferenceMatch(hour, preference, minute = 0) {
  let score = 50; // Base score
  
  // HIGHEST PRIORITY: Exact time match
  if (preference.specificTime && 
      preference.specificTime.hour === hour && 
      preference.specificTime.minute === minute) {
    score += 50; // Maximum bonus for exact time match
    console.log(`🎯 EXACT TIME MATCH: ${hour}:${minute.toString().padStart(2, '0')} - Score: ${score}`);
  }
  
  // Time of day preference
  if (preference.timeOfDay === 'morning' && hour <= 11) score += 30;
  else if (preference.timeOfDay === 'afternoon' && hour >= 12 && hour <= 15) score += 30; // FIXED: 12pm-4pm
  else if (preference.timeOfDay === 'evening' && hour >= 16) score += 30; // FIXED: 4pm+
  
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
