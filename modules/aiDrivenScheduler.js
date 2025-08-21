// modules/aiDrivenScheduler.js - AI-Driven Dynamic Scheduling System
const { OpenAI } = require('openai');
const { calculateTravelTime } = require('./travelOptimization');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI-powered job duration estimation
 * Replaces hardcoded duration estimates with dynamic AI analysis
 */
async function estimateJobDurationWithAI(issueDescription, customerData = {}, urgencyLevel = 'normal') {
  console.log('🤖 AI analyzing job duration requirements...');
  
  try {
    const prompt = `
You are an experienced plumbing contractor with 20+ years of experience. Analyze this job and provide accurate time estimates.

PLUMBING JOB ANALYSIS:
Issue Description: "${issueDescription}"
Customer Address: ${customerData.address || 'Brisbane area'}
Special Instructions: ${customerData.specialInstructions || 'None'}
Urgency Level: ${urgencyLevel}
Phone Conversation Context: ${customerData.conversationContext || 'Standard booking call'}

ANALYSIS REQUIREMENTS:
1. Estimate realistic job duration based on:
   - Issue complexity and scope
   - Potential complications (old fixtures, access issues, etc.)
   - Parts/tools that may be needed
   - Customer-specific factors from conversation

2. Factor in realistic scenarios:
   - Best case (everything goes smoothly)
   - Most likely case (standard complications)
   - Worst case (unexpected issues)

3. Consider Brisbane plumbing standards and building codes

RESPOND IN JSON FORMAT:
{
  "estimatedMinutes": number (most likely duration),
  "minMinutes": number (best case scenario),
  "maxMinutes": number (if complications arise),
  "complexity": "simple|moderate|complex|emergency",
  "riskFactors": ["factor1", "factor2"],
  "toolsRequired": ["tool1", "tool2"],
  "partsLikely": ["part1", "part2"],
  "accessConcerns": "any access challenges identified",
  "reasoning": "detailed explanation of time estimate"
}

Example estimates for reference:
- Simple toilet flush adjustment: 15-30 minutes
- Toilet unblock: 30-60 minutes  
- Toilet replacement: 120-180 minutes
- Tap washer replacement: 20-40 minutes
- Hot water system repair: 90-240 minutes
- Burst pipe emergency: 60-180 minutes
- Drain clearing: 45-90 minutes
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2, // Lower temperature for more consistent estimates
      max_tokens: 600
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    console.log('🎯 AI Job Duration Analysis:', {
      estimated: analysis.estimatedMinutes,
      range: `${analysis.minMinutes}-${analysis.maxMinutes}`,
      complexity: analysis.complexity,
      reasoning: analysis.reasoning
    });
    
    return {
      estimatedMinutes: analysis.estimatedMinutes || 60,
      minMinutes: analysis.minMinutes || 45,
      maxMinutes: analysis.maxMinutes || 90,
      complexity: analysis.complexity || 'moderate',
      riskFactors: analysis.riskFactors || [],
      toolsRequired: analysis.toolsRequired || [],
      partsLikely: analysis.partsLikely || [],
      accessConcerns: analysis.accessConcerns || '',
      reasoning: analysis.reasoning || 'Standard estimate applied'
    };
    
  } catch (error) {
    console.error('❌ AI job duration analysis failed:', error);
    
    // Intelligent fallback based on keywords
    return getIntelligentFallbackDuration(issueDescription, urgencyLevel);
  }
}

/**
 * AI-powered travel time and distance analysis
 * Provides dynamic calculations instead of hardcoded Brisbane estimates
 */
async function analyzeLocationDistance(originAddress, destinationAddress) {
  console.log('🚗 AI analyzing travel requirements...');
  
  try {
    const prompt = `
You are a logistics expert familiar with Brisbane, Australia geography and traffic patterns.

TRAVEL ANALYSIS REQUEST:
From: "${originAddress}"
To: "${destinationAddress}"

ANALYSIS REQUIREMENTS:
1. Estimate realistic travel time considering:
   - Brisbane traffic patterns (peak vs off-peak)
   - Distance between locations
   - Route complexity (highways vs city streets)
   - Typical plumbing vehicle travel (van/truck with equipment)

2. Consider Brisbane-specific factors:
   - Bridge crossings (Story Bridge, Gateway Bridge)
   - M1/M3 highway access
   - City center congestion
   - Suburban vs urban routes

3. Provide both distance and time estimates

RESPOND IN JSON FORMAT:
{
  "distanceKm": number (straight-line distance in km),
  "estimatedTravelMinutes": number (realistic travel time),
  "minTravelMinutes": number (best case - off-peak),
  "maxTravelMinutes": number (worst case - peak traffic),
  "routeType": "city|suburban|highway|mixed",
  "trafficConcerns": "any specific traffic considerations",
  "reasoning": "explanation of estimate"
}

Guidelines:
- Brisbane CBD to suburbs: 15-35 minutes
- Cross-city travel: 25-45 minutes
- Same suburb: 5-15 minutes
- Highway routes: Generally faster but may have access delays
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 400
    });

    let analysis;
    try {
      analysis = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error('❌ Failed to parse AI response, using fallback:', parseError);
      analysis = getBrisbaneFallbackTravel(originAddress, destinationAddress);
    }
    
    // Ensure all values are properly defined
    const result = {
      distanceKm: analysis.distanceKm || 15,
      estimatedTravelMinutes: analysis.estimatedTravelMinutes || 25,
      minTravelMinutes: analysis.minTravelMinutes || 20,
      maxTravelMinutes: analysis.maxTravelMinutes || 35,
      routeType: analysis.routeType || 'mixed',
      trafficConcerns: analysis.trafficConcerns || 'Standard Brisbane traffic',
      reasoning: analysis.reasoning || 'Standard Brisbane estimate'
    };
    
    console.log('🗺️ AI Location Analysis:', {
      distance: `${result.distanceKm}km`,
      travel: `${result.estimatedTravelMinutes} minutes`,
      range: `${result.minTravelMinutes}-${result.maxTravelMinutes}`,
      route: result.routeType
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ AI location analysis failed:', error);
    
    // Try to use Google Maps API as backup
    try {
      const googleTravelTime = await calculateTravelTime(originAddress, destinationAddress);
      const minutes = extractMinutesFromGoogleResponse(googleTravelTime);
      
      return {
        distanceKm: Math.round(minutes * 0.8), // Rough estimate: ~0.8km per minute in city
        estimatedTravelMinutes: minutes,
        minTravelMinutes: Math.max(5, minutes - 10),
        maxTravelMinutes: minutes + 15,
        routeType: 'mixed',
        trafficConcerns: 'Using Google Maps fallback',
        reasoning: 'Google Maps API fallback'
      };
    } catch (googleError) {
      console.log('⚠️ Google Maps API also failed, using Brisbane fallback');
      // Final fallback
      return getBrisbaneFallbackTravel(originAddress, destinationAddress);
    }
  }
}

/**
 * Brisbane-specific fallback travel estimates
 */
function getBrisbaneFallbackTravel(originAddress, destinationAddress) {
  // Analyze addresses for Brisbane-specific patterns
  const origin = (originAddress || '').toLowerCase();
  const dest = (destinationAddress || '').toLowerCase();
  
  // Brisbane CBD areas
  const cbdAreas = ['adelaide', 'queen', 'george', 'elizabeth', 'edward', 'albert', 'charlotte', 'creek'];
  const isOriginCBD = cbdAreas.some(area => origin.includes(area));
  const isDestCBD = cbdAreas.some(area => dest.includes(area));
  
  // Determine travel estimate based on location types
  let baseMinutes = 25;
  let distance = 15;
  
  if (isOriginCBD && isDestCBD) {
    // CBD to CBD
    baseMinutes = 15;
    distance = 8;
  } else if (isOriginCBD || isDestCBD) {
    // CBD to suburb or vice versa
    baseMinutes = 25;
    distance = 18;
  } else {
    // Suburb to suburb
    baseMinutes = 30;
    distance = 22;
  }
  
  return {
    distanceKm: distance,
    estimatedTravelMinutes: baseMinutes,
    minTravelMinutes: Math.max(10, baseMinutes - 10),
    maxTravelMinutes: baseMinutes + 15,
    routeType: 'mixed',
    trafficConcerns: 'Brisbane standard traffic patterns',
    reasoning: `Brisbane geographic fallback: ${isOriginCBD ? 'CBD' : 'suburb'} to ${isDestCBD ? 'CBD' : 'suburb'}`
  };
}

/**
 * AI-powered appointment gap calculation
 * Dynamically determines optimal gaps between appointments
 */
async function calculateOptimalAppointmentGap(previousJob, upcomingJob, travelAnalysis) {
  console.log('⏰ AI calculating optimal appointment gap...');
  
  try {
    const prompt = `
You are a plumbing business operations manager optimizing appointment scheduling.

APPOINTMENT GAP ANALYSIS:
Previous Job: 
- Type: ${previousJob.issueType || 'standard repair'}
- Duration: ${previousJob.estimatedMinutes || 60} minutes
- Completion Risk: ${previousJob.complexity || 'moderate'}
- Location: ${previousJob.address || 'Brisbane area'}

Next Job:
- Type: ${upcomingJob.issueType || 'standard repair'}  
- Urgency: ${upcomingJob.priority || 'standard'}
- Location: ${upcomingJob.address || 'Brisbane area'}

Travel Analysis:
- Distance: ${travelAnalysis.distanceKm}km
- Travel Time: ${travelAnalysis.estimatedTravelMinutes} minutes (${travelAnalysis.minTravelMinutes}-${travelAnalysis.maxTravelMinutes} range)
- Route Type: ${travelAnalysis.routeType}

CALCULATE OPTIMAL GAP CONSIDERING:
1. Job overrun risk (based on complexity)
2. Travel time + traffic buffer
3. Equipment loading/unloading time
4. Plumber break/preparation time
5. Customer service quality (not rushing)

RESPOND IN JSON FORMAT:
{
  "recommendedGapMinutes": number (total gap including all factors),
  "travelTimeMinutes": number (actual travel),
  "jobOverrunBuffer": number (extra time for previous job complications),
  "equipmentBuffer": number (loading/unloading time),
  "serviceBuffer": number (preparation and customer service),
  "reasoning": "detailed explanation of gap calculation"
}

Professional standards:
- Minimum gap: 15 minutes (emergency scheduling only)
- Standard gap: 30-45 minutes
- Complex job buffer: 60+ minutes
- Equipment-heavy jobs: +15-30 minutes
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    console.log('⏱️ AI Gap Analysis:', {
      total: analysis.recommendedGapMinutes,
      travel: analysis.travelTimeMinutes,
      buffers: `${analysis.jobOverrunBuffer}+${analysis.equipmentBuffer}+${analysis.serviceBuffer}`,
      reasoning: analysis.reasoning
    });
    
    return {
      recommendedGapMinutes: analysis.recommendedGapMinutes || 45,
      travelTimeMinutes: analysis.travelTimeMinutes || travelAnalysis.estimatedTravelMinutes,
      jobOverrunBuffer: analysis.jobOverrunBuffer || 15,
      equipmentBuffer: analysis.equipmentBuffer || 10,
      serviceBuffer: analysis.serviceBuffer || 10,
      reasoning: analysis.reasoning || 'Standard gap calculation applied'
    };
    
  } catch (error) {
    console.error('❌ AI gap calculation failed:', error);
    
    // Intelligent fallback
    const baseTravel = travelAnalysis.estimatedTravelMinutes;
    const complexityMultiplier = getComplexityMultiplier(previousJob.complexity);
    const urgencyAdjustment = getUrgencyAdjustment(upcomingJob.priority);
    
    return {
      recommendedGapMinutes: Math.max(30, baseTravel + (15 * complexityMultiplier) + urgencyAdjustment),
      travelTimeMinutes: baseTravel,
      jobOverrunBuffer: 15 * complexityMultiplier,
      equipmentBuffer: 10,
      serviceBuffer: 10,
      reasoning: 'Intelligent fallback calculation'
    };
  }
}

/**
 * AI-powered smart time rounding
 * Dynamically determines the best appointment time slots
 */
async function calculateSmartTimeRounding(calculatedTime, customerPreferences = {}, businessRules = {}) {
  console.log('🎯 AI determining optimal appointment time...');
  
  try {
    const prompt = `
You are a customer service expert optimizing appointment booking times for professional service delivery.

TIME ROUNDING ANALYSIS:
Calculated Time: ${calculatedTime.toISOString()}
Current Time: ${new Date().toISOString()}
Customer Preferences: ${JSON.stringify(customerPreferences)}
Business Rules: ${JSON.stringify(businessRules)}

OPTIMIZATION CRITERIA:
1. Professional appearance (avoid odd times like 3:33pm)
2. Customer convenience (standard appointment slots)
3. Operational efficiency (reasonable intervals)
4. Same-day vs next-day considerations
5. Peak hour considerations (avoid rush hours when possible)

STANDARD APPOINTMENT SLOTS (BUSINESS HOURS 8AM-5PM):
- Morning: 8:00 AM, 8:30 AM, 9:00 AM, 9:30 AM, 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM
- Afternoon: 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, 3:30 PM, 4:00 PM, 4:30 PM

BUSINESS RULES:
- Operating hours: 8:00 AM to 5:00 PM Monday-Friday
- Avoid lunch hour: 12:00 PM to 1:00 PM for complex jobs
- Emergency appointments can be outside hours but prefer standard slots
- Same-day preferred if before 3:00 PM, otherwise next business day

RESPOND IN JSON FORMAT:
{
  "recommendedTime": "ISO datetime string (MUST be within business hours 8AM-5PM)",
  "roundingStrategy": "round_up|round_down|nearest_slot",
  "slotInterval": 30,
  "businessDayAdjustment": "same_day|next_business_day",
  "reasoning": "explanation of time selection with business hours consideration"
}

Professional guidelines:
- Round to 30-minute intervals for standard appointments
- Round to 15-minute intervals for urgent/emergency only
- Avoid 12:00-1:00 PM unless necessary (lunch consideration)
- Prefer morning slots for complex jobs
- Evening slots (after 4:00 PM) for simple repairs only
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 400
    });

    let analysis;
    try {
      analysis = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error('❌ Failed to parse AI time rounding response, using fallback');
      analysis = {};
    }

    // Validate and fix business hours
    let recommendedTime = analysis.recommendedTime ? new Date(analysis.recommendedTime) : calculatedTime;
    recommendedTime = ensureBusinessHours(recommendedTime);
    
    console.log('🕐 AI Time Rounding:', {
      original: calculatedTime.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }),
      recommended: recommendedTime.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }),
      strategy: analysis.roundingStrategy || 'business_hours_corrected',
      reasoning: analysis.reasoning || 'Corrected to business hours (8AM-5PM)'
    });
    
    return {
      recommendedTime,
      roundingStrategy: analysis.roundingStrategy || 'nearest_slot',
      slotInterval: 30,
      businessDayAdjustment: analysis.businessDayAdjustment || 'same_day',
      reasoning: analysis.reasoning || 'Business hours validated appointment time'
    };
    
  } catch (error) {
    console.error('❌ AI time rounding failed:', error);
    
    // Intelligent fallback with business hours
    return getIntelligentTimeRounding(calculatedTime);
  }
}

/**
 * Ensure appointment time is within business hours (8AM-5PM)
 */
function ensureBusinessHours(dateTime) {
  const brisbaneTZ = 'Australia/Brisbane';
  const date = new Date(dateTime);
  
  // Get Brisbane time components
  const brisbaneTime = new Date(date.toLocaleString('en-US', { timeZone: brisbaneTZ }));
  const hours = brisbaneTime.getHours();
  const minutes = brisbaneTime.getMinutes();
  
  // Check if within business hours (8AM-5PM)
  if (hours < 8) {
    // Too early - set to 8:00 AM
    brisbaneTime.setHours(8, 0, 0, 0);
  } else if (hours >= 17) {
    // Too late - set to next business day 8:00 AM
    brisbaneTime.setDate(brisbaneTime.getDate() + 1);
    brisbaneTime.setHours(8, 0, 0, 0);
  } else if (hours === 16 && minutes > 30) {
    // After 4:30 PM - set to next business day 8:00 AM
    brisbaneTime.setDate(brisbaneTime.getDate() + 1);
    brisbaneTime.setHours(8, 0, 0, 0);
  } else {
    // Round to nearest 30-minute slot
    const roundedMinutes = Math.round(minutes / 30) * 30;
    if (roundedMinutes === 60) {
      brisbaneTime.setHours(hours + 1, 0, 0, 0);
    } else {
      brisbaneTime.setMinutes(roundedMinutes, 0, 0);
    }
  }
  
  // Skip weekends
  const dayOfWeek = brisbaneTime.getDay();
  if (dayOfWeek === 0) { // Sunday
    brisbaneTime.setDate(brisbaneTime.getDate() + 1); // Monday
  } else if (dayOfWeek === 6) { // Saturday
    brisbaneTime.setDate(brisbaneTime.getDate() + 2); // Monday
  }
  
  return brisbaneTime;
}

/**
 * Intelligent time rounding fallback
 */
function getIntelligentTimeRounding(calculatedTime) {
  const businessTime = ensureBusinessHours(calculatedTime);
  
  return {
    recommendedTime: businessTime,
    roundingStrategy: 'business_hours_fallback',
    slotInterval: 30,
    businessDayAdjustment: 'business_hours_corrected',
    reasoning: 'Fallback to business hours with 30-minute slots (8AM-5PM)'
  };
}

/**
 * Comprehensive AI-driven appointment scheduling
 * Combines all AI analyses for optimal scheduling
 */
async function scheduleAppointmentWithAI(customerData, issueDescription, previousAppointments = [], upcomingAppointments = []) {
  console.log('🚀 Starting comprehensive AI-driven appointment scheduling...');
  
  try {
    // Step 1: AI job duration analysis
    const jobAnalysis = await estimateJobDurationWithAI(issueDescription, customerData);
    
    // Step 2: Find the last appointment for travel calculation
    const lastAppointment = previousAppointments.length > 0 ? 
      previousAppointments[previousAppointments.length - 1] : 
      { address: 'Brisbane CBD, QLD 4000, Australia', issueType: 'travel_start' };
    
    // Step 3: AI travel analysis
    const travelAnalysis = await analyzeLocationDistance(
      lastAppointment.address, 
      customerData.address
    );
    
    // Step 4: AI gap calculation
    const gapAnalysis = await calculateOptimalAppointmentGap(
      lastAppointment,
      { ...customerData, issueType: jobAnalysis.complexity },
      travelAnalysis
    );
    
    // Step 5: Calculate initial appointment time with business hours validation
    let baseTime;
    if (lastAppointment.endTime) {
      baseTime = new Date(lastAppointment.endTime);
    } else {
      // No previous appointment - start with next available business slot
      baseTime = getNextBusinessSlot();
    }
    
    const calculatedStartTime = new Date(baseTime.getTime() + (gapAnalysis.recommendedGapMinutes * 60000));
    
    // Step 6: AI time rounding for professional scheduling
    const timeRounding = await calculateSmartTimeRounding(calculatedStartTime, customerData.preferences);
    
    // Step 7: Calculate end time
    const appointmentStart = timeRounding.recommendedTime;
    const appointmentEnd = new Date(appointmentStart.getTime() + (jobAnalysis.estimatedMinutes * 60000));
    
    const result = {
      start: appointmentStart,
      end: appointmentEnd,
      duration: jobAnalysis.estimatedMinutes,
      travelTime: travelAnalysis.estimatedTravelMinutes,
      gap: gapAnalysis.recommendedGapMinutes,
      analysis: {
        job: jobAnalysis,
        travel: travelAnalysis,
        gap: gapAnalysis,
        timeRounding: timeRounding
      },
      confidence: 'high', // AI-driven = high confidence
      type: 'ai_optimized'
    };
    
    console.log('✅ AI Scheduling Complete:', {
      appointment: `${appointmentStart.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} - ${appointmentEnd.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`,
      duration: `${jobAnalysis.estimatedMinutes} minutes`,
      travel: `${travelAnalysis.estimatedTravelMinutes} minutes`,
      gap: `${gapAnalysis.recommendedGapMinutes} minutes`
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ Comprehensive AI scheduling failed:', error);
    throw new Error(`AI scheduling failed: ${error.message}`);
  }
}

/**
 * Get the next available business slot (today if before 3PM, otherwise tomorrow)
 */
function getNextBusinessSlot() {
  const now = new Date();
  const brisbaneTZ = 'Australia/Brisbane';
  const brisbaneNow = new Date(now.toLocaleString('en-US', { timeZone: brisbaneTZ }));
  
  // Check if it's currently business hours and not too late for same-day booking
  const currentHour = brisbaneNow.getHours();
  
  if (currentHour >= 8 && currentHour < 15) {
    // Current time is between 8AM-3PM, can schedule for later today
    const nextSlot = new Date(brisbaneNow);
    nextSlot.setHours(currentHour + 1, 0, 0, 0); // Next hour, on the hour
    return ensureBusinessHours(nextSlot);
  } else {
    // Too late for today, schedule for tomorrow morning
    const tomorrow = new Date(brisbaneNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0); // 8 AM tomorrow
    return ensureBusinessHours(tomorrow);
  }
}

// Helper functions for fallbacks

function getIntelligentFallbackDuration(issueDescription, urgencyLevel) {
  const desc = issueDescription.toLowerCase();
  
  if (urgencyLevel === 'emergency' || desc.includes('emergency') || desc.includes('flooding')) {
    return { estimatedMinutes: 90, complexity: 'emergency', reasoning: 'Emergency fallback' };
  }
  
  if (desc.includes('toilet')) {
    if (desc.includes('install') || desc.includes('replace')) {
      return { estimatedMinutes: 150, complexity: 'complex', reasoning: 'Toilet installation fallback' };
    }
    return { estimatedMinutes: 60, complexity: 'moderate', reasoning: 'Toilet repair fallback' };
  }
  
  if (desc.includes('hot water')) {
    return { estimatedMinutes: 120, complexity: 'complex', reasoning: 'Hot water system fallback' };
  }
  
  return { estimatedMinutes: 75, complexity: 'moderate', reasoning: 'General plumbing fallback' };
}

function getIntelligentFallbackDistance(originAddress, destinationAddress) {
  // Simple keyword-based analysis for Brisbane
  const origin = (originAddress || '').toLowerCase();
  const dest = (destinationAddress || '').toLowerCase();
  
  // Same suburb check
  const originSuburb = origin.split(',')[0] || '';
  const destSuburb = dest.split(',')[0] || '';
  
  if (originSuburb === destSuburb) {
    return {
      distanceKm: 5,
      estimatedTravelMinutes: 15,
      reasoning: 'Same suburb fallback'
    };
  }
  
  // Brisbane distance estimates
  return {
    distanceKm: 20,
    estimatedTravelMinutes: 30,
    reasoning: 'Brisbane average fallback'
  };
}

function getComplexityMultiplier(complexity) {
  const multipliers = {
    'simple': 0.5,
    'moderate': 1.0,
    'complex': 1.5,
    'emergency': 2.0
  };
  return multipliers[complexity] || 1.0;
}

function getUrgencyAdjustment(priority) {
  const adjustments = {
    'emergency': -10,  // Reduce gap for emergencies
    'urgent': -5,      // Slight reduction for urgent
    'standard': 0,     // No adjustment
    'maintenance': 5   // Add buffer for maintenance
  };
  return adjustments[priority] || 0;
}

function getIntelligentTimeRounding(calculatedTime) {
  const rounded = new Date(calculatedTime);
  const minutes = rounded.getMinutes();
  
  // Round to nearest 30-minute interval
  if (minutes < 15) {
    rounded.setMinutes(0, 0, 0);
  } else if (minutes < 45) {
    rounded.setMinutes(30, 0, 0);
  } else {
    rounded.setHours(rounded.getHours() + 1, 0, 0, 0);
  }
  
  return {
    recommendedTime: rounded,
    roundingStrategy: 'nearest_slot',
    slotInterval: 30,
    reasoning: 'Standard 30-minute rounding fallback'
  };
}

function extractMinutesFromGoogleResponse(travelTimeString) {
  if (!travelTimeString) return 25;
  
  const hourMatch = travelTimeString.match(/(\d+)\s*hour/i);
  const minuteMatch = travelTimeString.match(/(\d+)\s*min/i);
  
  let totalMinutes = 0;
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
  if (minuteMatch) totalMinutes += parseInt(minuteMatch[1]);
  
  if (totalMinutes === 0) {
    const rangeMatch = travelTimeString.match(/(\d+)-(\d+)/);
    if (rangeMatch) {
      totalMinutes = Math.ceil((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
    }
  }
  
  return totalMinutes || 25;
}

module.exports = {
  estimateJobDurationWithAI,
  analyzeLocationDistance,
  calculateOptimalAppointmentGap,
  calculateSmartTimeRounding,
  scheduleAppointmentWithAI
};
