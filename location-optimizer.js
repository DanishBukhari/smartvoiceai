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

module.exports = {
  analyzeLocationForBooking,
  addBookingToCluster,
  getClusterStatus,
  calculateDistance,
  SERVICE_AREA
};
