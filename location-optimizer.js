// location-optimizer.js - Smart location-based booking optimization

// Australian timezone configuration
const BRISBANE_TZ = 'Australia/Brisbane';

// Cache for location data and clustering
const locationCache = new Map();
const clusterCache = new Map();

// Service area definition for Brisbane
const SERVICE_AREA = {
  center: { lat: -27.4698, lng: 153.0251 }, // Brisbane CBD
  maxRadius: 50, // 50km max service radius
  preferredRadius: 25, // 25km preferred radius for efficient scheduling
};

// Daily booking clusters - group nearby appointments
let dailyBookings = new Map(); // date -> array of bookings

// Location clustering configuration
const CLUSTER_CONFIG = {
  maxClusterRadius: 10, // km - max distance between locations in same cluster
  minClusterSize: 2, // minimum bookings to form a cluster
  maxClusterSize: 6, // maximum bookings per cluster per day
  travelTimeBuffer: 15, // minutes buffer between appointments
  jobCompletionBuffer: 15, // minutes buffer for unexpected delays
};

// Job duration estimation based on issue type and complexity
const JOB_DURATION_ESTIMATES = {
  // Toilet issues
  toilet: {
    basic: 60, // minutes - simple repairs, adjustments
    moderate: 90, // minutes - part replacements, blockages
    complex: 120, // minutes - major repairs, installations
    urgent: 45, // minutes - emergency fixes
  },
  
  // Tap/faucet issues  
  tap: {
    basic: 45, // minutes - washer replacement, minor leaks
    moderate: 75, // minutes - cartridge replacement, mixer repairs
    complex: 105, // minutes - complete tap replacement
    urgent: 30, // minutes - emergency shut-offs
  },
  
  // Hot water systems
  hotwater: {
    basic: 90, // minutes - element replacement, thermostat
    moderate: 120, // minutes - valve repairs, minor leaks
    complex: 180, // minutes - system replacement
    urgent: 60, // minutes - emergency repairs
  },
  
  // Blocked drains
  drain: {
    basic: 60, // minutes - simple blockages
    moderate: 90, // minutes - stubborn blockages, snaking
    complex: 150, // minutes - major blockages, excavation
    urgent: 45, // minutes - emergency clearing
  },
  
  // General plumbing
  general: {
    basic: 75, // minutes - standard repairs
    moderate: 105, // minutes - multiple issues
    complex: 135, // minutes - complex diagnostics
    urgent: 60, // minutes - emergency response
  },
  
  // Default fallback
  default: {
    basic: 90, // minutes - conservative estimate
    moderate: 120, // minutes - standard service call
    complex: 150, // minutes - complex job
    urgent: 75, // minutes - urgent response
  }
};

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(coord1, coord2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(coord2.lat - coord1.lat);
  const dLng = toRadians(coord2.lng - coord1.lng);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(coord1.lat)) * Math.cos(toRadians(coord2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Estimate job duration based on issue description and complexity
 */
function estimateJobDuration(issueDescription, urgencyLevel = 'normal') {
  console.log('🔧 Estimating job duration for:', issueDescription);
  
  // SAFETY: Ensure issueDescription is a string
  if (!issueDescription || typeof issueDescription !== 'string') {
    console.log('⚠️ Invalid issue description, using default');
    issueDescription = 'general plumbing repair';
  }
  
  const description = issueDescription.toLowerCase();
  let issueType = 'general';
  let complexity = 'moderate';
  
  // Determine issue type
  if (description.includes('toilet') || description.includes('cistern') || description.includes('flush')) {
    issueType = 'toilet';
  } else if (description.includes('tap') || description.includes('faucet') || description.includes('mixer')) {
    issueType = 'tap';
  } else if (description.includes('hot water') || description.includes('water heater') || description.includes('boiler')) {
    issueType = 'hotwater';
  } else if (description.includes('blocked') || description.includes('drain') || description.includes('clog')) {
    issueType = 'drain';
  }
  
  // Determine complexity level
  const urgentKeywords = ['emergency', 'urgent', 'flooding', 'burst', 'no water'];
  const complexKeywords = ['replacement', 'install', 'major', 'complete', 'renovation'];
  const basicKeywords = ['minor', 'small', 'slight', 'adjust', 'tighten'];
  
  if (urgentKeywords.some(keyword => description.includes(keyword))) {
    complexity = 'urgent';
  } else if (complexKeywords.some(keyword => description.includes(keyword))) {
    complexity = 'complex';
  } else if (basicKeywords.some(keyword => description.includes(keyword))) {
    complexity = 'basic';
  }
  
  // Override with urgency level if specified
  if (urgencyLevel === 'urgent' || urgencyLevel === 'emergency') {
    complexity = 'urgent';
  }
  
  // Get duration estimate
  const estimates = JOB_DURATION_ESTIMATES[issueType] || JOB_DURATION_ESTIMATES.default;
  const estimatedDuration = estimates[complexity] || estimates.moderate;
  
  console.log(`🎯 Job assessment: ${issueType}/${complexity} = ${estimatedDuration} minutes`);
  
  return {
    issueType,
    complexity,
    estimatedDuration, // in minutes
    bufferTime: CLUSTER_CONFIG.jobCompletionBuffer,
    totalDuration: estimatedDuration + CLUSTER_CONFIG.jobCompletionBuffer
  };
}

/**
 * Calculate next available booking slot with smart scheduling
 */
function calculateNextBookingSlot(previousJobEnd, travelTimeMinutes, jobDuration) {
  console.log('📅 Calculating next booking slot:');
  console.log(`   Previous job ends: ${previousJobEnd}`);
  console.log(`   Travel time: ${travelTimeMinutes} minutes`);
  console.log(`   Job duration: ${jobDuration.estimatedDuration} minutes`);
  
  // Calculate total buffer needed
  const totalBuffer = jobDuration.bufferTime + travelTimeMinutes;
  console.log(`   Total buffer needed: ${totalBuffer} minutes`);
  
  // Add buffer to previous job end time
  const nextSlotTime = new Date(previousJobEnd.getTime() + (totalBuffer * 60000));
  
  // Round to nearest 5-minute interval for professional scheduling
  const minutes = nextSlotTime.getMinutes();
  const roundedMinutes = Math.ceil(minutes / 5) * 5;
  nextSlotTime.setMinutes(roundedMinutes, 0, 0);
  
  console.log(`   Next available slot: ${nextSlotTime.toLocaleString('en-AU', { 
    timeZone: BRISBANE_TZ,
    dateStyle: 'short',
    timeStyle: 'short'
  })}`);
  
  return {
    slotTime: nextSlotTime,
    jobDuration: jobDuration,
    travelTime: travelTimeMinutes,
    totalBuffer: totalBuffer
  };
}

/**
 * Analyze location and suggest optimal booking time based on proximity to other bookings
 */
async function analyzeLocationForBooking(address, preferredDate = null) {
  console.log('🗺️ Analyzing location for optimal booking:', address);
  
  try {
    // Get coordinates for the address
    const coordinates = await getCoordinatesFromAddress(address);
    
    if (!coordinates) {
      console.log('⚠️ Could not geocode address, using standard booking');
      return {
        feasible: true,
        priority: 'standard',
        message: 'I can schedule your appointment. When would be convenient for you?',
        clusterInfo: null
      };
    }
    
    // Check if location is within service area
    const distanceFromCenter = calculateDistance(SERVICE_AREA.center, coordinates);
    
    if (distanceFromCenter > SERVICE_AREA.maxRadius) {
      return {
        feasible: false,
        priority: 'out_of_area',
        message: `I apologize, but ${address} is outside our service area. We service locations within ${SERVICE_AREA.maxRadius}km of Brisbane CBD. You're approximately ${Math.round(distanceFromCenter)}km away.`,
        clusterInfo: null
      };
    }
    
    // Analyze existing bookings for clustering opportunities
    const clusterAnalysis = await analyzeLocationClusters(coordinates, preferredDate);
    
    return {
      feasible: true,
      priority: clusterAnalysis.priority,
      message: clusterAnalysis.message,
      clusterInfo: clusterAnalysis,
      coordinates: coordinates,
      distanceFromCenter: distanceFromCenter
    };
    
  } catch (error) {
    console.error('❌ Location analysis failed:', error.message);
    return {
      feasible: true,
      priority: 'standard',
      message: 'I can schedule your appointment. When would be convenient for you?',
      clusterInfo: null
    };
  }
}

/**
 * Analyze existing bookings to find optimal clustering opportunities
 */
async function analyzeLocationClusters(newCoordinates, preferredDate) {
  console.log('🔍 Analyzing location clusters for optimal scheduling');
  
  // Get existing bookings for the next 7 days
  const upcoming = getUpcomingBookings(7);
  
  if (upcoming.length === 0) {
    return {
      priority: 'standard',
      message: 'I can schedule your appointment. When would be convenient for you?',
      suggestedDates: [],
      travelEfficiency: 'new_route'
    };
  }
  
  // Find clusters within efficient travel distance
  const nearbyBookings = [];
  const clusterOpportunities = [];
  
  for (const booking of upcoming) {
    if (booking.coordinates) {
      const distance = calculateDistance(newCoordinates, booking.coordinates);
      
      if (distance <= CLUSTER_CONFIG.maxClusterRadius) {
        nearbyBookings.push({
          ...booking,
          distance: distance
        });
      }
    }
  }
  
  if (nearbyBookings.length === 0) {
    return {
      priority: 'standard',
      message: 'I can schedule your appointment. When would be convenient for you?',
      suggestedDates: [],
      travelEfficiency: 'isolated'
    };
  }
  
  // Group nearby bookings by date
  const bookingsByDate = groupBookingsByDate(nearbyBookings);
  
  // Find optimal clustering opportunities
  for (const [date, bookings] of bookingsByDate) {
    if (bookings.length < CLUSTER_CONFIG.maxClusterSize) {
      clusterOpportunities.push({
        date: date,
        existingBookings: bookings.length,
        averageDistance: bookings.reduce((sum, b) => sum + b.distance, 0) / bookings.length,
        efficiency: calculateClusterEfficiency(bookings)
      });
    }
  }
  
  // Sort by efficiency (closest bookings first)
  clusterOpportunities.sort((a, b) => a.averageDistance - b.averageDistance);
  
  if (clusterOpportunities.length > 0) {
    const bestCluster = clusterOpportunities[0];
    const dateStr = new Date(bestCluster.date).toLocaleDateString('en-AU', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    return {
      priority: 'high_efficiency',
      message: `Great news! I can schedule your appointment on ${dateStr} when we'll already be servicing ${bestCluster.existingBookings} nearby location${bestCluster.existingBookings > 1 ? 's' : ''} in your area. This means faster service and better scheduling for everyone. Would ${dateStr} work for you?`,
      suggestedDates: clusterOpportunities.slice(0, 3).map(c => c.date),
      travelEfficiency: 'clustered',
      clusterDetails: bestCluster
    };
  }
  
  return {
    priority: 'standard',
    message: 'I can schedule your appointment. When would be convenient for you?',
    suggestedDates: [],
    travelEfficiency: 'standard'
  };
}

/**
 * Get upcoming bookings from cache/database
 */
function getUpcomingBookings(days = 7) {
  // This would typically query your booking database
  // For now, return mock data structure
  const mockBookings = [
    {
      id: 'booking1',
      date: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      address: '123 Queen Street, Brisbane City',
      coordinates: { lat: -27.4705, lng: 153.0260 },
      timeSlot: '09:00'
    },
    {
      id: 'booking2', 
      date: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      address: '456 Adelaide Street, Brisbane City',
      coordinates: { lat: -27.4698, lng: 153.0251 },
      timeSlot: '11:00'
    }
  ];
  
  return mockBookings.filter(booking => {
    const diffTime = booking.date.getTime() - Date.now();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  });
}

/**
 * Group bookings by date for cluster analysis
 */
function groupBookingsByDate(bookings) {
  const grouped = new Map();
  
  bookings.forEach(booking => {
    const dateKey = booking.date.toDateString();
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey).push(booking);
  });
  
  return grouped;
}

/**
 * Calculate efficiency score for a cluster
 */
function calculateClusterEfficiency(bookings) {
  if (bookings.length <= 1) return 0;
  
  // Calculate total travel time within cluster
  let totalDistance = 0;
  for (let i = 0; i < bookings.length - 1; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      totalDistance += bookings[i].distance;
    }
  }
  
  // Lower total distance = higher efficiency
  return 1 / (totalDistance + 1);
}

/**
 * Mock geocoding function - in production, use Google Maps API
 */
async function getCoordinatesFromAddress(address) {
  // Mock coordinates for testing - in production, use Google Maps Geocoding API
  const mockCoordinates = {
    '123 Queen Street, West Bend, Australia': { lat: -27.4698, lng: 153.0251 },
    '456 Adelaide Street, Brisbane': { lat: -27.4705, lng: 153.0260 },
    '789 George Street, Brisbane': { lat: -27.4710, lng: 153.0234 }
  };
  
  // Simple pattern matching for demo
  for (const [mockAddress, coords] of Object.entries(mockCoordinates)) {
    if (address.toLowerCase().includes(mockAddress.toLowerCase().substring(0, 10))) {
      return coords;
    }
  }
  
  // Default Brisbane area coordinates
  return { lat: -27.4698, lng: 153.0251 };
}

/**
 * Add a new booking to the daily clusters
 */
function addBookingToCluster(bookingDetails) {
  const dateKey = bookingDetails.date.toDateString();
  
  if (!dailyBookings.has(dateKey)) {
    dailyBookings.set(dateKey, []);
  }
  
  dailyBookings.get(dateKey).push(bookingDetails);
  
  console.log(`✅ Added booking to cluster for ${dateKey}. Total bookings: ${dailyBookings.get(dateKey).length}`);
}

/**
 * Get cluster status for a specific date
 */
function getClusterStatus(date) {
  const dateKey = date.toDateString();
  const bookings = dailyBookings.get(dateKey) || [];
  
  return {
    date: dateKey,
    bookingCount: bookings.length,
    hasCapacity: bookings.length < CLUSTER_CONFIG.maxClusterSize,
    efficiency: bookings.length > 1 ? 'clustered' : 'isolated'
  };
}

/**
 * Find optimal appointment slots that minimize travel distance
 * This function implements smart scheduling to reduce fuel consumption and travel time
 */
async function findOptimalTimeSlots(newCoordinates, preferredDate = null, accessToken) {
  console.log('🚗 SMART SCHEDULING: Finding optimal slots to minimize travel distance...');
  
  try {
    const startDate = preferredDate || new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // Next 7 days
    
    // Get existing appointments from Google Calendar
    const { google } = require('googleapis');
    const oauth2Client = new (require('google-auth-library')).OAuth2Client(
      process.env.GOOGLE_CLIENT_ID, 
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    const response = await calendar.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: 'plumbing OR appointment'
    });
    
    const existingAppointments = response.data.items.filter(event => 
      event.location && event.start.dateTime
    ).map(event => ({
      date: new Date(event.start.dateTime),
      address: event.location,
      coordinates: null // Will be geocoded if needed
    }));
    
    console.log(`🗓️ Found ${existingAppointments.length} existing appointments for optimization`);
    
    // Find optimal slots for each day
    const optimalSlots = [];
    
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const targetDate = new Date(startDate);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      
      const dayAppointments = existingAppointments.filter(apt => 
        apt.date.toDateString() === targetDate.toDateString()
      );
      
      if (dayAppointments.length === 0) {
        // No appointments this day - any slot is optimal
        const optimalTime = new Date(targetDate);
        optimalTime.setHours(9, 0, 0, 0); // Start at 9 AM
        
        optimalSlots.push({
          dateTime: optimalTime,
          efficiency: 'standard',
          travelDistance: 0,
          reason: 'First appointment of the day - no travel optimization needed',
          clusterOpportunity: false
        });
        continue;
      }
      
      // Find best insertion points that minimize total travel distance
      const bestSlots = await findBestInsertionSlots(
        dayAppointments, 
        newCoordinates, 
        targetDate
      );
      
      optimalSlots.push(...bestSlots);
    }
    
    // Sort by efficiency and travel distance
    optimalSlots.sort((a, b) => {
      const efficiencyWeight = { 'high_efficiency': 3, 'medium_efficiency': 2, 'standard': 1 };
      const aScore = efficiencyWeight[a.efficiency] - (a.travelDistance / 10);
      const bScore = efficiencyWeight[b.efficiency] - (b.travelDistance / 10);
      return bScore - aScore;
    });
    
    console.log(`🎯 Generated ${optimalSlots.length} optimal time slots`);
    console.log(`🏆 Best option: ${optimalSlots[0]?.reason}`);
    
    return optimalSlots.slice(0, 5); // Return top 5 optimal slots
    
  } catch (error) {
    console.error('❌ Error finding optimal slots:', error.message);
    return [];
  }
}

/**
 * Find the best time slots within a day to minimize travel distance
 */
async function findBestInsertionSlots(dayAppointments, newCoordinates, targetDate) {
  const slots = [];
  
  // Sort appointments by time
  dayAppointments.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Try inserting before first appointment
  if (dayAppointments.length > 0) {
    const firstApt = dayAppointments[0];
    const earlySlot = new Date(firstApt.date.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
    
    if (earlySlot.getHours() >= 8) { // Not before 8 AM
      const distance = await calculateTravelDistance(newCoordinates, firstApt.address);
      
      slots.push({
        dateTime: earlySlot,
        efficiency: distance < 10 ? 'high_efficiency' : distance < 25 ? 'medium_efficiency' : 'standard',
        travelDistance: distance,
        reason: `Scheduled before nearby appointment (${distance.toFixed(1)}km away)`,
        clusterOpportunity: distance < 10,
        nextAppointment: firstApt.address
      });
    }
  }
  
  // Try inserting between appointments
  for (let i = 0; i < dayAppointments.length - 1; i++) {
    const currentApt = dayAppointments[i];
    const nextApt = dayAppointments[i + 1];
    
    const timeBetween = nextApt.date.getTime() - currentApt.date.getTime();
    if (timeBetween >= 3 * 60 * 60 * 1000) { // At least 3 hours gap
      
      const insertionTime = new Date(currentApt.date.getTime() + 2 * 60 * 60 * 1000); // 2 hours after current
      
      const distanceFromCurrent = await calculateTravelDistance(newCoordinates, currentApt.address);
      const distanceToNext = await calculateTravelDistance(newCoordinates, nextApt.address);
      const avgDistance = (distanceFromCurrent + distanceToNext) / 2;
      
      slots.push({
        dateTime: insertionTime,
        efficiency: avgDistance < 10 ? 'high_efficiency' : avgDistance < 25 ? 'medium_efficiency' : 'standard',
        travelDistance: avgDistance,
        reason: `Optimally placed between two nearby appointments (avg ${avgDistance.toFixed(1)}km)`,
        clusterOpportunity: avgDistance < 10,
        previousAppointment: currentApt.address,
        nextAppointment: nextApt.address
      });
    }
  }
  
  // Try inserting after last appointment
  if (dayAppointments.length > 0) {
    const lastApt = dayAppointments[dayAppointments.length - 1];
    const lateSlot = new Date(lastApt.date.getTime() + 2 * 60 * 60 * 1000); // 2 hours after
    
    if (lateSlot.getHours() <= 16) { // Not after 4 PM
      const distance = await calculateTravelDistance(newCoordinates, lastApt.address);
      
      slots.push({
        dateTime: lateSlot,
        efficiency: distance < 10 ? 'high_efficiency' : distance < 25 ? 'medium_efficiency' : 'standard',
        travelDistance: distance,
        reason: `Scheduled after nearby appointment (${distance.toFixed(1)}km away)`,
        clusterOpportunity: distance < 10,
        previousAppointment: lastApt.address
      });
    }
  }
  
  return slots;
}

/**
 * Calculate travel distance between coordinates and an address
 */
async function calculateTravelDistance(coordinates, address) {
  try {
    // In a real implementation, you would geocode the address
    // For now, use mock coordinates based on address patterns
    const addressCoords = await getCoordinatesFromAddress(address);
    return calculateDistance(coordinates, addressCoords);
  } catch (error) {
    console.error('Error calculating travel distance:', error.message);
    return 50; // Default to 50km if calculation fails
  }
}

/**
 * Enhanced booking function that finds the most travel-efficient slot with smart job duration estimation
 */
async function findMostEfficientSlot(accessToken, newAddress, issueDescription = '', urgencyLevel = 'normal', preferredDate = null) {
  console.log('🚗 SMART SCHEDULING: Finding most fuel-efficient appointment slot...');
  
  try {
    // Step 1: Assess the job to estimate duration
    const jobAssessment = estimateJobDuration(issueDescription, urgencyLevel);
    console.log(`🔧 Job Assessment Complete: ${jobAssessment.estimatedDuration} min + ${jobAssessment.bufferTime} min buffer`);
    
    // Get coordinates for the new appointment
    const newCoordinates = await getCoordinatesFromAddress(newAddress);
    console.log(`📍 New appointment coordinates: ${newCoordinates.lat}, ${newCoordinates.lng}`);
    
    // Find optimal slots with job duration consideration
    const optimalSlots = await findOptimalTimeSlotsWithDuration(newCoordinates, jobAssessment, preferredDate, accessToken);
    
    if (optimalSlots.length === 0) {
      console.log('⚠️ No optimal slots found, falling back to standard scheduling');
      return {
        slot: null,
        jobAssessment: jobAssessment,
        fallbackMessage: 'Standard scheduling applied - no clustering opportunities found'
      };
    }
    
    const bestSlot = optimalSlots[0];
    
    console.log('🎯 OPTIMAL SLOT SELECTED:');
    console.log(`   📅 Time: ${bestSlot.dateTime.toLocaleString('en-AU', { 
      timeZone: BRISBANE_TZ,
      dateStyle: 'short',
      timeStyle: 'short'
    })}`);
    console.log(`   ⏱️ Job Duration: ${jobAssessment.estimatedDuration} minutes`);
    console.log(`   🛡️ Buffer Time: ${jobAssessment.bufferTime} minutes`);
    console.log(`   🚗 Travel Time: ${bestSlot.travelTime} minutes`);
    console.log(`   ⚡ Efficiency: ${bestSlot.efficiency}`);
    console.log(`   🚗 Travel Distance: ${bestSlot.travelDistance.toFixed(1)}km`);
    console.log(`   💡 Reason: ${bestSlot.reason}`);
    
    if (bestSlot.clusterOpportunity) {
      console.log('   🌟 HIGH EFFICIENCY: This creates an optimal appointment cluster!');
    }
    
    return {
      slot: {
        start: bestSlot.dateTime.toISOString(),
        end: new Date(bestSlot.dateTime.getTime() + (jobAssessment.estimatedDuration * 60000)).toISOString()
      },
      jobAssessment: jobAssessment,
      efficiency: {
        rating: bestSlot.efficiency,
        travelDistance: bestSlot.travelDistance,
        travelTime: bestSlot.travelTime,
        fuelSavings: calculateFuelSavings(bestSlot.travelDistance),
        reason: bestSlot.reason,
        clusterOpportunity: bestSlot.clusterOpportunity,
        message: generateEfficiencyMessage(bestSlot, jobAssessment)
      }
    };
    
  } catch (error) {
    console.error('❌ Error finding efficient slot:', error.message);
    const fallbackAssessment = estimateJobDuration(issueDescription, urgencyLevel);
    return {
      slot: null,
      jobAssessment: fallbackAssessment,
      error: error.message
    };
  }
}

/**
 * Find optimal time slots considering job duration and scheduling buffers
 */
async function findOptimalTimeSlotsWithDuration(newCoordinates, jobAssessment, preferredDate, accessToken) {
  console.log('🔍 Finding optimal slots with duration consideration...');
  
  // Get existing appointments from calendar
  const existingAppointments = await getCalendarAppointments(accessToken);
  
  // Analyze each potential time slot
  const candidateSlots = [];
  
  // Validate and handle preferredDate input
  let startDate;
  if (preferredDate) {
    // If preferredDate is already a Date object, use it directly
    if (preferredDate instanceof Date) {
      startDate = preferredDate;
    } else {
      // Try to parse as date string
      startDate = new Date(preferredDate);
      // If parsing failed, fall back to current time
      if (isNaN(startDate.getTime())) {
        console.log(`⚠️ Invalid preferredDate "${preferredDate}", using current time`);
        startDate = new Date();
      }
    }
  } else {
    startDate = new Date();
  }
  
  console.log(`📅 Starting search from: ${startDate.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
  
  // Look ahead 7 days for optimal slots
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDate = new Date(startDate);
    checkDate.setDate(startDate.getDate() + dayOffset);
    
    // Check business hours (8 AM to 5 PM)
    for (let hour = 8; hour < 17; hour++) {
      const slotTime = new Date(checkDate);
      slotTime.setHours(hour, 0, 0, 0);
      
      // Skip if slot is in the past
      if (slotTime <= new Date()) continue;
      
      // Check if slot is available and calculate efficiency
      const slotAnalysis = await analyzeTimeSlot(slotTime, newCoordinates, jobAssessment, existingAppointments);
      
      if (slotAnalysis.available) {
        candidateSlots.push(slotAnalysis);
      }
    }
  }
  
  // Sort by efficiency score (higher is better)
  candidateSlots.sort((a, b) => b.efficiency - a.efficiency);
  
  console.log(`📊 Found ${candidateSlots.length} candidate slots, top 3:`);
  candidateSlots.slice(0, 3).forEach((slot, index) => {
    console.log(`   ${index + 1}. ${slot.dateTime.toLocaleString()} - Efficiency: ${slot.efficiency}`);
  });
  
  return candidateSlots;
}

/**
 * Analyze a specific time slot for booking efficiency
 */
async function analyzeTimeSlot(slotTime, newCoordinates, jobAssessment, existingAppointments) {
  // Find the appointment immediately before this slot
  const beforeAppointments = existingAppointments.filter(apt => 
    new Date(apt.end?.dateTime || apt.end?.date) <= slotTime
  ).sort((a, b) => new Date(b.end?.dateTime || b.end?.date) - new Date(a.end?.dateTime || a.end?.date));
  
  // Find the appointment immediately after this slot
  const afterAppointments = existingAppointments.filter(apt => 
    new Date(apt.start?.dateTime || apt.start?.date) >= slotTime
  ).sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date));
  
  const prevAppointment = beforeAppointments[0];
  const nextAppointment = afterAppointments[0];
  
  // Calculate travel distances and times
  let travelFromPrev = 0;
  let travelToNext = 0;
  let efficiency = 50; // base efficiency score
  let reason = 'Standard scheduling';
  let clusterOpportunity = false;
  
  if (prevAppointment) {
    const prevLocation = await getCoordinatesFromAddress(prevAppointment.location || '142 Queen Street, Brisbane');
    if (prevLocation) {
      travelFromPrev = calculateDistance(prevLocation, newCoordinates);
    }
  }
  
  if (nextAppointment) {
    const nextLocation = await getCoordinatesFromAddress(nextAppointment.location || '142 Queen Street, Brisbane');
    if (nextLocation) {
      travelToNext = calculateDistance(newCoordinates, nextLocation);
    }
  }
  
  // Calculate efficiency based on travel optimization
  const totalTravelDistance = travelFromPrev + travelToNext;
  
  if (totalTravelDistance < 15) {
    efficiency = 90;
    reason = 'Excellent clustering - minimal travel between appointments';
    clusterOpportunity = true;
  } else if (totalTravelDistance < 25) {
    efficiency = 75;
    reason = 'Good proximity to other appointments';
  } else if (totalTravelDistance < 40) {
    efficiency = 60;
    reason = 'Moderate travel distance';
  } else {
    efficiency = 40;
    reason = 'Higher travel distance - consider alternative times';
  }
  
  // Check if there's enough time between appointments
  const jobEndTime = new Date(slotTime.getTime() + (jobAssessment.totalDuration * 60000));
  let available = true;
  
  if (nextAppointment) {
    const nextStartTime = new Date(nextAppointment.start?.dateTime || nextAppointment.start?.date);
    const travelTimeNeeded = Math.ceil(travelToNext * 2.5); // 2.5 minutes per km estimation
    const bufferNeeded = travelTimeNeeded + CLUSTER_CONFIG.travelTimeBuffer;
    
    if (jobEndTime.getTime() + (bufferNeeded * 60000) > nextStartTime.getTime()) {
      available = false;
    }
  }
  
  return {
    dateTime: slotTime,
    available,
    efficiency,
    travelDistance: isNaN(totalTravelDistance) ? 0 : totalTravelDistance,
    travelTime: isNaN(totalTravelDistance) ? 0 : Math.ceil(totalTravelDistance * 2.5), // minutes
    reason,
    clusterOpportunity,
    travelFromPrev: isNaN(travelFromPrev) ? 0 : travelFromPrev,
    travelToNext: isNaN(travelToNext) ? 0 : travelToNext
  };
}

/**
 * Generate customer-friendly efficiency message
 */
function generateEfficiencyMessage(bestSlot, jobAssessment) {
  const savings = calculateFuelSavings(bestSlot.travelDistance);
  
  if (bestSlot.clusterOpportunity) {
    return `Optimized scheduling saved ${Math.round(bestSlot.travelDistance)}km travel distance and $${savings.costAUD} in fuel costs! We'll be servicing nearby locations the same day.`;
  } else if (bestSlot.efficiency > 70) {
    return `Smart scheduling optimized your appointment for efficient service and reduced travel time.`;
  } else {
    return `Your appointment has been scheduled with standard efficiency.`;
  }
}
function calculateFuelSavings(optimizedDistance) {
  const averageRandomDistance = 35; // km - typical random scheduling distance
  const fuelConsumption = 0.1; // L/km - typical van consumption
  const fuelPrice = 1.80; // AUD per liter
  
  const distanceSaved = Math.max(0, averageRandomDistance - optimizedDistance);
  const fuelSaved = distanceSaved * fuelConsumption;
  const moneySaved = fuelSaved * fuelPrice;
  
  return {
    distanceKm: distanceSaved.toFixed(1),
    fuelLiters: fuelSaved.toFixed(1),
    costAUD: moneySaved.toFixed(2)
  };
}

/**
 * Get calendar appointments for analysis
 */
async function getCalendarAppointments(accessToken) {
  try {
    // This would typically fetch from Google Calendar API
    // For now, return mock data that represents existing appointments
    return [
      {
        start: { dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }, // Tomorrow
        end: { dateTime: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString() },
        location: '100 Queen Street, Brisbane, QLD',
        summary: 'Plumbing Service'
      }
    ];
  } catch (error) {
    console.error('Error fetching calendar appointments:', error);
    return [];
  }
}

module.exports = {
  analyzeLocationForBooking,
  addBookingToCluster,
  getClusterStatus,
  calculateDistance,
  findOptimalTimeSlots,
  findOptimalTimeSlotsWithDuration,
  findMostEfficientSlot,
  calculateTravelDistance,
  estimateJobDuration,
  calculateNextBookingSlot,
  generateEfficiencyMessage,
  JOB_DURATION_ESTIMATES,
  SERVICE_AREA
};
