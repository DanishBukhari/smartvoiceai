// modules/smartScheduler.js - AI-powered intelligent job scheduling system
const { OpenAI } = require('openai');
const { calculateTravelTime, extractMinutesFromTravelTime } = require('./travelOptimization');
const { getLastAppointment } = require('../outlook');
const { 
  estimateJobDurationWithAI, 
  analyzeLocationDistance, 
  calculateOptimalAppointmentGap,
  calculateSmartTimeRounding,
  scheduleAppointmentWithAI 
} = require('./aiDrivenScheduler');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Job complexity and time estimation knowledge base
const JOB_KNOWLEDGE_BASE = {
  toilet: {
    blocked: { min: 30, max: 90, urgent: true },
    leaking: { min: 45, max: 120, urgent: false },
    running: { min: 15, max: 45, urgent: false },
    installation: { min: 120, max: 240, urgent: false }
  },
  sink: {
    blocked: { min: 20, max: 60, urgent: false },
    leaking: { min: 30, max: 90, urgent: true },
    tap_replacement: { min: 45, max: 90, urgent: false }
  },
  'hot water': {
    no_hot_water: { min: 60, max: 180, urgent: true },
    leaking: { min: 45, max: 120, urgent: true },
    installation: { min: 180, max: 360, urgent: false }
  },
  burst: {
    pipe: { min: 90, max: 240, urgent: true },
    leak: { min: 60, max: 180, urgent: true }
  },
  emergency: {
    flooding: { min: 30, max: 120, urgent: true },
    major_leak: { min: 45, max: 150, urgent: true }
  }
};

// Priority levels
const PRIORITY_LEVELS = {
  emergency: { weight: 10, maxDelay: 120 }, // 2 hours max
  urgent: { weight: 7, maxDelay: 480 },     // 8 hours max
  standard: { weight: 3, maxDelay: 2880 },  // 2 days max
  maintenance: { weight: 1, maxDelay: 10080 } // 7 days max
};

/**
 * Enhanced AI-driven job complexity analysis
 * Uses both traditional analysis and new AI-driven estimation
 */
async function analyzeJobComplexity(issueDescription, customerData = {}) {
  console.log('🤖 Analyzing job complexity with enhanced AI...');
  
  try {
    // Use the new AI-driven duration estimation
    const aiAnalysis = await estimateJobDurationWithAI(issueDescription, customerData);
    
    // Map AI analysis to our expected format
    const priority = mapComplexityToPriority(aiAnalysis.complexity);
    
    return {
      estimatedDuration: aiAnalysis.estimatedMinutes,
      minDuration: aiAnalysis.minMinutes || Math.round(aiAnalysis.estimatedMinutes * 0.8),
      maxDuration: aiAnalysis.maxMinutes || Math.round(aiAnalysis.estimatedMinutes * 1.5),
      complexity: aiAnalysis.complexity,
      priority: priority,
      issueType: determineIssueTypeFromAI(issueDescription, aiAnalysis),
      riskFactors: aiAnalysis.riskFactors || [],
      recommendations: aiAnalysis.reasoning || 'AI-driven analysis',
      confidence: aiAnalysis.reasoning ? 'high' : 'medium',
      analysisType: 'ai_enhanced'
    };
    
  } catch (aiError) {
    console.log('⚠️ AI analysis failed, falling back to traditional analysis:', aiError.message);
    
    // Fallback to traditional analysis with enhancements
    return await fallbackJobAnalysis(issueDescription, customerData);
  }
}

/**
 * Fallback job analysis with enhanced logic
 */
async function fallbackJobAnalysis(issueDescription, customerData = {}) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `
You are an experienced plumbing contractor analyzing a job request. Based on the description, estimate the time required and assess complexity.

Job Description: "${issueDescription}"
Customer Location: ${customerData.address || 'Brisbane area'}
Special Instructions: ${customerData.specialInstructions || 'None'}

Consider these factors:
1. Type of plumbing issue (toilet, sink, hot water, pipes, etc.)
2. Complexity indicators (blocked, leaking, not working, installation)
3. Potential complications (access issues, old fixtures, multiple issues)
4. Special instructions that might affect timing

Please respond in JSON format:
{
  "estimatedMinutes": number (realistic time in minutes),
  "complexity": "simple|moderate|complex|emergency",
  "priority": "emergency|urgent|standard|maintenance",
  "issueType": "toilet|sink|hot_water|burst|drain|installation|other",
  "riskFactors": ["factor1", "factor2"],
  "recommendations": "any special considerations"
}

Base estimates:
- Simple toilet unblock: 30-45 mins
- Toilet replacement: 2-3 hours
- Sink/tap repairs: 20-60 mins
- Hot water issues: 1-3 hours
- Burst pipes: 1.5-4 hours
- Emergency flooding: 30-90 mins
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    console.log('🧠 Traditional AI Job Analysis (fallback):', analysis);
    
    return {
      estimatedDuration: analysis.estimatedMinutes || 60,
      complexity: analysis.complexity || 'moderate',
      priority: analysis.priority || 'standard',
      issueType: analysis.issueType || 'other',
      riskFactors: analysis.riskFactors || [],
      recommendations: analysis.recommendations || '',
      confidence: 'medium',
      analysisType: 'traditional_ai'
    };
    
  } catch (error) {
    console.error('❌ Traditional AI analysis also failed, using rule-based fallback:', error.message);
    return getRuleBasedJobAnalysis(issueDescription);
  }
}

/**
 * Rule-based fallback analysis when all AI methods fail
 */
function getRuleBasedJobAnalysis(issueDescription) {
  const desc = issueDescription.toLowerCase();
  
  // Determine priority
  let priority = 'standard';
  if (desc.includes('emergency') || desc.includes('flooding') || desc.includes('burst')) {
    priority = 'emergency';
  } else if (desc.includes('urgent') || desc.includes('no hot water') || desc.includes('major leak')) {
    priority = 'urgent';
  }
  
  // Estimate duration based on keywords
  let estimatedDuration = 60; // Default 1 hour
  
  if (desc.includes('toilet')) {
    if (desc.includes('blocked') || desc.includes('unblock')) estimatedDuration = 45;
    else if (desc.includes('install') || desc.includes('replacement')) estimatedDuration = 180;
    else estimatedDuration = 75;
  } else if (desc.includes('sink') || desc.includes('tap')) {
    estimatedDuration = 45;
  } else if (desc.includes('hot water')) {
    estimatedDuration = 120;
  } else if (desc.includes('burst') || desc.includes('pipe')) {
    estimatedDuration = 150;
  }
  
  return {
    estimatedDuration,
    complexity: 'moderate',
    priority,
    issueType: 'other',
    riskFactors: [],
    recommendations: 'Standard plumbing service rule-based analysis',
    confidence: 'low',
    analysisType: 'rule_based'
  };
}

// Helper functions for AI integration
function mapComplexityToPriority(complexity) {
  const mapping = {
    'simple': 'standard',
    'moderate': 'standard', 
    'complex': 'urgent',
    'emergency': 'emergency'
  };
  return mapping[complexity] || 'standard';
}

function determineIssueTypeFromAI(issueDescription, aiAnalysis) {
  // Use AI analysis if available, otherwise fall back to keyword detection
  if (aiAnalysis.toolsRequired && aiAnalysis.toolsRequired.length > 0) {
    const tools = aiAnalysis.toolsRequired.join(' ').toLowerCase();
    if (tools.includes('toilet')) return 'toilet';
    if (tools.includes('hot water')) return 'hot_water';
    if (tools.includes('drain')) return 'drain';
  }
  
  const desc = issueDescription.toLowerCase();
  if (desc.includes('toilet')) return 'toilet';
  if (desc.includes('hot water')) return 'hot_water';
  if (desc.includes('sink') || desc.includes('tap')) return 'sink';
  if (desc.includes('burst')) return 'burst';
  if (desc.includes('drain') || desc.includes('blocked')) return 'drain';
  if (desc.includes('install')) return 'installation';
  
  return 'other';
}

/**
 * Enhanced optimal appointment slot finder with AI-driven scheduling
 */
async function findOptimalAppointmentSlot(customerAddress, issueDescription, customerData = {}, accessToken = null) {
  console.log('🎯 Finding optimal appointment slot with AI-driven smart scheduling...');
  
  // Try comprehensive AI-driven scheduling first
  try {
    // Refresh last booked job location from calendar if we have access token
    if (accessToken) {
      try {
        const { refreshLastBookedJobLocation } = require('./travelOptimization');
        await refreshLastBookedJobLocation(accessToken);
      } catch (error) {
        console.log('⚠️ Could not refresh last booked job location:', error.message);
      }
    }

    // Get previous appointments for context
    const existingAppointments = await getExistingAppointments(accessToken);
    
    // Prepare customer data with address
    const enrichedCustomerData = {
      ...customerData,
      address: customerAddress,
      conversationContext: `Customer calling about: ${issueDescription}`
    };
    
    // Use comprehensive AI scheduling
    const aiSchedulingResult = await scheduleAppointmentWithAI(
      enrichedCustomerData,
      issueDescription,
      existingAppointments.slice(-5), // Last 5 appointments for context
      []
    );
    
    if (aiSchedulingResult) {
      console.log('✅ AI-driven scheduling successful');
      
      // Convert to expected format and add metadata
      return {
        start: aiSchedulingResult.start,
        end: aiSchedulingResult.end,
        estimatedDuration: aiSchedulingResult.duration,
        travelTime: `${aiSchedulingResult.travelTime} minutes`,
        totalBufferMinutes: aiSchedulingResult.gap,
        priority: aiSchedulingResult.analysis.job.complexity,
        analysis: aiSchedulingResult.analysis,
        type: 'ai_optimized',
        confidence: 'high'
      };
    }
    
  } catch (aiError) {
    console.log('⚠️ Comprehensive AI scheduling failed, falling back to hybrid approach:', aiError.message);
  }
  
  // Fallback to enhanced traditional scheduling with AI components
  try {
    console.log('🔄 Using hybrid AI-enhanced scheduling...');
    
    // Refresh last booked job location from calendar if we have access token
    if (accessToken) {
      try {
        const { refreshLastBookedJobLocation } = require('./travelOptimization');
        await refreshLastBookedJobLocation(accessToken);
      } catch (error) {
        console.log('⚠️ Could not refresh last booked job location:', error.message);
      }
    }

    // Step 1: Enhanced AI job analysis  
    const jobAnalysis = await analyzeJobComplexity(issueDescription, customerData);
    console.log(`🔧 Job Analysis - Duration: ${jobAnalysis.estimatedDuration}min, Priority: ${jobAnalysis.priority}, Type: ${jobAnalysis.issueType}`);

    // Step 2: Get existing appointments for location clustering
    const existingAppointments = await getExistingAppointments(accessToken);

    // Step 3: Find appointments in similar locations with AI-enhanced distance analysis
    const nearbyAppointments = await findNearbyAppointmentsWithAI(customerAddress, existingAppointments);
    console.log(`📍 Found ${nearbyAppointments.length} nearby appointments for AI-enhanced clustering`);

    // Step 4: Calculate optimal scheduling with AI-enhanced gap calculation
    const optimalSlot = await calculateOptimalSlotWithAI({
      customerAddress,
      jobAnalysis,
      nearbyAppointments,
      existingAppointments,
      accessToken
    });

    return optimalSlot;
    
  } catch (hybridError) {
    console.error('❌ Hybrid AI scheduling failed, using traditional fallback:', hybridError.message);
    
    // Final fallback to original scheduling
    return await calculateOptimalSlotTraditional({
      customerAddress,
      issueDescription,
      customerData,
      accessToken
    });
  }
}

/**
 * AI-enhanced nearby appointments finder
 */
async function findNearbyAppointmentsWithAI(customerAddress, appointments) {
  try {
    // Use AI-powered distance analysis for more accurate clustering
    const nearbyAppointments = [];
    
    for (const appointment of appointments) {
      if (appointment.location) {
        try {
          const distanceAnalysis = await analyzeLocationDistance(appointment.location, customerAddress);
          
          // Consider appointments within 15km as "nearby" for clustering
          if (distanceAnalysis.distanceKm <= 15) {
            nearbyAppointments.push({
              ...appointment,
              distanceKm: distanceAnalysis.distanceKm,
              travelMinutes: distanceAnalysis.estimatedTravelMinutes
            });
          }
        } catch (error) {
          console.log(`⚠️ Could not analyze distance for ${appointment.location}:`, error.message);
        }
      }
    }
    
    // Sort by distance for optimal clustering
    nearbyAppointments.sort((a, b) => a.distanceKm - b.distanceKm);
    
    return nearbyAppointments;
    
  } catch (error) {
    console.error('❌ AI nearby appointments analysis failed:', error);
    
    // Fallback to traditional method
    return await findNearbyAppointments(customerAddress, appointments);
  }
}

/**
 * AI-enhanced optimal slot calculation
 */
async function calculateOptimalSlotWithAI({ customerAddress, jobAnalysis, nearbyAppointments, existingAppointments, accessToken }) {
  try {
    // Get last appointment for travel calculation
    const lastAppointment = await getLastAppointmentBeforeSlot(new Date(), existingAppointments, accessToken);
    const startLocation = lastAppointment?.location || 'Brisbane CBD, QLD 4000, Australia';
    
    // AI-powered travel analysis
    const travelAnalysis = await analyzeLocationDistance(startLocation, customerAddress);
    
    // AI-powered gap calculation
    const previousJob = {
      address: startLocation,
      estimatedMinutes: 60, // Assume standard previous job
      complexity: 'moderate',
      issueType: 'standard'
    };
    
    const upcomingJob = {
      address: customerAddress,
      priority: jobAnalysis.priority,
      issueType: jobAnalysis.issueType
    };
    
    const gapAnalysis = await calculateOptimalAppointmentGap(previousJob, upcomingJob, travelAnalysis);
    
    // Calculate start time
    const lastEndTime = lastAppointment?.end || new Date();
    const calculatedStartTime = new Date(lastEndTime.getTime() + (gapAnalysis.recommendedGapMinutes * 60000));
    
    // AI-powered time rounding
    const timeRounding = await calculateSmartTimeRounding(calculatedStartTime, {}, {});
    
    // Calculate end time
    const appointmentStart = timeRounding.recommendedTime;
    const appointmentEnd = new Date(appointmentStart.getTime() + (jobAnalysis.estimatedDuration * 60000));
    
    return {
      start: appointmentStart,
      end: appointmentEnd,
      estimatedDuration: jobAnalysis.estimatedDuration,
      travelTime: `${travelAnalysis.estimatedTravelMinutes} minutes`,
      totalBufferMinutes: gapAnalysis.recommendedGapMinutes,
      priority: jobAnalysis.priority,
      analysis: {
        job: jobAnalysis,
        travel: travelAnalysis,
        gap: gapAnalysis,
        timeRounding: timeRounding
      },
      type: 'ai_enhanced',
      confidence: 'high'
    };
    
  } catch (error) {
    console.error('❌ AI-enhanced slot calculation failed:', error);
    
    // Fallback to traditional calculation
    return await calculateOptimalSlotTraditional({ customerAddress, jobAnalysis, nearbyAppointments, existingAppointments, accessToken });
  }
}

/**
 * Traditional optimal slot calculation (fallback)
 */
async function calculateOptimalSlotTraditional({ customerAddress, jobAnalysis, nearbyAppointments, existingAppointments, accessToken }) {
  const now = new Date();
  const priority = PRIORITY_LEVELS[jobAnalysis.priority];
  
  // Calculate earliest possible start time based on priority (Brisbane time)
  let earliestStart = new Date();
  if (jobAnalysis.priority === 'emergency') {
    earliestStart.setHours(earliestStart.getHours() + 1); // 1 hour for emergency
  } else if (jobAnalysis.priority === 'urgent') {
    earliestStart.setHours(earliestStart.getHours() + 2); // 2 hours for urgent
  } else {
    // For standard jobs, schedule for next day at 9 AM Brisbane time
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    
    // Create 9 AM Brisbane time properly as UTC
    const brisbaneYear = nextDay.getFullYear();
    const brisbaneMonth = nextDay.getMonth();
    const brisbaneDay = nextDay.getDate();
    
    // Create as UTC time first, then adjust for Brisbane timezone
    const utcTime = new Date(Date.UTC(brisbaneYear, brisbaneMonth, brisbaneDay, 9, 0, 0, 0));
    earliestStart = new Date(utcTime.getTime() - (10 * 60 * 60 * 1000)); // Convert Brisbane to UTC
  }
  
  // Find the best slot considering travel optimization
  const candidates = await generateTimeSlotCandidates(earliestStart, jobAnalysis, priority);
  
  let bestSlot = null;
  let bestScore = -1;
  
  for (const candidate of candidates) {
    const score = await evaluateTimeSlot(candidate, {
      customerAddress,
      jobAnalysis,
      nearbyAppointments,
      existingAppointments
    });
    
    console.log(`⏰ Slot ${candidate.start.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit', hour12: true })} - Score: ${score.total}`);
    
    if (score.total > bestScore && score.available) {
      bestScore = score.total;
      bestSlot = { ...candidate, score: score.details };
    }
  }
  
  if (bestSlot) {
    // Calculate travel time and buffer
    const lastAppointment = await getLastAppointmentBeforeSlot(bestSlot.start, existingAppointments, accessToken);
    const startLocation = lastAppointment?.location || 'Brisbane CBD, QLD 4000, Australia';
    
    const travelTime = await calculateTravelTime(startLocation, customerAddress);
    const travelMinutes = extractMinutesFromTravelTime(travelTime);
    
    console.log(`🎯 Optimal slot found: ${bestSlot.start.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log(`🚗 Travel from: ${startLocation}`);
    console.log(`⏱️ Travel time: ${travelTime} (${travelMinutes} minutes)`);
    
    // Generate a proper reference number
    const refNumber = `PLB-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
    
    const result = {
      start: bestSlot.start,
      end: bestSlot.end,
      type: 'smart_scheduled',
      priority: jobAnalysis.priority,
      estimatedDuration: jobAnalysis.estimatedDuration,
      travelTime: travelTime,
      travelMinutes: travelMinutes,
      location: customerAddress,
      analysis: jobAnalysis,
      score: bestSlot.score,
      reference: refNumber,
      serviceDuration: jobAnalysis.estimatedDuration
    };
    
    console.log(`✅ Returning smart scheduled appointment for ${result.start.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit', hour12: true })}`);
    return result;
  }
  
  // Fallback to basic scheduling if no optimal slot found
  console.log('⚠️ No optimal slot found, using fallback scheduling');
  console.log(`⚠️ bestSlot was: ${bestSlot ? 'found but invalid' : 'null'}, bestScore: ${bestScore}`);
  const fallbackResult = generateFallbackSlot(earliestStart, jobAnalysis, customerAddress);
  console.log(`⚠️ Fallback appointment time: ${fallbackResult.start.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit', hour12: true })}`);
  return fallbackResult;
}

/**
 * Traditional nearby appointments finder (fallback)
 */
async function findNearbyAppointments(customerAddress, appointments) {
  const nearbyAppointments = [];
  
  for (const appointment of appointments) {
    if (appointment.location && isSimilarLocation(appointment.location, customerAddress)) {
      nearbyAppointments.push(appointment);
    }
  }
  
  return nearbyAppointments;
}

/**
 * Generate candidate time slots for evaluation
 */
async function generateTimeSlotCandidates(earliestStart, jobAnalysis, priority) {
  const candidates = [];
  const workingHours = { start: 7, end: 17 }; // 7 AM to 5 PM Brisbane time
  
  // Generate slots for next 7 days
  for (let day = 0; day < 7; day++) {
    const date = new Date(earliestStart);
    date.setDate(date.getDate() + day);
    
    // Skip weekends for non-emergency jobs
    if (jobAnalysis.priority !== 'emergency' && (date.getDay() === 0 || date.getDay() === 6)) {
      continue;
    }
    
    // Generate hourly slots during working hours in Brisbane timezone
    for (let hour = workingHours.start; hour < workingHours.end; hour++) {
      // Create slot time in Brisbane timezone (AEST = UTC+10)
      // For 9 AM Brisbane, we need 11 PM UTC previous day (9 - 10 = -1, so previous day 23:00)
      
      // First create the Brisbane local time
      const brisbaneYear = date.getFullYear();
      const brisbaneMonth = date.getMonth();  
      const brisbaneDay = date.getDate();
      
      // Create as UTC time first, then adjust
      const utcTime = new Date(Date.UTC(brisbaneYear, brisbaneMonth, brisbaneDay, hour, 0, 0, 0));
      
      // Convert Brisbane time to UTC by subtracting 10 hours
      const slotStart = new Date(utcTime.getTime() - (10 * 60 * 60 * 1000));
      
      // Skip if before earliest start time
      if (slotStart < earliestStart) continue;
      
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + jobAnalysis.estimatedDuration + 15); // +15min buffer
      
      candidates.push({
        start: slotStart,  // Now properly in UTC
        end: slotEnd,      // Now properly in UTC
        day: day,
        hour: hour,
        brisbaneHour: hour // Original Brisbane hour for reference
      });
    }
  }
  
  return candidates;
}

/**
 * Evaluate a time slot based on multiple criteria
 */
async function evaluateTimeSlot(slot, context) {
  let score = 0;
  const details = {};
  
  // Check availability (basic conflict check)
  const conflicts = checkTimeSlotConflicts(slot, context.existingAppointments);
  if (conflicts.length > 0) {
    return { total: -1, available: false, details: { conflicts } };
  }
  details.available = true;
  
  // Travel optimization score (higher is better)
  const travelScore = await calculateTravelOptimizationScore(slot, context);
  score += travelScore * 40; // 40% weight
  details.travelScore = travelScore;
  
  // Location clustering score
  const clusterScore = calculateLocationClusteringScore(slot, context);
  score += clusterScore * 30; // 30% weight
  details.clusterScore = clusterScore;
  
  // Priority timing score
  const priorityScore = calculatePriorityScore(slot, context.jobAnalysis);
  score += priorityScore * 20; // 20% weight
  details.priorityScore = priorityScore;
  
  // Work efficiency score (time of day, day of week)
  const efficiencyScore = calculateEfficiencyScore(slot);
  score += efficiencyScore * 10; // 10% weight
  details.efficiencyScore = efficiencyScore;
  
  return { total: score, available: true, details };
}

/**
 * Calculate travel optimization score for a time slot
 */
async function calculateTravelOptimizationScore(slot, context) {
  // Find previous and next appointments
  const previousAppointment = findPreviousAppointment(slot.start, context.existingAppointments);
  const nextAppointment = findNextAppointment(slot.end, context.existingAppointments);
  
  let score = 50; // Base score
  
  // Bonus for being close to previous appointment
  if (previousAppointment) {
    const distance = await estimateLocationDistance(previousAppointment.location, context.customerAddress);
    if (distance < 10) score += 30; // Same suburb
    else if (distance < 20) score += 20; // Nearby suburb
    else if (distance < 40) score += 10; // Same city
  }
  
  // Bonus for being close to next appointment
  if (nextAppointment) {
    const distance = await estimateLocationDistance(context.customerAddress, nextAppointment.location);
    if (distance < 10) score += 20;
    else if (distance < 20) score += 15;
    else if (distance < 40) score += 5;
  }
  
  return Math.min(score, 100);
}

/**
 * Calculate location clustering score
 */
function calculateLocationClusteringScore(slot, context) {
  let score = 0;
  const sameDay = context.existingAppointments.filter(apt => 
    apt.start.toDateString() === slot.start.toDateString()
  );
  
  // Bonus for clustering appointments in same area on same day
  for (const appointment of sameDay) {
    if (isSimilarLocation(appointment.location, context.customerAddress)) {
      score += 25;
    }
  }
  
  return Math.min(score, 100);
}

/**
 * Calculate priority-based timing score
 */
function calculatePriorityScore(slot, jobAnalysis) {
  const now = new Date();
  const hoursUntilSlot = (slot.start - now) / (1000 * 60 * 60);
  
  const priority = PRIORITY_LEVELS[jobAnalysis.priority];
  const maxDelayHours = priority.maxDelay / 60;
  
  if (hoursUntilSlot <= maxDelayHours * 0.25) return 100; // Within 25% of max delay
  if (hoursUntilSlot <= maxDelayHours * 0.5) return 80;   // Within 50% of max delay
  if (hoursUntilSlot <= maxDelayHours * 0.75) return 60;  // Within 75% of max delay
  if (hoursUntilSlot <= maxDelayHours) return 40;         // Within max delay
  
  return 0; // Beyond acceptable delay
}

/**
 * Calculate work efficiency score
 */
function calculateEfficiencyScore(slot) {
  let score = 50;
  
  const hour = slot.start.getHours();
  const day = slot.start.getDay();
  
  // Peak efficiency hours (9 AM - 4 PM)
  if (hour >= 9 && hour <= 16) score += 30;
  else if (hour >= 7 && hour <= 18) score += 15;
  
  // Weekday bonus
  if (day >= 1 && day <= 5) score += 20;
  
  return Math.min(score, 100);
}

// Helper functions
function checkTimeSlotConflicts(slot, existingAppointments) {
  return existingAppointments.filter(apt => 
    (slot.start < apt.end && slot.end > apt.start)
  );
}

function findPreviousAppointment(startTime, appointments) {
  return appointments
    .filter(apt => apt.end <= startTime)
    .sort((a, b) => b.end - a.end)[0];
}

function findNextAppointment(endTime, appointments) {
  return appointments
    .filter(apt => apt.start >= endTime)
    .sort((a, b) => a.start - b.start)[0];
}

async function estimateLocationDistance(location1, location2) {
  // Simplified distance estimation (in km)
  // In production, use Google Maps Distance Matrix API
  return Math.random() * 50; // Placeholder
}

function isSimilarLocation(location1, location2) {
  // Simple similarity check - can be enhanced
  const extractSuburb = (addr) => {
    const parts = addr.split(',');
    return parts[parts.length - 3]?.trim() || '';
  };
  
  return extractSuburb(location1) === extractSuburb(location2);
}

async function getExistingAppointments(accessToken) {
  try {
    // Use the existing Google Calendar integration from outlook.js
    const outlook = require('../outlook');
    
    // Get events from Google Calendar for the next 30 days
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + 30);
    
    const { google } = require('googleapis');
    const { OAuth2Client } = require('google-auth-library');
    
    const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    
    // Get a fresh access token
    const { token } = await oauth2Client.getAccessToken();
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: futureDate.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
      // Removed q filter - get all events and filter in code instead
    });
    
    const events = response.data.items || [];
    console.log(`📅 Raw calendar query returned ${events.length} events`);
    
    // Debug: Show raw events
    if (events.length > 0) {
      console.log('🔍 Raw events from calendar:');
      events.slice(0, 3).forEach((event, index) => {
        console.log(`   ${index + 1}. "${event.summary}" (${event.start?.dateTime || event.start?.date})`);
      });
    }
    
    // Convert to our appointment format and filter for plumbing appointments
    const appointments = events
      .filter(event => {
        if (!event.start || !event.start.dateTime || !event.end || !event.end.dateTime) {
          console.log(`   ❌ Filtered out (no dateTime): "${event.summary}"`);
          return false;
        }
        
        if (!event.summary) {
          console.log(`   ❌ Filtered out (no summary): "${event.id}"`);
          return false;
        }
        
        const summary = event.summary.toLowerCase();
        
        // Look for plumbing-related appointments
        const isPlumbingRelated = summary.includes('plumbing') || 
                                 summary.includes('plumber') ||
                                 summary.includes('plb-') ||
                                 summary.includes('service') ||
                                 summary.includes('repair') ||
                                 summary.includes('installation') ||
                                 summary.includes('maintenance') ||
                                 summary.includes('appointment');
        
        if (isPlumbingRelated) {
          console.log(`   ✅ Found plumbing appointment: "${event.summary}"`);
        } else {
          console.log(`   ❌ Filtered out (not plumbing): "${event.summary}"`);
        }
        
        return isPlumbingRelated;
      })
      .map(event => ({
        id: event.id,
        summary: event.summary,
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime),
        location: event.location || '',
        description: event.description || ''
      }));
    
    console.log(`📅 Found ${appointments.length} existing appointments in calendar (after filtering)`);
    
    // Debug: Show existing appointments
    if (appointments.length > 0) {
      console.log('📋 Existing appointments:');
      appointments.slice(0, 3).forEach((apt, index) => {
        const brisbaneTime = apt.start.toLocaleString('en-AU', {
          timeZone: 'Australia/Brisbane',
          weekday: 'short',
          day: 'numeric', 
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        console.log(`   ${index + 1}. ${brisbaneTime} - ${apt.summary}`);
      });
    }
    
    return appointments;
    
  } catch (error) {
    console.error('❌ Error getting existing appointments:', error.message);
    // Return empty array to continue with booking (but log the issue)
    console.log('⚠️  Calendar access unavailable, proceeding without conflict checking');
    return [];
  }
}

async function findNearbyAppointments(address, appointments) {
  // Find appointments in similar locations
  return appointments.filter(apt => isSimilarLocation(apt.location, address));
}

async function getLastAppointmentBeforeSlot(slotStart, appointments, accessToken) {
  const beforeSlot = appointments.filter(apt => apt.end <= slotStart);
  return beforeSlot.sort((a, b) => b.end - a.end)[0];
}

function generateFallbackSlot(earliestStart, jobAnalysis, customerAddress) {
  const start = new Date(earliestStart);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + jobAnalysis.estimatedDuration + 15);
  
  // Generate a proper reference number
  const refNumber = `PLB-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
  
  return {
    start,
    end,
    type: 'fallback',
    priority: jobAnalysis.priority,
    estimatedDuration: jobAnalysis.estimatedDuration,
    travelTime: '20-30 minutes',
    travelMinutes: 25,
    location: customerAddress,
    analysis: jobAnalysis,
    reference: refNumber,
    serviceDuration: jobAnalysis.estimatedDuration
  };
}

module.exports = {
  analyzeJobComplexity,
  findOptimalAppointmentSlot,
  calculateOptimalSlotWithAI,
  calculateOptimalSlotTraditional,
  getExistingAppointments,
  PRIORITY_LEVELS,
  JOB_KNOWLEDGE_BASE
};
