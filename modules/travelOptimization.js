// modules/travelOptimization.js - Travel time calculation and scheduling optimization
const { getLastAppointment } = require('../outlook');

// Global cache for travel time calculations
const travelTimeCache = new Map();
let lastBookedJobLocation = 'Brisbane CBD, QLD 4000, Australia'; // Default starting location

async function calculateTravelTime(origin, destination) {
  const cacheKey = `${origin}->${destination}`;
  
  // Check cache first
  if (travelTimeCache.has(cacheKey)) {
    const cached = travelTimeCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
      console.log('🚗 Using cached travel time:', cached.duration);
      return cached.duration;
    }
  }
  
  try {
    // Check if Google Maps API key is available
    if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY === 'your_google_maps_api_key_here') {
      console.log('🗺️ Google Maps API key not configured, using Brisbane estimates');
      const fallbackTime = estimateBrisbaneTravelTime(origin, destination);
      console.log(`🚗 Using Brisbane geographic estimate: ${fallbackTime}`);
      return fallbackTime;
    }
    
    // Use Google Maps API for accurate travel times
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?` +
      `origins=${encodeURIComponent(origin)}&` +
      `destinations=${encodeURIComponent(destination)}&` +
      `mode=driving&` +
      `departure_time=now&` +
      `traffic_model=best_guess&` +
      `key=${process.env.GOOGLE_MAPS_API_KEY}`
    );
    
    const data = await response.json();
    
    // Check for API errors
    if (data.error_message) {
      console.log(`🗺️ Google Maps API error: ${data.error_message}`);
      
      // If it's a billing error, fall back to Brisbane estimates
      if (data.error_message.includes('billing') || data.error_message.includes('Billing')) {
        console.log('💳 Google Maps API billing not enabled, using Brisbane estimates');
        const fallbackTime = estimateBrisbaneTravelTime(origin, destination);
        console.log(`🚗 Using Brisbane geographic estimate: ${fallbackTime}`);
        return fallbackTime;
      }
      
      throw new Error(`Google Maps API error: ${data.status}`);
    }
    
    if (data.status === 'REQUEST_DENIED') {
      console.log('🗺️ Google Maps API request denied (likely billing issue), using Brisbane estimates');
      const fallbackTime = estimateBrisbaneTravelTime(origin, destination);
      console.log(`🚗 Using Brisbane geographic estimate: ${fallbackTime}`);
      return fallbackTime;
    }
    
    if (data.status === 'OK' && data.rows[0]?.elements[0]?.status === 'OK') {
      const element = data.rows[0].elements[0];
      const duration = element.duration_in_traffic?.text || element.duration?.text;
      
      // Cache the result
      travelTimeCache.set(cacheKey, {
        duration,
        timestamp: Date.now()
      });
      
      console.log(`🚗 Travel time from ${origin} to ${destination}: ${duration}`);
      return duration;
    } else {
      throw new Error(`Google Maps API error: ${data.status}`);
    }
  } catch (error) {
    console.error('Travel time calculation failed:', error);
    
    // Fallback to Brisbane distance estimates
    const fallbackTime = estimateBrisbaneTravelTime(origin, destination);
    console.log(`🚗 Using fallback travel time: ${fallbackTime}`);
    return fallbackTime;
  }
}

function estimateBrisbaneTravelTime(origin, destination) {
  // Enhanced fallback based on Brisbane geography
  if (!destination || typeof destination !== 'string') {
    console.log('⚠️ Invalid destination for travel time estimation');
    return '20-30 minutes'; // Default fallback
  }
  
  const destLower = destination.toLowerCase();
  const originLower = (origin || '').toLowerCase();
  
  // Same location check
  if (origin && destination && originLower.includes(destLower.split(',')[0]) || destLower.includes(originLower.split(',')[0])) {
    return '5-10 minutes';
  }
  
  // Brisbane area estimates
  if (destLower.includes('cbd') || destLower.includes('city') || destLower.includes('george street') || destLower.includes('queen street')) {
    return '15-25 minutes';
  } else if (destLower.includes('north') || destLower.includes('chermside') || destLower.includes('albion') || destLower.includes('fortitude valley')) {
    return '20-30 minutes';
  } else if (destLower.includes('south') || destLower.includes('sunnybank') || destLower.includes('logan')) {
    return '25-35 minutes';
  } else if (destLower.includes('west') || destLower.includes('toowong') || destLower.includes('indooroopilly')) {
    return '20-30 minutes';
  } else if (destLower.includes('east') || destLower.includes('carindale') || destLower.includes('wynnum')) {
    return '25-35 minutes';
  } else {
    return '20-30 minutes'; // Default Brisbane estimate
  }
}

async function findMostEfficientSlot(accessToken, customerAddress, issueDescription, priority = 'standard', earliestTime = null) {
  try {
    console.log('🎯 Finding most efficient appointment slot...');
    
    // Set default earliest time if not provided
    if (!earliestTime) {
      earliestTime = new Date();
      earliestTime.setHours(earliestTime.getHours() + 1); // Default to 1 hour from now
    }
    
    // Get the last appointment location for travel optimization and update our tracking
    const lastAppointment = await getLastAppointment(accessToken, earliestTime);
    
    // Automatically update lastBookedJobLocation with the actual last appointment address
    if (lastAppointment && lastAppointment.location) {
      lastBookedJobLocation = lastAppointment.location;
      console.log(`📍 Updated last booked job location to: ${lastBookedJobLocation}`);
    }
    
    const startLocation = lastBookedJobLocation;
    
    console.log(`📍 Starting location: ${startLocation}`);
    console.log(`📍 Customer location: ${customerAddress}`);
    
    // Calculate travel time
    const travelTime = await calculateTravelTime(startLocation, customerAddress);
    const travelMinutes = extractMinutesFromTravelTime(travelTime);
    
    // Calculate service duration based on issue type
    const serviceDuration = calculateServiceDuration(issueDescription);
    
    // Total buffer: job completion (30 min) + travel time + service duration
    const totalBuffer = 30 + travelMinutes + serviceDuration;
    
    console.log(`⏱️ Travel time: ${travelTime} (${travelMinutes} minutes)`);
    console.log(`🔧 Service duration: ${serviceDuration} minutes`);
    console.log(`⏰ Total buffer needed: ${totalBuffer} minutes`);
    
    // Find next available slot with buffer
    const nextSlot = await getNextAvailableSlotWithBuffer(accessToken, totalBuffer, earliestTime, priority);
    
    if (nextSlot) {
      // Update last booked location for next calculation
      lastBookedJobLocation = customerAddress;
      console.log(`📍 Setting next starting location to: ${customerAddress}`);
      
      return {
        slot: nextSlot,
        travelTime,
        serviceDuration,
        totalBuffer,
        startLocation
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error finding efficient slot:', error);
    return null;
  }
}

function calculateServiceDuration(issueDescription) {
  const issue = issueDescription.toLowerCase();
  
  // Emergency jobs take longer
  if (issue.includes('burst') || issue.includes('flood') || issue.includes('emergency')) {
    return 90; // 1.5 hours for emergencies
  }
  
  // Hot water system issues typically take longer
  if (issue.includes('hot water') || issue.includes('water heater')) {
    return 75; // 1.25 hours
  }
  
  // Installation and major repairs
  if (issue.includes('install') || issue.includes('replace') || issue.includes('new')) {
    return 120; // 2 hours
  }
  
  // Standard repairs (toilet, tap, minor leaks)
  return 60; // 1 hour for standard jobs
}

function extractMinutesFromTravelTime(travelTimeString) {
  if (!travelTimeString) return 20; // Default
  
  const hourMatch = travelTimeString.match(/(\d+)\s*hour/i);
  const minuteMatch = travelTimeString.match(/(\d+)\s*min/i);
  
  let totalMinutes = 0;
  
  if (hourMatch) {
    totalMinutes += parseInt(hourMatch[1]) * 60;
  }
  
  if (minuteMatch) {
    totalMinutes += parseInt(minuteMatch[1]);
  }
  
  // If no time found, extract from range (e.g., "20-30 minutes")
  if (totalMinutes === 0) {
    const rangeMatch = travelTimeString.match(/(\d+)-(\d+)/);
    if (rangeMatch) {
      totalMinutes = Math.ceil((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
    }
  }
  
  // Fallback
  return totalMinutes || 20;
}

async function getNextAvailableSlotWithBuffer(accessToken, bufferMinutes, earliestTime = null, priority = 'standard') {
  const { getNextAvailableSlot, isSlotFree } = require('../outlook');
  
  try {
    // For emergency priority, find the very next slot
    if (priority === 'urgent' || priority === 'emergency') {
      const emergencySlot = await getNextAvailableSlot(accessToken, new Date());
      if (emergencySlot) {
        console.log('🚨 Emergency slot allocated:', emergencySlot);
        return emergencySlot;
      }
    }
    
    // Calculate the earliest possible start time with buffer
    const now = new Date();
    const bufferTime = new Date(now.getTime() + bufferMinutes * 60000);
    const startTime = earliestTime ? new Date(Math.max(earliestTime.getTime(), bufferTime.getTime())) : bufferTime;
    
    // Round up to next 30-minute slot
    const roundedTime = roundToNextAppointmentSlot(startTime);
    
    console.log(`🕐 Looking for slots starting from: ${roundedTime.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
    
    // Get the next available slot
    const slot = await getNextAvailableSlot(accessToken, roundedTime);
    
    if (slot && await isSlotFree(accessToken, slot.start, slot.end)) {
      return slot;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting slot with buffer:', error);
    return null;
  }
}

function roundToNextAppointmentSlot(date) {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  
  // Round to next 30-minute interval
  if (minutes <= 30) {
    rounded.setMinutes(30, 0, 0);
  } else {
    rounded.setHours(rounded.getHours() + 1, 0, 0, 0);
  }
  
  return rounded;
}

/**
 * Update the last booked job location to be used for travel optimization
 * This should be called whenever a new appointment is successfully booked
 */
function updateLastBookedJobLocation(customerAddress) {
  if (customerAddress && typeof customerAddress === 'string') {
    lastBookedJobLocation = customerAddress;
    console.log(`📍 Last booked job location updated to: ${customerAddress}`);
  }
}

/**
 * Get the current last booked job location
 */
function getLastBookedJobLocation() {
  return lastBookedJobLocation;
}

/**
 * Automatically refresh the last booked job location from calendar
 * This can be called periodically or when the system starts
 */
async function refreshLastBookedJobLocation(accessToken) {
  try {
    const lastAppointment = await getLastAppointment(accessToken, new Date());
    if (lastAppointment && lastAppointment.location) {
      lastBookedJobLocation = lastAppointment.location;
      console.log(`🔄 Refreshed last booked job location from calendar: ${lastBookedJobLocation}`);
      return lastBookedJobLocation;
    }
  } catch (error) {
    console.log('⚠️ Could not refresh last booked job location from calendar:', error.message);
  }
  return lastBookedJobLocation;
}

module.exports = {
  calculateTravelTime,
  findMostEfficientSlot,
  calculateServiceDuration,
  extractMinutesFromTravelTime,
  roundToNextAppointmentSlot,
  estimateBrisbaneTravelTime,
  updateLastBookedJobLocation,
  getLastBookedJobLocation,
  refreshLastBookedJobLocation
};
