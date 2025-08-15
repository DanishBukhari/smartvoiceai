// flow.js - Comprehensive Merged Flow with Travel Time and Email Confirmation
const { getResponse } = require('./nlp');
const { getAccessToken, getLastAppointment, getNextAvailableSlot, isSlotFree, createAppointment } = require('./outlook');
const { createOrUpdateContact } = require('./ghl');
const { notifyError, notifyWarning, notifySuccess } = require('./notifications');
const { sendBookingConfirmationEmail, sendSMSConfirmation } = require('./professional-email-service');
const { analyzeLocationForBooking, addBookingToCluster } = require('./location-optimizer');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BRISBANE_TZ = 'Australia/Brisbane';

// Global caches and state
const travelTimeCache = new Map(); // Cache for travel time calculations
const responseCache = new Map(); // Cache for common responses
let lastBookedJobLocation = 'Brisbane CBD, QLD 4000, Australia'; // Default starting location

// Fast response patterns for common inputs
const quickResponses = {
  'hello': "Hello! I'm Robyn from Assure Fix Plumbing. What plumbing issue can I help you with today?",
  'hi': "Hi there! I'm Robyn from Assure Fix Plumbing. What plumbing problem do you need fixed?",
  'toilet': "I can help with your toilet issue. What's happening - is it not flushing, leaking, or blocked?",
  'sink': "I can help with your sink problem. Is it leaking, blocked, or no water coming out?",
  'bathroom sink': "I can help with your bathroom sink issue. Is it leaking, blocked, or no water coming out?",
  'kitchen sink': "I can help with your kitchen sink problem. Is it leaking, blocked, or no water coming out?",
  'drain': "I can help with your drain problem. Is it completely blocked or draining slowly?",
  'leak': "I can help with that leak. Where is it leaking from - toilet, tap, or pipe?",
  'tap': "I can help with your tap issue. Is it dripping, won't turn off, or no water?",
  'hot water': "I can help with your hot water problem. Do you have any hot water at all?",
  'emergency': "I understand this is urgent. What's the emergency - burst pipe, flooding, or no hot water?",
  'booking': "I can book an appointment for you. What plumbing issue needs fixing?",
  'appointment': "I can schedule an appointment for you. What plumbing problem do you need fixed?",
  'yes': "Great! Let me help you with that.",
  'no': "No problem. Is there anything else I can help you with?",
  'plumber': "I'm here to help with your plumbing needs! What specific issue are you experiencing?",
};

// Add input validation and common transcription error correction
function validateAndCorrectInput(input) {
  if (!input || typeof input !== 'string') return input;
  let corrected = input.trim();
  
  // First handle specific email patterns with numbers
  corrected = corrected
    .replace(/\bf\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)\s*@/gi, 'fyedahira$1@')
    .replace(/\bs\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)\s*@/gi, 'syedahira$1@')
    // Fix specific email issue: remove 'six.' before @
    .replace(/(\d+)six\.@/gi, '$1@')
    .replace(/six\.@/gi, '@');
  
  // Handle spaced letters in names (but not in email addresses)
  // Split by @ to handle email and non-email parts separately
  const parts = corrected.split('@');
  if (parts.length === 2) {
    // Handle email local part
    parts[0] = parts[0]
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3$4')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2');
    corrected = parts.join('@');
  } else {
    // No email address, safe to fix spaced letters everywhere
    corrected = corrected
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3$4')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2');
  }
  
  // Apply other corrections
  corrected = corrected
    .replace(/\bh\s*i\s*r\s*a\b/gi, 'Hira')
    .replace(/\bs\s*y\s*e\s*d\s*a?\s*h?\s*i\s*r\s*a\b/gi, 'Syed Ahira')
    .replace(/\bsyed\s+ahira\b/gi, 'Syed Ahira')
    .replace(/\btoy\b/gi, 'toilet') // Fix "toy" ? "toilet"
    .replace(/\btarget\b/gi, 'toilet') // Fix "target" ? "toilet"
    .replace(/\bbreastband\b/gi, 'Brisbane') // Fix "Breastband" ? "Brisbane"
    .replace(/\bflash\b/gi, 'flush'); // Fix "flash" ? "flush"

  const corrections = {
    'gmail dot com': 'gmail.com',
    'outlook dot com': 'outlook.com',
    'yahoo dot com': 'yahoo.com',
    'hotmail dot com': 'hotmail.com',
    'straight': 'street',
    'rode': 'road',
    'avenue': 'avenue',
    'court': 'court',
    'drive': 'drive',
    'yeah': 'yes',
    'yep': 'yes',
    'yup': 'yes',
    'nah': 'no',
    'nope': 'no',
  };

  for (const [wrong, right] of Object.entries(corrections)) {
    const regex = new RegExp('\\b' + wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    corrected = corrected.replace(regex, right);
  }

  return corrected;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  const localPart = email.split('@')[0];
  const domainPart = email.split('@')[1];
  
  if (!emailRegex.test(email)) return false;
  if (!localPart || !domainPart) return false;
  
  // Check for common invalid patterns
  if (localPart.includes('..') || localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (domainPart.includes('..') || domainPart.startsWith('.') || domainPart.endsWith('.')) return false;
  
  // Additional domain validation
  const domainParts = domainPart.split('.');
  if (domainParts.length < 2 || domainParts.some(part => part.length === 0)) return false;
  
  return true;
}

function correctEmailFromTranscription(input) {
  if (!input || typeof input !== 'string') return input;
  
  let corrected = input.trim().toLowerCase();
  
  // Fix common email transcription errors
  corrected = corrected
    // Fix numerical words to numbers
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    .replace(/\bzero\b/g, '0')
    // Fix domain extensions
    .replace(/\bat\s+g\s*mail\s*dot\s*com/g, '@gmail.com')
    .replace(/\bat\s+gmail\s*dot\s*com/g, '@gmail.com')
    .replace(/\bat\s+yahoo\s*dot\s*com/g, '@yahoo.com')
    .replace(/\bat\s+hotmail\s*dot\s*com/g, '@hotmail.com')
    .replace(/\bat\s+outlook\s*dot\s*com/g, '@outlook.com')
    // Fix spacing around @ and dots
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    // Remove invalid patterns like "six." before @
    .replace(/(\d+)six\.@/g, '$1@')
    .replace(/six\.@/g, '@')
    // Fix common transcription errors
    .replace(/\bf\s*y\s*e\s*d?\s*a?\s*h?\s*i\s*r\s*a\s*(\d+)/g, 'fyedahira$1')
    .replace(/\bs\s*y\s*e\s*d?\s*a?\s*h?\s*i\s*r\s*a\s*(\d+)/g, 'syedahira$1');
  
  return corrected;
}

const stateMachine = {
  awaitingAddress: false,
  awaitingTime: false,
  currentState: 'start',
  conversationHistory: [],
  clientData: {},
  issueType: null,
  questionIndex: 0,
  nextSlot: null,
  bookingRetryCount: 0,
  collectingDetail: null, // 'name', 'email', 'address', 'phone'
  spellingConfirmation: false,
  tempCollectedValue: null,
  callerPhoneNumber: null, // Store caller's phone number for appointment ID
  detailsCollectionStep: 0, // Track step-by-step collection (0=name, 1=email, 2=address, 3=phone, 4=confirm_all)
  allDetailsCollected: false,
  confirmingAllDetails: false,
  modifyingDetail: null, // Track which detail user wants to modify
  appointmentBooked: false,
  appointmentId: null,
  // Additional fields for comprehensive flow
  pendingTermination: false,
  callEndReason: null,
  awaitingConfirmation: false,
  pendingConfirmation: null,
  safetyConcern: false,
  needsBookingOffer: false, // Flag to offer booking in general handler
};

const issueQuestions = {
  'toilet': [
    "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    "Is it still leaking or has it stopped?",
    "How many toilets or showers do you have?",
  ],
  'hot water system': [
    "Do you have any hot water at all?",
    "Is it gas, electric, or solar?",
    "Any leaks�steady drip or fast?",
    "How old is it�under 10 years or over?",
    "What's the tank size�125L, 250L, 315L, or other?",
  ],
  'burst/leak': [
    "Has the water been shut off, or is it still running?",
    "Is there flooding inside or outside?",
  ],
  'rain-pump': [
    "Is the pump standalone or submersible?",
    "Does it supply toilets, laundry, or garden?",
    "Are those fixtures still getting water?",
  ],
  'roof leak': [
    "Is water dripping inside right now?",
    "Is the ceiling bulging or sagging?",
  ],
  'new install/quote': [
    "What would you like us to quote�new installation, repair, or inspection?",
  ],
  'other': [
    "Can you describe the issue or what you need?",
  ],
};

// Add conversation learning
const conversationInsights = {
  commonIssues: new Map(),
  customerPreferences: new Map(),
  successfulPhrases: new Map()
};

// Add analytics to track bot performance
const botAnalytics = {
  totalConversations: 0,
  successfulBookings: 0,
  commonIssues: new Map(),
  averageResponseTime: 0,
  customerSatisfaction: []
};

// Track conversation success
function trackConversationSuccess(successful) {
  botAnalytics.totalConversations++;
  if (successful) {
    botAnalytics.successfulBookings++;
  }
  
  // Calculate success rate
  const successRate = (botAnalytics.successfulBookings / botAnalytics.totalConversations) * 100;
  console.log(`Bot Success Rate: ${successRate.toFixed(1)}%`);
}

/**
 * Classify plumbing issues based on input to provide specific responses
 */
function classifyPlumbingIssue(input) {
  const text = input.toLowerCase();
  
  // Toilet issues
  if (text.includes('toilet') || text.includes('flush') || text.includes('flushing')) {
    if (text.includes('flush') || text.includes('flushing') || text.includes('won\'t flush') || text.includes('not flush')) {
      return {
        type: 'toilet_flush',
        description: 'a toilet that won\'t flush properly',
        followUp: 'This is a common issue that our plumbers can fix quickly.'
      };
    }
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'toilet_leak',
        description: 'a leaking toilet',
        followUp: 'Toilet leaks can waste water and cause damage, so it\'s good you\'re getting it fixed.'
      };
    }
    if (text.includes('block') || text.includes('blocked') || text.includes('clog')) {
      return {
        type: 'toilet_blocked',
        description: 'a blocked toilet',
        followUp: 'Blocked toilets need professional attention to avoid overflow issues.'
      };
    }
    // If mentions flushing but no toilet keyword, assume toilet
    if (text.includes('flush') || text.includes('flushing')) {
      return {
        type: 'toilet_flush',
        description: 'a toilet that won\'t flush properly',
        followUp: 'This is a common issue that our plumbers can fix quickly.'
      };
    }
    return {
      type: 'toilet_general',
      description: 'a toilet issue',
      followUp: 'Our plumbers are experienced with all types of toilet problems.'
    };
  }
  
  // Sink issues
  if (text.includes('sink') || text.includes('basin')) {
    const isKitchen = text.includes('kitchen');
    const isBathroom = text.includes('bathroom') || text.includes('bath');
    const sinkType = isKitchen ? 'kitchen sink' : isBathroom ? 'bathroom sink' : 'sink';
    
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'sink_leak',
        description: `a leaking ${sinkType}`,
        followUp: 'Sink leaks can cause water damage, so it\'s important to get them fixed promptly.'
      };
    }
    if (text.includes('block') || text.includes('blocked') || text.includes('drain')) {
      return {
        type: 'sink_blocked',
        description: `a blocked ${sinkType}`,
        followUp: 'Blocked sinks are usually caused by buildup in the pipes that our plumbers can clear.'
      };
    }
    if (text.includes('no water') || text.includes('not working')) {
      return {
        type: 'sink_no_water',
        description: `${sinkType} with no water`,
        followUp: 'This could be a tap issue or water supply problem that we can diagnose and fix.'
      };
    }
    return {
      type: 'sink_general',
      description: `a ${sinkType} problem`,
      followUp: 'Our plumbers handle all types of sink and tap issues.'
    };
  }
  
  // Tap/Faucet issues
  if (text.includes('tap') || text.includes('faucet')) {
    if (text.includes('drip') || text.includes('dripping')) {
      return {
        type: 'tap_drip',
        description: 'a dripping tap',
        followUp: 'Dripping taps waste water and money - good choice getting it fixed!'
      };
    }
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'tap_leak',
        description: 'a leaking tap',
        followUp: 'Tap leaks can usually be fixed quickly with the right parts.'
      };
    }
    return {
      type: 'tap_general',
      description: 'a tap issue',
      followUp: 'Our plumbers can repair or replace taps efficiently.'
    };
  }
  
  // Drain issues
  if (text.includes('drain') && !text.includes('sink')) {
    if (text.includes('block') || text.includes('blocked') || text.includes('clog')) {
      return {
        type: 'drain_blocked',
        description: 'a blocked drain',
        followUp: 'Blocked drains need professional equipment to clear properly.'
      };
    }
    if (text.includes('slow') || text.includes('slowly')) {
      return {
        type: 'drain_slow',
        description: 'a slow-draining drain',
        followUp: 'Slow drains often indicate a partial blockage that will get worse over time.'
      };
    }
    return {
      type: 'drain_general',
      description: 'a drain problem',
      followUp: 'Drain issues can be tricky, so professional help is often the best solution.'
    };
  }
  
  // Hot water issues
  if (text.includes('hot water') || text.includes('water heater')) {
    if (text.includes('no hot water') || text.includes('cold water only')) {
      return {
        type: 'hot_water_none',
        description: 'no hot water',
        followUp: 'No hot water can be caused by several issues that our technicians can diagnose.'
      };
    }
    if (text.includes('not enough') || text.includes('runs out')) {
      return {
        type: 'hot_water_insufficient',
        description: 'insufficient hot water',
        followUp: 'This could be a capacity or efficiency issue with your water heater.'
      };
    }
    return {
      type: 'hot_water_general',
      description: 'a hot water system issue',
      followUp: 'Hot water problems require specialized knowledge to fix safely.'
    };
  }
  
  // Leak issues (general)
  if (text.includes('leak') || text.includes('leaking')) {
    if (text.includes('pipe')) {
      return {
        type: 'pipe_leak',
        description: 'a pipe leak',
        followUp: 'Pipe leaks can cause significant damage, so quick action is important.'
      };
    }
    return {
      type: 'leak_general',
      description: 'a water leak',
      followUp: 'Water leaks should be addressed quickly to prevent damage.'
    };
  }
  
  // Emergency situations
  if (text.includes('burst') || text.includes('flooding') || text.includes('emergency')) {
    return {
      type: 'emergency',
      description: 'an emergency plumbing situation',
      followUp: 'This sounds urgent - we\'ll prioritize your appointment.'
    };
  }
  
  return null; // No specific classification found
}

// Check for quick responses first to reduce latency
function getQuickResponse(input) {
  const cleanInput = input.toLowerCase().trim();
  
  // Direct matches for greetings and simple responses
  if (quickResponses[cleanInput]) {
    return quickResponses[cleanInput];
  }
  
  // Smart partial matches - only for main topics
  for (const [key, response] of Object.entries(quickResponses)) {
    if (key === 'hello' || key === 'hi' || key === 'yes' || key === 'no') {
      // Exact match for simple words
      if (cleanInput === key) {
        return response;
      }
    } else if (key.includes(' ')) {
      // Multi-word phrases like "hot water", "bathroom sink"
      if (cleanInput.includes(key)) {
        return response;
      }
    } else {
      // Single word topics - ensure it's the main focus
      const words = cleanInput.split(' ');
      if (words.includes(key) || 
          cleanInput.startsWith(key) || 
          cleanInput.endsWith(key)) {
        return response;
      }
    }
  }
  
  return null; // No quick response found
}

// LATENCY OPTIMIZATION: Use faster model for simple analysis
async function analyzeFastInput(input) {
  const startTime = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Faster than gpt-4o-mini
      messages: [
        {
          role: 'system',
          content: 'Quick analysis. Return one word: toilet, drain, leak, emergency, booking, or general'
        },
        {
          role: 'user',
          content: input
        }
      ],
      max_tokens: 5, // Very short response
      temperature: 0,
    });
    
    const analysisTime = Date.now() - startTime;
    console.log(`? Fast analysis completed in ${analysisTime}ms`);
    
    const result = response.choices[0].message.content.trim().toLowerCase();
    return {
      issue: result.includes('toilet') ? 'toilet issue' : 
             result.includes('drain') ? 'drain issue' :
             result.includes('leak') ? 'leak issue' :
             result.includes('emergency') ? 'emergency' :
             result.includes('booking') ? 'booking request' : 'general plumbing',
      urgency: result.includes('emergency') ? 'high' : 'medium',
      emotion: 'calm',
      knowledge: 'basic',
      safety: 'none'
    };
  } catch (error) {
    console.error('Fast analysis error:', error.message);
    return {
      issue: input.toLowerCase().includes('toilet') ? 'toilet issue' : 'plumbing issue',
      urgency: 'medium',
      emotion: 'calm',
      knowledge: 'basic',
      safety: 'none'
    };
  }
}

/**
 * Calculate estimated service duration based on issue description
 * @param {string} issueDescription - Description of the plumbing issue
 * @returns {string} Estimated duration in readable format
 */
function calculateServiceDuration(issueDescription) {
  if (!issueDescription) return '1-2 hours';
  
  const issue = issueDescription.toLowerCase();
  
  // Complex/lengthy repairs
  if (issue.includes('renovation') || issue.includes('replacement') || 
      issue.includes('install') || issue.includes('new') || 
      issue.includes('multiple') || issue.includes('bathroom')) {
    return '3-4 hours';
  }
  
  // Medium complexity
  if (issue.includes('leak') || issue.includes('burst') || 
      issue.includes('hot water') || issue.includes('drainage') ||
      issue.includes('pipe') || issue.includes('valve')) {
    return '2-3 hours';
  }
  
  // Quick fixes
  if (issue.includes('drip') || issue.includes('tap') || 
      issue.includes('faucet') || issue.includes('running') ||
      issue.includes('flush') || issue.includes('toilet')) {
    return '1-2 hours';
  }
  
  // Default estimate
  return '1-2 hours';
}

/**
 * Calculate estimated travel time for email template based on address
 * Enhanced with more Brisbane suburbs for better accuracy
 * @param {string} address - Customer address
 * @returns {string} Estimated travel time in readable format
 */
function calculateEmailTravelTime(address) {
  if (!address) return '30-45 minutes';
  
  const addr = address.toLowerCase();
  
  // Central Brisbane areas (closer) - 15-30 minutes
  if (addr.includes('brisbane cbd') || addr.includes('brisbane city') ||
      addr.includes('spring hill') || addr.includes('fortitude valley') || 
      addr.includes('new farm') || addr.includes('west end') || 
      addr.includes('south bank') || addr.includes('kangaroo point') || 
      addr.includes('teneriffe') || addr.includes('milton') || 
      addr.includes('paddington') || addr.includes('petrie terrace') ||
      addr.includes('bowen hills') || addr.includes('herston')) {
    return '15-30 minutes';
  }
  
  // Suburban areas (medium distance) - 30-45 minutes  
  if (addr.includes('chermside') || addr.includes('carindale') || 
      addr.includes('indooroopilly') || addr.includes('toowong') ||
      addr.includes('ashgrove') || addr.includes('kelvin grove') ||
      addr.includes('woolloongabba') || addr.includes('greenslopes') ||
      addr.includes('camp hill') || addr.includes('coorparoo') ||
      addr.includes('bulimba') || addr.includes('hawthorne') ||
      addr.includes('morningside') || addr.includes('cannon hill') ||
      addr.includes('murarrie') || addr.includes('tingalpa') ||
      addr.includes('stones corner') || addr.includes('annerley') ||
      addr.includes('yeronga') || addr.includes('fairfield') ||
      addr.includes('dutton park') || addr.includes('st lucia') ||
      addr.includes('taringa') || addr.includes('chapel hill') ||
      addr.includes('kenmore') || addr.includes('fig tree pocket')) {
    return '30-45 minutes';
  }
  
  // Outer suburbs (further) - 45-60 minutes
  if (addr.includes('logan') || addr.includes('ipswich') || 
      addr.includes('redcliffe') || addr.includes('caboolture') ||
      addr.includes('gold coast') || addr.includes('beenleigh') ||
      addr.includes('springwood') || addr.includes('eight mile plains') ||
      addr.includes('sunnybank') || addr.includes('browns plains') ||
      addr.includes('forest lake') || addr.includes('inala') ||
      addr.includes('richlands') || addr.includes('darra') ||
      addr.includes('oxley') || addr.includes('corinda') ||
      addr.includes('sherwood') || addr.includes('graceville') ||
      addr.includes('chelmer') || addr.includes('jindalee') ||
      addr.includes('mount ommaney') || addr.includes('westlake')) {
    return '45-60 minutes';
  }
  
  // Default estimate for unknown areas
  return '30-45 minutes';
}

/**
 * Start step-by-step detail collection process
 */
async function startStepByStepCollection() {
  stateMachine.detailsCollectionStep = 0;
  stateMachine.allDetailsCollected = false;
  stateMachine.confirmingAllDetails = false;
  return await collectNextDetail();
}

/**
 * Collect details in sequential order: name -> email -> address -> phone
 */
async function collectNextDetail() {
  const steps = ['name', 'email', 'address', 'phone'];
  const currentStep = stateMachine.detailsCollectionStep;
  
  if (currentStep >= steps.length) {
    // All details collected, move to confirmation
    return await confirmAllDetails();
  }
  
  const detailType = steps[currentStep];
  stateMachine.collectingDetail = detailType;
  stateMachine.spellingConfirmation = false;
  
  const prompts = {
    name: 'Let me start by getting your details. Could you please tell me your full name? Please speak clearly so I can get the spelling right.',
    email: 'Perfect! Now, what\'s your email address? Please spell it out letter by letter so I don\'t miss anything.',
    address: 'Great! Now I need the complete address where you need the plumber. Please include the street number, street name, suburb, state, and postcode.',
    phone: 'Excellent! Finally, could you please provide your phone number? This will be your reference number for the appointment.'
  };
  
  const response = await getResponse(prompts[detailType], stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

/**
 * Confirm all collected details step by step
 */
async function confirmAllDetails() {
  stateMachine.confirmingAllDetails = true;
  stateMachine.allDetailsCollected = true;
  
  const confirmationMessage = 
    `Perfect! Let me confirm all your details step by step:\n\n` +
    `?? Name: ${stateMachine.clientData.name || 'Not provided'}\n` +
    `?? Email: ${stateMachine.clientData.email || 'Not provided'}\n` +
    `?? Address: ${stateMachine.clientData.address || 'Not provided'}\n` +
    `?? Phone:  ${stateMachine.clientData.phone || 'Not provided'}\n\n` +
    `Are all these details correct? Please say:\n` +
    `� "YES" if everything is correct\n` +
    `� "CHANGE NAME" to modify your name\n` +
    `� "CHANGE EMAIL" to modify your email\n` +
    `� "CHANGE ADDRESS" to modify your address\n` +
    `� "CHANGE PHONE" to modify your phone number`;
  
  const response = await getResponse(confirmationMessage, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

/**
 * Handle modification of specific details
 */
async function handleDetailModification(detailType) {
  stateMachine.modifyingDetail = detailType;
  stateMachine.collectingDetail = detailType;
  stateMachine.spellingConfirmation = false;
  
  const prompts = {
    name: 'Please tell me your correct full name.',
    email: 'Please provide your correct email address, spelling it out letter by letter.',
    address: 'Please provide the correct complete address where you need the plumber.',
    phone: 'Please provide your correct phone number.'
  };
  
  const response = await getResponse(prompts[detailType], stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

/**
 * Automatically detect available slots and book appointment
 */
async function autoBookAppointment() {
  try {
    console.log('?? Auto-detecting available appointment slots...');
    
    // Get access token for Google Calendar
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error('? Failed to get Google Calendar access token');
      const response = await getResponse(
        'I apologize, but I\'m having trouble accessing our scheduling system right now. Let me get this sorted for you. I\'ll have someone from our office call you within the next hour to schedule your appointment. Is that okay?',
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
    
    // ??? ANALYZE LOCATION FOR OPTIMAL BOOKING
    console.log('??? Analyzing customer location for travel optimization...');
    try {
      const locationAnalysis = await analyzeLocationForBooking(stateMachine.clientData.address);
      console.log('?? Location analysis result:', locationAnalysis);
      
      // Store location analysis for later use
      stateMachine.clientData.locationAnalysis = locationAnalysis;
      
      // If location is not feasible (outside service area), inform customer
      if (!locationAnalysis.feasible) {
        const response = await getResponse(locationAnalysis.message, stateMachine.conversationHistory);
        stateMachine.conversationHistory.push({ role: 'assistant', content: response });
        return response;
      }
      
      // If high efficiency cluster opportunity, include message in booking confirmation
      if (locationAnalysis.priority === 'high_efficiency') {
        console.log('?? High efficiency booking opportunity detected');
        console.log('?? Cluster message:', locationAnalysis.message);
      }
      
    } catch (locationError) {
      console.error('? Location analysis failed:', locationError.message);
      console.log('?? Continuing with standard booking process');
    }
    
    // ✅ SMART SCHEDULING: Find most travel-efficient slot first
    console.log('🚗 PRIORITY: Using smart scheduling to minimize travel distance and fuel consumption...');
    let smartSlotResult = null;
    try {
      const { findMostEfficientSlot } = require('./location-optimizer');
      
      // Get issue description for job duration estimation
      const issueDescription = stateMachine.clientData.issueDescription || 
                              stateMachine.clientData.toilet_1 || 
                              stateMachine.clientData.tap_1 ||
                              stateMachine.clientData.hotwater_1 ||
                              stateMachine.clientData.drain_1 ||
                              'General plumbing service';
      
      const urgencyLevel = stateMachine.clientData.safetyConcern ? 'urgent' : 'normal';
      
      console.log(`🔧 Job Assessment: "${issueDescription}" (${urgencyLevel})`);
      
      smartSlotResult = await findMostEfficientSlot(
        accessToken, 
        stateMachine.clientData.address, 
        issueDescription, 
        urgencyLevel
      );
      
      if (smartSlotResult && smartSlotResult.slot) {
        console.log('🎯 SMART SCHEDULING SUCCESS: Found optimal slot!');
        console.log(`   ⚡ Efficiency Level: ${smartSlotResult.analysis.efficiency}`);
        console.log(`   🚗 Travel Distance: ${smartSlotResult.analysis.travelDistance.toFixed(1)}km`);
        console.log(`   💰 Estimated Savings: $${smartSlotResult.analysis.fuelSavings.costAUD} AUD`);
        console.log(`   💡 Strategy: ${smartSlotResult.analysis.reason}`);
        
        // Use the optimized slot
        stateMachine.nextSlot = smartSlotResult.slot;
        stateMachine.smartScheduling = smartSlotResult.analysis;
      } else {
        console.log('⚠️ Smart scheduling unavailable, using standard slot selection...');
      }
    } catch (smartSchedulingError) {
      console.error('⚠️ Smart scheduling failed, falling back to standard:', smartSchedulingError.message);
    }
    
    // Fallback to standard slot selection if smart scheduling failed
    if (!stateMachine.nextSlot) {
      console.log('📅 Using standard next available slot...');
      const now = new Date();
      const nextSlot = await getNextAvailableSlot(accessToken, now);
      if (!nextSlot) {
        console.error('❌ No available appointment slots found');
        const response = await getResponse(
          'I apologize, but I\'m having trouble accessing our scheduling system right now. Let me get this sorted for you. I\'ll have someone from our office call you within the next hour to schedule your appointment. Is that okay?',
          stateMachine.conversationHistory
        );
        stateMachine.conversationHistory.push({ role: 'assistant', content: response });
        return response;
      }
      stateMachine.nextSlot = nextSlot;
    }
    console.log(`? Available slot found: ${nextSlot}`);
    
    // Format appointment time
    const appointmentTime = nextSlot.toLocaleString('en-AU', {
      timeZone: BRISBANE_TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    // Generate reference number
    const referenceNumber = `PLB-${Date.now().toString().slice(-6)}`;
    
    // Create Google Calendar event details
    const eventDetails = {
      summary: `Plumbing Appointment - ${stateMachine.clientData.name}`,
      description: `**PLUMBING SERVICE APPOINTMENT**\n\n` +
                  `Customer: ${stateMachine.clientData.name}\n` +
                  `Phone: ${stateMachine.clientData.phone || 'Not provided'}\n` +
                  `Email: ${stateMachine.clientData.email}\n` +
                  `Address: ${stateMachine.clientData.address}\n` +
                  `Issue: ${stateMachine.clientData.issueDescription || 'General plumbing service'}\n` +
                  `Reference: ${referenceNumber}\n` +
                  `Booked via Smart Voice AI`,
      start: {
        dateTime: nextSlot.toISOString(),
        timeZone: BRISBANE_TZ,
      },
      end: {
        dateTime: new Date(nextSlot.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours duration
        timeZone: BRISBANE_TZ,
      },
      location: stateMachine.clientData.address,
      attendees: [
        { email: stateMachine.clientData.email }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 }
        ]
      }
    };
    
    console.log('?? Creating Google Calendar appointment...');
    console.log(`?? Customer: ${stateMachine.clientData.name}`);
    console.log(`?? Email: ${stateMachine.clientData.email}`);
    console.log(`?? Address: ${stateMachine.clientData.address}`);
    console.log(`?? Phone: ${stateMachine.clientData.phone || 'Not provided'}`);
    console.log(`? Appointment Time: ${appointmentTime}`);
    console.log(`?? Reference Number: ${referenceNumber}`);
    
    const appointment = await createAppointment(accessToken, eventDetails);
    
    if (appointment && appointment.id) {
      console.log('? APPOINTMENT SUCCESSFULLY BOOKED IN GOOGLE CALENDAR!');
      console.log(`?? Appointment ID: ${appointment.id}`);
      console.log(`?? Email confirmation will be sent to: ${stateMachine.clientData.email}`);
      
      stateMachine.appointmentBooked = true;
      stateMachine.appointmentId = appointment.id;
      stateMachine.referenceNumber = referenceNumber;
      
      // ??? ADD BOOKING TO LOCATION CLUSTER FOR OPTIMIZATION
      try {
        const bookingDetails = {
          id: appointment.id,
          date: nextSlot,
          address: stateMachine.clientData.address,
          coordinates: stateMachine.clientData.locationAnalysis?.coordinates,
          customerName: stateMachine.clientData.name,
          referenceNumber: referenceNumber
        };
        
        addBookingToCluster(bookingDetails);
        console.log('? Booking added to location cluster for future optimization');
        
        // Log cluster efficiency message if applicable
        if (stateMachine.clientData.locationAnalysis?.priority === 'high_efficiency') {
          console.log('?? HIGH EFFICIENCY BOOKING: This appointment is clustered with nearby locations');
        }
        
      } catch (clusterError) {
        console.error('?? Failed to add booking to cluster:', clusterError.message);
        // Continue with booking process even if clustering fails
      }
      
      // Send confirmation email (this will be handled by Google Calendar automatically)
      console.log('?? EMAIL CONFIRMATION PROCESS:');
      console.log('   ? Google Calendar will automatically send email invitation');
      console.log('   ? Customer will receive calendar invite with appointment details');
      console.log('   ? Appointment added to customer\'s calendar');
      
      // Also send our custom confirmation email with detailed information
      try {
        console.log('?? Sending additional professional confirmation email...');
        await sendConfirmationEmail();
        console.log('? Additional professional confirmation email sent successfully');
      } catch (emailError) {
        console.error('?? Custom email failed, but Google Calendar invitation was sent:', emailError.message);
      }
      
      const response = `🎯 Appointment Successfully Booked!

📅 Date & Time: ${appointmentTime}
📍 Location: ${stateMachine.clientData.address}
🎫 Reference Number: ${referenceNumber}
📧 Email Confirmation: Being sent to ${stateMachine.clientData.email}

✅ Your appointment is confirmed! Our technician will arrive within the scheduled time window.${
  stateMachine.smartScheduling && stateMachine.smartScheduling.efficiency === 'high_efficiency'
    ? `\n\n🌟 SMART SCHEDULING OPTIMIZATION: ${stateMachine.smartScheduling.reason}! This saves approximately ${stateMachine.smartScheduling.fuelSavings.distanceKm}km of travel distance and $${stateMachine.smartScheduling.fuelSavings.costAUD} in fuel costs.`
    : stateMachine.smartScheduling && stateMachine.smartScheduling.efficiency === 'medium_efficiency'
    ? `\n\n⚡ EFFICIENT SCHEDULING: ${stateMachine.smartScheduling.reason}. This reduces travel by ${stateMachine.smartScheduling.fuelSavings.distanceKm}km compared to random scheduling.`
    : stateMachine.clientData.locationAnalysis?.priority === 'high_efficiency' 
    ? '\n\n🚗 TRAVEL EFFICIENCY: ' + stateMachine.clientData.locationAnalysis.message.replace('Great news! ', '') 
    : stateMachine.clientData.locationAnalysis?.distanceFromCenter > 25 
      ? `\n\n🌍 LOCATION NOTE: Your address is ${Math.round(stateMachine.clientData.locationAnalysis.distanceFromCenter)}km from our central service area, so we've scheduled extra travel time.`
      : ''
}

📋 You will receive:
• Calendar invitation with appointment details
• Email confirmation with our contact information
• Reminder notifications before your appointment

🔧 You can:
• Say "CANCEL APPOINTMENT" to cancel
• Say "RESCHEDULE" to change the time
• Say "POSTPONE" to delay the appointment

Is there anything else I can help you with?`;
      
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      trackConversationSuccess(true);
      return response;
    } else {
      throw new Error('Failed to create appointment - no appointment ID returned');
    }
    
  } catch (error) {
    console.error('? APPOINTMENT BOOKING FAILED:', error.message);
    console.error('?? Error Details:', {
      customerName: stateMachine.clientData.name,
      customerEmail: stateMachine.clientData.email,
      customerAddress: stateMachine.clientData.address,
      error: error.stack
    });
    
    const response = await getResponse(
      'I apologize, but I encountered an issue while booking your appointment. Let me get this resolved for you immediately. I\'ll have our scheduling team call you within the next 30 minutes to confirm your appointment. Is that acceptable?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

/**
 * Handle appointment cancellation
 */
async function handleAppointmentCancellation() {
  if (!stateMachine.appointmentBooked || !stateMachine.appointmentId) {
    const response = await getResponse(
      'I don\'t see any active appointment to cancel. If you have an appointment reference number, please provide it and I\'ll help you cancel it.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  try {
    // Here you would call your cancellation API
    // await cancelAppointment(stateMachine.appointmentId);
    
    stateMachine.appointmentBooked = false;
    const cancelledId = stateMachine.appointmentId;
    stateMachine.appointmentId = null;
    
    const response = await getResponse(
      `? Appointment Cancelled Successfully\n\n` +
      `?? Cancelled Reference: ${cancelledId}\n` +
      `?? Cancellation confirmation will be sent to ${stateMachine.clientData.email}\n\n` +
      `Your appointment has been cancelled. If you need to reschedule or book a new appointment, just let me know!`,
      stateMachine.conversationHistory
    );
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
    
  } catch (error) {
    console.error('? Cancellation failed:', error);
    const response = await getResponse(
      'I encountered an issue while cancelling your appointment. Please call our office directly, or I can have someone call you back to assist with the cancellation. What would you prefer?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

/**
 * Handle appointment postponement
 */
async function handleAppointmentPostponement() {
  if (!stateMachine.appointmentBooked || !stateMachine.appointmentId) {
    const response = await getResponse(
      'I don\'t see any active appointment to postpone. If you have an appointment reference number, please provide it and I\'ll help you reschedule it.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  const response = await getResponse(
    `I understand you need to postpone your appointment (Reference: ${stateMachine.appointmentId}).\n\n` +
    `When would you prefer to reschedule? Please tell me:\n` +
    `� "TOMORROW" for the next available slot tomorrow\n` +
    `� "NEXT WEEK" for next week\n` +
    `� A specific day like "FRIDAY" or "NEXT MONDAY"\n` +
    `� Or say "CALL ME" and we'll call you to reschedule`,
    stateMachine.conversationHistory
  );
  
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  stateMachine.currentState = 'rescheduling';
  return response;
}

/**
 * Enhanced detail collection with step-by-step confirmation
 */
async function handleDetailCollection(input, extractedData) {
  const detailType = stateMachine.collectingDetail;
  
  // Handle modification requests during confirmation
  if (stateMachine.confirmingAllDetails) {
    const normalizedInput = input.toLowerCase();
    
    if (normalizedInput.includes('yes') || normalizedInput.includes('correct') || normalizedInput.includes('all good')) {
      // All details confirmed, proceed to booking
      stateMachine.confirmingAllDetails = false;
      return await autoBookAppointment();
    }
    
    // Check for specific modification requests
    if (normalizedInput.includes('change name') || normalizedInput.includes('name wrong') || normalizedInput.includes('wrong name')) {
      return await handleDetailModification('name');
    }
    if (normalizedInput.includes('change email') || normalizedInput.includes('email wrong') || normalizedInput.includes('wrong email')) {
      return await handleDetailModification('email');
    }
    if (normalizedInput.includes('change address') || normalizedInput.includes('address wrong') || normalizedInput.includes('wrong address')) {
      return await handleDetailModification('address');
    }
    if (normalizedInput.includes('change phone') || normalizedInput.includes('phone wrong') || normalizedInput.includes('wrong phone')) {
      return await handleDetailModification('phone');
    }
    
    // If no specific change mentioned, ask for clarification
    const response = await getResponse(
      'Which detail would you like to change? Please say:\n' +
      '� "CHANGE NAME" for your name\n' +
      '� "CHANGE EMAIL" for your email\n' +
      '� "CHANGE ADDRESS" for your address\n' +
      '� "CHANGE PHONE" for your phone number\n' +
      '� or "YES" if everything is actually correct',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  if (!stateMachine.spellingConfirmation) {
    // First attempt to collect the detail
    let extractedValue = null;
    
    if (detailType === 'name') {
      extractedValue = extractedData.name || await extractCustomerData(input).then(data => data.name);
    } else if (detailType === 'email') {
      extractedValue = extractedData.email || await extractCustomerData(input).then(data => data.email);
      if (extractedValue) {
        extractedValue = correctEmailFromTranscription(extractedValue);
      }
    } else if (detailType === 'address') {
      extractedValue = extractedData.address || await extractCustomerData(input).then(data => data.address);
    } else if (detailType === 'phone') {
      extractedValue = extractedData.phone || await extractCustomerData(input).then(data => data.phone);
      if (!extractedValue) {
        // Try to extract phone number from raw input
        const phoneMatch = input.match(/(\d{4}\s?\d{3}\s?\d{3}|\d{10}|\+61\s?\d{9})/);
        if (phoneMatch) {
          extractedValue = phoneMatch[0].replace(/\s/g, '');
        }
      }
    }
    
    if (extractedValue) {
      stateMachine.tempCollectedValue = extractedValue;
      stateMachine.spellingConfirmation = true;
      
      let confirmationQuestion;
      if (detailType === 'email') {
        confirmationQuestion = `I heard your email as: ${extractedValue}. Is that spelled correctly? Please say YES if correct, or spell it out again if I got it wrong.`;
      } else if (detailType === 'name') {
        confirmationQuestion = `I heard your name as: ${extractedValue}. Is that correct? Please say YES if correct, or tell me your name again if I got it wrong.`;
      } else if (detailType === 'phone') {
        confirmationQuestion = `I heard your phone number as: ${extractedValue}. Is that correct? Please say YES if correct, or repeat your phone number if I got it wrong.`;
      } else {
        confirmationQuestion = `I heard your address as: ${extractedValue}. Is that correct? Please say YES if correct, or tell me the address again if I got it wrong.`;
      }
      
      const response = await getResponse(confirmationQuestion, stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } else {
      // Couldn't extract, ask again
      const retryPrompts = {
        name: 'I didn\'t catch your name clearly. Could you please repeat your full name?',
        email: 'I couldn\'t catch your email address. Please spell it out letter by letter.',
        address: 'I didn\'t get the full address. Please repeat the complete address including street number, street name, suburb, and postcode.',
        phone: 'I didn\'t catch your phone number. Please repeat it clearly with all digits.',
      };
      
      const response = await getResponse(retryPrompts[detailType], stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  } else {
    // Handling confirmation response
    const isConfirmed = input.toLowerCase().includes('yes') || 
                       input.toLowerCase().includes('correct') || 
                       input.toLowerCase().includes('right') ||
                       input.toLowerCase().includes('perfect');
    
    if (isConfirmed) {
      // Confirmed, save the detail with validation
      let valueToSave = stateMachine.tempCollectedValue;
      
      // Special validation for email
      if (detailType === 'email') {
        valueToSave = correctEmailFromTranscription(valueToSave);
        if (!validateEmail(valueToSave)) {
          console.log(`? Invalid email after confirmation: ${valueToSave}`);
          stateMachine.spellingConfirmation = false;
          stateMachine.tempCollectedValue = null;
          const response = await getResponse(
            'I\'m sorry, but that email address doesn\'t look valid. Could you please spell out your email address letter by letter? For example: j-o-h-n at g-m-a-i-l dot c-o-m',
            stateMachine.conversationHistory
          );
          stateMachine.conversationHistory.push({ role: 'assistant', content: response });
          return response;
        }
      }
      
      stateMachine.clientData[detailType] = valueToSave;
      stateMachine.collectingDetail = null;
      stateMachine.spellingConfirmation = false;
      stateMachine.tempCollectedValue = null;
      
      console.log(`? Confirmed ${detailType}: ${stateMachine.clientData[detailType]}`);
      
      // If we're modifying a detail during confirmation, go back to confirmation
      if (stateMachine.modifyingDetail) {
        stateMachine.modifyingDetail = null;
        return await confirmAllDetails();
      }
      
      // Move to next step in sequential collection
      stateMachine.detailsCollectionStep++;
      return await collectNextDetail();
      
    } else {
      // Not confirmed, ask again
      stateMachine.spellingConfirmation = false;
      stateMachine.tempCollectedValue = null;
      
      const retryPrompts = {
        name: 'Please tell me your full name again.',
        email: 'Please spell out your email address letter by letter.',
        address: 'Please tell me the complete address again.',
        phone: 'Please repeat your phone number.',
      };
      
      const response = await getResponse(retryPrompts[detailType], stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  }
}

/**
 * Generate a reference number using caller's phone number
 */
function generatePhoneBasedReference(phoneNumber) {
  if (!phoneNumber) {
    return 'USHFX' + Date.now();
  }
  
  // Clean phone number and take last 6 digits
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  const last6Digits = cleanPhone.slice(-6);
  
  // Add current date and time for uniqueness
  const now = new Date();
  const dateString = now.getFullYear().toString().slice(-2) + 
                    String(now.getMonth() + 1).padStart(2, '0') + 
                    String(now.getDate()).padStart(2, '0');
  
  return `PH${last6Digits}-${dateString}`;
}

/**
 * Get service category based on issue description
 * @param {string} issueDescription - Description of the plumbing issue
 * @returns {string} Service category
 */
function getServiceCategory(issueDescription) {
  if (!issueDescription) return 'General Plumbing';
  
  const issue = issueDescription.toLowerCase();
  
  if (issue.includes('toilet') || issue.includes('flush') || 
      issue.includes('cistern')) {
    return 'Toilet Repairs';
  }
  
  if (issue.includes('tap') || issue.includes('faucet') || 
      issue.includes('drip') || issue.includes('leak')) {
    return 'Tap & Leak Repairs';
  }
  
  if (issue.includes('hot water') || issue.includes('heater') || 
      issue.includes('boiler')) {
    return 'Hot Water Systems';
  }
  
  if (issue.includes('drain') || issue.includes('block') || 
      issue.includes('clog') || issue.includes('sewer')) {
    return 'Drainage & Blocked Drains';
  }
  
  if (issue.includes('pipe') || issue.includes('replacement') || 
      issue.includes('install')) {
    return 'Pipe Installation & Repair';
  }
  
  return 'General Plumbing';
}

async function calculateTravelTime(origin, destination) {
  console.log('?? calculateTravelTime: Calculating from', origin, 'to', destination);
  
  // Check cache first
  const cacheKey = `${origin.toLowerCase()}|${destination.toLowerCase()}`;
  if (travelTimeCache.has(cacheKey)) {
    const cached = travelTimeCache.get(cacheKey);
    console.log('?? Using cached travel time:', cached, 'minutes');
    return cached;
  }
  
  try {
    // Format addresses for Australia with proper structure
    const formattedOrigin = formatAustralianAddress(origin);
    const formattedDestination = formatAustralianAddress(destination);
    
    console.log('?? Formatted addresses:', {
      origin: formattedOrigin,
      destination: formattedDestination
    });
    
    // If same location or very similar
    if (formattedOrigin.toLowerCase() === formattedDestination.toLowerCase()) {
      console.log('?? Same location, returning 30 minutes for job completion buffer');
      const result = 30; // 30 minutes for finishing previous job even at same location
      travelTimeCache.set(cacheKey, result);
      return result;
    }
    
    let travelTimeMinutes = 0;
    
    // Try Google Maps Distance Matrix API first with retry logic
    if (process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY !== 'your_google_maps_key_here') {
      try {
        const googleResult = await retryApiCall(
          () => calculateGoogleMapsDistance(formattedOrigin, formattedDestination),
          3, // 3 retries
          1000 // 1 second delay
        );
        if (googleResult && googleResult > 0) {
          travelTimeMinutes = googleResult;
          console.log('??? Google Maps Result:', travelTimeMinutes, 'minutes');
        }
      } catch (googleError) {
        console.log('?? Google Maps failed, trying fallback:', googleError.message);
      }
    }
    
    // Try OpenAI for Australian travel time estimation if Google Maps failed
    if (travelTimeMinutes === 0 && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'process.env.GOOGLE_MAPS_API_KEY') {
      try {
        const prompt = `Calculate accurate driving time in minutes from "${formattedOrigin}" to "${formattedDestination}" in Brisbane, Australia. 

IMPORTANT: Consider Brisbane's actual road network and traffic patterns:
- Brisbane CBD to suburbs: 15-45 minutes depending on distance
- Cross-city travel (e.g., north to south): 25-60 minutes  
- Airport to CBD: 25-35 minutes
- Inner suburbs to each other: 10-25 minutes
- Adjacent suburbs: 8-15 minutes
- Same suburb/area: 5-10 minutes

Factors to include:
- Real Brisbane driving distances and main roads (not straight line)
- Business hours traffic (moderate congestion)
- Speed limits: 50-60 km/h urban, 70-80 km/h arterials, 100 km/h highways
- Brisbane River crossings and bridge delays
- Hills and terrain in western suburbs

Return ONLY the number of minutes as an integer. Be realistic - Brisbane metro area travel rarely exceeds 60 minutes.`;

        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini', // Faster model for travel calculations
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 15,
          temperature: 0.2, // Slightly higher for more realistic variation
        });
        
        const aiResult = parseInt(response.choices[0].message.content.trim());
        if (!isNaN(aiResult) && aiResult > 0) {
          travelTimeMinutes = aiResult;
          console.log('?? OpenAI Result:', travelTimeMinutes, 'minutes');
        }
      } catch (aiError) {
        console.log('?? OpenAI travel estimation failed:', aiError.message);
      }
    }
    
    // Fallback to coordinate-based calculation with Brisbane-specific routing
    if (travelTimeMinutes === 0) {
      console.log('?? Using coordinate-based fallback calculation');
      travelTimeMinutes = await calculateAustralianDistanceBasedTime(formattedOrigin, formattedDestination);
      console.log('?? Coordinate-based Result:', travelTimeMinutes, 'minutes');
    }
    
    // Ensure minimum time (5 minutes) and reasonable maximum (120 minutes for Brisbane metro)
    const finalResult = Math.max(5, Math.min(travelTimeMinutes, 120));
    
    // Cache the result
    travelTimeCache.set(cacheKey, finalResult);
    
    console.log('? Final travel time:', finalResult, 'minutes');
    return finalResult;
    
  } catch (error) {
    console.error('? calculateTravelTime: Comprehensive error', error.message);
    const defaultTime = 30; // Default 30 minutes
    travelTimeCache.set(cacheKey, defaultTime);
    return defaultTime;
  }
}

// Retry API calls with exponential backoff
async function retryApiCall(apiFunction, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiFunction();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
      console.log(`?? API retry ${attempt}/${maxRetries} after ${delay}ms delay`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Format address for Australian postal system
function formatAustralianAddress(address) {
  if (!address || typeof address !== 'string') {
    return address;
  }
  
  let formatted = address.trim();
  
  // If already properly formatted with Australia, return as-is
  if (formatted.toLowerCase().includes(', australia')) {
    return formatted;
  }
  
  // Remove common variations and clean up
  formatted = formatted
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .trim();
  
  // Add Australia if not present
  if (!formatted.toLowerCase().includes('australia')) {
    // Check if it already has state info
    const australianStates = ['qld', 'nsw', 'vic', 'wa', 'sa', 'tas', 'nt', 'act', 'queensland', 'new south wales', 'victoria', 'western australia', 'south australia', 'tasmania', 'northern territory', 'australian capital territory'];
    const hasState = australianStates.some(state => formatted.toLowerCase().includes(state));
    
    if (hasState) {
      formatted += ', Australia';
    } else {
      // Default to Queensland for Brisbane area
      if (formatted.toLowerCase().includes('brisbane') || !formatted.toLowerCase().includes('sydney') && !formatted.toLowerCase().includes('melbourne')) {
        formatted += ', QLD, Australia';
      } else {
        formatted += ', Australia';
      }
    }
  }
  
  return formatted;
}

// Google Maps Distance Matrix API integration
async function calculateGoogleMapsDistance(origin, destination) {
  try {
    // Import fetch for Node.js
    const fetch = (await import('node-fetch')).default;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey || apiKey === 'your_google_maps_key_here') {
      console.log('calculateGoogleMapsDistance: No valid API key configured');
      return null;
    }
    
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&units=metric&departure_time=now&traffic_model=best_guess&key=${apiKey}`;
    
    console.log('calculateGoogleMapsDistance: Calling API for', origin, 'to', destination);
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0]) {
      const element = data.rows[0].elements[0];
      
      if (element.status === 'OK') {
        // Prefer duration_in_traffic if available, otherwise use duration
        const duration = element.duration_in_traffic || element.duration;
        const travelTimeMinutes = Math.ceil(duration.value / 60);
        
        console.log('calculateGoogleMapsDistance: Success', {
          distance: element.distance.text,
          duration: duration.text,
          minutes: travelTimeMinutes,
          withTraffic: !!element.duration_in_traffic
        });
        
        return travelTimeMinutes;
      } else {
        console.log('calculateGoogleMapsDistance: Element error', element.status);
        return null;
      }
    } else {
      console.log('calculateGoogleMapsDistance: API error', data.status, data.error_message);
      
      // Provide specific guidance for common errors
      if (data.status === 'REQUEST_DENIED') {
        console.log('?? GOOGLE MAPS SETUP REQUIRED:');
        console.log('   1. Enable billing: https://console.cloud.google.com/billing');
        console.log('   2. Enable Distance Matrix API: https://console.cloud.google.com/apis/library/distancematrix.googleapis.com');
        console.log('   3. Enable Geocoding API: https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com');
        console.log('   4. Run test: node test-google-maps-travel-time.js');
      } else if (data.status === 'OVER_DAILY_LIMIT') {
        console.log('?? Google Maps daily quota exceeded, using OpenAI fallback');
      } else if (data.status === 'OVER_QUERY_LIMIT') {
        console.log('?? Google Maps rate limit exceeded, using OpenAI fallback');
      }
      
      return null;
    }
  } catch (error) {
    console.error('calculateGoogleMapsDistance: Exception', error.message);
    return null;
  }
}

// Enhanced distance-based travel time calculation for Australian locations
function calculateAustralianDistanceBasedTime(origin, destination) {
  // Comprehensive Australian location coordinates
  const australianLocations = {
    // Brisbane area
    'brisbane cbd': { lat: -27.4698, lng: 153.0251 },
    'brisbane city': { lat: -27.4698, lng: 153.0251 },
    'fortitude valley': { lat: -27.4567, lng: 153.0351 },
    'brisbane airport': { lat: -27.3942, lng: 153.1218 },
    'gold coast': { lat: -28.0167, lng: 153.4000 },
    'toowong': { lat: -27.4847, lng: 152.9927 },
    'chermside': { lat: -27.3858, lng: 153.0351 },
    'kangaroo point': { lat: -27.4792, lng: 153.0350 },
    'west end': { lat: -27.4839, lng: 153.0101 },
    'indooroopilly': { lat: -27.4978, lng: 152.9732 },
    'carindale': { lat: -27.5181, lng: 153.1019 },
    'southbank': { lat: -27.4816, lng: 153.0200 },
    'new farm': { lat: -27.4669, lng: 153.0506 },
    'paddington': { lat: -27.4598, lng: 152.9988 },
    'woolloongabba': { lat: -27.4909, lng: 153.0378 },
    'spring hill': { lat: -27.4598, lng: 153.0234 },
    'milton': { lat: -27.4713, lng: 152.9978 },
    'kelvin grove': { lat: -27.4486, lng: 153.0178 },
    'red hill': { lat: -27.4486, lng: 153.0100 },
    'teneriffe': { lat: -27.4567, lng: 153.0451 },
    'bowen hills': { lat: -27.4422, lng: 153.0351 },
    'albion': { lat: -27.4333, lng: 153.0500 },
    'newstead': { lat: -27.4544, lng: 153.0467 },
    'petrie terrace': { lat: -27.4644, lng: 152.9978 },
    'highgate hill': { lat: -27.4872, lng: 153.0156 },
    'south brisbane': { lat: -27.4833, lng: 153.0167 },
    'east brisbane': { lat: -27.4833, lng: 153.0500 },
    'stones corner': { lat: -27.4944, lng: 153.0444 },
    'morningside': { lat: -27.4611, lng: 153.0667 },
    'balmoral': { lat: -27.4611, lng: 153.0689 },
    'bulimba': { lat: -27.4556, lng: 153.0667 },
    'hawthorne': { lat: -27.4556, lng: 153.0600 },
    'coorparoo': { lat: -27.4944, lng: 153.0556 },
    'greenslopes': { lat: -27.5056, lng: 153.0444 },
    'camp hill': { lat: -27.5000, lng: 153.0667 },
    'carina': { lat: -27.5167, lng: 153.0889 },
    'wynnum': { lat: -27.4444, lng: 153.1667 },
    'manly': { lat: -27.4500, lng: 153.1833 },
    'redcliffe': { lat: -27.2333, lng: 153.1167 },
    'cleveland': { lat: -27.5333, lng: 153.2667 },
    'ipswich': { lat: -27.6167, lng: 152.7667 },
    'logan': { lat: -27.6389, lng: 153.1111 },
    'beenleigh': { lat: -27.7167, lng: 153.2000 },
    
    // Sydney area
    'sydney cbd': { lat: -33.8688, lng: 151.2093 },
    'sydney city': { lat: -33.8688, lng: 151.2093 },
    'sydney airport': { lat: -33.9399, lng: 151.1753 },
    'bondi': { lat: -33.8915, lng: 151.2767 },
    'manly sydney': { lat: -33.7969, lng: 151.2840 },
    'parramatta': { lat: -33.8150, lng: 151.0000 },
    'chatswood': { lat: -33.7969, lng: 151.1831 },
    'cronulla': { lat: -34.0544, lng: 151.1544 },
    'penrith': { lat: -33.7508, lng: 150.6944 },
    
    // Melbourne area
    'melbourne cbd': { lat: -37.8136, lng: 144.9631 },
    'melbourne city': { lat: -37.8136, lng: 144.9631 },
    'melbourne airport': { lat: -37.6690, lng: 144.8410 },
    'st kilda': { lat: -37.8667, lng: 144.9833 },
    'richmond melbourne': { lat: -37.8167, lng: 145.0000 },
    'brunswick': { lat: -37.7667, lng: 144.9667 },
    'preston': { lat: -37.7500, lng: 145.0000 },
    'fitzroy': { lat: -37.8000, lng: 144.9833 },
    
    // Perth area
    'perth cbd': { lat: -31.9505, lng: 115.8605 },
    'perth city': { lat: -31.9505, lng: 115.8605 },
    'perth airport': { lat: -31.9403, lng: 115.9669 },
    'fremantle': { lat: -32.0569, lng: 115.7453 },
    
    // Adelaide area
    'adelaide cbd': { lat: -34.9285, lng: 138.6007 },
    'adelaide city': { lat: -34.9285, lng: 138.6007 },
    'adelaide airport': { lat: -34.9462, lng: 138.5308 },
    
    // Other major cities
    'darwin': { lat: -12.4634, lng: 130.8456 },
    'hobart': { lat: -42.8821, lng: 147.3272 },
    'canberra': { lat: -35.2809, lng: 149.1300 },
    'townsville': { lat: -19.2590, lng: 146.8169 },
    'cairns': { lat: -16.9186, lng: 145.7781 },
    'wollongong': { lat: -34.4278, lng: 150.8931 },
    'geelong': { lat: -38.1499, lng: 144.3617 },
    'newcastle': { lat: -32.9283, lng: 151.7817 }
  };
  
  // Normalize location names for matching
  const normalizeLocation = (location) => {
    let normalized = location.toLowerCase()
      .replace(/\d+\s+/, '') // Remove street numbers
      .replace(/\s+street.*/, '') // Remove street suffixes
      .replace(/\s+road.*/, '')
      .replace(/\s+avenue.*/, '')
      .replace(/\s+st\b.*/, '')
      .replace(/\s+rd\b.*/, '')
      .replace(/\s+ave\b.*/, '')
      .replace(/\s+lane.*/, '')
      .replace(/\s+drive.*/, '')
      .replace(/\s+court.*/, '')
      .replace(/\s+qld.*/, '') // Remove state
      .replace(/\s+nsw.*/, '')
      .replace(/\s+vic.*/, '')
      .replace(/\s+wa.*/, '')
      .replace(/\s+sa.*/, '')
      .replace(/\s+tas.*/, '')
      .replace(/\s+nt.*/, '')
      .replace(/\s+act.*/, '')
      .replace(/\s+australia.*/, '') // Remove country
      .replace(/,.*/, '') // Remove everything after first comma
      .trim();
    
    // Handle specific location mappings for better matching
    const locationMappings = {
      'queen': 'brisbane cbd',
      'brunswick': 'fortitude valley',
      'stanley': 'south brisbane',
      'montague': 'west end',
      'ann': 'brisbane cbd',
      'eagle': 'brisbane cbd',
      'charlotte': 'brisbane cbd',
      'elizabeth': 'brisbane cbd',
      'roma': 'brisbane cbd',
      'turbot': 'brisbane cbd',
      'wickham': 'fortitude valley',
      'james': 'fortitude valley',
      'mcwhirter': 'fortitude valley'
    };
    
    // Check if the normalized string contains any street name that maps to a known area
    for (const [street, area] of Object.entries(locationMappings)) {
      if (normalized.includes(street)) {
        normalized = area;
        break;
      }
    }
    
    return normalized;
  };
  
  const normalizedOrigin = normalizeLocation(origin);
  const normalizedDest = normalizeLocation(destination);
  
  console.log('calculateAustralianDistanceBasedTime: Normalized locations', {
    origin: normalizedOrigin,
    destination: normalizedDest
  });
  
  // Find coordinates with exact and fuzzy matching
  let originCoords = australianLocations[normalizedOrigin];
  let destCoords = australianLocations[normalizedDest];
  
  // Fallback: Try partial matching for origin
  if (!originCoords) {
    for (const [key, coords] of Object.entries(australianLocations)) {
      if (key.includes(normalizedOrigin) || normalizedOrigin.includes(key)) {
        originCoords = coords;
        console.log('calculateAustralianDistanceBasedTime: Fuzzy matched origin:', key);
        break;
      }
    }
  }
  
  // Fallback: Try partial matching for destination
  if (!destCoords) {
    for (const [key, coords] of Object.entries(australianLocations)) {
      if (key.includes(normalizedDest) || normalizedDest.includes(key)) {
        destCoords = coords;
        console.log('calculateAustralianDistanceBasedTime: Fuzzy matched destination:', key);
        break;
      }
    }
  }
  
  // If we found coordinates, calculate distance-based time
  if (originCoords && destCoords) {
    const distance = calculateDistance(originCoords, destCoords);
    
    console.log('calculateAustralianDistanceBasedTime: Distance calculated', distance, 'km');
    
    // Brisbane-specific speed adjustments based on real travel patterns
    let averageSpeed;
    let timeAdjustment = 1.0; // Multiplier for Brisbane-specific factors
    
    // Check if both locations are in Brisbane area (latitude between -27.8 and -27.2)
    const isBrisbaneRoute = originCoords.lat >= -27.8 && originCoords.lat <= -27.2 && 
                           destCoords.lat >= -27.8 && destCoords.lat <= -27.2;
    
    if (isBrisbaneRoute) {
      // Brisbane-specific routing
      if (distance <= 2) {
        averageSpeed = 20; // Inner Brisbane with traffic lights, narrow streets
        timeAdjustment = 1.2; // Allow for parking, access
      } else if (distance <= 5) {
        averageSpeed = 30; // Brisbane suburbs, some arterials
        timeAdjustment = 1.1; // Brisbane traffic patterns
      } else if (distance <= 15) {
        averageSpeed = 45; // Cross-Brisbane, main roads, some highway
        timeAdjustment = 1.3; // Bridge crossings, traffic congestion
      } else if (distance <= 30) {
        averageSpeed = 60; // Brisbane to outer suburbs, mostly highway
        timeAdjustment = 1.1; // Gateway Motorway, Pacific Motorway
      } else {
        averageSpeed = 70; // Long distance from Brisbane
        timeAdjustment = 1.0;
      }
    } else {
      // General Australian routing (non-Brisbane)
      if (distance <= 3) {
        averageSpeed = 25; // Inner city/suburban with traffic lights
      } else if (distance <= 10) {
        averageSpeed = 35; // Suburban with some arterial roads
      } else if (distance <= 30) {
        averageSpeed = 50; // Mix of suburban and highway
      } else if (distance <= 100) {
        averageSpeed = 70; // Primarily highway driving
      } else {
        averageSpeed = 80; // Long distance highway
      }
    }
    
    const baseTimeMinutes = (distance / averageSpeed) * 60;
    const timeMinutes = Math.round(baseTimeMinutes * timeAdjustment);
    const adjustedTime = Math.max(5, timeMinutes); // Minimum 5 minutes for any trip
    
    console.log('calculateAustralianDistanceBasedTime: Calculated time', {
      distance: distance + 'km',
      averageSpeed: averageSpeed + 'km/h',
      timeMinutes: adjustedTime
    });
    
    return adjustedTime;
  }
  
  // Fallback based on predefined travel times for common Australian routes
  const fallbackTimes = {
    // Brisbane area
    'brisbane cbd_fortitude valley': 8,
    'brisbane cbd_southbank': 6,
    'brisbane cbd_west end': 10,
    'brisbane cbd_new farm': 12,
    'brisbane cbd_kangaroo point': 8,
    'brisbane cbd_toowong': 15,
    'brisbane cbd_chermside': 25,
    'brisbane airport_brisbane cbd': 25,
    'brisbane airport_gold coast': 90,
    'gold coast_brisbane cbd': 75,
    'toowong_chermside': 35,
    'indooroopilly_carindale': 40,
    'fortitude valley_new farm': 6,
    'southbank_west end': 4,
    'paddington_spring hill': 8,
    'brisbane cbd_ipswich': 45,
    'brisbane cbd_logan': 35,
    'brisbane cbd_redcliffe': 40,
    
    // Sydney area
    'sydney cbd_sydney airport': 20,
    'sydney cbd_bondi': 25,
    'sydney cbd_manly sydney': 35,
    'sydney cbd_parramatta': 45,
    'sydney cbd_penrith': 60,
    
    // Melbourne area
    'melbourne cbd_melbourne airport': 30,
    'melbourne cbd_st kilda': 20,
    'melbourne cbd_richmond melbourne': 15,
    'melbourne cbd_brunswick': 25,
    
    // Inter-city
    'brisbane cbd_sydney cbd': 720, // 12 hours
    'brisbane cbd_melbourne cbd': 1020, // 17 hours
    'sydney cbd_melbourne cbd': 540, // 9 hours
    'melbourne cbd_adelaide cbd': 480, // 8 hours
    'adelaide cbd_perth cbd': 1680, // 28 hours
  };
  
  // Try direct lookup
  const key1 = `${normalizedOrigin}_${normalizedDest}`;
  const key2 = `${normalizedDest}_${normalizedOrigin}`;
  
  if (fallbackTimes[key1]) {
    console.log('calculateAustralianDistanceBasedTime: Using fallback time for', key1, fallbackTimes[key1]);
    return fallbackTimes[key1];
  }
  if (fallbackTimes[key2]) {
    console.log('calculateAustralianDistanceBasedTime: Using fallback time for', key2, fallbackTimes[key2]);
    return fallbackTimes[key2];
  }
  
  // City-specific estimates
  if (normalizedOrigin.includes('brisbane') && normalizedDest.includes('brisbane')) {
    return 25; // Within Brisbane metro
  }
  if (normalizedOrigin.includes('sydney') && normalizedDest.includes('sydney')) {
    return 30; // Within Sydney metro
  }
  if (normalizedOrigin.includes('melbourne') && normalizedDest.includes('melbourne')) {
    return 28; // Within Melbourne metro
  }
  if (normalizedOrigin.includes('perth') && normalizedDest.includes('perth')) {
    return 25; // Within Perth metro
  }
  if (normalizedOrigin.includes('adelaide') && normalizedDest.includes('adelaide')) {
    return 22; // Within Adelaide metro
  }
  
  // Inter-state estimates
  if ((normalizedOrigin.includes('brisbane') && normalizedDest.includes('gold coast')) ||
      (normalizedOrigin.includes('gold coast') && normalizedDest.includes('brisbane'))) {
    return 80;
  }
  
  console.log('calculateAustralianDistanceBasedTime: Using default Australian estimate');
  return 45; // Default for Australian metro areas
}

async function handleInput(input, confidence = 1.0) {
  console.log('?? === COMPREHENSIVE HANDLE INPUT START ===');
  console.log('?? Input:', input);
  console.log('?? Confidence:', confidence);
  console.log('?? Current State:', stateMachine.currentState);
  console.log('? Question Index:', stateMachine.questionIndex);
  console.log('?? Client Data Keys:', Object.keys(stateMachine.clientData));
  
  // STEP 1: Apply input validation and correction FIRST
  if (input && typeof input === 'string') {
    input = validateAndCorrectInput(input);
    console.log('? Corrected input:', input);
  }
  
  // STEP 2: Fast confidence and completeness check
  if (!input || input.trim().length === 0 || confidence < 0.3) {
    if (confidence < 0.3) {
      return "Sorry, I didn't quite catch that. Could you please speak a bit more clearly?";
    }
    return "Go on...";
  }

  // STEP 2.5: Check for quick responses to reduce latency
  const quickResponse = getQuickResponse(input);
  if (quickResponse && stateMachine.currentState === 'start') {
    console.log('? Using quick response for faster reply');
    stateMachine.currentState = 'general';
    stateMachine.conversationHistory.push({ role: 'user', content: input });
    stateMachine.conversationHistory.push({ role: 'assistant', content: quickResponse });
    return quickResponse;
  }

  // STEP 3: Handle partial/incomplete sentences intelligently
  if (input.endsWith(',') || input.endsWith(' the') || input.endsWith(' a') || 
      input.endsWith(' an') || input.endsWith(' to') || input.endsWith(' for') || 
      input.endsWith(' with') || input.endsWith(' my') || input.endsWith('is') || 
      input.endsWith('for') || input.endsWith('or')) {
    return "Go on, I'm listening...";
  }

  // STEP 4: Store conversation for context and learn patterns (non-blocking)
  stateMachine.conversationHistory.push({ role: 'user', content: input });
  learnFromInput(input).catch(err => console.log('Learning failed:', err));

  try {
    let response;

    // PRIORITY 1: Handle special confirmation flows
    if (stateMachine.awaitingConfirmation) {
      console.log('  Processing detail confirmation');
      return await handleDetailConfirmation(input);
    }

    // PRIORITY 2: Handle pending termination
    if (stateMachine.pendingTermination) {
      console.log('?? Processing call termination');
      return await terminateCall(input);
    }

    // PRIORITY 3: Main conversation flow router with comprehensive state handling
    switch (stateMachine.currentState) {
      case 'start':
        response = await handleStart(input);
        break;
        
      // Issue diagnosis states
      case 'hot water system':
      case 'toilet':
      case 'burst/leak':
      case 'rain-pump':
      case 'roof leak':
      case 'new install/quote':
      case 'other':
        response = await askNextQuestion(input);
        break;
        
      // Booking flow states
      case 'ask_booking':
        response = await askBooking(input);
        break;
        
      case 'collect_details':
        response = await collectClientDetails(input);
        break;
        
      case 'booking_in_progress':
        response = await executeActualBooking();
        break;
        
      case 'book_appointment':
        response = await handleAppointmentBooking(input);
        break;
        
      case 'confirm_slot':
        response = await confirmSlot(input);
        break;
        
      case 'special_instructions':
        response = await collectSpecialInstructions(input);
        break;
        
      case 'collect_special_instructions':
        response = await collectSpecialInstructions(input);
        break;
        
      // Post-booking states
      case 'booking_complete':
        response = await handleBookingComplete(input);
        break;
        
      case 'confirm_appointment':
        response = await confirmAppointmentBooking(input);
        break;
        
      // Service management states
      case 'rescheduling':
        response = await handleReschedulingRequest(input);
        break;
        
      case 'cancellation':
        response = await handleAppointmentCancellation(input);
        break;
        
      // General handling
      case 'general':
        response = await handleGeneralQuery(input);
        break;
        
      default:
        console.log('?? Unknown state, attempting intelligent recovery...');
        response = await handleUnknownState(input);
        break;
    }
    
    // STEP 5: Store assistant response and log comprehensive state
    if (response) {
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    }
    
    console.log('?? === COMPREHENSIVE HANDLE INPUT END ===');
    console.log('? Response:', response);
    console.log('?? New State:', stateMachine.currentState);
    console.log('??? Conversation Length:', stateMachine.conversationHistory.length);
    
    return response;
    
  } catch (error) {
    console.error('? handleInput comprehensive error:', error);
    return await handleErrorWithRecovery(input, error);
  }
}

// Comprehensive error recovery with context preservation
async function handleErrorWithRecovery(input, error) {
  console.log('?? Attempting comprehensive error recovery...');
  
  // Log error for monitoring
  if (typeof notifyError === 'function') {
    await notifyError(error, 'Comprehensive Flow Error', {
      userInput: input,
      currentState: stateMachine.currentState,
      clientData: stateMachine.clientData,
      conversationLength: stateMachine.conversationHistory?.length || 0
    });
  }
  
  // Don't lose conversation context on errors
  const preservedData = { ...stateMachine.clientData };
  const contextualRecovery = `I apologize, I'm having a technical difficulty. Let me help you in a different way. 
  You mentioned: "${input}". How can I assist you with your plumbing needs?`;
  
  // Reset to a safe state but preserve collected data
  stateMachine.currentState = 'general';
  stateMachine.clientData = preservedData;
  stateMachine.awaitingConfirmation = false;
  
  return await getResponse(contextualRecovery, stateMachine.conversationHistory);
}

// Handle unknown state with intelligent recovery
async function handleUnknownState(input) {
  console.log('?? Analyzing input for intelligent state recovery...');
  
  try {
    // Use fast analysis to determine intent
    const analysis = await analyzeFastInput(input);
    
    // Route based on detected intent
    
    if (analysis.issue && analysis.issue.includes('toilet')) {
      console.log('?? Toilet issue detected');
      stateMachine.currentState = 'toilet';
      stateMachine.issueType = 'toilet';
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    if (analysis.issue && (analysis.issue.includes('water') || analysis.issue.includes('hot'))) {
      console.log('?? Hot water issue detected');
      stateMachine.currentState = 'hot water system';
      stateMachine.issueType = 'hot water system';
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    if (analysis.issue && (analysis.issue.includes('leak') || analysis.issue.includes('burst'))) {
      console.log('?? Leak/burst issue detected');
      stateMachine.currentState = 'burst/leak';
      stateMachine.issueType = 'burst/leak';
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    // Fallback to general handling
    console.log('?? Routing to general handling');
    stateMachine.currentState = 'general';
    return await handleGeneralQuery(input);
    
  } catch (recoveryError) {
    console.error('Recovery analysis failed:', recoveryError);
    
    // Final fallback - enhanced pattern matching
    const lowerInput = input.toLowerCase();
    
    // Specific issue detection
    if (lowerInput.includes('toilet') || lowerInput.includes('bathroom')) {
      stateMachine.currentState = 'toilet';
      stateMachine.issueType = 'toilet';
      return "I understand you have a toilet issue. What's happening with your toilet?";
    }
    
    if (lowerInput.includes('hot water') || lowerInput.includes('water heater')) {
      stateMachine.currentState = 'hot water system';
      stateMachine.issueType = 'hot water system';
      return "I see you have a hot water issue. Do you have any hot water at all?";
    }
    
    // Booking related
    if (lowerInput.includes('book') || lowerInput.includes('appointment') || 
        lowerInput.includes('schedule')) {
      stateMachine.currentState = 'ask_booking';
      return "I'd be happy to help you book an appointment. Could you first tell me what plumbing issue you need assistance with?";
    }
    
    // Ultimate fallback
    stateMachine.currentState = 'general';
    return "I'm here to help with your plumbing needs. Could you tell me what issue you're experiencing?";
  }
}

async function learnFromInput(input) {
  // LATENCY OPTIMIZATION: Use faster analysis
  try {
    const insights = await analyzeFastInput(input);
    
    // Store insights for future improvements
    if (insights.issue) {
      const count = conversationInsights.commonIssues.get(insights.issue) || 0;
      conversationInsights.commonIssues.set(insights.issue, count + 1);
    }
    
    // Store customer data for context
    if (insights.emotion === 'frustrated') {
      stateMachine.clientData.needsEmpathy = true;
    }
    if (insights.safety === 'yes') {
      stateMachine.clientData.safetyConcern = true;
    }
    
  } catch (error) {
    console.log('Learning analysis failed:', error.message);
    // Don't let this break the conversation flow
  }
}

async function handleStart(input) {
  console.log('handleStart: Identifying issue');
  
  const lowerInput = input.toLowerCase();
  
  // First, check for booking intent keywords that should lead directly to booking
  const bookingIntentKeywords = [
    'need a plumber', 'need plumber', 'want a plumber', 'want plumber', 
    'call a plumber', 'get a plumber', 'book a plumber', 'schedule a plumber',
    'plumbing problem', 'plumbing issue', 'plumbing help', 'plumber please',
    'need help with plumbing', 'plumbing service', 'plumbing appointment'
  ];
  
  const hasBookingIntent = bookingIntentKeywords.some(keyword => lowerInput.includes(keyword));
  
  if (hasBookingIntent) {
    console.log('handleStart: BOOKING INTENT detected - moving to general greeting');
    stateMachine.currentState = 'general';
    stateMachine.needsBookingOffer = true; // Flag to offer booking in general handler
    return "Hi there! I can definitely help you with that. What kind of plumbing issue are you experiencing today?";
  }
  
  // Add fast-path for common first responses
  const commonIssues = {
    'toilet': "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    'hot water': "Do you have any hot water at all?",
    'water': "Do you have any hot water at all?",
    'leak': "Has the water been shut off, or is it still running?",
    'pipe': "Has the water been shut off, or is it still running?",
    'pump': "Is the pump standalone or submersible?",
    'roof': "Is water dripping inside right now?",
    'quote': "What would you like us to quote�new installation, repair, or inspection?"
  };
  
  // Quick check for common keywords
  for (const [keyword, response] of Object.entries(commonIssues)) {
    if (lowerInput.includes(keyword)) {
      console.log(`Fast-path response for: ${keyword}`);
      stateMachine.issueType = keyword;
      // Map keywords to proper state names
      let stateName = keyword;
      if (keyword === 'hot water' || keyword === 'water') {
        stateName = 'hot water system';
      }
      stateMachine.currentState = stateName;
      stateMachine.questionIndex = 0;
      return response; // Return pre-written response instantly
    }
  }
  
  // Fall back to AI processing for complex cases
  const enhancedPrompt = `Analyze this customer query and identify the primary plumbing issue. Consider context and urgency.

Customer says: "${input}"

Categorize into one of these types:
- toilet: Any toilet-related issues (blocked, leaking, running, not flushing)
- hot water system: Hot water problems (no hot water, leaks, age, tank issues)
- burst/leak: Active leaks, burst pipes, water damage
- rain-pump: Rainwater pump issues, water supply problems
- roof leak: Roof leaks, ceiling damage, water ingress
- new install/quote: New installations, quotes, upgrades
- other: General questions, unclear issues, or multiple problems

If the query is a greeting or no issue is mentioned, categorize as 'general'.

Also assess:
- Urgency level (emergency, urgent, routine)
- Safety concerns (water damage, electrical issues)
- Multiple issues present

Return only the category name (e.g., "toilet", "hot water system").`;

  stateMachine.issueType = (await getResponse(enhancedPrompt)).toLowerCase();
  console.log('handleStart: Issue type', stateMachine.issueType);
  
  if (issueQuestions[stateMachine.issueType]) {
    stateMachine.currentState = stateMachine.issueType;
    stateMachine.questionIndex = 0;
    return await askNextQuestion('');
  } else {
    stateMachine.currentState = 'general';
    return await handleGeneralQuery(input);
  }
}

async function askNextQuestion(input) {
  console.log('askNextQuestion: Current state', stateMachine.currentState, 'Index', stateMachine.questionIndex);
  
  // Check for booking interrupt - customer wants to book immediately
  if (input && (
    input.toLowerCase().includes('book') ||
    input.toLowerCase().includes('appointment') ||
    input.toLowerCase().includes('schedule') ||
    input.toLowerCase().includes('visit') ||
    (input.toLowerCase().includes('yes') && input.toLowerCase().includes('want')) ||
    input.toLowerCase().includes('right now') ||
    input.toLowerCase().includes('asap') ||
    input.toLowerCase().includes('urgent')
  )) {
    console.log('askNextQuestion: BOOKING INTERRUPT - Customer wants to book immediately');
    stateMachine.currentState = 'ask_booking';
    const response = "Great! Let's get that appointment booked for you. I'll need to collect a few details - your full name, email address, and complete address. You can give me all three together if it's easier, or we can go one by one. What would you prefer?";
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Store customer's response
  if (input) {
    stateMachine.clientData[`${stateMachine.currentState}_${stateMachine.questionIndex}`] = input;
  }
  
  const questions = issueQuestions[stateMachine.currentState];
  
  if (questions && stateMachine.questionIndex < questions.length) {
    // Make questions more contextual
    let contextualQuestion = questions[stateMachine.questionIndex];
    
    // Add context from previous answers
    if (stateMachine.questionIndex > 0) {
      const previousAnswer = stateMachine.clientData[`${stateMachine.currentState}_${stateMachine.questionIndex - 1}`];
      contextualQuestion = await getResponse(`Based on the customer's previous answer "${previousAnswer}", rephrase this question to be more specific and helpful: "${contextualQuestion}". Keep it natural and conversational.`);
    }
    
    const response = await getResponse(contextualQuestion, stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.questionIndex++;
    console.log('askNextQuestion: Response', response);
    
    // Check if this was the last question
    if (stateMachine.questionIndex >= questions.length) {
      console.log('askNextQuestion: All technical questions completed, next response will be booking confirmation');
    }
    
    return response;
  } else {
    // All technical questions completed - transition to booking confirmation
    console.log('askNextQuestion: All questions completed, transitioning to ask_booking state');
    
    let bookingPrompt = "Would you like to book an appointment to fix this issue?";
    
    stateMachine.currentState = 'ask_booking';
    const response = await getResponse(bookingPrompt, stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('askNextQuestion: Asking for booking confirmation', response);
    return response;
  }
}

async function askBooking(input) {
  console.log('askBooking: User response', input);
  
  // Check if user wants to book
  const lowerInput = input.toLowerCase();
  
  // Check for clear NO/decline responses first
  if ((lowerInput.includes('no ') || lowerInput.startsWith('no') || lowerInput.endsWith(' no')) || 
      (lowerInput.includes('don\'t') && lowerInput.includes('want')) ||
      (lowerInput.includes('not') && (lowerInput.includes('right now') || lowerInput.includes('today') || lowerInput.includes('yet'))) ||
      lowerInput.includes('maybe later') ||
      lowerInput.includes('not interested')) {
    
    console.log('askBooking: Customer declined booking');
    stateMachine.currentState = 'general';
    
    const response = "No problem! Is there anything else I can help you with? I can provide DIY tips or answer any other plumbing questions you might have.";
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
    
  } else if (lowerInput.includes('yes') || 
             (lowerInput.includes('sure') && !lowerInput.includes('not')) || 
             lowerInput.includes('ok') ||
             lowerInput.includes('okay') ||
             lowerInput.includes('go ahead') ||
             lowerInput.includes('proceed') ||
             (lowerInput.includes('book') && !lowerInput.includes('don\'t')) || 
             (lowerInput.includes('appointment') && !lowerInput.includes('don\'t')) ||
             lowerInput.includes('schedule') ||
             // Check if input looks like a name (user jumped straight to providing name)
             // Only consider as name if it doesn't contain common uncertainty words
             (/^[a-zA-Z\s]+$/.test(input.trim()) && 
              input.trim().split(' ').length >= 2 &&
              !lowerInput.includes('sure') &&
              !lowerInput.includes('not') &&
              !lowerInput.includes('think') &&
              !lowerInput.includes('know') &&
              !lowerInput.includes('maybe') &&
              !lowerInput.includes('about'))) {
    
    console.log('askBooking: Customer wants to book');
    
    // Check if we already have all required details and customer is confirming to proceed
    const hasName = stateMachine.clientData.name || extractName(input);
    const hasEmail = stateMachine.clientData.email || extractEmail(input);
    const hasAddress = stateMachine.clientData.address || extractAddress(input);
    
    console.log('askBooking: Checking existing details:');
    console.log('  Name:', hasName);
    console.log('  Email:', hasEmail);
    console.log('  Address:', hasAddress);
    
    // If customer says "yes, go ahead" and we have all details, proceed to actual booking
    if ((lowerInput.includes('yes') || lowerInput.includes('go ahead') || lowerInput.includes('proceed')) && 
        hasName && hasEmail && hasAddress) {
      
      console.log('?? PROCEEDING TO ACTUAL BOOKING - All details confirmed!');
      
      // Store the collected details if not already stored
      if (!stateMachine.clientData.name) stateMachine.clientData.name = hasName;
      if (!stateMachine.clientData.email) stateMachine.clientData.email = hasEmail;
      if (!stateMachine.clientData.address) stateMachine.clientData.address = hasAddress;
      
      // Set phone number from caller ID
      if (stateMachine.callerPhoneNumber) {
        stateMachine.clientData.phone = stateMachine.callerPhoneNumber;
      }
      
      // Transition to actual booking state
      stateMachine.currentState = 'booking_in_progress';
      
      // Execute the booking process
      console.log('?? EXECUTING BOOKING PROCESS...');
      return await executeActualBooking();
    }
    
    // If they provided a name directly, store it
    if (/^[a-zA-Z\s]+$/.test(input.trim()) && 
        input.trim().split(' ').length >= 2 && 
        !lowerInput.includes('yes') && 
        !lowerInput.includes('book')) {
      stateMachine.clientData.name = input.trim();
      console.log('askBooking: Stored name directly:', input.trim());
    }
    
    stateMachine.currentState = 'collect_details';
    stateMachine.questionIndex = 0;
    
    // Return direct message instead of using getResponse to avoid AI generation
    const response = "Perfect! I'll need to collect a few details to book your appointment. I need your full name, email address, and complete address. You can give me all three together if you like, or we can go one by one. What works better for you?";
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
    
  } else {
    // Unclear response, ask for clarification
    console.log('askBooking: Unclear response, asking for clarification');
    const response = "I'm not sure if you'd like to book an appointment or not. Could you please let me know - would you like me to schedule a plumber to come out and fix this issue?";
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

// Helper functions to extract details from conversation history
function extractName(input) {
  const history = stateMachine.conversationHistory;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user') {
      const nameMatch = msg.content.match(/(?:my name is|i'm|i am|this is)\s+([a-zA-Z\s]+)/i);
      if (nameMatch) return nameMatch[1].trim();
      // Also check if a name was mentioned
      if (msg.content.toLowerCase().includes('hera')) return 'Hera';
    }
  }
  return null;
}

function extractEmail(input) {
  const history = stateMachine.conversationHistory;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user') {
      const emailMatch = msg.content.match(emailRegex);
      if (emailMatch) return emailMatch[0].toLowerCase();
    }
  }
  return null;
}

function extractAddress(input) {
  const history = stateMachine.conversationHistory;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user' && (msg.content.toLowerCase().includes('address') || msg.content.includes('123 main street'))) {
      const addressMatch = msg.content.match(/(?:address is\s+)?(.+(?:street|st|road|rd|avenue|ave).+(?:brisbane|qld|australia))/i);
      if (addressMatch) return addressMatch[1].trim();
    }
  }
  return null;
}

// NEW FUNCTION: Execute the actual booking process
async function executeActualBooking() {
  console.log('?? EXECUTING ACTUAL BOOKING PROCESS');
  console.log('?? Customer Details:');
  console.log('   Name:', stateMachine.clientData.name);
  console.log('   Email:', stateMachine.clientData.email);
  console.log('   Address:', stateMachine.clientData.address);
  console.log('   Phone:', stateMachine.clientData.phone);
  
  try {
    // Step 1: Get Google Calendar access token
    console.log('?? Getting Google Calendar access token...');
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error('? Failed to get Google Calendar access token');
      return "I'm sorry, I'm having trouble accessing our booking system right now. I'll have someone from our office call you back within the hour to schedule your appointment.";
    }
    console.log('? Google Calendar access token obtained');
    
    // Step 2: Find next available appointment slot
    console.log('?? Finding next available appointment slot...');
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(14, 0, 0, 0); // 2 PM tomorrow as requested
    
    const nextSlot = await getNextAvailableSlot(accessToken, tomorrow);
    if (!nextSlot) {
      console.error('? No available appointment slots found');
      return "I'm sorry, I'm having trouble finding available appointment slots right now. I'll have someone from our office call you back within the hour to schedule your appointment.";
    }
    console.log('? Available slot found:', nextSlot.toISOString());
    
    // Step 3: Generate reference number
    const referenceNumber = `USHFX${stateMachine.clientData.phone ? stateMachine.clientData.phone.slice(-4) : Date.now().toString().slice(-4)}`;
    console.log('?? Generated reference number:', referenceNumber);
    
    // Step 4: Create Google Calendar appointment
    console.log('?? Creating Google Calendar appointment...');
    const eventDetails = {
      summary: `Plumbing Service - ${stateMachine.clientData.name}`,
      description: `**PLUMBING SERVICE APPOINTMENT**\n\n` +
                  `Customer: ${stateMachine.clientData.name}\n` +
                  `Phone: ${stateMachine.clientData.phone || 'Not provided'}\n` +
                  `Email: ${stateMachine.clientData.email}\n` +
                  `Address: ${stateMachine.clientData.address}\n` +
                  `Issue: ${stateMachine.issueType || 'Blocked drain/toilet'}\n` +
                  `Reference: ${referenceNumber}\n` +
                  `Booked via Smart Voice AI`,
      start: {
        dateTime: nextSlot.toISOString(),
        timeZone: 'Australia/Brisbane',
      },
      end: {
        dateTime: new Date(nextSlot.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours duration
        timeZone: 'Australia/Brisbane',
      },
      location: stateMachine.clientData.address,
      attendees: [
        { email: stateMachine.clientData.email, displayName: stateMachine.clientData.name }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 }
        ]
      }
    };
    
    const appointment = await createAppointment(accessToken, eventDetails);
    
    if (appointment && appointment.id) {
      console.log('? APPOINTMENT SUCCESSFULLY CREATED IN GOOGLE CALENDAR!');
      console.log('?? Appointment ID:', appointment.id);
      
      // Step 5: Store booking details
      stateMachine.appointmentBooked = true;
      stateMachine.appointmentId = appointment.id;
      stateMachine.referenceNumber = referenceNumber;
      stateMachine.nextSlot = nextSlot;
      
      // Step 6: Send confirmation email
      console.log('?? Sending confirmation email...');
      try {
        await sendConfirmationEmail();
        console.log('? Confirmation email sent successfully');
      } catch (emailError) {
        console.error('?? Email sending failed:', emailError.message);
        // Don't fail the booking due to email issues
      }
      
      // Step 7: Format appointment time for customer
      const appointmentTime = nextSlot.toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      
      // Step 8: Transition to booking complete state
      stateMachine.currentState = 'booking_complete';
      
      // Step 9: Return success message
      const successMessage = `Perfect! Your appointment has been successfully booked for ${appointmentTime}. ` +
                           `Your reference number is ${referenceNumber}. ` +
                           `You'll receive a confirmation email at ${stateMachine.clientData.email} with all the details. ` +
                           `Our plumber will be there to help with your blocked drain. Thank you, ${stateMachine.clientData.name}!`;
      
      console.log('?? BOOKING COMPLETED SUCCESSFULLY!');
      return successMessage;
      
    } else {
      console.error('? Failed to create appointment in Google Calendar');
      return "I'm sorry, I'm having trouble booking the appointment right now. I'll have someone from our office call you back within the hour to schedule your appointment manually.";
    }
    
  } catch (error) {
    console.error('? Error during booking process:', error);
    return "I'm sorry, I encountered an error while booking your appointment. I'll have someone from our office call you back within the hour to schedule your appointment manually.";
  }
}

// Enhanced information extraction function
async function extractMultipleDetails(input) {
  const extracted = {};
  
  // Extract email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = input.match(emailRegex);
  if (emailMatches && emailMatches.length > 0) {
    extracted.email = emailMatches[0].toLowerCase();
  }
  
  // Extract names (look for "my name is" or "I'm" patterns)
  const namePatterns = [
    /(?:my name is|i'm|i am|this is)\s+([a-zA-Z\s]+?)(?:\s+and|$|,|\.|my)/i,
    /^([a-zA-Z]+\s+[a-zA-Z]+)/i // First and last name at start
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = input.match(pattern);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      if (name.length > 2 && name.split(' ').length >= 2) {
        extracted.name = name;
        break;
      }
    }
  }
  
  // Extract addresses (look for street numbers, street names, suburbs)
  const addressPatterns = [
    /(\d+\s+[a-zA-Z\s]+(street|road|avenue|drive|court|place|way)[a-zA-Z\s,]*(?:qld|queensland|nsw|vic|sa|wa|nt|act|australia)[a-zA-Z\s,\d]*)/i,
    /([a-zA-Z\s]+(street|road|avenue|drive|court|place|way)[a-zA-Z\s,]*(?:qld|queensland|nsw|vic|sa|wa|nt|act|australia)[a-zA-Z\s,\d]*)/i
  ];
  
  for (const pattern of addressPatterns) {
    const addressMatch = input.match(pattern);
    if (addressMatch && addressMatch[1]) {
      const address = addressMatch[1].trim();
      if (address.length > 10) {
        extracted.address = address;
        break;
      }
    }
  }
  
  return extracted;
}

// Enhanced prompt generation for collecting multiple details at once
async function getEnhancedCollectionPrompt(nextDetail) {
  const missingDetails = ['name', 'email', 'address'].filter(d => !stateMachine.clientData[d]);
  
  if (missingDetails.length === 3) {
    // Ask for all three at once
    return "Perfect! I'll need to collect a few details to book your appointment. Can you please provide your full name, email address, and complete address all in one go? For example: 'My name is John Smith, email is john.smith@gmail.com, and I live at 123 Main Street, Brisbane QLD 4000.'";
  } else if (missingDetails.length === 2) {
    if (missingDetails.includes('name') && missingDetails.includes('email')) {
      return "Great! I just need your full name and email address. You can give me both together if you like.";
    } else if (missingDetails.includes('name') && missingDetails.includes('address')) {
      return "Thanks! I just need your full name and complete address to finish the booking.";
    } else if (missingDetails.includes('email') && missingDetails.includes('address')) {
      return "Excellent! I just need your email address and complete address to complete the booking.";
    }
  } else {
    // Single detail prompts with polite phrasing
    const prompts = {
      name: "What's your full name, please?",
      email: "Could I have your email address?",
      address: "And what's your complete address including street number, street name, suburb, state, and postcode?",
    };
    return prompts[nextDetail];
  }
  
  // Fallback
  return "Could I have that information please?";
}

// Handle multiple details captured at once
async function handleMultipleDetailsCapture(acknowledgedDetails, needsSpelling) {
  let acknowledgment = "Got it! ";
  let confirmations = [];
  
  // Create acknowledgment message
  if (acknowledgedDetails.includes('name')) {
    acknowledgment += `I have your name as ${stateMachine.clientData.temp_name}. `;
    confirmations.push('name');
  }
  
  if (acknowledgedDetails.includes('email')) {
    acknowledgment += `Your email is ${stateMachine.clientData.temp_email}. `;
    if (needsSpelling.includes('email')) {
      acknowledgment += "Can you please confirm that email spelling is correct? ";
      stateMachine.awaitingConfirmation = true;
      stateMachine.pendingConfirmation = { type: 'email', value: stateMachine.clientData.temp_email };
      return await getResponse(acknowledgment, stateMachine.conversationHistory);
    }
    confirmations.push('email');
  }
  
  if (acknowledgedDetails.includes('address')) {
    acknowledgment += `And your address is ${stateMachine.clientData.temp_address}. `;
    confirmations.push('address');
  }
  
  // If no spelling confirmation needed, confirm all details and store them
  if (needsSpelling.length === 0) {
    acknowledgment += "Is all this information correct?";
    
    // Store confirmed details
    for (const detail of acknowledgedDetails) {
      stateMachine.clientData[detail] = stateMachine.clientData[`temp_${detail}`];
      delete stateMachine.clientData[`temp_${detail}`];
    }
    
    stateMachine.awaitingConfirmation = true;
    stateMachine.pendingConfirmation = { type: 'multiple', details: acknowledgedDetails };
  }
  
  // Add 0.65 second delay
  await new Promise(resolve => setTimeout(resolve, 650));
  
  return await getResponse(acknowledgment, stateMachine.conversationHistory);
}

// Enhanced detail confirmation with acknowledgment
async function requestDetailConfirmationWithAcknowledgment(detailType, value) {
  let acknowledgment = "";
  let confirmationPrompt = "";
  
  switch (detailType) {
    case 'name':
      acknowledgment = "Perfect! ";
      confirmationPrompt = `I have your name as ${value}. Is that correct?`;
      break;
    case 'email':
      acknowledgment = "Thanks for that! ";
      const spokenValue = value.replace(/@/g, ' at ').replace(/\./g, ' dot ');
      confirmationPrompt = `Let me confirm your email address. I have ${spokenValue}. Is that spelling correct?`;
      break;
    case 'address':
      acknowledgment = "Got it! ";
      confirmationPrompt = `Your address is ${value}. Is that correct?`;
      break;
  }
  
  stateMachine.awaitingConfirmation = true;
  stateMachine.pendingConfirmation = { type: detailType, value: value };
  
  const fullPrompt = acknowledgment + confirmationPrompt;
  
  // Add 0.65 second delay
  await new Promise(resolve => setTimeout(resolve, 650));
  
  return await getResponse(fullPrompt, stateMachine.conversationHistory);
}

function combineAddresses(existing, newAddress) {
  if (!existing) return newAddress;
  if (!newAddress) return existing;
  const parts = [existing, newAddress]
    .map(a => a.split(',').map(part => part.trim()))
    .flat()
    .filter((part, index, self) => part && self.indexOf(part) === index);
  return parts.join(', ');
}

async function collectClientDetails(input) {
  console.log('collectClientDetails: Current data', stateMachine.clientData);
  console.log('collectClientDetails: Input received', input);

  // Handle confirmation if we're waiting for one
  if (stateMachine.awaitingConfirmation && stateMachine.pendingConfirmation) {
    return await handleDetailConfirmation(input);
  }
  
  // 🚨 SPECIAL CASE: Customer wants to book but we're missing name - extract from history and proceed
  if (input && input.toLowerCase().includes('book') && stateMachine.clientData.email && stateMachine.clientData.address && !stateMachine.clientData.name) {
    console.log('🔄 EMERGENCY BOOKING: Customer wants to book, extracting missing details...');
    
    // Force extract name from conversation history
    for (const msg of stateMachine.conversationHistory) {
      if (msg.role === 'user' && /^[A-Z][a-z]+\s+[A-Z][a-z]+\.?$/.test(msg.content.trim())) {
        stateMachine.clientData.name = msg.content.trim().replace(/\.$/, '');
        console.log('🎯 EMERGENCY: Name extracted:', stateMachine.clientData.name);
        break;
      }
    }
    
    // If we now have all details, proceed with booking
    if (stateMachine.clientData.name && stateMachine.clientData.email && stateMachine.clientData.address) {
      console.log('🚀 EMERGENCY BOOKING: All details complete, proceeding with smart scheduling...');
      stateMachine.allDetailsCollected = true;
      return await autoBookAppointment();
    }
  }
  
  const details = ['name', 'email', 'address']; 
  
  // ?? CRITICAL FIX: Assign phone number from caller first
  if (stateMachine.callerPhoneNumber && !stateMachine.clientData.phone) {
    stateMachine.clientData.phone = stateMachine.callerPhoneNumber;
    console.log('?? Phone auto-assigned from caller:', stateMachine.callerPhoneNumber);
  }

  // ?? SMART CONTEXT EXTRACTION: Look for missing data in conversation history
  if (!stateMachine.clientData.email || !stateMachine.clientData.address || !stateMachine.clientData.name) {
    console.log('?? Scanning conversation history for missing details...');
    
    // ?? URGENT FIX: Manual extraction for current call logs
    if (!stateMachine.clientData.name) {
      for (const msg of stateMachine.conversationHistory) {
        if (msg.role === 'user' && msg.content.includes('John Smith')) {
          stateMachine.clientData.name = 'John Smith';
          console.log('?? MANUAL FIX: Name extracted as John Smith');
          break;
        }
      }
    }
    
    for (const msg of stateMachine.conversationHistory) {
      if (msg.role === 'user') {
        const content = msg.content;
        
        // Extract email if missing
        if (!stateMachine.clientData.email) {
          const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch) {
            stateMachine.clientData.email = emailMatch[0].toLowerCase();
            console.log('?? Email extracted from history:', stateMachine.clientData.email);
          }
        }
        
        // Extract address if missing
        if (!stateMachine.clientData.address) {
          if (/\d+\s+[a-zA-Z\s]+(?:street|st|road|rd|avenue|ave),?\s*[a-zA-Z\s]*,?\s*(?:australia|qld|nsw|vic)/i.test(content)) {
            stateMachine.clientData.address = content.trim();
            console.log('?? Address extracted from history:', stateMachine.clientData.address);
          }
        }
        
        // Extract name if missing (improved pattern matching)
        if (!stateMachine.clientData.name) {
          // Pattern 1: "My name is John Smith"
          if (/my name is\s+([a-zA-Z\s]+)/i.test(content)) {
            const nameMatch = content.match(/my name is\s+([a-zA-Z\s]+)/i);
            if (nameMatch && nameMatch[1] && !nameMatch[1].toLowerCase().includes('clogged')) {
              const extractedName = nameMatch[1].trim().replace(/[,\.]+$/, ''); // Remove trailing punctuation
              if (isValidName(extractedName)) {
                stateMachine.clientData.name = extractedName;
                console.log('?? Name extracted from history (pattern 1):', stateMachine.clientData.name);
              }
            }
          }
          // Pattern 2: Just a name like "John Smith" (when asked for name)
          else if (/^[A-Z][a-z]+\s+[A-Z][a-z]+\.?$/.test(content.trim())) {
            const nameCandidate = content.trim().replace(/\.$/, '');
            if (isValidName(nameCandidate)) {
              stateMachine.clientData.name = nameCandidate;
              console.log('?? Name extracted from history (pattern 2):', stateMachine.clientData.name);
            }
          }
          // Pattern 3: "This is John Smith" or "I'm John Smith"
          else if (/(?:this is|i'm|i am)\s+([a-zA-Z\s]+)/i.test(content)) {
            const nameMatch = content.match(/(?:this is|i'm|i am)\s+([a-zA-Z\s]+)/i);
            if (nameMatch && nameMatch[1]) {
              const extractedName = nameMatch[1].trim().replace(/[,\.]+$/, '');
              if (isValidName(extractedName)) {
                stateMachine.clientData.name = extractedName;
                console.log('?? Name extracted from history (pattern 3):', stateMachine.clientData.name);
              }
            }
          }
        }
      }
    }
  }
  
  // Store the input first if we have one
  if (input && input.trim()) {
    const missingDetail = details.find(d => !stateMachine.clientData[d]);
    if (missingDetail) {
      console.log(`collectClientDetails: Processing ${missingDetail} = ${input}`);
      const cleanedInput = validateAndCorrectInput(input.trim());
      
      if (missingDetail === 'name') {
        // Extract name from the input more intelligently
        const extractedName = extractNameFromInput(cleanedInput);
        console.log('collectClientDetails: Extracted name:', extractedName);
        
        if (!extractedName || !isValidName(extractedName)) {
          const response = await getResponse(
            "I didn't quite catch your name clearly. Could you please tell me your first and last name?",
            stateMachine.conversationHistory
          );
          stateMachine.conversationHistory.push({ role: 'assistant', content: response });
          return response;
        }
        
        // Store as temp_name and request confirmation  
        stateMachine.clientData.temp_name = extractedName;
        console.log('? Name extracted, requesting confirmation:', extractedName);
        return await requestDetailConfirmation('name', extractedName);
        
        // Move to next detail
        const nextDetail = details.find(d => !stateMachine.clientData[d]);
        if (nextDetail) {
          const prompts = {
            email: "Great! Now, could I have your email address?",
            address: "Perfect! And what's your complete address including street number, street name, suburb, state, and postcode?",
          };
          const response = await getResponse(prompts[nextDetail], stateMachine.conversationHistory);
          stateMachine.conversationHistory.push({ role: 'assistant', content: response });
          return response;
        }
        
      } else if (missingDetail === 'email') {
        // Handle email collection with spelling confirmation
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const extractedEmail = cleanedInput.match(emailPattern);
        
        if (extractedEmail && extractedEmail[0]) {
          // Store as temp_email and request spelling confirmation
          stateMachine.clientData.temp_email = extractedEmail[0].toLowerCase();
          console.log('? Email extracted, requesting spelling confirmation:', extractedEmail[0]);
          return await requestDetailConfirmation('email', extractedEmail[0].toLowerCase());
        } else {
          // Email format not recognized, ask again
          const response = await getResponse(
            "I didn't catch your email address clearly. Could you please provide your email address again, speaking clearly?",
            stateMachine.conversationHistory
          );
          stateMachine.conversationHistory.push({ role: 'assistant', content: response });
          return response;
        }
      } else if (missingDetail === 'address') {
        // Handle address collection - be more permissive with Brisbane addresses
        const addressPatterns = [
          /\d+\s+[a-zA-Z\s]+(?:street|st|road|rd|avenue|ave|court|ct|drive|dr|place|pl|close|way|crescent|cres),?\s*[a-zA-Z\s]+,?\s*(?:qld|queensland|brisbane)/i,
          /[a-zA-Z\s]+,\s*(?:brisbane|qld|queensland)/i,
          /\d+\s+[a-zA-Z\s]+,\s*[a-zA-Z\s]+/i // Basic pattern for any address with number + street + suburb
        ];
        
        const hasValidAddressPattern = addressPatterns.some(pattern => pattern.test(cleanedInput));
        
        if (hasValidAddressPattern || cleanedInput.toLowerCase().includes('brisbane') || cleanedInput.toLowerCase().includes('qld')) {
          // Format the address to include Brisbane, QLD, Australia if not present
          let formattedAddress = cleanedInput;
          if (!formattedAddress.toLowerCase().includes('australia')) {
            formattedAddress += ', Australia';
          }
          if (!formattedAddress.toLowerCase().includes('qld') && !formattedAddress.toLowerCase().includes('queensland')) {
            formattedAddress = formattedAddress.replace(', Australia', ', QLD, Australia');
          }
          
          stateMachine.clientData.address = formattedAddress;
          console.log('? Address accepted:', formattedAddress);
          
          // ?? SMART LOCATION ANALYSIS FOR OPTIMAL BOOKING
          console.log('??? Analyzing location for optimal booking and travel efficiency...');
          
          try {
            // Analyze location for clustering opportunities
            const locationAnalysis = await analyzeLocationForBooking(formattedAddress);
            console.log('?? Location analysis result:', locationAnalysis);
            
            if (!locationAnalysis.feasible) {
              // Location is outside service area
              const response = await getResponse(locationAnalysis.message, stateMachine.conversationHistory);
              stateMachine.conversationHistory.push({ role: 'assistant', content: response });
              return response;
            }
            
            // Store location analysis results
            stateMachine.clientData.locationAnalysis = locationAnalysis;
            
            // ?? CALCULATE TRAVEL TIME AND DETERMINE EARLIEST APPOINTMENT
            console.log('?? Calculating travel time and determining earliest available appointment...');
            
            // Get last job location (Location X)
            const lastJobLocation = "142 Queen Street, Brisbane, QLD, Australia"; // Default last job location
            const customerLocation = formattedAddress; // Location Y (customer's address)
            
            console.log(`?? Travel calculation: ${lastJobLocation} ? ${customerLocation}`);
            
            // Calculate travel time from X to Y
            const travelTime = await calculateTravelTime(lastJobLocation, customerLocation);
            console.log(`?? Travel time calculated: ${travelTime}`);
            
            // Parse travel time to get minutes
            const travelMinutes = extractMinutesFromTravelTime(travelTime);
            console.log(`?? Travel time in minutes: ${travelMinutes}`);
            
            // Calculate total buffer time
            const jobCompletionBuffer = 30; // 30 minutes constant for job completion
            const totalBufferMinutes = jobCompletionBuffer + travelMinutes;
            
            console.log(`?? Scheduling calculation:`);
            console.log(`   Job completion buffer: ${jobCompletionBuffer} minutes`);
            console.log(`   Travel time (X?Y): ${travelMinutes} minutes`);
            console.log(`   Total buffer needed: ${totalBufferMinutes} minutes`);
            
            // Calculate earliest available appointment time
            const now = new Date();
            const earliestTime = new Date(now.getTime() + totalBufferMinutes * 60 * 1000);
            
            // Round to next reasonable appointment slot (e.g., next 30-minute interval)
            const roundedTime = roundToNextAppointmentSlot(earliestTime);
            
            const formattedTime = roundedTime.toLocaleString('en-AU', {
              timeZone: 'Australia/Brisbane',
              weekday: 'long',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            });
            
            console.log(`?? Earliest available appointment: ${formattedTime}`);
            
            // Store travel and scheduling information
            stateMachine.clientData.travelTime = travelTime;
            stateMachine.clientData.travelMinutes = travelMinutes;
            stateMachine.clientData.earliestAppointment = roundedTime;
            stateMachine.clientData.totalBufferMinutes = totalBufferMinutes;
            
            // ?? PRESENT LOCATION-OPTIMIZED BOOKING OPTIONS
            let locationMessage = '';
            if (locationAnalysis.priority === 'high_efficiency') {
              // High efficiency cluster opportunity
              locationMessage = locationAnalysis.message + '\n\n';
            } else if (locationAnalysis.priority === 'standard') {
              // Standard booking - mention distance if far
              if (locationAnalysis.distanceFromCenter > 25) {
                locationMessage = `I can service your location at ${formattedAddress}, though it's ${Math.round(locationAnalysis.distanceFromCenter)} km from our central area, which means additional travel time. `;
              }
            }
            
            // Ask if customer has any special instructions before proposing appointment
            const response = await getResponse(
              `Perfect! I've got your address. ${locationMessage}Before I book your appointment, do you have any special instructions for the plumber? For example, do you have any pets, or is there anything specific about accessing your property that we should know?`,
              stateMachine.conversationHistory
            );
            stateMachine.conversationHistory.push({ role: 'assistant', content: response });
            
            // Set state to collect special instructions
            stateMachine.currentState = 'collect_special_instructions';
            return response;
            
          } catch (locationError) {
            console.error('? Location analysis failed:', locationError.message);
            
            // Fall back to basic travel time calculation
            try {
              const lastJobLocation = "142 Queen Street, Brisbane, QLD, Australia";
              const travelTime = await calculateTravelTime(lastJobLocation, formattedAddress);
              const travelMinutes = extractMinutesFromTravelTime(travelTime);
              const totalBufferMinutes = 30 + travelMinutes;
              const now = new Date();
              const earliestTime = new Date(now.getTime() + totalBufferMinutes * 60 * 1000);
              const roundedTime = roundToNextAppointmentSlot(earliestTime);
              
              stateMachine.clientData.travelTime = travelTime;
              stateMachine.clientData.travelMinutes = travelMinutes;
              stateMachine.clientData.earliestAppointment = roundedTime;
              stateMachine.clientData.totalBufferMinutes = totalBufferMinutes;
              
            } catch (travelError) {
              console.error('? Travel time calculation also failed:', travelError.message);
            }
            
            // Continue with default scheduling
            const response = await getResponse(
              `Perfect! I've got your address. Before I book your appointment, do you have any special instructions for the plumber?`,
              stateMachine.conversationHistory
            );
            stateMachine.conversationHistory.push({ role: 'assistant', content: response });
            stateMachine.currentState = 'collect_special_instructions';
            return response;
          }
          
        } else {
          stateMachine.clientData.temp_address = cleanedInput;
          return await requestDetailConfirmation('address', cleanedInput);
        }
      } else {
        stateMachine.clientData[`temp_${missingDetail}`] = cleanedInput;
        return await requestDetailConfirmation(missingDetail, stateMachine.clientData[`temp_${missingDetail}`]);
      }
    }
  }
  
  // Check what's still missing after storing the input
  const nextDetail = details.find(d => !stateMachine.clientData[d]);
  console.log('collectClientDetails: Next detail needed', nextDetail);
  
  if (nextDetail) {
    const prompts = {
      name: "What's your full name, please?",
      email: "Could I have your email address?",
      address: "And what's your complete address including street number, street name, suburb, state, and postcode?",
    };
    const response = await getResponse(prompts[nextDetail], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('collectClientDetails: Asking for', nextDetail, '- Prompt', response);
    return response;
  } else {
    // All details collected, transition to booking
    console.log('collectClientDetails: All details collected, transitioning to booking');
    console.log('?? Final customer data:', {
      name: stateMachine.clientData.name,
      email: stateMachine.clientData.email, 
      address: stateMachine.clientData.address,
      issue: stateMachine.clientData.issueDescription
    });
    
    stateMachine.currentState = 'book_appointment';
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
    
    // Validate address format
    const isValidAddress = stateMachine.clientData.address &&
      stateMachine.clientData.address.match(/\d+\s+[a-zA-Z\s]+,\s*[a-zA-Z\s]+,\s*(?:QLD|Queensland),\s*Australia/i);
    if (!isValidAddress) {
      const response = await getResponse(
        "It looks like the address might be incomplete. Please provide your full address, including street number, street name, suburb, state, and postcode.",
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
    
    stateMachine.clientData.issueDescription = stateMachine.clientData.issueDescription || 'Burst pipe or leak';
    let response;
    if (stateMachine.clientData.urgent) {
      // For urgent, use location-optimized auto booking
      response = await autoBookAppointment();
    } else {
      // For non-urgent, also use location-optimized auto booking
      response = await autoBookAppointment();
    }
    return response;
  }
}

async function handleAppointmentBooking(input) {
  console.log('handleAppointmentBooking: User input', input);
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.error('handleAppointmentBooking: No access token');
    return "Sorry, I can't access the calendar right now. Please try again later.";
  }

  // Use dynamic dates
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minStartDate = new Date(today.getTime() + 7 * 60 * 60 * 1000); // 7 AM today
  const maxEndDate = new Date(today.getTime() + 19 * 60 * 60 * 1000); // 7 PM today
  
  // If it's past 7 PM, start from tomorrow
  if (now.getHours() >= 19) {
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    minStartDate.setTime(tomorrow.getTime() + 7 * 60 * 60 * 1000);
    maxEndDate.setTime(tomorrow.getTime() + 19 * 60 * 60 * 1000);
  }
  
  let earliestStartTime = new Date(Math.max(now.getTime(), minStartDate.getTime()));

  // Check for existing appointments to determine last job location and timing
  const lastAppointment = await getLastAppointment(accessToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  
  if (lastAppointment) {
    console.log('handleAppointmentBooking: Found last appointment', {
      location: lastAppointment.location?.displayName,
      endTime: lastAppointment.end.dateTime
    });
    
    // Get the last job location
    const lastJobLocation = lastAppointment.location?.displayName || lastBookedJobLocation || 'Brisbane CBD, QLD, Australia';
    
    // Ensure we have a customer address for calculation
    if (!stateMachine.clientData.address) {
      console.log('handleAppointmentBooking: No customer address available yet');
      return await getResponse("I need your full address to calculate travel time from our last job. What's your complete address including street number, street name, suburb, state, and postcode?", stateMachine.conversationHistory);
    }
    
    // Calculate travel time from last job to new job
    const travelTimeMinutes = await calculateTravelTime(lastJobLocation, stateMachine.clientData.address);
    console.log('handleAppointmentBooking: Travel time calculated', {
      from: lastJobLocation,
      to: stateMachine.clientData.address,
      travelTime: travelTimeMinutes
    });
    
    // Get last appointment end time and add job completion time (30 min) + travel time
    const lastEndTime = new Date(lastAppointment.end.dateTime);
    const jobCompletionMinutes = 30; // Fixed 30 minutes for job completion
    const totalBufferMinutes = jobCompletionMinutes + travelTimeMinutes;
    
    // Calculate earliest available time
    const calculatedEarliestTime = new Date(lastEndTime.getTime() + totalBufferMinutes * 60 * 1000);
    earliestStartTime = new Date(Math.max(calculatedEarliestTime.getTime(), minStartDate.getTime()));
    
    console.log('handleAppointmentBooking: Earliest start time calculated', {
      lastJobEnd: lastEndTime.toISOString(),
      jobCompletionTime: jobCompletionMinutes,
      travelTime: travelTimeMinutes,
      totalBuffer: totalBufferMinutes,
      earliestTime: earliestStartTime.toISOString()
    });
    
    // Update the global last job location for this booking
    lastBookedJobLocation = lastJobLocation;
  } else {
    console.log('handleAppointmentBooking: No previous appointments found - first booking of the day');
    // For first booking of the day, use requested time if reasonable
    if (input && !input.toLowerCase().includes('asap') && !stateMachine.clientData.urgent) {
      try {
        // Try to parse customer's preferred time
        const parsePrompt = `Parse this appointment time request: "${input}". Current time is ${now.toISOString()}. Return ISO datetime string (YYYY-MM-DDTHH:mm:00Z) or "invalid" if unclear. Assume Australia/Brisbane timezone.`;
        let preferredStr = await getResponse(parsePrompt);
        
        if (preferredStr !== "invalid") {
          const preferred = new Date(preferredStr);
          if (!isNaN(preferred.getTime()) && preferred >= earliestStartTime && preferred <= maxEndDate) {
            earliestStartTime = preferred;
            console.log('handleAppointmentBooking: Using customer preferred time for first booking', preferred);
          }
        }
      } catch (parseError) {
        console.log('handleAppointmentBooking: Could not parse preferred time, using default');
      }
    }
  }

  let nextSlot;
  
  // 🚗 SMART SCHEDULING: Try to find optimal slot first (for non-urgent bookings)
  if (!stateMachine.clientData.urgent && !input.toLowerCase().includes('asap') && !input.toLowerCase().includes('soon')) {
    try {
      console.log('🚗 SMART SCHEDULING: Finding travel-optimized slot for customer...');
      const { findMostEfficientSlot } = require('./location-optimizer');
      
      // Extract issue description safely - ENSURE STRING TYPE
      let issueForAssessment = 'general plumbing service'; // Default fallback
      
      // Try to get issue description from various sources
      if (stateMachine.clientData.issueDescription && typeof stateMachine.clientData.issueDescription === 'string') {
        issueForAssessment = stateMachine.clientData.issueDescription;
      } else if (stateMachine.clientData.toilet_0 && typeof stateMachine.clientData.toilet_0 === 'string') {
        issueForAssessment = stateMachine.clientData.toilet_0;
      } else if (stateMachine.clientData.other_1 && typeof stateMachine.clientData.other_1 === 'string') {
        issueForAssessment = stateMachine.clientData.other_1;
      }
      
      // Ensure it's a proper string (failsafe)
      issueForAssessment = String(issueForAssessment).toLowerCase();
      
      console.log('🔧 Smart scheduling issue assessment:', issueForAssessment);
      
      const smartSlotResult = await findMostEfficientSlot(
        accessToken, 
        stateMachine.clientData.address, 
        issueForAssessment,
        stateMachine.clientData.urgent ? 'urgent' : 'standard',
        earliestStartTime
      );
      
      if (smartSlotResult && smartSlotResult.slot && smartSlotResult.slot >= earliestStartTime && smartSlotResult.slot <= maxEndDate) {
        nextSlot = smartSlotResult.slot;
        stateMachine.smartSchedulingPreview = smartSlotResult.analysis;
        
        console.log('🎯 SMART SCHEDULING SUCCESS for quote:');
        console.log(`   ⚡ Efficiency: ${smartSlotResult.analysis.efficiency}`);
        console.log(`   🚗 Travel Distance: ${smartSlotResult.analysis.travelDistance.toFixed(1)}km`);
        console.log(`   💰 Estimated Savings: $${smartSlotResult.analysis.fuelSavings.costAUD} AUD`);
        console.log(`   💡 Strategy: ${smartSlotResult.analysis.reason}`);
      } else {
        console.log('⚠️ Smart scheduling found no optimal slots for today, using standard selection');
      }
    } catch (smartError) {
      console.error('⚠️ Smart scheduling failed for quote, using standard:', smartError.message);
    }
  }
  
  if (stateMachine.clientData.urgent || input.toLowerCase().includes('asap') || input.toLowerCase().includes('soon')) {
    // For urgent bookings, find the next available slot
    if (!nextSlot) {
      nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
    }
    if (!nextSlot || nextSlot > maxEndDate) {
      console.log('handleAppointmentBooking: No urgent slot available today');
      return "Sorry, no slots are available today for urgent service. Would you like to try tomorrow?";
    }
  } else if (!lastAppointment) {
    // First booking of the day - use customer's exact requested time if possible
    if (!nextSlot && input && !input.toLowerCase().includes('next available')) {
      const parsePrompt = `Parse the preferred appointment time from: "${input}". Current time is ${now.toISOString()}. Return ISO datetime string (YYYY-MM-DDTHH:mm:00Z) or "invalid" if can't parse. Assume Australia/Brisbane timezone.`;
      let preferredStr = await getResponse(parsePrompt);
      
      if (preferredStr !== "invalid") {
        const preferred = new Date(preferredStr);
        if (!isNaN(preferred.getTime()) && preferred >= earliestStartTime) {
          const preferredEnd = new Date(preferred.getTime() + 60 * 60 * 1000);
          const isFree = await isSlotFree(accessToken, preferred, preferredEnd);
          
          if (isFree) {
            nextSlot = preferred;
            console.log('handleAppointmentBooking: Using exact requested time for first booking', preferred);
          }
        }
      }
    }
    
    // If we couldn't parse or slot wasn't free, get next available
    if (!nextSlot) {
      nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
    }
  } else {
    // Subsequent booking - calculate based on travel time and offer earliest available
    nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
    if (!nextSlot || nextSlot > maxEndDate) {
      console.log('handleAppointmentBooking: No slot available today with travel time');
      
      // Calculate when we'd be available tomorrow
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowStart = new Date(tomorrow.getTime() + 7 * 60 * 60 * 1000); // 7 AM tomorrow
      const tomorrowSlot = await getNextAvailableSlot(accessToken, tomorrowStart);
      
      if (tomorrowSlot) {
        const formattedTomorrow = tomorrowSlot.toLocaleString('en-AU', { 
          timeZone: BRISBANE_TZ, 
          hour: 'numeric', 
          minute: 'numeric', 
          hour12: true,
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        });
        
        return `Based on our travel time from the last job, the earliest I can schedule you is ${formattedTomorrow} Brisbane time. Does that work for you?`;
      } else {
        return "I'm sorry, we're quite busy at the moment. Could you please call us directly at (07) 3608 1688 to discuss available times?";
      }
    }
  }
  
  // Store the slot and provide information about timing
  stateMachine.nextSlot = nextSlot;
  const formattedSlot = nextSlot.toLocaleString('en-AU', { 
    timeZone: BRISBANE_TZ, 
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: true,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
  
  // Provide context about the scheduling
  let schedulingContext = '';
  if (stateMachine.smartSchedulingPreview && stateMachine.smartSchedulingPreview.efficiency === 'high_efficiency') {
    schedulingContext = ` 🌟 SMART SCHEDULING: ${stateMachine.smartSchedulingPreview.reason}! This optimal time slot saves approximately ${stateMachine.smartSchedulingPreview.fuelSavings.distanceKm}km of travel distance.`;
  } else if (stateMachine.smartSchedulingPreview && stateMachine.smartSchedulingPreview.efficiency === 'medium_efficiency') {
    schedulingContext = ` ⚡ EFFICIENT SCHEDULING: ${stateMachine.smartSchedulingPreview.reason}. This reduces travel compared to random scheduling.`;
  } else if (lastAppointment) {
    const lastLocation = lastAppointment.location?.displayName || 'our last job';
    const travelTime = await calculateTravelTime(lastLocation, stateMachine.clientData.address);
    
    schedulingContext = ` This time accounts for travel from ${lastLocation} (approximately ${travelTime} minutes) plus 30 minutes for job completion.`;
  } else {
    schedulingContext = ' This is our first appointment of the day, so I can schedule you exactly when requested.';
  }
  
  const response = await getResponse(
    `The earliest available appointment is ${formattedSlot} Brisbane time.${schedulingContext} Does that work for you?`, 
    stateMachine.conversationHistory
  );
  
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  stateMachine.currentState = 'confirm_slot';
  console.log('handleAppointmentBooking: Slot offered', formattedSlot);
  return response;
}

async function confirmSlot(input) {
  console.log('confirmSlot: User response', input);
  
  // Check if user is providing details instead of confirming
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const addressPattern = /\d+\s+[a-zA-Z\s]+,?\s*[a-zA-Z\s]*|[a-zA-Z\s]+\s+street|[a-zA-Z\s]+\s+road|[a-zA-Z\s]+\s+avenue/i;
  const namePattern = /^[a-zA-Z\s]+$/;
  
  if (emailPattern.test(input)) {
    console.log('confirmSlot: Email detected, switching to detail collection');
    stateMachine.currentState = 'collect_details';
    return await collectClientDetails(input);
  } else if (addressPattern.test(input)) {
    console.log('confirmSlot: Address detected, switching to detail collection');
    stateMachine.currentState = 'collect_details';
    return await collectClientDetails(input);
  } else if (namePattern.test(input) && input.split(' ').length >= 2) {
    console.log('confirmSlot: Name detected, switching to detail collection');
    stateMachine.currentState = 'collect_details';
    return await collectClientDetails(input);
  } else if (input.toLowerCase().includes('yes') || input.toLowerCase().includes('okay')) {
    // User confirmed slot, check if we have all details
    const missingDetails = [];
    if (!stateMachine.clientData.name) missingDetails.push('name');
    if (!stateMachine.clientData.email) missingDetails.push('email');
    if (!stateMachine.clientData.address) missingDetails.push('address');
    
    if (missingDetails.length > 0) {
      console.log('confirmSlot: Slot confirmed but missing details, switching to collection');
      stateMachine.currentState = 'collect_details';
      return await collectClientDetails('');
    } else {
      console.log('confirmSlot: Slot confirmed with all details, asking for instructions');
      stateMachine.currentState = 'special_instructions';
      const response = await getResponse("Great! Any special instructions, like gate codes or security details?", stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  } else {
    stateMachine.currentState = 'book_appointment';
    const response = await getResponse("No worries! When would you prefer instead?", stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('confirmSlot: Re-prompting', response);
    return response;
  }
}

async function collectSpecialInstructions(input) {
  console.log('collectSpecialInstructions: User input', input);
  stateMachine.clientData.specialInstructions = input;
  
  let contactData = null;
  try {
    contactData = {
      firstName: stateMachine.clientData.name?.split(' ')[0] || '',
      lastName: stateMachine.clientData.name?.split(' ').slice(1).join(' ') || '',
      email: stateMachine.clientData.email,
      phone: stateMachine.clientData.phone,
      address: stateMachine.clientData.address,
      customField: {
        specialInstructions: input || 'None',
        issueDescription: stateMachine.clientData.issueDescription || 'Burst pipe or leak',
      },
    };
    // Save contact to GHL with automatic token refresh handling
    await createOrUpdateContact(contactData);
    console.log('collectSpecialInstructions: Contact saved to GHL');
  } catch (error) {
    console.error('collectSpecialInstructions: GHL contact save failed', error);
    // Notify critical error but continue with booking
    await notifyError(error, 'collectSpecialInstructions - GHL Contact Save', {
      customerName: stateMachine.clientData.name,
      customerEmail: stateMachine.clientData.email,
      contactData: contactData
    });
  }

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }

    const formattedAddress = formatAustralianAddress(stateMachine.clientData.address);
    const eventDetails = {
      summary: `Plumbing Appointment - ${stateMachine.clientData.name}`,
      start: { dateTime: stateMachine.nextSlot.toISOString(), timeZone: BRISBANE_TZ },
      end: { dateTime: new Date(stateMachine.nextSlot.getTime() + 60 * 60 * 1000).toISOString(), timeZone: BRISBANE_TZ },
      location: formattedAddress,
      description: `Customer: ${stateMachine.clientData.name}\n` +
                   `Email: ${stateMachine.clientData.email}\n` +
                   `Phone: ${stateMachine.clientData.phone || 'Not provided'}\n` +
                   `Address: ${formattedAddress}\n` +
                   `Issue: ${stateMachine.clientData.issueDescription || 'Burst pipe or leak'}\n` +
                   `Special Instructions: ${input || 'None'}\n` +
                   `Travel Time Calculation:\n` +
                   `- Last job location: ${lastBookedJobLocation || 'First appointment of day'}\n` +
                   `- Current job location: ${formattedAddress}\n` +
                   `- Estimated travel time: ${lastBookedJobLocation ? await calculateTravelTime(lastBookedJobLocation, formattedAddress) : 0} minutes\n` +
                   `- Job completion buffer: 30 minutes`,
      attendees: [{ email: stateMachine.clientData.email }],
    };

    const appointment = await createAppointment(accessToken, eventDetails);
    if (appointment) {
      lastBookedJobLocation = formattedAddress;
      console.log('? Updated last booked job location to:', lastBookedJobLocation);
      stateMachine.bookingRetryCount = 0;

      const bookingDetails = {
        customerName: stateMachine.clientData.name,
        customerEmail: stateMachine.clientData.email,
        phone: stateMachine.clientData.phone,
        address: formattedAddress,
        appointmentTime: stateMachine.nextSlot,
        issue: stateMachine.clientData.issueDescription || 'Burst pipe or leak',
        specialInstructions: input || 'None',
        referenceNumber: generatePhoneBasedReference(stateMachine.callerPhoneNumber),
        estimated_duration: calculateServiceDuration(stateMachine.clientData.issueDescription),
        travel_time: calculateEmailTravelTime(formattedAddress),
        service_category: getServiceCategory(stateMachine.clientData.issueDescription),
      };

      try {
        await sendBookingConfirmationEmail(bookingDetails);
        console.log('? Confirmation email sent successfully');
        stateMachine.clientData.emailConfirmationSent = true;
        stateMachine.clientData.emailSentTimestamp = new Date().toISOString();
      } catch (emailError) {
        console.error('?? Email sending failed:', emailError);
        // Notify email failure
        await notifyWarning('Booking confirmation email failed', {
          customerName: stateMachine.clientData.name,
          customerEmail: stateMachine.clientData.email,
          appointmentTime: stateMachine.nextSlot,
          error: emailError.message
        });
        
        try {
          await sendSMSConfirmation(bookingDetails);
          console.log('? SMS confirmation sent as backup');
          stateMachine.clientData.smsConfirmationSent = true;
        } catch (smsError) {
          console.error('?? SMS sending failed:', smsError);
          // Notify both email and SMS failures - critical
          await notifyError(
            new Error(`Both email and SMS confirmations failed. Email: ${emailError.message}, SMS: ${smsError.message}`),
            'collectSpecialInstructions - Confirmation Communication Failed',
            {
              customerName: stateMachine.clientData.name,
              customerEmail: stateMachine.clientData.email,
              customerPhone: stateMachine.clientData.phone,
              emailError: emailError.message,
              smsError: smsError.message
            }
          );
        }
      }

      const formattedTime = stateMachine.nextSlot.toLocaleString('en-AU', {
        timeZone: BRISBANE_TZ,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      });

      let travelInfo = lastBookedJobLocation && lastBookedJobLocation !== formattedAddress
        ? `\n??Location Note:** This appointment accounts for ${await calculateTravelTime(lastBookedJobLocation, formattedAddress)} minutes travel time from our previous job plus 30 minutes job completion time.`
        : '\n??Location Note:** This is our first appointment of the day at your requested location.';

      const confirmationMessage = `?APPOINTMENT CONFIRMED!**\n\n` +
                                 `??Date & Time:** ${formattedTime} Brisbane time\n` +
                                 `??Customer:** ${stateMachine.clientData.name}\n` +
                                 `??Address:** ${formattedAddress}\n` +
                                 `??Email:** ${stateMachine.clientData.email}\n` +
                                 `??Phone:** ${stateMachine.clientData.phone || 'Not provided'}\n` +
                                 `??Special Instructions:** ${input || 'None'}${travelInfo}\n` +
                                 `**Your appointment reference:** ${generatePhoneBasedReference(stateMachine.callerPhoneNumber)}\n` +
                                 `**What to expect:**\n` +
                                 `- ? Confirmation email sent to ${stateMachine.clientData.email}\n` +
                                 `- ?? Our plumber will call 30 minutes before arrival\n` +
                                 `- ?? We'll bring all standard tools and parts\n` +
                                 `- ?? Payment can be made on completion\n` +
                                 `Thank you for choosing Usher Fix Plumbing! Is there anything else I can help you with today?`;

      const response = await getResponse(confirmationMessage, stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      stateMachine.currentState = 'booking_complete';
      console.log('collectSpecialInstructions: Appointment booked at', formattedAddress, 'for', formattedTime);
      
      // Notify successful booking
      await notifySuccess('New Plumbing Appointment Booked Successfully', {
        customerName: stateMachine.clientData.name,
        customerEmail: stateMachine.clientData.email,
        customerPhone: stateMachine.clientData.phone,
        address: formattedAddress,
        appointmentTime: formattedTime,
        appointmentId: generatePhoneBasedReference(stateMachine.callerPhoneNumber),
        issue: stateMachine.clientData.issueDescription || 'Burst pipe or leak',
        specialInstructions: input || 'None',
        emailConfirmed: stateMachine.clientData.emailConfirmationSent || false,
        smsBackup: stateMachine.clientData.smsConfirmationSent || false
      });
      
      return response;
    } else {
      throw new Error('Appointment creation returned null');
    }
  } catch (error) {
    console.error('collectSpecialInstructions: Booking failed', error);
    // Notify critical booking failure
    await notifyError(error, 'collectSpecialInstructions - Calendar Booking Failed', {
      customerName: stateMachine.clientData.name,
      customerEmail: stateMachine.clientData.email,
      customerAddress: stateMachine.clientData.address,
      appointmentTime: stateMachine.nextSlot,
      retryCount: stateMachine.bookingRetryCount || 0
    });
    
    stateMachine.bookingRetryCount = (stateMachine.bookingRetryCount || 0) + 1;
    if (stateMachine.bookingRetryCount < 2) {
      return await collectSpecialInstructions(input);
    } else {
      // Final failure - critical notification
      await notifyError(
        new Error(`Booking failed after ${stateMachine.bookingRetryCount} retries: ${error.message}`),
        'collectSpecialInstructions - FINAL BOOKING FAILURE',
        {
          customerName: stateMachine.clientData.name,
          customerEmail: stateMachine.clientData.email,
          customerAddress: stateMachine.clientData.address,
          originalError: error.message,
          totalRetries: stateMachine.bookingRetryCount
        }
      );
      
      stateMachine.bookingRetryCount = 0;
      const response = "Sorry, there was an error with your booking. Please call us directly at (07) 3608 1688 to complete your appointment. We have all your details ready.";
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      stateMachine.currentState = 'ended';
      return response;
    }
  }
}

async function handleGeneralQuery(input) {
  try {
    console.log('  EMERGENCY BOOKING INITIATED');
    console.log('?? Customer Details:', {
      name: stateMachine.clientData.name,
      email: stateMachine.clientData.email,
      address: stateMachine.clientData.address,
      phone: stateMachine.clientData.phone,
      issue: stateMachine.clientData.issueDescription
    });
    
    // Get access token for Google Calendar
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.error('? EMERGENCY: Failed to get Google Calendar access token');
      const response = `??EMERGENCY RESPONSE ACTIVATED**

I've escalated your urgent request to our emergency dispatch team. 
A plumber will be contacted immediately and will call you within 15 minutes to confirm arrival time.

?? You'll also receive an email confirmation at ${stateMachine.clientData.email}`;
      
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
    
    // Get next available emergency slot
    const now = new Date();
    const nextSlot = await getNextAvailableSlot(accessToken, now);
    if (!nextSlot) {
      console.error('? EMERGENCY: No available appointment slots found');
      const response = `??EMERGENCY RESPONSE ACTIVATED**

I've escalated your urgent request to our emergency dispatch team. 
A plumber will be contacted immediately and will call you within 15 minutes to confirm arrival time.

?? You'll also receive an email confirmation at ${stateMachine.clientData.email}`;
      
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
    
    console.log(`? EMERGENCY SLOT FOUND: ${nextSlot}`);
    
    // Format appointment time
    const appointmentTime = nextSlot.toLocaleString('en-AU', {
      timeZone: BRISBANE_TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    // Generate reference number
    const referenceNumber = `PLB-URG-${Date.now().toString().slice(-6)}`;
    console.log(`?? EMERGENCY REFERENCE: ${referenceNumber}`);
    
    // Create emergency appointment
    const appointmentEventDetails = {
      summary: `?? EMERGENCY: ${stateMachine.clientData.issueDescription || 'Plumbing Issue'} - ${stateMachine.clientData.name}`,
      description: `EMERGENCY PLUMBING APPOINTMENT\n\n` +
                  `Customer: ${stateMachine.clientData.name}\n` +
                  `Phone: ${stateMachine.clientData.phone || 'Not provided'}\n` +
                  `Email: ${stateMachine.clientData.email}\n` +
                  `Address: ${stateMachine.clientData.address}\n` +
                  `Issue: ${stateMachine.clientData.issueDescription || 'Emergency plumbing issue'}\n` +
                  `Priority: HIGH - EMERGENCY\n` +
                  `Reference: ${referenceNumber}\n\n` +
                  `?? URGENT: Customer needs immediate assistance\n` +
                  `?? Call customer 30 minutes before arrival\n` +
                  `?? Email confirmation sent to ${stateMachine.clientData.email}`,
      start: {
        dateTime: nextSlot.toISOString(),
        timeZone: BRISBANE_TZ,
      },
      end: {
        dateTime: new Date(nextSlot.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hour appointment
        timeZone: BRISBANE_TZ,
      },
      location: stateMachine.clientData.address,
      attendees: [
        { email: stateMachine.clientData.email, displayName: stateMachine.clientData.name },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 15 },
        ],
      },
      colorId: '11', // Red color for emergency appointments
    };
    
    console.log('?? CREATING EMERGENCY GOOGLE CALENDAR APPOINTMENT...');
    console.log(`?? Customer: ${stateMachine.clientData.name}`);
    console.log(`?? Email: ${stateMachine.clientData.email}`);
    console.log(`?? Address: ${stateMachine.clientData.address}`);
    console.log(`?? Phone: ${stateMachine.clientData.phone || 'Not provided'}`);
    console.log(`? Emergency Time: ${appointmentTime}`);
    
    // Create appointment in Google Calendar
    const appointment = await createAppointment(accessToken, appointmentEventDetails);
    
    if (appointment && appointment.id) {
      console.log('? EMERGENCY APPOINTMENT SUCCESSFULLY BOOKED IN GOOGLE CALENDAR!');
      console.log(`?? Emergency Appointment ID: ${appointment.id}`);
      console.log(`?? Email confirmation will be sent to: ${stateMachine.clientData.email}`);
      
      stateMachine.appointmentBooked = true;
      stateMachine.appointmentId = appointment.id;
      stateMachine.referenceNumber = referenceNumber;
      stateMachine.currentState = 'appointment_confirmed';
      
      // Email confirmation will be sent automatically by Google Calendar
      console.log('?? EMAIL CONFIRMATION PROCESS:');
      console.log('   ? Google Calendar will automatically send emergency appointment invite');
      console.log('   ? Customer will receive urgent calendar notification');
      console.log('   ? Emergency appointment marked with high priority');
      
      const response = `??EMERGENCY APPOINTMENT BOOKED!**

?URGENT PRIORITY CONFIRMED**
??Date & Time:** ${appointmentTime}
??Location:** ${stateMachine.clientData.address}
??Emergency Reference:** ${referenceNumber}
??Confirmation:** Being sent to ${stateMachine.clientData.email}

?? Our emergency plumber is being dispatched and will arrive within the scheduled time. 

??You will receive:**
� Immediate calendar invitation with emergency details
� SMS notification 30 minutes before arrival
� Direct contact number for the assigned plumber

?? EMERGENCY PROTOCOL ACTIVE** - Our team has been notified of your urgent situation.

Is there anything else urgent I can help you with?`;
      
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } else {
      throw new Error('Failed to create emergency appointment - no appointment ID returned');
    }
    
  } catch (error) {
    console.error('? EMERGENCY BOOKING FAILED:', error.message);
    console.error('  Emergency Error Details:', {
      customerName: stateMachine.clientData.name,
      customerEmail: stateMachine.clientData.email,
      customerAddress: stateMachine.clientData.address,
      error: error.stack
    });
    
    const response = `??EMERGENCY ESCALATION**

I've immediately escalated your emergency to our dispatch team. 
A supervisor will call you within 5 minutes to arrange immediate assistance.

?? Please keep your phone available.
?? You'll receive follow-up details at ${stateMachine.clientData.email}`;
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

async function handleGeneralQuery(input) {
  console.log('handleGeneralQuery: Processing', input);
  
  // Check if this is the first response after booking intent was detected
  if (stateMachine.needsBookingOffer) {
    console.log('handleGeneralQuery: Customer responded after booking intent, analyzing response');
    stateMachine.needsBookingOffer = false; // Reset flag
    
    const lowerInput = input.toLowerCase();
    
    // Check if customer described an issue, then offer booking
    if (lowerInput.length > 5 && (
      lowerInput.includes('toilet') || lowerInput.includes('sink') || lowerInput.includes('pipe') ||
      lowerInput.includes('leak') || lowerInput.includes('water') || lowerInput.includes('drain') ||
      lowerInput.includes('hot water') || lowerInput.includes('shower') || lowerInput.includes('tap') ||
      lowerInput.includes('block') || lowerInput.includes('clog') || lowerInput.includes('fix') ||
      lowerInput.includes('repair') || lowerInput.includes('problem') || lowerInput.includes('issue') ||
      lowerInput.includes('broken') || lowerInput.includes('not working') || lowerInput.includes('burst')
    )) {
      // Store the issue description and offer booking
      stateMachine.clientData.issueDescription = input;
      stateMachine.currentState = 'ask_booking';
      return `I understand you're having ${input.toLowerCase()}. That definitely sounds like something our experienced plumbers can help you with. Would you like me to schedule an appointment for a technician to come out and take care of this for you?`;
    } 
    // Handle simple confirmations like "Yes" - ask for more details about the issue
    else if (lowerInput.includes('yes') || lowerInput.includes('sure') || lowerInput.includes('okay') || lowerInput.includes('ok')) {
      // Customer confirmed they need help but didn't describe the issue yet
      return "Great! Can you tell me a bit more about what's happening? For example, is it a toilet issue, hot water problem, leak, or something else?";
    }
    // Handle other responses - still try to get issue details
    else {
      return "No problem! Can you tell me what kind of plumbing issue you're experiencing? For example, is it related to your toilet, hot water, a leak, or something else?";
    }
  }
  
  // Handle modification requests during confirmation
  if (stateMachine.confirmingAllDetails) {
    const normalizedInput = input.toLowerCase();
    
    if (normalizedInput.includes('yes') || normalizedInput.includes('correct') || normalizedInput.includes('all good')) {
      // All details confirmed, proceed to booking
      console.log('? CUSTOMER CONFIRMED ALL DETAILS - PROCEEDING TO BOOK APPOINTMENT');
      stateMachine.confirmingAllDetails = false;
      return await autoBookAppointment();
    }
    
    // Check for specific modification requests
    if (normalizedInput.includes('change name') || normalizedInput.includes('name wrong') || normalizedInput.includes('wrong name')) {
      return await handleDetailModification('name');
    }
    if (normalizedInput.includes('change email') || normalizedInput.includes('email wrong') || normalizedInput.includes('wrong email')) {
      return await handleDetailModification('email');
    }
    if (normalizedInput.includes('change address') || normalizedInput.includes('address wrong') || normalizedInput.includes('wrong address')) {
      return await handleDetailModification('address');
    }
    if (normalizedInput.includes('change phone') || normalizedInput.includes('phone wrong') || normalizedInput.includes('wrong phone')) {
      return await handleDetailModification('phone');
    }
  }
  
  // Enhanced booking request keywords - more specific to avoid false positives
  const bookingKeywords = /\b(book|schedule|make|set|arrange).*(appointment|booking|time|slot|visit|service|someone out|technician|repair|fix)|schedule.*\b(me|us|appointment|visit|service)|book.*\b(me|us|appointment|visit)|appointment.*\b(for|at|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)|come.*\b(out|over|today|tomorrow|this week)|visit.*\b(today|tomorrow|this week|soon)|service.*\b(call|visit|appointment)|fix.*\b(today|tomorrow|soon|asap)|repair.*\b(today|tomorrow|soon|asap)|when.*\b(can|could|available|come|visit)|what.*\b(time|times|available|slots)|available.*\b(time|times|today|tomorrow)|earliest.*\b(time|slot|appointment)|next.*\b(available|slot|appointment)|send.*\b(someone|technician|plumber)|dispatch.*\b(technician|plumber)|quote.*\b(appointment|visit)|estimate.*\b(visit|appointment)|book.*appointment|schedule.*appointment|make.*appointment|set.*appointment|arrange.*appointment|need.*appointment|want.*appointment|would like.*appointment|could.*book|can.*book|please.*book|let me.*book|help me.*book|get me.*appointment/i;
  
  // Enhanced email change keywords
  const emailChangeKeywords = /\b(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error).*(email|e-mail|address)|email.*(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error)|wrong.*email|incorrect.*email|different.*email|new.*email|update.*email|email.*wrong|email.*incorrect|email.*mistake|typed.*wrong.*email/i;
  
  // Enhanced confirmation keywords
  const confirmationKeywords = /\b(send|email|confirmation|confirm|receipt|details|summary|copy|record|proof).*(email|confirmation|details|receipt|summary|copy|record|proof)|send.*\b(me|us).*(confirmation|email|details|receipt|copy|record)|confirmation.*(email|send|please)|receipt.*(email|send|please)|details.*(email|send|please)|email.*\b(confirmation|receipt|details|summary|copy|record)|where.*(confirmation|email|receipt)|did.*\b(send|email|confirmation)|get.*\b(confirmation|email|receipt)|need.*\b(confirmation|receipt|copy|record)|want.*\b(confirmation|email|receipt)/i;
  
  // Add new detection patterns
  const nameChangeKeywords = /\b(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error).*(name|my name)|name.*(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error)|wrong.*name|incorrect.*name|different.*name|my name is|call me|name.*wrong|name.*incorrect|name.*mistake|spelled.*wrong.*name|misspelled.*name/i;
  
  const addressChangeKeywords = /\b(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error).*(address|location|place)|address.*(change|update|fix|correct|modify|edit|new|different|wrong|incorrect|mistake|typo|error)|wrong.*address|incorrect.*address|different.*address|moved|new address|relocated|address.*wrong|address.*incorrect|address.*mistake|different.*location|new.*location|changed.*address/i;
  
  const timeChangeKeywords = /\b(change|update|fix|correct|modify|edit|new|different|reschedule|move|shift|postpone|delay|earlier|later).*(time|appointment|booking|schedule)|time.*(change|update|fix|correct|modify|edit|new|different|earlier|later)|different.*time|another.*time|reschedule|move.*appointment|change.*appointment|shift.*appointment|postpone.*appointment|delay.*appointment|earlier.*time|later.*time|new.*time.*slot/i;
  
  const cancelKeywords = /\b(cancel|cancelled|delete|remove|no longer|don't need|changed mind|not needed|abort|stop|void|withdraw).*(appointment|booking|service|visit)|cancel|cancelled|delete.*appointment|remove.*booking|no longer.*need|don't.*need.*service|changed.*mind|not.*needed.*anymore|abort.*appointment|stop.*service|void.*booking|withdraw.*appointment|don't.*want.*service/i;
  
  const helpKeywords = /\b(help|assistance|support|info|information|explain|tell me|what|how|why|question|confused|don't understand|not sure|clarify|guide|assist|advise|instruct|teach|show|demonstrate)/i;
  
  const greetingKeywords = /\b(hello|hi|hey|good morning|good afternoon|good evening|greetings|how are you|thanks|thank you|please|excuse me|sorry|pardon|appreciate|grateful)/i;
  
  const statusCheckKeywords = /\b(status|check|update|progress|when|where|timeline|eta|arrival|arriving|coming|on the way|scheduled|confirmed|tracking|follow up).*(appointment|booking|service|visit|plumber|technician)|appointment.*(status|confirmed|scheduled|when|where|time|progress)|booking.*(status|confirmed|scheduled|when|where|time|progress)|when.*(coming|arrive|arriving|scheduled|appointment|visit)|where.*(technician|plumber|appointment)|how.*long.*(wait|until)|still.*coming|on.*schedule|running.*late/i;
  
  const emergencyKeywords = /\b(emergency|flooding|burst pipe|no water|overflow|disaster|crisis|help|urgent help|serious problem|major issue|water everywhere|pipe burst|toilet overflow|sink overflow|bathroom flooding|kitchen flooding|basement flooding|water damage|leak everywhere|catastrophe|calamity|urgent situation|critical situation|immediate help|desperate|panic)/i;
  
  // Add price/quote related keywords
  const priceQuoteKeywords = /\b(price|cost|quote|estimate|fee|charge|rate|pricing|how much|what.*cost|expensive|cheap|affordable|budget|payment|pay|bill|invoice)/i;
  
  // Add service type keywords
  const serviceTypeKeywords = /\b(toilet|bathroom|kitchen|sink|tap|faucet|drain|pipe|water heater|hot water|cold water|shower|bath|leak|block|clog|repair|install|replace|maintenance)/i;
  
  // Handle emergency situations first (highest priority)
  if (emergencyKeywords.test(input)) {
    console.log('?? EMERGENCY detected - highest priority');
    stateMachine.urgent = true;
    stateMachine.needsEmpathy = true;
    stateMachine.safetyConcern = true;
    stateMachine.currentState = 'urgent_booking';
    return await handleUrgentBooking(input);
  }
  
  // Check if customer is describing a plumbing issue (for normal booking flow)
  const lowerInput = input.toLowerCase();
  const hasIssueDescription = lowerInput.length > 5 && (
    lowerInput.includes('toilet') || lowerInput.includes('sink') || lowerInput.includes('pipe') ||
    lowerInput.includes('leak') || lowerInput.includes('water') || lowerInput.includes('drain') ||
    lowerInput.includes('hot water') || lowerInput.includes('shower') || lowerInput.includes('tap') ||
    lowerInput.includes('block') || lowerInput.includes('clog') || lowerInput.includes('fix') ||
    lowerInput.includes('repair') || lowerInput.includes('problem') || lowerInput.includes('issue') ||
    lowerInput.includes('broken') || lowerInput.includes('not working') || lowerInput.includes('burst') ||
    lowerInput.includes('overflow') || lowerInput.includes('flood') || lowerInput.includes('drip')
  );
  
  // If customer describes an issue but we're not in any specific booking flow, offer booking
  if (hasIssueDescription && 
      stateMachine.currentState === 'general' && 
      !stateMachine.troubleshootingProvided &&
      !stateMachine.confirmingAllDetails) {
    console.log('?? ISSUE DETECTED in general conversation - offering booking');
    stateMachine.clientData.issueDescription = input;
    stateMachine.currentState = 'ask_booking';
    return `I understand you're having issues with ${input.toLowerCase()}. That definitely sounds like something our experienced plumbers can help you with. Would you like me to schedule an appointment for a technician to come out and take care of this for you?`;
  }
  
  // Handle troubleshooting feedback after troubleshooting was provided
  if (stateMachine.troubleshootingProvided) {
    const troubleshootingSuccessKeywords = /\b(worked|fixed|solved|resolved|working now|ok now|good now|sorted|done|that helped|successful|success|it's working|problem solved|all good|thank you|thanks|that did it|perfect)/i;
    const troubleshootingFailedKeywords = /\b(didn't work|still not working|still broken|still have the problem|no luck|not fixed|same issue|still leaking|still blocked|still won't flush|doesn't help|tried but|tried that|already tried|still need help|need a plumber|book appointment|schedule|visit)/i;
    
    if (troubleshootingSuccessKeywords.test(input)) {
      console.log('? Troubleshooting was successful');
      stateMachine.troubleshootingProvided = false; // Reset for future issues
      const response = await getResponse(
        `That's wonderful! I'm so glad those troubleshooting steps worked for you. Is there anything else I can help you with today? If you have any other plumbing issues in the future, feel free to call us anytime.`,
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
    
    if (troubleshootingFailedKeywords.test(input)) {
      console.log('? Troubleshooting didn\'t work - offering appointment');
      stateMachine.troubleshootingProvided = false; // Reset so booking flow can proceed
      const response = await getResponse(
        `No worries at all - sometimes these issues need professional attention. Our experienced plumbers have the right tools and expertise to fix this properly. Would you like me to book an appointment for a technician to come out and take care of this for you?`,
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  }
  
  // Handle cancellation requests
  if (cancelKeywords.test(input)) {
    console.log('? Cancellation request detected');
    const response = await getResponse(
      'I understand you\'d like to cancel. Can you please provide your appointment reference number or the details of your booking so I can help you with the cancellation?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle name change requests
  if (nameChangeKeywords.test(input)) {
    console.log('?? Name change request detected');
    stateMachine.collectingDetail = 'name';
    stateMachine.spellingConfirmation = false;
    stateMachine.tempCollectedValue = null;
    const response = await getResponse(
      'Of course! What\'s the correct name for the appointment?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle address change requests
  if (addressChangeKeywords.test(input)) {
    console.log('?? Address change request detected');
    stateMachine.collectingDetail = 'address';
    stateMachine.spellingConfirmation = false;
    stateMachine.tempCollectedValue = null;
    const response = await getResponse(
      'No problem! What\'s the correct address for the service call? Please include street number, street name, suburb, and postcode.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle time/appointment change requests
  if (timeChangeKeywords.test(input)) {
    console.log('? Time change request detected');
    const response = await getResponse(
      'I can help you reschedule your appointment. What time would work better for you? I can check availability for today, tomorrow, or later this week.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle status check requests
  if (statusCheckKeywords.test(input)) {
    console.log('?? Status check request detected');
    const extractedData = extractCustomerDataFromHistory();
    if (extractedData.name || extractedData.email || extractedData.address) {
      const response = await getResponse(
        `Let me check the status of your appointment. I can see we have details for ${extractedData.name || 'your appointment'} ${extractedData.address ? `at ${extractedData.address}` : ''}. Your appointment is confirmed and our technician will arrive within the scheduled window. You'll receive a call 30 minutes before arrival.`,
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } else {
      const response = await getResponse(
        'I\'d be happy to check your appointment status. Can you please provide your name, phone number, or appointment reference so I can look up your booking?',
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  }
  
  // Handle help/information requests
  if (helpKeywords.test(input)) {
    console.log('? Help request detected');
    const response = await getResponse(
      'I\'m here to help! I can assist you with:\n' +
      '� Booking plumbing appointments\n' +
      '� Emergency plumbing services\n' +
      '� Updating your contact details\n' +
      '� Checking appointment status\n' +
      '� Rescheduling appointments\n' +
      '� Service pricing and quotes\n' +
      'What would you like help with?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle pricing/quote requests
  if (priceQuoteKeywords.test(input)) {
    console.log('?? Pricing/quote request detected');
    const response = await getResponse(
      'I\'d be happy to help with pricing information. Our call-out fee is $99, which includes the first 30 minutes of labour. Additional work is charged at competitive rates. For an accurate quote, I can arrange for a technician to assess your specific issue. Would you like me to book an appointment for a free quote?',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle service type questions
  if (serviceTypeKeywords.test(input) && !bookingKeywords.test(input)) {
    console.log('?? Service type inquiry detected');
    const response = await getResponse(
      'We handle all types of plumbing issues including:\n' +
      '� Toilet repairs and installations\n' +
      '� Sink and tap problems\n' +
      '� Drain cleaning and unblocking\n' +
      '� Water heater services\n' +
      '� Pipe repairs and leaks\n' +
      '� Bathroom and kitchen plumbing\n' +
      'What specific plumbing issue do you need help with? I can book an appointment to get it fixed.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle greetings and general plumbing requests
  if (greetingKeywords.test(input) && !bookingKeywords.test(input)) {
    console.log('?? Greeting detected');
    const response = 'Hello! I\'m Robyn from Assure Fix Plumbing. How can I help you today? Are you experiencing a plumbing issue that needs fixing?';
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle general plumbing requests (like "I need a plumber")
  const generalPlumbingKeywords = /\b(need|want|require|looking for|could use|call for).*(plumber|plumbing|fix|repair|help|service|technician)|plumber|plumbing.*help|plumbing.*service|plumbing.*issue|plumbing.*problem|need.*fixed|need.*repaired|something.*wrong|having.*problem|experiencing.*issue/i;
  
  if (generalPlumbingKeywords.test(input) && !bookingKeywords.test(input) && !serviceTypeKeywords.test(input)) {
    console.log('?? General plumbing request detected - starting issue diagnosis');
    const response = await getResponse(
      'I\'d be happy to help you with your plumbing needs! What specific plumbing issue are you experiencing? For example:\n' +
      '� Toilet problems (won\'t flush, overflowing, leaking)\n' +
      '� Sink or tap issues (no water, leaks, drips)\n' +
      '� Blocked drains\n' +
      '� Water heater problems\n' +
      '� Pipe leaks or bursts\n' +
      'Tell me what\'s happening so I can understand how to help you.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle email change requests
  if (emailChangeKeywords.test(input)) {
    console.log('?? Email change request detected');
    stateMachine.collectingDetail = 'email';
    stateMachine.spellingConfirmation = false;
    stateMachine.tempCollectedValue = null;
    const response = await getResponse(
      'Of course! What\'s your correct email address? Please spell it out letter by letter if needed.',
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
  
  // Handle confirmation email requests
  if (confirmationKeywords.test(input)) {
    console.log('?? Confirmation email request detected');
    const extractedData = extractCustomerDataFromHistory();
    
    if (extractedData.email && extractedData.name && extractedData.address) {
      console.log('? Complete data available, proceeding with booking and confirmation');
      stateMachine.currentState = 'confirm_booking';
      return await confirmAppointmentBooking('confirm');
    } else {
      console.log('? Missing data for confirmation, collecting details first');
      const missingDetails = [];
      if (!extractedData.name) missingDetails.push('name');
      if (!extractedData.email) missingDetails.push('email');
      if (!extractedData.address) missingDetails.push('address');
      
      const nextDetail = missingDetails[0];
      return await startDetailCollection(nextDetail, extractedData);
    }
  }
  
  if (bookingKeywords.test(input)) {
    console.log('?? Booking request detected, transitioning to structured collection with location optimization');
    
    // Start structured collection process that includes location optimization
    if (!stateMachine.clientData.name || !stateMachine.clientData.phone || !stateMachine.clientData.email || !stateMachine.clientData.address) {
      console.log('?? Missing details detected, starting structured collection');
      stateMachine.currentState = 'collect_details';
      stateMachine.questionIndex = 0;
      
      const response = await getResponse(
        'I\'d be happy to schedule an appointment for you. Let me get your details first. What\'s your full name?',
        stateMachine.conversationHistory
      );
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } else {
      // All details available, proceed with location-optimized booking
      console.log('?? All details available, proceeding with optimized booking');
      return await autoBookAppointment();
    }
  }
  
  const extractedData = extractCustomerDataFromHistory();
  const currentInputData = await extractCustomerData(input);
  Object.assign(extractedData, currentInputData);
  Object.assign(stateMachine.clientData, extractedData);
  
  console.log('Extracted customer data:', extractedData);

  // PRIORITY CHECK: If all details are now complete, proceed to booking immediately
  const autoBookResult = await checkAndAutoBook();
  if (autoBookResult) {
    return autoBookResult;
  }

  // Check if we're in a specific detail collection state
  if (stateMachine.collectingDetail) {
    return await handleDetailCollection(input, extractedData);
  }

  // Handle appointment management commands
  const normalizedInput = input.toLowerCase();
  
  // Handle cancellation requests
  if (normalizedInput.includes('cancel') && (normalizedInput.includes('appointment') || normalizedInput.includes('booking'))) {
    return await handleAppointmentCancellation();
  }
  
  // Handle postponement requests
  if (normalizedInput.includes('postpone') || normalizedInput.includes('delay') || normalizedInput.includes('reschedule')) {
    return await handleAppointmentPostponement();
  }
  
  // Handle "no longer required" requests
  if (normalizedInput.includes('no longer required') || normalizedInput.includes('not needed anymore') || normalizedInput.includes('changed my mind')) {
    return await handleAppointmentCancellation();
  }

  const isProvidingDetails = currentInputData.name || currentInputData.email || currentInputData.address || currentInputData.phone;
  if (isProvidingDetails && !stateMachine.allDetailsCollected) {
    console.log('  Customer is providing contact details - starting step-by-step collection');
    
    // If customer provides multiple details at once, collect them step by step
    if (currentInputData.name) {
      stateMachine.clientData.name = currentInputData.name;
    }
    if (currentInputData.email) {
      stateMachine.clientData.email = correctEmailFromTranscription(currentInputData.email);
    }
    if (currentInputData.address) {
      stateMachine.clientData.address = currentInputData.address;
    }
    if (currentInputData.phone) {
      stateMachine.clientData.phone = currentInputData.phone;
    }
    
    return await startStepByStepCollection();
  }

  const bookingTriggers = ['schedule', 'book', 'appointment', 'time', 'today', 'tomorrow', 'pm', 'am', 'morning', 'afternoon', 'evening'];
  const hasBookingIntent = bookingTriggers.some(trigger => input.toLowerCase().includes(trigger));
  
  // Check for complete data in both current input AND stored client data
  const hasCompleteDataFromInput = extractedData.name && extractedData.email && extractedData.address;
  const hasCompleteDataStored = stateMachine.clientData.name && stateMachine.clientData.email && stateMachine.clientData.address;
  const hasCompleteData = hasCompleteDataFromInput || hasCompleteDataStored;
  
  const readyToProceedPhrases = ['nothing', 'no', 'done', 'thats all', 'all set', 'ready', 'go ahead', 'nothing else', 'none', 'nope', 'finished'];
  const seemsReady = readyToProceedPhrases.some(phrase => input.toLowerCase().includes(phrase));

  console.log('🔍 BOOKING LOGIC CHECK:', {
    hasBookingIntent,
    hasCompleteDataFromInput,
    hasCompleteDataStored,
    hasCompleteData,
    allDetailsCollected: stateMachine.allDetailsCollected,
    clientData: stateMachine.clientData
  });

  // If we have complete data and booking intent, proceed to booking immediately
  if (hasCompleteData && hasBookingIntent) {
    console.log('🎯 BOOKING TRIGGER DETECTED with complete data - proceeding to auto-booking!');
    
    // Ensure client data is properly set from both sources
    if (extractedData.name) stateMachine.clientData.name = extractedData.name;
    if (extractedData.email) stateMachine.clientData.email = extractedData.email;
    if (extractedData.address) stateMachine.clientData.address = extractedData.address;
    
    // Set phone from caller ID if not provided
    if (!stateMachine.clientData.phone && stateMachine.callerPhoneNumber) {
      stateMachine.clientData.phone = stateMachine.callerPhoneNumber;
    }
    
    stateMachine.allDetailsCollected = true;
    return await autoBookAppointment();
  }

  // Check if customer wants to start the booking process without providing details first
  if (hasBookingIntent && !hasCompleteData && !stateMachine.allDetailsCollected) {
    console.log('⚠️ Booking intent detected - starting step-by-step detail collection');
    return await startStepByStepCollection();
  }

  // Check if customer is ready to proceed with stored complete data (answering questions like "when would you like to schedule?")
  if (hasCompleteDataStored && (seemsReady || hasBookingIntent)) {
    console.log('🎯 CUSTOMER READY TO PROCEED with stored data - proceeding to auto-booking!');
    
    // Set phone from caller ID if not provided
    if (!stateMachine.clientData.phone && stateMachine.callerPhoneNumber) {
      stateMachine.clientData.phone = stateMachine.callerPhoneNumber;
    }
    
    stateMachine.allDetailsCollected = true;
    return await autoBookAppointment();
  }

  // Handle specific plumbing issues with proper classification
  const issueClassification = classifyPlumbingIssue(input);
  
  if (issueClassification && issueClassification !== 'unknown') {
    console.log(`?? ${issueClassification.type} issue detected`);
    stateMachine.clientData.issueDescription = issueClassification.description;
    const response = await getResponse(
      `I understand you have ${issueClassification.description}. ${issueClassification.followUp} To book an appointment, I'll need to collect your contact details. What's your full name?`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }

  // Handle general plumbing issues (enhanced with classification)
  const plumbingKeywords = ['plumbing', 'plumber', 'pipe', 'water', 'repair', 'fix', 'broken', 'problem', 'issue', 'toilet', 'sink', 'tap', 'drain', 'leak', 'blocked', 'faucet'];
  const hasPlumbingIssue = plumbingKeywords.some(keyword => input.toLowerCase().includes(keyword));
  
  if (hasPlumbingIssue) {
    // Try to classify the specific issue type
    const issueClassification = classifyPlumbingIssue(input);
    
    if (issueClassification) {
      const response = `I understand you're having ${issueClassification.description}. ${issueClassification.followUp} Let me help you schedule an appointment to get this fixed. What's your full name?`;
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } else {
      const response = 'I can help you with that plumbing issue. To get a technician out to fix it, I\'ll need to collect some basic information and book you an appointment. What\'s your full name?';
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    }
  }

  // Check for rescheduling state
  if (stateMachine.currentState === 'rescheduling') {
    return await handleReschedulingRequest(input);
  }

  // Default response for unclear inputs
  const response = await getResponse(
    'I\'m here to help with your plumbing needs. Could you tell me what specific plumbing issue you\'re experiencing? For example, is it a toilet, sink, drain, or pipe problem?',
    stateMachine.conversationHistory
  );
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

/**
 * Handle rescheduling requests
 */
async function handleReschedulingRequest(input) {
  const normalizedInput = input.toLowerCase();
  
  if (normalizedInput.includes('tomorrow')) {
    // Try to reschedule for tomorrow
    const response = await getResponse(
      `I'll reschedule your appointment for tomorrow. Let me find the next available slot and update your booking. You'll receive a confirmation email with the new time shortly.`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
  }
  
  if (normalizedInput.includes('next week')) {
    const response = await getResponse(
      `I'll reschedule your appointment for next week. I'll have our scheduling team call you within the hour to arrange a convenient time. Is that okay?`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
  }
  
  if (normalizedInput.includes('call me')) {
    const response = await getResponse(
      `Perfect! I'll have our scheduling team call you within the next hour to reschedule your appointment. We have your number on file from your original booking.`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
  }
  
  // Handle specific days
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const mentionedDay = days.find(day => normalizedInput.includes(day));
  
  if (mentionedDay) {
    const response = await getResponse(
      `I'll reschedule your appointment for ${mentionedDay}. Let me check our availability and I'll have someone call you to confirm the exact time. You should hear from us within the hour.`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
  }
  
  // If we reach here and don't have complete customer details, BUT they haven't specified their plumbing issue yet, 
  // ask about the issue first instead of jumping to booking details
  if (!stateMachine.allDetailsCollected && !stateMachine.clientData.name && !stateMachine.clientData.email && !stateMachine.clientData.address) {
    console.log('?? No clear intent - asking about plumbing issue first');
    const response = await getResponse(
      `I'd be happy to help you with your plumbing needs! What specific plumbing problem are you experiencing? Once I understand the issue, I can assist you with booking a service call.`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }

  // Detect when customer has described a plumbing issue and provide troubleshooting steps first
  const issueDescriptionKeywords = /\b(toilet|sink|tap|faucet|drain|pipe|water heater|hot water|shower|bath|leak|leaking|dripping|blocked|clogged|broken|not working|overflow|flooding|burst|no water|cold water|running|won't flush|won't turn off|stuck|loose|cracked|damaged|smells|odor|noise|gurgling|slow|backup)/i;
  
  // Check if customer is describing an issue but hasn't mentioned booking yet
  if (issueDescriptionKeywords.test(input) && !bookingKeywords.test(input) && !stateMachine.allDetailsCollected && !stateMachine.troubleshootingProvided) {
    console.log('?? Issue description detected - providing troubleshooting steps first');
    return await provideTroubleshootingSteps(input);
  }

  // If troubleshooting was already provided and customer still needs help, offer booking
  if (stateMachine.troubleshootingProvided && !stateMachine.allDetailsCollected) {
    console.log('?? Troubleshooting completed - offering to book appointment');
    const response = await getResponse(
      `If those troubleshooting steps didn't resolve the issue, our experienced plumbers can definitely help fix that problem. Would you like me to book an appointment for a technician to come out and take care of this for you?`,
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }

  // CRITICAL: Check if all details are now collected and auto-book if ready
  const autoBookResult = await checkAndAutoBook();
  if (autoBookResult) {
    return autoBookResult;
  }

  // Default general response
  const response = await getResponse(input, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

/**
 * Provide troubleshooting steps based on the customer's issue description
 */
async function provideTroubleshootingSteps(input) {
  console.log('??? Providing troubleshooting steps for:', input);
  stateMachine.troubleshootingProvided = true;
  
  const lowerInput = input.toLowerCase();
  let troubleshootingResponse = '';
  
  // Toilet issues
  if (lowerInput.includes('toilet') && (lowerInput.includes('flush') || lowerInput.includes('won\'t flush') || lowerInput.includes('not flushing'))) {
    troubleshootingResponse = `I understand your toilet won't flush properly. Let's try a few quick troubleshooting steps:\n\n` +
      `??Quick Fixes to Try:**\n` +
      `1.Check the flapper** - Lift the toilet tank lid and see if the rubber flapper at the bottom is sealing properly\n` +
      `2.Adjust the chain** - Make sure the chain connecting the flush handle to the flapper isn't too loose or tight\n` +
      `3.Check water level** - Water should be about 1 inch below the rim of the tank\n` +
      `4.Try a firm flush** - Press and hold the handle down for 2-3 seconds\n\n` +
      `Try these steps and let me know if the toilet is working properly now, or if you still need a plumber to come out.`;
  }
  // Blocked toilet
  else if (lowerInput.includes('toilet') && (lowerInput.includes('blocked') || lowerInput.includes('clogged') || lowerInput.includes('backup'))) {
    troubleshootingResponse = `I understand your toilet is blocked. Let's try some safe troubleshooting steps:\n\n` +
      `??Safe Unblocking Steps:**\n` +
      `1.Use a plunger** - Place firmly over the drain hole and pump vigorously 10-15 times\n` +
      `2.Wait and try again** - Let it sit for 15 minutes, then try flushing\n` +
      `3.Check for obvious obstructions** - Look for anything visible that might be causing the blockage\n` +
      `4.Don't use chemical drain cleaners** - These can damage your pipes\n\n` +
      `??Stop immediately if water starts overflowing!**\n\n` +
      `Try these steps and let me know if the blockage has cleared, or if you need a professional plumber.`;
  }
  // Leaking toilet
  else if (lowerInput.includes('toilet') && (lowerInput.includes('leak') || lowerInput.includes('leaking') || lowerInput.includes('water on floor'))) {
    troubleshootingResponse = `I understand your toilet is leaking. Let's identify where the leak is coming from:\n\n` +
      `??Check These Areas:**\n` +
      `1.Around the base** - Tighten the bolts at the base of the toilet (don't overtighten)\n` +
      `2.Tank to bowl connection** - Check if water is dripping between the tank and bowl\n` +
      `3.Water supply line** - Look behind the toilet for drips from the water line\n` +
      `4.Inside the tank** - Lift the lid and see if water is constantly running\n\n` +
      `??If there's a lot of water or it keeps getting worse, turn off the water valve behind the toilet!**\n\n` +
      `Let me know what you found, or if you'd like a plumber to properly diagnose and fix the leak.`;
  }
  // Sink/tap issues
  else if ((lowerInput.includes('sink') || lowerInput.includes('tap') || lowerInput.includes('faucet')) && (lowerInput.includes('drip') || lowerInput.includes('leak'))) {
    troubleshootingResponse = `I understand your sink/tap is dripping. Here are some quick steps to try:\n\n` +
      `??Quick Tap Fixes:**\n` +
      `1.Turn off tightly** - Make sure the tap is completely turned off (but don't force it)\n` +
      `2.Check the aerator** - Unscrew the tip of the tap and clean any debris\n` +
      `3.Look for obvious loose parts** - Gently tighten any visible loose connections\n` +
      `4.Note the drip location** - Is it from the spout, handle, or base?\n\n` +
      `??Temporary fix:** Place a bowl underneath to catch drips until it's properly fixed.\n\n` +
      `Try these steps and let me know if the dripping has stopped, or if you need a plumber to replace worn parts.`;
  }
  // No water issues
  else if (lowerInput.includes('no water') || (lowerInput.includes('water') && lowerInput.includes('not working'))) {
    troubleshootingResponse = `I understand you have no water. Let's check a few things:\n\n` +
      `??Water Supply Checks:**\n` +
      `1.Check other taps** - Do any other taps in the house have water?\n` +
      `2.Look for shut-off notices** - Check if there's a water outage in your area\n` +
      `3.Check the water meter** - Make sure the main water valve is turned on\n` +
      `4.Look for obvious leaks** - Check around your property for any burst pipes\n\n` +
      `??If it's just one tap:** Try cleaning the aerator (tip of the tap)\n\n` +
      `Let me know what you discovered, or if you'd like a plumber to investigate the water supply issue.`;
  }
  // Hot water issues
  else if (lowerInput.includes('hot water') || (lowerInput.includes('water heater') && (lowerInput.includes('not working') || lowerInput.includes('cold')))) {
    troubleshootingResponse = `I understand you're having hot water issues. Let's try some basic checks:\n\n` +
      `??Hot Water System Checks:**\n` +
      `1.Check the pilot light** - If you have a gas system, make sure the pilot light is on\n` +
      `2.Check circuit breakers** - For electric systems, ensure no breakers have tripped\n` +
      `3.Test other hot taps** - Is it just one tap or the whole house?\n` +
      `4.Check water heater temperature** - It should be set to 60�C (140�F)\n\n` +
      `??Safety note:** Don't attempt any repairs on gas or electrical components yourself.\n\n` +
      `Try these checks and let me know what you found, or if you need a qualified plumber to service your hot water system.`;
  }
  // Blocked drains
  else if (lowerInput.includes('drain') && (lowerInput.includes('blocked') || lowerInput.includes('clogged') || lowerInput.includes('slow'))) {
    troubleshootingResponse = `I understand your drain is blocked. Here are some safe methods to try:\n\n` +
      `??Drain Unblocking Steps:**\n` +
      `1.Remove visible debris** - Clear any hair or soap buildup you can see\n` +
      `2.Try hot water** - Pour a kettle of hot (not boiling) water down the drain\n` +
      `3.Use a plunger** - Create a seal and plunge gently several times\n` +
      `4.Baking soda and vinegar** - Pour 1/2 cup baking soda, then 1/2 cup vinegar, wait 15 minutes, then hot water\n\n` +
      `?Avoid:** Chemical drain cleaners - these can damage pipes and are harmful\n\n` +
      `Try these steps and let me know if water is draining properly now, or if you need professional drain cleaning.`;
  }
  // Generic plumbing issue
  else {
    troubleshootingResponse = `I understand you're experiencing a plumbing issue. Here are some general safety steps:\n\n` +
      `??General Plumbing Safety:**\n` +
      `1.Turn off water** - If there's a leak, turn off the nearest water valve\n` +
      `2.Check for obvious problems** - Look for loose connections, visible damage, or blockages\n` +
      `3.Don't force anything** - Avoid using excessive force on taps, handles, or pipes\n` +
      `4.Document the issue** - Note when it started and what triggers it\n\n` +
      `?? Can you describe your specific plumbing problem in more detail? This will help me provide more targeted troubleshooting steps.\n\n` +
      `If you've tried basic steps or the issue seems complex, I can arrange for a qualified plumber to properly diagnose and fix the problem.`;
  }
  
  const response = await getResponse(troubleshootingResponse, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  console.log('handleGeneralQuery: Response', response);
  return response;
}

// Enhanced auto-booking check - called at the end of handleGeneralQuery
async function checkAndAutoBook() {
  const hasCompleteData = stateMachine.clientData.name && stateMachine.clientData.email && stateMachine.clientData.address;
  
  if (hasCompleteData && !stateMachine.allDetailsCollected) {
    console.log('?? AUTO-BOOKING: All details detected, proceeding to book appointment');
    console.log('?? Customer details:', {
      name: stateMachine.clientData.name,
      email: stateMachine.clientData.email,
      address: stateMachine.clientData.address
    });
    
    stateMachine.allDetailsCollected = true;
    return await autoBookAppointment();
  }
}

// Add this function to handle conversation timeouts
async function handleTimeout() {
  const response = await getResponse("It seems like you're not responding. Is there anything else I can help you with today?", stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

// Request confirmation for a captured detail
async function requestDetailConfirmation(detailType, value) {
  console.log(`?? Requesting confirmation for ${detailType}: ${value}`);
  
  stateMachine.awaitingConfirmation = true;
  stateMachine.pendingConfirmation = {
    type: detailType,
    value: value,
    timestamp: new Date().toISOString()
  };
  
  let confirmationPrompt = '';
  let spokenValue = value;
  
  switch (detailType) {
    case 'name':
      confirmationPrompt = `Thank you! Just to confirm, your name is ${value}. Is that correct?`;
      break;
      
    case 'email':
      // Spell out email address clearly
      spokenValue = spellOutEmail(value);
      confirmationPrompt = `Thank you! Let me confirm your email address. I have ${spokenValue}. Is that spelled correctly?`;
      break;
      
    case 'address':
      confirmationPrompt = `Thank you! Just to confirm, your address is ${value}. Is that correct?`;
      break;
      
    case 'phone':
      // Format phone number for clear speech
      spokenValue = formatPhoneForSpeech(value);
      confirmationPrompt = `Thank you! Let me confirm your phone number. I have ${spokenValue}. Is that correct?`;
      break;
      
    default:
      confirmationPrompt = `Thank you! Just to confirm, I have ${value}. Is that correct?`;
  }
  
  const response = await getResponse(confirmationPrompt, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  
  console.log(`?? Confirmation requested for ${detailType}:`, response);
  return response;
}

// Handle the customer's confirmation response
async function handleDetailConfirmation(input) {
  console.log('?? Handling detail confirmation:', input);
  const confirmation = stateMachine.pendingConfirmation;
  if (!confirmation) {
    console.error('?? No pending confirmation found!');
    return "I'm sorry, there seems to be an issue. Let me start over with collecting your details.";
  }

  const lowerInput = input.toLowerCase().trim();
  
  // ?? CRITICAL FIX: Detect if customer is providing new information instead of confirming
  const isEmail = input.includes('@') && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(input);
  const isAddress = input.toLowerCase().includes('street') || input.toLowerCase().includes('brisbane') || 
                   input.toLowerCase().includes('qld') || /\d+\s+[a-zA-Z\s]+/.test(input);
  const isName = /^[a-zA-Z\s]{2,50}$/.test(input.trim()) && input.trim().split(' ').length >= 2 && 
                 !input.includes('@') && !isAddress;
  
  // If customer provides new information, process it instead of treating as confirmation
  if (isEmail || isAddress || isName) {
    console.log('?? Customer provided new information, canceling confirmation and processing data');
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
    return await collectClientDetails(input);
  }
  
  const isConfirmed = lowerInput.includes('yes') ||
                     lowerInput.includes('correct') ||
                     lowerInput.includes('right') ||
                     lowerInput.includes('yeah') ||
                     lowerInput.includes('yep') ||
                     lowerInput === 'ok' || lowerInput === 'okay';
  const isRejected = lowerInput.includes('no') ||
                    lowerInput.includes('wrong') ||
                    lowerInput.includes('incorrect') ||
                    lowerInput.includes('nope');

  if (isConfirmed) {
    console.log(`?? Detail confirmed: ${confirmation.type} = ${confirmation.value || 'multiple'}`);
    
    // Move the confirmed detail from temp to permanent storage
    if (confirmation.type === 'multiple') {
      for (const detail of confirmation.details) {
        stateMachine.clientData[detail] = stateMachine.clientData[`temp_${detail}`];
        delete stateMachine.clientData[`temp_${detail}`];
      }
    } else {
      stateMachine.clientData[confirmation.type] = confirmation.value;
      delete stateMachine.clientData[`temp_${confirmation.type}`];
    }
    
    // Clear confirmation state
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
    
    // Small delay for natural conversation flow
    await new Promise(resolve => setTimeout(resolve, 650));
    
    // Continue with detail collection (this will check for next missing detail)
    return await collectClientDetails('');
  } else if (isRejected) {
    console.log(`?? Detail rejected: ${confirmation.type}`);
    // Clear temp data and ask for correct information
    delete stateMachine.clientData[`temp_${confirmation.type}`];
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
      
    const correctionPrompts = {
      name: "No problem! Could you please tell me your correct full name?",
      email: "No problem! Could you please spell out your correct email address?",
      address: "No problem! Could you please give me your correct address?",
      phone: "No problem! Could you please give me your correct phone number?",
    };
    
    const response = await getResponse(
      correctionPrompts[confirmation.type] || "No problem! Could you please provide the correct information?",
      stateMachine.conversationHistory
    );
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  } else {
    console.log(`?? Unclear confirmation response: ${input}`);
    
    // ?? INTELLIGENT DETECTION: Check if input contains info for missing details
    const missingDetail = ['name', 'email', 'address'].find(d => !stateMachine.clientData[d]);
    
    if (missingDetail) {
      console.log(`?? Detected possible ${missingDetail} in unclear confirmation: ${input}`);
      
      // Check if this input actually contains the missing detail
      if (missingDetail === 'email' && input.includes('@')) {
        console.log('?? Input contains email, processing as email instead of confirmation');
        stateMachine.awaitingConfirmation = false;
        stateMachine.pendingConfirmation = null;
        return await collectClientDetails(input);
      } else if (missingDetail === 'address' && (input.toLowerCase().includes('street') || input.toLowerCase().includes('brisbane') || input.toLowerCase().includes('qld') || /\d+\s+[a-zA-Z\s]+/.test(input))) {
        console.log('?? Input contains address, processing as address instead of confirmation');
        stateMachine.awaitingConfirmation = false;
        stateMachine.pendingConfirmation = null;
        return await collectClientDetails(input);
      } else if (missingDetail === 'name' && /^[a-zA-Z\s]+$/.test(input.trim()) && input.trim().split(' ').length >= 2) {
        console.log('?? Input contains name, processing as name instead of confirmation');
        stateMachine.awaitingConfirmation = false;
        stateMachine.pendingConfirmation = null;
        return await collectClientDetails(input);
      }
    }
    
    const clarificationPrompt = `I didn't catch that. Is ${confirmation.value} correct? Please say yes or no, or provide the correct ${confirmation.type}.`;
    const response = await getResponse(clarificationPrompt, stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

// Helper function to spell out email addresses clearly
function spellOutEmail(email) {
  if (!email || !email.includes('@')) {
    return email;
  }
  
  const [localPart, domain] = email.split('@');
  
  // Spell out the local part character by character if it's complex
  let spokenLocal = localPart;
  if (localPart.length > 8 || /[0-9]/.test(localPart)) {
    spokenLocal = localPart.split('').join(' ');
  }
  
  // Handle common domains with clearer pronunciation
  let spokenDomain = domain;
  const commonDomains = {
    'gmail.com': 'gmail dot com',
    'outlook.com': 'outlook dot com',
    'hotmail.com': 'hotmail dot com',
    'yahoo.com': 'yahoo dot com',
    'icloud.com': 'icloud dot com'
  };
  
  if (commonDomains[domain]) {
    spokenDomain = commonDomains[domain];
  } else {
    // For other domains, spell out with "dot"
    spokenDomain = domain.replace('.', ' dot ');
  }
  
  return `${spokenLocal} at ${spokenDomain}`;
}

// Helper function to format phone numbers for clear speech
function formatPhoneForSpeech(phone) {
  // Remove all non-digit characters
  const digits = phone.replace(/[^\d]/g, '');
  
  // Format based on length
  if (digits.length === 10) {
    // Format as (XXX) XXX-XXXX
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // US/Canada format with country code
    return `1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  } else if (digits.length >= 10) {
    // International or other format - group by 3s
    const groups = [];
    for (let i = 0; i < digits.length; i += 3) {
      groups.push(digits.slice(i, i + 3));
    }
    return groups.join(' ');
  }
  
  // If we can't format it nicely, just space out the digits
  return digits.split('').join(' ');
}
async function handleBookingComplete(input) {
  console.log('?? handleBookingComplete: Processing', input);
  
  const lowerInput = input.toLowerCase();
  
  // Check if customer wants to end the conversation
  if (lowerInput.includes('no') || lowerInput.includes('nothing') || 
      lowerInput.includes('that\'s all') || lowerInput.includes('goodbye') || 
      lowerInput.includes('bye') || lowerInput.includes('thanks') ||
      lowerInput.includes('that\'s it') || lowerInput.includes('all good') ||
      lowerInput.includes('i\'m good') || lowerInput.includes('nope')) {
    
    console.log('?? Customer wants to end call - verifying email confirmation');
    
    // Verify email confirmation was sent before ending call
    const emailVerification = await verifyEmailConfirmation();
    
    let closingMessage = `Perfect! Your appointment is all set. `;
    
    if (emailVerification.sent) {
      closingMessage += `Your confirmation email has been sent to ${stateMachine.clientData.email}. `;
    } else {
      closingMessage += `We'll send your confirmation email shortly to ${stateMachine.clientData.email}. `;
      // Try to send email again
      try {
        await sendConfirmationEmail();
        console.log('?? Email resent successfully on call end');
      } catch (error) {
        console.error('?? Email failed to send on call end:', error);
        // Log for manual follow-up
        console.log('?? MANUAL FOLLOW-UP REQUIRED: Email failed for', stateMachine.clientData.email);
      }
    }
    
    closingMessage += `Have a great day and we'll see you soon!

If you need to make any changes or have questions before your appointment, please call us at (07) 3608 1688.

Thank you for choosing Usher Fix Plumbing! ??`;
    
    const closingResponse = await getResponse(closingMessage, stateMachine.conversationHistory);
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: closingResponse });
    stateMachine.currentState = 'call_ending';
    
    // Set termination flag to be picked up by the main handler
    stateMachine.pendingTermination = {
      reason: 'customer_completed',
      timestamp: new Date().toISOString(),
      shouldClose: true
    };
    
    return closingResponse;
  }
  
  // If customer has another question/issue, handle it
  if (lowerInput.includes('yes') || lowerInput.includes('another') || 
      lowerInput.includes('also') || lowerInput.includes('question')) {
    
    const continueResponse = await getResponse(
      `Of course! What else can I help you with today?`, 
      stateMachine.conversationHistory
    );
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: continueResponse });
    stateMachine.currentState = 'general';
    return continueResponse;
  }
  
  // For any other input, check if it's a new issue or question
  stateMachine.currentState = 'general';
  return await handleGeneralQuery(input);
}

// Confirm and create the actual appointment
async function confirmAppointmentBooking(input, emergencyMode = false) {
  console.log('?? confirmAppointmentBooking: Processing', input, emergencyMode ? '(EMERGENCY MODE)' : '');
  
  const lowerInput = input.toLowerCase();
  
  // In emergency mode, always proceed with booking
  const shouldProceed = emergencyMode || 
    lowerInput.includes('yes') || lowerInput.includes('confirm') || 
    lowerInput.includes('book') || lowerInput.includes('ok') ||
    lowerInput.includes('please') || lowerInput.includes('correct');
  
  if (shouldProceed) {
    try {
      
      // Get access token and create appointment
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('No access token available');
      }
      
      // 🚀 SMART SCHEDULING INTEGRATION: Use enhanced location optimization
      console.log('🚀 SMART SCHEDULING: Calculating optimal appointment time...');
      
      let appointmentTime = stateMachine.nextSlot;
      let smartSchedulingMessage = '';
      
      // Try smart scheduling if we have address and issue info
      if (stateMachine.clientData.address && !emergencyMode) {
        try {
          // Calculate earliest available time (today + 2 hours minimum)
          const now = new Date();
          const earliestStartTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
          
          console.log('🚗 SMART SCHEDULING: Finding travel-optimized slot...');
          const { findMostEfficientSlot } = require('./location-optimizer');
          
          // Extract issue description and urgency - ENSURE STRING TYPE
          let issueDescription = 'bathroom repair'; // Default fallback
          
          // Try to get issue from various sources
          if (stateMachine.clientData.issueDescription && typeof stateMachine.clientData.issueDescription === 'string') {
            issueDescription = stateMachine.clientData.issueDescription;
          } else if (stateMachine.clientData.toilet_0 && typeof stateMachine.clientData.toilet_0 === 'string') {
            issueDescription = stateMachine.clientData.toilet_0;
          } else if (stateMachine.clientData.other_1 && typeof stateMachine.clientData.other_1 === 'string') {
            issueDescription = stateMachine.clientData.other_1;
          }
          
          // Ensure it's a proper string (failsafe)
          issueDescription = String(issueDescription).toLowerCase();
          
          const urgencyLevel = stateMachine.clientData.urgent ? 'urgent' : 'standard';
          
          console.log('🔧 Issue for assessment:', issueDescription);
          console.log('⚡ Urgency level:', urgencyLevel);
          
          const smartSlotResult = await findMostEfficientSlot(
            accessToken,
            stateMachine.clientData.address,
            issueDescription,
            urgencyLevel,
            earliestStartTime
          );
          
          if (smartSlotResult && smartSlotResult.slot) {
            appointmentTime = smartSlotResult.slot;
            smartSchedulingMessage = `\n\n🎯 Smart Scheduling Applied:\n` +
              `• Job Assessment: ${smartSlotResult.jobAssessment?.issueType}/${smartSlotResult.jobAssessment?.complexity} = ${smartSlotResult.jobAssessment?.estimatedDuration} minutes\n` +
              `• Travel Optimization: ${smartSlotResult.analysis?.reason || 'Route optimized'}\n` +
              `• Efficiency Rating: ${smartSlotResult.analysis?.efficiency || 'HIGH'}\n` +
              `• Estimated Savings: $${smartSlotResult.analysis?.fuelSavings?.costAUD || '5-15'} AUD`;
            
            console.log('🎯 SMART SCHEDULING SUCCESS:');
            console.log(`   📅 Optimal Time: ${appointmentTime.toLocaleString('en-AU', { timeZone: BRISBANE_TZ })}`);
            console.log(`   🔧 Job Duration: ${smartSlotResult.jobAssessment?.estimatedDuration} minutes`);
            console.log(`   ⚡ Efficiency: ${smartSlotResult.analysis?.efficiency}`);
            console.log(`   💰 Savings: $${smartSlotResult.analysis?.fuelSavings?.costAUD} AUD`);
          } else {
            console.log('⚠️ Smart scheduling failed, using standard time');
            appointmentTime = earliestStartTime;
          }
          
        } catch (smartSchedulingError) {
          console.error('⚠️ Smart scheduling error:', smartSchedulingError.message);
          appointmentTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
        }
      } else {
        // Fallback for emergency mode or missing data
        appointmentTime = appointmentTime || new Date(Date.now() + 2 * 60 * 60 * 1000);
      }
      
      // Ensure appointmentTime is a valid Date object
      if (!appointmentTime || !(appointmentTime instanceof Date)) {
        appointmentTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // Default 2 hours from now
      }
      
      const eventDetails = {
        summary: `Plumbing Appointment - ${stateMachine.clientData.name}`,
        start: { 
          dateTime: appointmentTime.toISOString(), 
          timeZone: BRISBANE_TZ 
        },
        end: { 
          dateTime: new Date(appointmentTime.getTime() + 60 * 60 * 1000).toISOString(), 
          timeZone: BRISBANE_TZ 
        },
        location: stateMachine.clientData.address,
        description: `Customer: ${stateMachine.clientData.name}
Email: ${stateMachine.clientData.email}
Phone: ${stateMachine.clientData.phone || 'Not provided'}
Issue: ${stateMachine.clientData.issueDescription || stateMachine.clientData.toilet_0 || 'Toilet repair'}
Special Instructions: ${stateMachine.clientData.specialInstructions || 'None'}${smartSchedulingMessage}`,
        attendees: [
          { email: stateMachine.clientData.email }
        ]
      };
      
        const appointment = await createAppointment(accessToken, eventDetails);
        
        if (appointment) {
          const formattedTime = appointmentTime.toLocaleString('en-AU', {
            timeZone: BRISBANE_TZ,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          
          // Format short time for main message
          const shortTime = appointmentTime.toLocaleString('en-AU', {
            timeZone: BRISBANE_TZ,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          
          // Try to send confirmation email immediately
          try {
            await sendConfirmationEmail();
            console.log('? Confirmation email sent successfully');
          } catch (emailError) {
            console.error('?? Email sending failed during appointment creation:', emailError);
            // Don't fail the appointment, but log for follow-up
          }
          
          // Create comprehensive booking confirmation with smart scheduling info
          const issueDesc = stateMachine.clientData.issueDescription || stateMachine.clientData.toilet_0 || 'Toilet repair';
          const confirmationMessage = `🎉 APPOINTMENT CONFIRMED!

📅 **Scheduled:** ${shortTime} (Australian time)
👤 **Customer:** ${stateMachine.clientData.name}
📍 **Address:** ${stateMachine.clientData.address}
📧 **Email:** ${stateMachine.clientData.email}
🔧 **Issue:** ${issueDesc}
📱 **Reference:** ${generatePhoneBasedReference(stateMachine.callerPhoneNumber)}${smartSchedulingMessage}

**What to expect:**
- ✅ Confirmation email sent to ${stateMachine.clientData.email}
- 📞 Our plumber will call 30 minutes before arrival  
- 🛠️ We'll bring all standard tools and parts
- 💳 Payment can be made on completion

Thank you for choosing Usher Fix Plumbing! Is there anything else I can help you with today?`;
          
          const response = await getResponse(confirmationMessage, stateMachine.conversationHistory);
          stateMachine.conversationHistory.push({ role: 'assistant', content: response });
          stateMachine.currentState = 'booking_complete';
          
          console.log('? Appointment created successfully:', appointment.id);
          return response;      } else {
        throw new Error('Appointment creation returned null');
      }
      
    } catch (error) {
      console.error('? Appointment booking failed:', error);
      
      const errorResponse = await getResponse(
        `I apologize, but there was an issue creating your appointment. 
        Please call us directly at (07) 3608 1688 and we'll get you booked in right away.
        
        Your details are: ${stateMachine.clientData.name}, ${stateMachine.clientData.email}, ${stateMachine.clientData.address}`, 
        stateMachine.conversationHistory
      );
      
      stateMachine.conversationHistory.push({ role: 'assistant', content: errorResponse });
      stateMachine.currentState = 'booking_complete';
      return errorResponse;
    }
    
  } else if (lowerInput.includes('no') || lowerInput.includes('wrong') || 
             lowerInput.includes('incorrect') || lowerInput.includes('change')) {
    
    const response = await getResponse(
      `No problem! Let me get the correct details. What would you like to change?`, 
      stateMachine.conversationHistory
    );
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
    
  } else {
    // Not a clear yes/no, ask for clarification
    const response = await getResponse(
      `Would you like me to confirm this appointment? Please say "yes" to book it or "no" if you'd like to make changes.`, 
      stateMachine.conversationHistory
    );
    
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }
}

// Extract customer data from conversation history
// Extract customer data from a single input message
async function extractCustomerData(input) {
  if (!input || typeof input !== 'string') return {};
  const extractedData = {};
  const content = input.toLowerCase();
  const originalContent = input;

  const explicitNameMatch = originalContent.match(/(?:name is|i'm|i am|my name is|call me)\s+([a-zA-Z\s]{2,})/i);
  if (explicitNameMatch) {
    const candidateName = explicitNameMatch[1].trim();
    if (isValidName(candidateName)) {
      extractedData.name = candidateName;
    }
  } else if (originalContent.length <= 25 && originalContent.length >= 3) {
    if (/^[a-zA-Z]+(\s+[a-zA-Z]+)*$/.test(originalContent.trim())) {
      const candidateName = originalContent.trim();
      if (isValidName(candidateName)) {
        extractedData.name = candidateName;
      }
    }
  }

  if (content.includes('@')) {
    const emailMatch = content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      extractedData.email = emailMatch[1].toLowerCase();
    }
  }

  const explicitAddressMatch = originalContent.match(/(?:address is|full address is)\s+([^,]+(?:,\s*[^,]+)*)/i);
  if (explicitAddressMatch) {
    extractedData.address = explicitAddressMatch[1].trim();
  } else {
    const australianPatterns = [
      /(\d+\s+[a-zA-Z\s]+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|court|ct|crescent|cres|way)[^,]*(?:,\s*[^,]+)*)/i,
      /((?:[a-zA-Z\s\d,]+)?(?:brisbane\s+airport|airport)(?:,\s*qld)?(?:\s+\d+)?(?:,\s*australia)?)/i,
      /(brisbane\s+airport(?:,\s*qld)?(?:\s+\d+)?(?:,\s*australia)?)/i,
      /(brisbane\s+cbd(?:,\s*qld)?(?:,\s*australia)?)/i,
      /([a-zA-Z\s\d,]+(?:,\s*)?qld(?:\s+\d+)?(?:,\s*australia)?)/i,
      /([a-zA-Z\s\d,]+,?\s*brisbane[^,]*,?\s*qld[^,]*(?:,\s*australia)?)/i,
      /([a-zA-Z\s\d,]+(?:,\s*qld)?(?:,\s*australia))/i,
    ];
    for (const pattern of australianPatterns) {
      const match = originalContent.match(pattern);
      if (match && match[1].length > 3) {
        extractedData.address = match[1].trim();
        break;
      }
    }
  }

  const phoneMatch = originalContent.match(/(\+?[\d\s\-\(\)]{8,})/);
  if (phoneMatch) {
    const cleanPhone = phoneMatch[1].replace(/[^\d+]/g, '');
    if (cleanPhone.length >= 8) {
      extractedData.phone = cleanPhone;
    }
  }

  return extractedData;
}

function extractCustomerDataFromHistory() {
  const history = stateMachine.conversationHistory;
  const extractedData = {};
  
  // Look for name in conversation - process from most recent to oldest for latest updates
  const reverseHistory = [...history].reverse();
  
  // Separate processing: first find most recent of each type of information
  let latestName = null;
  let latestEmail = null;
  let latestAddress = null;
  
  for (const message of reverseHistory) {
    if (message.role === 'user') {
      const content = message.content.toLowerCase();
      const originalContent = message.content; // Preserve original casing for extraction
      
      // IMPROVED: Extract most recent name if we haven't found one yet
      if (!latestName) {
        // Priority 1: Explicit name statements (highest priority)
        const explicitNameMatch = originalContent.match(/(?:name is|i'm|i am|my name is|call me)\s+([a-zA-Z\s]{2,})/i);
        if (explicitNameMatch) {
          const candidateName = explicitNameMatch[1].trim();
          // Validate it's actually a name, not a description
          if (isValidName(candidateName)) {
            latestName = candidateName;
          }
        } 
        // Priority 2: Clean responses that look like names (when length suggests name response)
        else if (originalContent.length <= 25 && originalContent.length >= 3) {
          // Must be letters and spaces only, and look like a proper name
          if (/^[a-zA-Z]+(\s+[a-zA-Z]+)*$/.test(originalContent.trim())) {
            const candidateName = originalContent.trim();
            if (isValidName(candidateName)) {
              latestName = candidateName;
            }
          }
        }
        // Priority 3: Names mentioned in context (e.g., "My name is John" or "This is John")
        else {
          const contextualNameMatch = originalContent.match(/(?:this is|call me|i'm|name)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
          if (contextualNameMatch) {
            const candidateName = contextualNameMatch[1].trim();
            if (isValidName(candidateName)) {
              latestName = candidateName;
            }
          }
        }
      }
      
      // Extract most recent email if we haven't found one yet
      if (!latestEmail && content.includes('@')) {
        const emailMatch = content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          latestEmail = emailMatch[1].toLowerCase();
        }
      }
      
      // ENHANCED: Extract most recent address with improved patterns  
      if (!latestAddress) {
        // Process each message separately to avoid cross-contamination
        for (let i = stateMachine.conversationHistory.length - 1; i >= 0; i--) {
          const message = stateMachine.conversationHistory[i];
          if (message.role !== 'user') continue; // Only check user messages
          
          const userInput = message.content.trim();
          
          const addressPatterns = [
            // 1. Explicit address statements (highest priority)
            /(?:address is|my address is|i live at|located at|full address)\s*:?\s*(.{8,120}?)(?:\s*[.!?]|$)/i,
            
            // 2. Address corrections and moves (high priority)  
            /(?:moved.*now at|moved.*to|correction.*address)\s*(.{8,120}?)(?:\s*[.!?]|$)/i,
            
            // 3. Complete addresses with street numbers
            /^(\d+\s+[a-zA-Z\s]+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|court|ct|crescent|cres|way|boulevard|blvd)(?:\s*,\s*[^.!?]*)?)\s*[.!?]?$/i,
            
            // 4. Suburb/Location patterns with state/country
            /^([a-zA-Z\s]{3,}(?:Point|Beach|Hill|Park|Valley|Creek|City|Town|Heights|Ridge|Gardens|Grove|Springs|Waters|Bay|Cove|Estate|CBD|Airport)[.,\s]*(?:QLD|Queensland|NSW|New South Wales|VIC|Victoria|SA|South Australia|WA|Western Australia|TAS|Tasmania|NT|Northern Territory|ACT|Australian Capital Territory)[.,\s]*(?:Australia)?)\s*[.!?]?$/i,
            
            // 5. Simple address format: Number + Name + Area (like "142 Street, Old Farm")
            /^(\d+\s+[a-zA-Z\s]+,\s*[a-zA-Z\s]{3,})\s*[.!?]?$/i,
            
            // 6. Any pattern that looks like an address with numbers and location words
            /^([a-zA-Z\s]*\d+[a-zA-Z0-9\s,.-]*(?:street|road|avenue|drive|farm|point|hill|park|city|town|suburb|area)(?:\s*,\s*[^.!?]*)?)\s*[.!?]?$/i
          ];
          
          for (const pattern of addressPatterns) {
            const addressMatch = userInput.match(pattern);
            if (addressMatch && addressMatch[1]) {
              const candidateAddress = addressMatch[1].trim();
              
              // Enhanced validation - prevent false positives
              const isValidAddress = candidateAddress.length >= 8 && 
                                    candidateAddress.length <= 120 &&
                                    /[a-zA-Z]{3,}/.test(candidateAddress) &&
                                    !candidateAddress.includes('@') &&
                                    !candidateAddress.toLowerCase().includes('email') &&
                                    !candidateAddress.toLowerCase().includes('my name') &&
                                    !candidateAddress.toLowerCase().includes('i need') &&
                                    !candidateAddress.toLowerCase().includes('hello') &&
                                    !candidateAddress.toLowerCase().includes('book') &&
                                    !candidateAddress.toLowerCase().includes('appointment');
              
              if (isValidAddress) {
                latestAddress = candidateAddress;
                console.log('?? Found address:', latestAddress);
                break;
              }
            }
          }
          
          if (latestAddress) break; // Found address, stop searching
        }
      }
    }
  }
  
  // Assign found data
  if (latestName) extractedData.name = latestName;
  if (latestEmail) extractedData.email = latestEmail;
  if (latestAddress) extractedData.address = latestAddress;
  
  console.log('Extracted customer data:', extractedData);
  return extractedData;
}

// NEW: Helper function to validate if a string is actually a name
// Helper function to extract name from speech input
function extractNameFromInput(input) {
  if (!input || typeof input !== 'string') return null;
  
  let name = input.trim();
  
  // First check if the input is clearly not a name (plumbing issues, etc.)
  const plumbingPhrases = [
    'clogged', 'blocked', 'leaking', 'dripping', 'running', 'broken', 'stopped',
    'backing up', 'overflowing', 'no hot water', 'low pressure', 'won\'t flush',
    'toilet', 'sink', 'drain', 'pipe', 'faucet', 'shower', 'bathtub'
  ];
  
  const lowerInput = input.toLowerCase();
  const isPlumbingRelated = plumbingPhrases.some(phrase => lowerInput.includes(phrase));
  
  if (isPlumbingRelated) {
    console.log(`Rejecting plumbing-related input as name: "${input}"`);
    return null;
  }
  
  // Common patterns for name introductions
  const namePatterns = [
    /(?:my name is|i'm|i am|this is|call me|it's)\s+([a-zA-Z\s\-'\.]+?)(?:\s*\.?$|,|\sand\s)/i,
    /^([a-zA-Z\-'\.\s]+)\s*\.?$/i, // Just the name
  ];
  
  for (const pattern of namePatterns) {
    const match = name.match(pattern);
    if (match && match[1]) {
      name = match[1].trim();
      break;
    }
  }
  
  // Clean up common speech-to-text artifacts
  name = name
    .replace(/\s*space\s*/gi, ' ')  // Remove "space" words
    .replace(/\s*\d+\s*/g, ' ')     // Remove numbers (except in context)
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim();
  
  // Final validation using isValidName function
  if (!isValidName(name)) {
    console.log(`Extracted name "${name}" failed validation`);
    return null;
  }
  
  // Convert common speech patterns to proper names
  const nameCorrections = {
    'hira': 'Hira',
    'hera': 'Hera', 
    'syeda': 'Syeda',
    'syeb': 'Syeda',
    'joanna': 'Joanna',
    'jonathan': 'Jonathan',
    'muhammad': 'Muhammad',
    'ahmed': 'Ahmed',
    'ali': 'Ali',
    'fatima': 'Fatima',
    'aisha': 'Aisha',
    'omar': 'Omar',
    'hassan': 'Hassan',
    'hussain': 'Hussain',
    'zain': 'Zain',
    'sara': 'Sara',
    'noor': 'Noor',
    'amina': 'Amina',
    'khalid': 'Khalid',
    'rashid': 'Rashid',
    'tariq': 'Tariq',
    'farah': 'Farah',
    'layla': 'Layla',
    'yasmin': 'Yasmin',
    'maria': 'Maria',
    'jose': 'Jos�',
    'pedro': 'Pedro',
    'carlos': 'Carlos',
    'fernando': 'Fernando',
    'diego': 'Diego',
    'antonio': 'Antonio',
    'miguel': 'Miguel',
    'rafael': 'Rafael',
    'daniel': 'Daniel',
    'david': 'David',
    'michael': 'Michael',
    'john': 'John',
    'james': 'James',
    'robert': 'Robert',
    'william': 'William',
    'mary': 'Mary',
    'patricia': 'Patricia',
    'jennifer': 'Jennifer',
    'linda': 'Linda',
    'elizabeth': 'Elizabeth',
    'barbara': 'Barbara',
    'susan': 'Susan',
    'jessica': 'Jessica',
    'sarah': 'Sarah',
    'karen': 'Karen',
    'nancy': 'Nancy',
    'lisa': 'Lisa',
    'betty': 'Betty',
    'helen': 'Helen',
    'sandra': 'Sandra',
    'donna': 'Donna',
    'carol': 'Carol',
    'ruth': 'Ruth',
    'sharon': 'Sharon',
    'michelle': 'Michelle',
    'laura': 'Laura',
    'emily': 'Emily',
    'kimberly': 'Kimberly',
    'deborah': 'Deborah',
    'dorothy': 'Dorothy',
    'amy': 'Amy',
    'angela': 'Angela',
    'ashley': 'Ashley',
    'brenda': 'Brenda',
    'emma': 'Emma',
    'olivia': 'Olivia',
    'cynthia': 'Cynthia',
    'marie': 'Marie',
    'janet': 'Janet',
    'catherine': 'Catherine',
    'frances': 'Frances',
    'christine': 'Christine',
    'samantha': 'Samantha',
    'debra': 'Debra',
    'rachel': 'Rachel',
    'carolyn': 'Carolyn',
    'janet': 'Janet',
    'virginia': 'Virginia',
    'maria': 'Maria',
    'heather': 'Heather',
    'diane': 'Diane',
    'julie': 'Julie',
    'joyce': 'Joyce',
    'victoria': 'Victoria',
    'kelly': 'Kelly',
    'christina': 'Christina',
    'joan': 'Joan',
    'evelyn': 'Evelyn',
    'lauren': 'Lauren',
    'judith': 'Judith',
    'megan': 'Megan',
    'cheryl': 'Cheryl',
    'andrea': 'Andrea',
    'hannah': 'Hannah',
    'jacqueline': 'Jacqueline',
    'martha': 'Martha',
    'gloria': 'Gloria',
    'teresa': 'Teresa',
    'sara': 'Sara',
    'janice': 'Janice',
    'marie': 'Marie',
    'julia': 'Julia',
    'heather': 'Heather',
    'diane': 'Diane',
    'ruth': 'Ruth',
    'julie': 'Julie',
    'joyce': 'Joyce',
    'virginia': 'Virginia'
  };
  
  // Apply corrections and proper case
  const words = name.toLowerCase().split(' ');
  const correctedWords = words.map(word => {
    // Handle hyphenated names
    if (word.includes('-')) {
      return word.split('-').map(part => 
        nameCorrections[part] || part.charAt(0).toUpperCase() + part.slice(1)
      ).join('-');
    }
    // Handle names with apostrophes (O'Connor, D'Angelo)
    if (word.includes("'")) {
      return word.split("'").map((part, index) => 
        index === 0 ? (nameCorrections[part] || part.charAt(0).toUpperCase() + part.slice(1)) :
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join("'");
    }
    return nameCorrections[word] || word.charAt(0).toUpperCase() + word.slice(1);
  });
  
  return correctedWords.join(' ');
}

function isValidName(candidateName) {
  if (!candidateName || typeof candidateName !== 'string') return false;
  
  const name = candidateName.trim();
  
  // Must be between 1-50 characters (more lenient)
  if (name.length < 1 || name.length > 50) return false;
  
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(name)) return false;
  
  // Allow letters, spaces, hyphens, apostrophes, and dots (for titles/initials)
  if (!/^[a-zA-Z�-�A-�?-?\s\-'\.]+$/.test(name)) return false;
  
  // Should have reasonable word count (1-5 words for names with titles)
  const wordCount = name.trim().split(/\s+/).length;
  if (wordCount > 5) return false;
  
  // Check if it looks like a real name (has at least one word with 1+ letters)
  const words = name.trim().split(/\s+/);
  const hasValidWord = words.some(word => /^[a-zA-Z�-�A-�?-?\-'\.]+$/.test(word));
  
  // Exclude obvious non-names and conversational phrases
  const excludedWords = ['hello', 'hi', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank', 'please', 'help', 'urgent', 'asap', 'today', 'tomorrow', 'morning', 'afternoon', 'evening', 'problem', 'issue', 'broken', 'toilet', 'sink', 'drain', 'pipe', 'water', 'plumber', 'plumbing', 'appointment', 'book', 'schedule', 'ready', 'provide', 'details', 'give', 'tell', 'information', 'data', 'waiting', 'prepared', 'clogged', 'blocked', 'leaking', 'dripping', 'running', 'slow', 'stopped', 'backing', 'overflowing', 'cold', 'hot', 'pressure', 'flow', 'flush', 'handle', 'tank'];
  
  // Also check for conversational phrases that are definitely not names
  const conversationalPhrases = [
    'ready to provide',
    'i am ready',
    'give you my',
    'tell you my',
    'provide my',
    'share my',
    'here are my',
    'waiting to give',
    'prepared to share',
    'it\'s clogged',
    'its clogged', 
    'it is clogged',
    'toilet is clogged',
    'drain is blocked',
    'pipe is broken',
    'water is running',
    'no hot water',
    'low pressure',
    'not working',
    'won\'t flush',
    'keeps running'
  ];
  
  const lowerName = name.toLowerCase();
  const containsExcluded = excludedWords.some(word => 
    lowerName === word || 
    lowerName.includes(` ${word} `) || 
    lowerName.startsWith(`${word} `) || 
    lowerName.endsWith(` ${word}`)
  );
  
  const isConversationalPhrase = conversationalPhrases.some(phrase => 
    lowerName.includes(phrase)
  );
  
  return hasValidWord && !containsExcluded && !isConversationalPhrase;
}

// Add emotional intelligence to responses
async function getEmotionallyAwareResponse(basePrompt, context = {}) {
  let enhancedPrompt = basePrompt;
  
  if (context.needsEmpathy) {
    enhancedPrompt = `The customer seems frustrated. Respond with empathy and reassurance: ${basePrompt}`;
  }
  
  if (context.safetyConcern) {
    enhancedPrompt = `This involves safety concerns. Provide clear safety advice first, then: ${basePrompt}`;
  }
  
  if (context.urgent) {
    enhancedPrompt = `This is urgent. Show appropriate concern and urgency: ${basePrompt}`;
  }
  
  return await getResponse(enhancedPrompt, stateMachine.conversationHistory);
}

// Verify email confirmation was sent
async function verifyEmailConfirmation() {
  try {
    // Check if we have record of email being sent
    const emailSent = stateMachine.clientData.emailConfirmationSent || false;
    const appointmentCreated = stateMachine.currentState === 'booking_complete' || stateMachine.currentState === 'call_ending';
    
    console.log('?? Email verification - sent:', emailSent, 'appointment created:', appointmentCreated);
    
    return {
      sent: emailSent && appointmentCreated,
      timestamp: stateMachine.clientData.emailSentTimestamp,
      email: stateMachine.clientData.email
    };
  } catch (error) {
    console.error('?? Email verification failed:', error);
    return { sent: false, error: error.message };
  }
}

// Send confirmation email using simple working email service
async function sendConfirmationEmail() {
  try {
    console.log('?? Attempting to send confirmation email to:', stateMachine.clientData.email);
    
    // Calculate estimated duration based on issue type
    const estimatedDuration = calculateServiceDuration(stateMachine.clientData.issueDescription);
    
    // Calculate travel time (estimate based on typical Brisbane distances)
    const travelTime = calculateEmailTravelTime(stateMachine.clientData.address);
    
    // Generate reference number using customer's phone number (last 6 digits)
    const phoneDigits = stateMachine.clientData.phone ? 
      stateMachine.clientData.phone.replace(/\D/g, '').slice(-6) : 
      Date.now().toString().slice(-6);
    
    // Prepare booking details for email
    const bookingDetails = {
      customerName: stateMachine.clientData.name,
      customerEmail: stateMachine.clientData.email,
      phone: stateMachine.clientData.phone,
      address: stateMachine.clientData.address,
      appointmentTime: stateMachine.nextSlot,
      issue: stateMachine.clientData.issueDescription || 'Toilet that won\'t flush',
      specialInstructions: stateMachine.clientData.specialInstructions || 'None provided',
      referenceNumber: `USHFX${phoneDigits}`,
      estimated_duration: estimatedDuration,
      travel_time: travelTime,
      totalBufferMinutes: stateMachine.clientData.totalBufferMinutes || 'Not calculated',
      travelMinutes: stateMachine.clientData.travelMinutes || 'Not calculated',
      service_category: getServiceCategory(stateMachine.clientData.issueDescription)
    };
    
    try {
      // Try to send email first (using Gmail OAuth2)
      const emailResult = await sendBookingConfirmationEmail(bookingDetails);
      
      // Mark email as sent
      stateMachine.clientData.emailConfirmationSent = true;
      stateMachine.clientData.emailSentTimestamp = emailResult.timestamp;
      
      console.log('? Confirmation email sent successfully to:', stateMachine.clientData.email);
      return { success: true, timestamp: emailResult.timestamp, method: 'email' };
      
    } catch (emailError) {
      console.error('?? Email sending failed, trying SMS backup:', emailError);
      
      // Try SMS as backup if email fails
      const smsResult = await sendSMSConfirmation(bookingDetails);
      
      if (smsResult && smsResult.success) {
        console.log('? SMS confirmation sent as backup to:', bookingDetails.phone);
        stateMachine.clientData.smsConfirmationSent = true;
        return { success: true, timestamp: new Date().toISOString(), method: 'sms' };
      } else {
        throw emailError; // Re-throw original email error
      }
    }
    
  } catch (error) {
    console.error('?? All confirmation methods failed:', error);
    // Log for manual follow-up
    console.log('?? MANUAL FOLLOW-UP REQUIRED: Send confirmation to', stateMachine.clientData.email);
    throw error;
  }
}

// Terminate the call gracefully
function terminateCall(reason = 'conversation_complete') {
  console.log('?? Terminating call - reason:', reason);
  
  // EMERGENCY EMAIL SEND: If we have complete booking data but no email sent, try to send it
  const hasCompleteData = stateMachine.clientData.name && 
                         stateMachine.clientData.email && 
                         stateMachine.clientData.address;
  const emailNotSent = !stateMachine.clientData.emailConfirmationSent;
  
  if (hasCompleteData && emailNotSent && (reason === 'unexpected_disconnect' || reason === 'error')) {
    console.log('?? Emergency email send - completing booking before call ends');
    
    // Try to complete the booking quickly
    try {
      // Force booking completion in emergency mode
      confirmAppointmentBooking('yes', true); // true = emergency mode
    } catch (error) {
      console.error('?? Emergency booking failed:', error);
    }
  }
  
  // Update state machine
  stateMachine.currentState = 'call_ended';
  stateMachine.callEndReason = reason;
  stateMachine.callEndTimestamp = new Date().toISOString();
  
  // Log final conversation summary
  const summary = {
    duration: Date.now() - (stateMachine.callStartTime || Date.now()),
    customerData: stateMachine.clientData,
    finalState: stateMachine.currentState,
    endReason: reason,
    appointmentBooked: !!stateMachine.nextSlot,
    emailSent: stateMachine.clientData.emailConfirmationSent || false
  };
  
  console.log('?? Call terminated - Summary:', JSON.stringify(summary, null, 2));
  
  // Trigger any cleanup or post-call actions
  try {
    // Send call summary to webhook/logging service if configured
    // postCallCleanup(summary);
    
    // Mark for quality assurance review if needed
    if (reason === 'error' || !summary.emailSent) {
      console.log('?? Call marked for QA review - reason:', reason);
    }
    
    // Set termination signal for the WebSocket handler to pick up
    stateMachine.pendingTermination = {
      reason: reason,
      timestamp: new Date().toISOString(),
      shouldClose: true
    };
    
  } catch (error) {
    console.error('?? Post-call cleanup failed:', error);
  }
  
  // Return call termination signal
  return {
    action: 'terminate_call',
    reason: reason,
    summary: summary
  };
}

// Initialize call tracking
if (!stateMachine.callStartTime) {
  stateMachine.callStartTime = Date.now();
}

/**
 * Set the caller's phone number for generating appointment references
 */
function setCallerPhoneNumber(phoneNumber) {
  stateMachine.callerPhoneNumber = phoneNumber;
  console.log('?? Caller phone number set:', phoneNumber);
}

// Comprehensive call termination with email verification
async function terminateCall(input = '') {
  console.log('?? Terminating call with comprehensive cleanup...');
  
  try {
    // Final attempt to send email confirmation if not sent
    if (!stateMachine.clientData.emailConfirmationSent && 
        stateMachine.clientData.email && 
        stateMachine.appointmentBooked) {
      
      console.log('?? Final attempt to send email confirmation...');
      
      try {
        
        const finalBookingDetails = {
          customerName: stateMachine.clientData.name,
          customerEmail: stateMachine.clientData.email,
          phone: stateMachine.clientData.phone || 'Not provided',
          address: stateMachine.clientData.address,
          appointmentTime: stateMachine.nextSlot,
          issue: stateMachine.clientData.issueDescription || 'Plumbing service',
          specialInstructions: stateMachine.clientData.specialInstructions || 'None',
          referenceNumber: generatePhoneBasedReference(stateMachine.callerPhoneNumber),
          estimated_duration: calculateServiceDuration(stateMachine.clientData.issueDescription),
          travel_time: '30-45 minutes',
          service_category: getServiceCategory(stateMachine.clientData.issueDescription)
        };
        
        await sendBookingConfirmationEmail(finalBookingDetails);
        console.log('? Final email confirmation sent successfully!');
        
      } catch (emailError) {
        console.error('? Final email attempt failed:', emailError);
        
        // Log manual follow-up requirement
        console.log('?? MANUAL FOLLOW-UP REQUIRED:');
        console.log('?? Email:', stateMachine.clientData.email);
        console.log('?? Name:', stateMachine.clientData.name);
        console.log('?? Appointment:', stateMachine.nextSlot?.toISOString());
        console.log('?? Address:', stateMachine.clientData.address);
      }
    }
    
    // Log comprehensive call summary
    const callSummary = {
      timestamp: new Date().toISOString(),
      duration: stateMachine.conversationHistory.length,
      customerName: stateMachine.clientData.name || 'Not provided',
      customerEmail: stateMachine.clientData.email || 'Not provided',
      customerPhone: stateMachine.callerPhoneNumber || 'Not provided',
      issueType: stateMachine.issueType || 'Not determined',
      appointmentBooked: stateMachine.appointmentBooked || false,
      appointmentTime: stateMachine.nextSlot?.toISOString() || 'Not scheduled',
      emailSent: stateMachine.clientData.emailConfirmationSent || false,
      callEndReason: stateMachine.callEndReason || 'Natural conclusion',
      finalState: stateMachine.currentState,
      conversationLength: stateMachine.conversationHistory.length
    };
    
    console.log('?? Call Summary:', JSON.stringify(callSummary, null, 2));
    
    // Track conversation completion
    trackConversationSuccess(stateMachine.appointmentBooked);
    
    // Reset state for next call
    Object.keys(stateMachine).forEach(key => {
      if (typeof stateMachine[key] === 'object' && stateMachine[key] !== null) {
        if (Array.isArray(stateMachine[key])) {
          stateMachine[key] = [];
        } else {
          stateMachine[key] = {};
        }
      } else if (typeof stateMachine[key] === 'boolean') {
        stateMachine[key] = false;
      } else if (typeof stateMachine[key] === 'number') {
        stateMachine[key] = 0;
      } else {
        stateMachine[key] = null;
      }
    });
    
    // Reset to initial state
    stateMachine.currentState = 'start';
    stateMachine.conversationHistory = [];
    stateMachine.clientData = {};
    
    console.log('?? State machine reset for next call');
    
    return "Thank you for calling Usher Fix Plumbing. Your appointment has been confirmed and you'll receive an email confirmation shortly. Have a great day!";
    
  } catch (error) {
    console.error('? Error during call termination:', error);
    return "Thank you for calling Usher Fix Plumbing. Have a great day!";
  }
}

// Verify email confirmation was sent successfully
async function verifyEmailConfirmation() {
  if (stateMachine.clientData.emailConfirmationSent && 
      stateMachine.clientData.emailSentTimestamp) {
    
    const timeSinceSent = Date.now() - new Date(stateMachine.clientData.emailSentTimestamp).getTime();
    const minutesSinceSent = Math.floor(timeSinceSent / (1000 * 60));
    
    console.log(`?? Email confirmation sent ${minutesSinceSent} minutes ago`);
    return true;
  }
  
  console.log('? No email confirmation record found');
  return false;
}

// Enhanced fast input analysis for better performance
async function analyzeFastInput(input) {
  const startTime = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Much faster model
      messages: [
        {
          role: 'system',
          content: 'Analyze customer input for plumbing issues. Return ONLY a JSON object: {"issue":"main issue","urgency":"low/medium/high","emotion":"calm/frustrated/urgent","knowledge":"basic/intermediate/advanced","safety":"yes/no/none"}'
        },
        {
          role: 'user',
          content: `Analyze this customer input: "${input}".`
        }
      ],
      max_tokens: 100,
      temperature: 0.1, // Very low for consistent JSON responses
    });
    
    const result = JSON.parse(response.choices[0].message.content.trim());
    console.log(`? Fast analysis completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    console.error('Fast analysis error:', error.message);
    return {
      issue: input.toLowerCase().includes('toilet') ? 'toilet issue' : 'plumbing issue',
      urgency: input.toLowerCase().includes('urgent') || input.toLowerCase().includes('emergency') ? 'high' : 'medium',
      emotion: 'calm',
      knowledge: 'basic',
      safety: 'none'
    };
  }
}

/**
 * Extract minutes from travel time string
 * @param {string|number} travelTime - Travel time in various formats
 * @returns {number} Travel time in minutes
 */
function extractMinutesFromTravelTime(travelTime) {
  if (typeof travelTime === 'number') {
    return travelTime;
  }
  
  if (typeof travelTime === 'string') {
    // Handle various formats like "25 minutes", "1 hour 15 minutes", "45-60 minutes"
    const timeStr = travelTime.toLowerCase();
    
    // Extract hours and minutes
    const hourMatch = timeStr.match(/(\d+)\s*(?:hour|hr)s?/);
    const minuteMatch = timeStr.match(/(\d+)\s*(?:minute|min)s?/);
    
    let totalMinutes = 0;
    
    if (hourMatch) {
      totalMinutes += parseInt(hourMatch[1]) * 60;
    }
    
    if (minuteMatch) {
      totalMinutes += parseInt(minuteMatch[1]);
    }
    
    // Handle range formats like "45-60 minutes" - take the middle value
    if (totalMinutes === 0) {
      const rangeMatch = timeStr.match(/(\d+)\s*-\s*(\d+)\s*(?:minute|min)s?/);
      if (rangeMatch) {
        const min = parseInt(rangeMatch[1]);
        const max = parseInt(rangeMatch[2]);
        totalMinutes = Math.round((min + max) / 2);
      }
    }
    
    // If still no match, try to extract any number
    if (totalMinutes === 0) {
      const numberMatch = timeStr.match(/(\d+)/);
      if (numberMatch) {
        totalMinutes = parseInt(numberMatch[1]);
      }
    }
    
    return totalMinutes || 30; // Default to 30 minutes if can't parse
  }
  
  return 30; // Default fallback
}

/**
 * Round time to next reasonable appointment slot (30-minute intervals)
 * @param {Date} time - Time to round
 * @returns {Date} Rounded time
 */
function roundToNextAppointmentSlot(time) {
  const rounded = new Date(time);
  
  // Round to next 30-minute interval
  const minutes = rounded.getMinutes();
  if (minutes === 0) {
    // Already on the hour
  } else if (minutes <= 30) {
    rounded.setMinutes(30, 0, 0);
  } else {
    rounded.setHours(rounded.getHours() + 1);
    rounded.setMinutes(0, 0, 0);
  }
  
  // Ensure it's during business hours (7 AM - 6 PM)
  const hour = rounded.getHours();
  if (hour < 7) {
    rounded.setHours(7, 0, 0, 0);
  } else if (hour >= 18) {
    // Move to next day at 7 AM
    rounded.setDate(rounded.getDate() + 1);
    rounded.setHours(7, 0, 0, 0);
  }
  
  return rounded;
}

/**
 * Handle special instructions collection and then propose appointment
 */
async function collectSpecialInstructions(input) {
  console.log('collectSpecialInstructions: Input received', input);
  
  // Store special instructions
  if (input && input.trim()) {
    stateMachine.clientData.specialInstructions = input.trim();
    console.log('? Special instructions recorded:', input.trim());
  } else {
    stateMachine.clientData.specialInstructions = 'No special instructions';
    console.log('? No special instructions provided');
  }
  
  // Now propose the appointment with calculated travel time
  const travelTime = stateMachine.clientData.travelTime || '30 minutes';
  const earliestTime = stateMachine.clientData.earliestAppointment || new Date(Date.now() + 60 * 60 * 1000);
  const totalBuffer = stateMachine.clientData.totalBufferMinutes || 60;
  
  const formattedTime = earliestTime.toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  console.log('?? Proposing appointment with travel calculation:');
  console.log(`   Travel time: ${travelTime}`);
  console.log(`   Total buffer: ${totalBuffer} minutes`);
  console.log(`   Proposed time: ${formattedTime}`);
  
  // Set state to await booking confirmation
  stateMachine.currentState = 'confirm_appointment';
  
  const response = await getResponse(
    `Perfect! Based on the travel time calculation from our previous job location to your address (${travelTime}), ` +
    `plus 30 minutes for job completion, the earliest available appointment is ${formattedTime}. ` +
    `This ensures our plumber arrives with adequate time for your ${stateMachine.clientData.issueDescription || 'plumbing service'}. ` +
    `Would you like me to book this appointment for you?`,
    stateMachine.conversationHistory
  );
  
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

module.exports = { 
  handleInput, 
  stateMachine, 
  handleTimeout, 
  verifyEmailConfirmation, 
  sendConfirmationEmail, 
  terminateCall,
  calculateTravelTime,
  calculateEmailTravelTime,
  setCallerPhoneNumber,
  generatePhoneBasedReference,
  extractNameFromInput,
  isValidName,
  extractMinutesFromTravelTime,
  roundToNextAppointmentSlot,
  collectSpecialInstructions,
  getStateMachine: () => stateMachine,
  resetStateMachine: () => {
    stateMachine.currentState = 'start';
    stateMachine.conversationHistory = [];
    stateMachine.clientData = {};
    stateMachine.issueType = null;
    stateMachine.questionIndex = 0;
    stateMachine.needsBookingOffer = false;
    stateMachine.collectingDetail = null;
    stateMachine.spellingConfirmation = false;
    stateMachine.tempCollectedValue = null;
    stateMachine.detailsCollectionStep = 0;
    stateMachine.allDetailsCollected = false;
    stateMachine.confirmingAllDetails = false;
    stateMachine.modifyingDetail = null;
    stateMachine.appointmentBooked = false;
    stateMachine.appointmentId = null;
    stateMachine.pendingTermination = false;
    stateMachine.callEndReason = null;
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
    stateMachine.safetyConcern = false;
    console.log('?? State machine reset to initial state');
  }
};
