// location-optimizer.js - Smart location-based booking optimization

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
 * Enhanced booking function that finds the most travel-efficient slot
 */
async function findMostEfficientSlot(accessToken, newAddress, preferredDate = null) {
  console.log('🚗 SMART SCHEDULING: Finding most fuel-efficient appointment slot...');
  
  try {
    // Get coordinates for the new appointment
    const newCoordinates = await getCoordinatesFromAddress(newAddress);
    console.log(`📍 New appointment coordinates: ${newCoordinates.lat}, ${newCoordinates.lng}`);
    
    // Find optimal slots
    const optimalSlots = await findOptimalTimeSlots(newCoordinates, preferredDate, accessToken);
    
    if (optimalSlots.length === 0) {
      console.log('⚠️ No optimal slots found, falling back to standard scheduling');
      return null;
    }
    
    const bestSlot = optimalSlots[0];
    
    console.log('🎯 OPTIMAL SLOT SELECTED:');
    console.log(`   📅 Time: ${bestSlot.dateTime.toLocaleString()}`);
    console.log(`   ⚡ Efficiency: ${bestSlot.efficiency}`);
    console.log(`   🚗 Travel Distance: ${bestSlot.travelDistance.toFixed(1)}km`);
    console.log(`   💡 Reason: ${bestSlot.reason}`);
    
    if (bestSlot.clusterOpportunity) {
      console.log('   🌟 HIGH EFFICIENCY: This creates an optimal appointment cluster!');
    }
    
    return {
      slot: bestSlot.dateTime,
      analysis: {
        efficiency: bestSlot.efficiency,
        travelDistance: bestSlot.travelDistance,
        reason: bestSlot.reason,
        clusterOpportunity: bestSlot.clusterOpportunity,
        fuelSavings: calculateFuelSavings(bestSlot.travelDistance)
      }
    };
    
  } catch (error) {
    console.error('❌ Error finding efficient slot:', error.message);
    return null;
  }
}

/**
 * Calculate estimated fuel savings compared to random scheduling
 */
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

module.exports = {
  analyzeLocationForBooking,
  addBookingToCluster,
  getClusterStatus,
  calculateDistance,
  findOptimalTimeSlots,
  findMostEfficientSlot,
  calculateTravelDistance,
  SERVICE_AREA
};
