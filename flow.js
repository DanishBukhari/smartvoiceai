// flow.js - Restructured Smart Voice AI Flow
// Modular conversation flow system for Assure Fix Plumbing
const { validateAndCorrectInput, getQuickResponse } = require('./modules/inputValidation');
const { detectEmergency } = require('./modules/issueClassification');
const { stateMachine, transitionTo, addToHistory, resetStateMachine, setCallerPhoneNumber } = require('./modules/stateMachine');
const { 
  handleStart, 
  askNextQuestion, 
  handleGeneralQuery, 
  handleBookingComplete 
} = require('./modules/conversationHandlers');
const enhancedBookingFlow = require('./modules/enhancedBookingFlow');
const travelOptimization = require('./modules/travelOptimization');
const { notifyError } = require('./notifications');

/**
 * Check if input is a simple greeting or response vs complex issue description
 */
function isSimpleGreetingOrResponse(input) {
  const simple = input.trim().toLowerCase();
  
  // Single word responses
  if (simple.split(' ').length <= 2) {
    return true;
  }
  
  // Pure greetings
  const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'];
  if (greetings.some(greeting => simple === greeting)) {
    return true;
  }
  
  // Simple yes/no responses
  if (['yes', 'no', 'okay', 'ok', 'sure', 'yeah', 'nope'].includes(simple)) {
    return true;
  }
  
  // Complex issue descriptions (don't use quick response)
  if (simple.includes('issue') || simple.includes('problem') || simple.includes('broken') ||
      simple.includes('have a') || simple.includes('my ') || simple.length > 20) {
    return false;
  }
  
  return true;
}

// Global caches for performance optimization
const responseCache = new Map();
const conversationInsights = {
  commonIssues: new Map(),
  customerPreferences: new Map(),
  successfulPhrases: new Map()
};

// Analytics tracking
const botAnalytics = {
  totalConversations: 0,
  successfulBookings: 0,
  averageResponseTime: 0,
  commonIssues: new Map()
};

/**
 * Main conversation handler - processes all customer inputs
 * Follows the structured flow: Start → Issue Detection → Technical Diagnosis → Booking → Confirmation
 */
async function handleInput(input, confidence = 1.0) {
  console.log('🎯 === CONVERSATION FLOW START ===');
  console.log('📞 Input:', input);
  console.log('🎚️ Confidence:', confidence);
  console.log('🔄 Current State:', stateMachine.currentState);
  console.log('📊 Client Data:', Object.keys(stateMachine.clientData));
  
  // STEP 1: Enhanced speech recognition with context
  if (input && typeof input === 'string') {
    const { enhanceSpeechRecognition, getConversationContext } = require('./modules/speechRecognitionEnhancer');
    const context = getConversationContext(stateMachine);
    input = enhanceSpeechRecognition(input, context);
    console.log('✅ Enhanced input:', input);
  }
  
  // STEP 2: Confidence and completeness check
  if (!input || input.trim().length === 0 || confidence < 0.3) {
    if (confidence < 0.3) {
      return "Sorry, I didn't quite catch that. Could you please speak a bit more clearly?";
    }
    return "Go on...";
  }
  
  // STEP 3: Quick response check for simple greetings only (not complex issue descriptions)
  const quickResponse = getQuickResponse(input);
  if (quickResponse && stateMachine.currentState === 'start' && isSimpleGreetingOrResponse(input)) {
    console.log('⚡ Using quick response for simple greeting');
    transitionTo('general', 'quick response triggered');
    addToHistory('user', input);
    addToHistory('assistant', quickResponse);
    return quickResponse;
  }
  
  // STEP 4: Handle incomplete sentences
  if (input.endsWith(',') || input.endsWith(' the') || input.endsWith(' a') || 
      input.endsWith(' an') || input.endsWith(' to') || input.endsWith(' for')) {
    return "Go on, I'm listening...";
  }
  
  // STEP 5: Store user input for context
  addToHistory('user', input);
  
  try {
    let response;
    
    // PRIORITY 1: Handle pending termination
    if (stateMachine.pendingTermination) {
      console.log('🔚 Processing call termination');
      return await terminateCall(input);
    }
    
    // PRIORITY 2: Handle confirmation flows
    if (stateMachine.awaitingConfirmation) {
      console.log('⏳ Processing detail confirmation');
      return await handleDetailConfirmation(input);
    }
    
    // PRIORITY 3: Emergency detection (highest priority) - but not if booking is complete
    if (detectEmergency(input) && stateMachine.currentState !== 'urgent_booking' && stateMachine.currentState !== 'booking_complete') {
      console.log('🚨 EMERGENCY DETECTED - redirecting to urgent flow');
      stateMachine.urgent = true;
      stateMachine.safetyConcern = true;
      transitionTo('urgent_booking', 'emergency detected');
      const { handleUrgentBooking } = require('./modules/conversationHandlers');
      response = await handleUrgentBooking(input);
    }
    // PRIORITY 4: Main conversation flow router
    else {
      switch (stateMachine.currentState) {
        case 'start':
          response = await handleStart(input);
          break;
          
        // Issue diagnosis states
        case 'hot water system':
        case 'toilet':
        case 'sink/tap':
        case 'burst/leak':
        case 'rain-pump':
        case 'roof leak':
        case 'new install/quote':
        case 'other':
          response = await askNextQuestion(input);
          break;
          
        // Booking flow states
        case 'ask_booking':
          const { handleBookingRequest } = require('./modules/enhancedBookingFlow');
          response = await handleBookingRequest(input);
          break;
          
        case 'collect_details':
          const { handleDetailCollection } = require('./modules/enhancedBookingFlow');
          response = await handleDetailCollection(input);
          break;
          
        case 'book_appointment':
          const { proceedToBooking } = require('./modules/enhancedBookingFlow');
          response = await proceedToBooking();
          break;
          
        case 'confirm_slot':
          response = await confirmSlot(input);
          break;
          
        case 'collect_special_instructions':
          response = await collectSpecialInstructions(input);
          break;
          
        case 'collect_time_preference':
          response = await collectTimePreference(input);
          break;
          
        case 'confirm_time_slot':
          response = await confirmTimeSlot(input);
          break;
          
        // Post-booking states
        case 'booking_complete':
          response = await handleBookingComplete(input);
          break;
          
        // Emergency and general handling
        case 'urgent_booking':
          const { handleUrgentBooking } = require('./modules/conversationHandlers');
          response = await handleUrgentBooking(input);
          break;
          
        case 'general':
          response = await handleGeneralQuery(input);
          break;
          
        default:
          console.log('❓ Unknown state, attempting recovery...');
          response = await handleUnknownState(input);
          break;
      }
    }
    
    // STEP 6: Store assistant response and update analytics
    if (response) {
      addToHistory('assistant', response);
      updateAnalytics(input, response);
    }
    
    console.log('🎯 === CONVERSATION FLOW END ===');
    console.log('💬 Response:', response);
    console.log('🔄 New State:', stateMachine.currentState);
    console.log('📏 Conversation Length:', stateMachine.conversationHistory.length);
    
    return response;
    
  } catch (error) {
    console.error('🚨 HandleInput error:', error);
    return await handleErrorWithRecovery(input, error);
  }
}

/**
 * Handle unknown state with intelligent recovery
 */
async function handleUnknownState(input) {
  console.log('🔧 Analyzing input for intelligent state recovery...');
  
  try {
    const { analyzeFastInput } = require('./modules/issueClassification');
    const analysis = await analyzeFastInput(input);
    
    // Route based on detected intent
    if (analysis.issue?.includes('toilet')) {
      console.log('🚽 Toilet issue detected');
      stateMachine.issueType = 'toilet';
      transitionTo('toilet', 'recovery - toilet detected');
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    if (analysis.issue?.includes('sink') || analysis.issue?.includes('tap') || analysis.issue?.includes('faucet')) {
      console.log('🚿 Sink/tap issue detected');
      stateMachine.issueType = 'sink/tap';
      transitionTo('sink/tap', 'recovery - sink/tap detected');
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    if (analysis.issue?.includes('water')) {
      console.log('🔥 Hot water issue detected');
      stateMachine.issueType = 'hot water system';
      transitionTo('hot water system', 'recovery - hot water detected');
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    if (analysis.issue?.includes('leak')) {
      console.log('💧 Leak/burst issue detected');
      stateMachine.issueType = 'burst/leak';
      transitionTo('burst/leak', 'recovery - leak detected');
      stateMachine.questionIndex = 0;
      return await askNextQuestion('');
    }
    
    // Fallback to general handling
    console.log('🔄 Routing to general handling');
    transitionTo('general', 'recovery fallback');
    return await handleGeneralQuery(input);
    
  } catch (recoveryError) {
    console.error('Recovery analysis failed:', recoveryError);
    
    // Final fallback with pattern matching
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('toilet') || lowerInput.includes('bathroom')) {
      transitionTo('toilet', 'pattern match - toilet');
      return "I understand you have a toilet issue. What's happening with your toilet?";
    }
    
    if (lowerInput.includes('sink') || lowerInput.includes('tap') || lowerInput.includes('faucet')) {
      transitionTo('sink/tap', 'pattern match - sink/tap');
      return "I see you have a sink or tap issue. What's the problem - is it leaking, blocked, or no water coming out?";
    }
    
    if (lowerInput.includes('hot water') || lowerInput.includes('water heater')) {
      transitionTo('hot water system', 'pattern match - hot water');
      return "I see you have a hot water issue. Do you have any hot water at all?";
    }
    
    if (lowerInput.includes('book') || lowerInput.includes('appointment')) {
      const { handleBookingRequest } = require('./modules/enhancedBookingFlow');
      transitionTo('ask_booking', 'pattern match - booking');
      return "I'd be happy to help you book an appointment. Could you first tell me what plumbing issue you need assistance with?";
    }
    
    // Ultimate fallback
    transitionTo('general', 'ultimate fallback');
    return "I'm here to help with your plumbing needs. Could you tell me what issue you're experiencing?";
  }
}

/**
 * Handle detail confirmation flows
 */
async function handleDetailConfirmation(input) {
  const lowerInput = input.toLowerCase();
  
  if (lowerInput.includes('yes') || lowerInput.includes('correct') || lowerInput.includes('right')) {
    stateMachine.awaitingConfirmation = false;
    
    if (stateMachine.pendingConfirmation) {
      const { detail, value } = stateMachine.pendingConfirmation;
      stateMachine.clientData[detail] = value;
      stateMachine.pendingConfirmation = null;
      
      // Continue with next step
      const { handleDetailCollection } = require('./modules/enhancedBookingFlow');
      return await handleDetailCollection('');
    }
  } else {
    stateMachine.awaitingConfirmation = false;
    stateMachine.pendingConfirmation = null;
    return "No problem, let's try that again. What's the correct information?";
  }
}

/**
 * Handle call termination
 */
async function terminateCall(input) {
  console.log('🔚 Terminating call...');
  
  const { reason, shouldClose } = stateMachine.pendingTermination;
  
  if (shouldClose) {
    // Track conversation success
    trackConversationSuccess(stateMachine.appointmentBooked);
    
    // Reset state machine for next call
    resetStateMachine();
    
    return "Thank you for calling Assure Fix Plumbing. Have a great day!";
  }
  
  return "Is there anything else I can help you with today?";
}

/**
 * Error handling with recovery
 */
async function handleErrorWithRecovery(input, error) {
  console.error('🚨 Error in conversation flow:', error);
  
  await notifyError(error, 'handleInput', {
    input,
    state: stateMachine.currentState,
    clientData: stateMachine.clientData
  });
  
  // Attempt graceful recovery
  if (stateMachine.currentState === 'start') {
    return "I'm having a technical issue. Let me help you with your plumbing needs. What issue are you experiencing?";
  } else if (stateMachine.appointmentBooked) {
    return "I experienced a brief technical issue, but your appointment is confirmed. Is there anything else I can help you with?";
  } else {
    return "I apologize for the technical issue. Let me try to help you again. What plumbing issue do you need assistance with?";
  }
}

/**
 * Update conversation analytics
 */
function updateAnalytics(input, response) {
  botAnalytics.totalConversations++;
  
  // Track common issues
  const issueWords = ['toilet', 'sink', 'leak', 'hot water', 'drain', 'tap'];
  for (const word of issueWords) {
    if (input.toLowerCase().includes(word)) {
      botAnalytics.commonIssues.set(word, (botAnalytics.commonIssues.get(word) || 0) + 1);
    }
  }
}

/**
 * Track conversation success rates
 */
function trackConversationSuccess(successful) {
  if (successful) {
    botAnalytics.successfulBookings++;
  }
  
  const successRate = (botAnalytics.successfulBookings / botAnalytics.totalConversations) * 100;
  console.log(`📊 Bot Success Rate: ${successRate.toFixed(1)}%`);
}

/**
 * Handle timeout scenarios
 */
async function handleTimeout() {
  console.log('⏰ Handling conversation timeout');
  
  if (stateMachine.appointmentBooked) {
    return "Your appointment is confirmed. You'll receive an email confirmation shortly. Thank you for choosing Assure Fix Plumbing!";
  } else if (Object.keys(stateMachine.clientData).length > 0) {
    return "I notice we were in the middle of scheduling your appointment. Someone will call you back within the hour to complete your booking. Thank you for your patience.";
  } else {
    return "Thank you for calling Assure Fix Plumbing. Please call back anytime for your plumbing needs!";
  }
}

/**
 * Collect time preference from customer
 */
async function collectTimePreference(input) {
  console.log('⏰ Collecting time preference:', input);
  
  // Store the time preference
  if (!stateMachine.customerData) stateMachine.customerData = {};
  stateMachine.customerData.timePreference = input;
  
  console.log('⏰ Time preference recorded:', stateMachine.customerData.timePreference);
  
  // Find available slots based on customer preference
  const { findAvailableSlots } = require('./modules/timePreferenceHandler');
  
  try {
    const result = await findAvailableSlots(input, stateMachine.customerData);
    
    // Check if we need clarification first
    if (result.needsClarification) {
      console.log('❓ Need clarification for vague preference');
      return "I'd like to find the best time for you. Could you be more specific? For example, would you prefer morning (9am-12pm), afternoon (12pm-5pm), or evening (5pm-8pm)? And would today, tomorrow, or later this week work better?";
    }
    
    const availableSlots = result.slots || result; // Handle both new and old format
    
    if (availableSlots && availableSlots.length > 0) {
      // Offer the best available slot
      const recommendedSlot = availableSlots[0];
      
      // Store the recommended slot for confirmation
      stateMachine.recommendedSlot = recommendedSlot;
      transitionTo('confirm_time_slot');
      
      const appointmentTime = new Date(recommendedSlot.start).toLocaleString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Brisbane',
        hour12: true
      });
      
      return `Perfect! Based on your preference, the earliest available time is ${appointmentTime}. Does that work for you, or would you prefer a different time?`;
    } else {
      // No slots available, ask for alternative preference
      transitionTo('collect_time_preference');
      return "I don't have any availability for that time. Would you prefer a morning or evening appointment? I can also check tomorrow or later this week.";
    }
  } catch (error) {
    console.error('Error finding available slots:', error);
    // Fallback to manual scheduling
    transitionTo('manual_scheduling');
    return "Let me check our schedule manually. What specific day and time would work best for you, and I'll see what we have available?";
  }
}

/**
 * Confirm time slot with customer
 */
async function confirmTimeSlot(input) {
  console.log('✅ Confirming time slot:', input);
  
  const confirmationWords = ['yes', 'yeah', 'okay', 'ok', 'sure', 'perfect', 'good', 'fine', 'works', 'confirm', 'alright', 'great', 'sounds good'];
  const rejectionWords = ['no', 'not', 'different', 'another', 'else'];
  
  const inputLower = input.toLowerCase().trim();
  
  // CRITICAL FIX: Check if customer is giving a new time preference instead of confirming/rejecting
  const isGivingNewPreference = inputLower.includes('prefer') || 
                               inputLower.includes('tomorrow') || 
                               inputLower.includes('morning') || 
                               inputLower.includes('afternoon') || 
                               inputLower.includes('evening') ||
                               inputLower.includes('later') ||
                               inputLower.includes('earlier');
  
  // If they're giving a new preference, treat it as such rather than rejection
  if (isGivingNewPreference && !confirmationWords.some(word => inputLower.includes(word))) {
    console.log('🔄 Customer provided new time preference, redirecting to time collection');
    transitionTo('collect_time_preference');
    return await collectTimePreference(input);
  }
  
  // CRITICAL FIX: Better confirmation detection
  const isConfirming = confirmationWords.some(word => inputLower.includes(word)) || 
                      inputLower === 'alright' || inputLower === 'alright.' ||
                      inputLower.startsWith('that works') || inputLower.startsWith('that sounds');
  
  // CRITICAL FIX: Only treat as rejection if explicit rejection words
  const isRejecting = rejectionWords.some(word => inputLower.includes(word)) && 
                     !inputLower.includes('that works') && 
                     !inputLower.includes('sounds good');
  
  console.log(`🔍 Confirmation analysis: confirming=${isConfirming}, rejecting=${isRejecting}, newPreference=${isGivingNewPreference}, input="${inputLower}"`);
  
  if (isConfirming && !isRejecting) {
    console.log('✅ Customer CONFIRMED the time slot');
    // Customer confirmed the time, proceed to booking
    const { proceedToBookingWithSlot } = require('./modules/enhancedBookingFlow');
    return await proceedToBookingWithSlot(stateMachine.recommendedSlot);
  } else if (isRejecting) {
    console.log('❌ Customer REJECTED the time slot');
    // Customer explicitly rejected, offer alternatives
    transitionTo('collect_time_preference');
    
    // Provide specific options to avoid looping
    return "I understand that time doesn't work for you. Let me offer some alternatives:\n" +
           "• Tomorrow morning (9am-12pm)\n" +
           "• Tomorrow afternoon (1pm-5pm)\n" +
           "• This weekend\n" +
           "Which of these would suit you better?";
  } else {
    console.log('❓ Customer response unclear, asking for clarification');
    return "I want to make sure I get the right time for you. Would you like to book the suggested time, or would you prefer a different time?";
  }
}

/**
 * Collect special instructions from customer
 */
async function collectSpecialInstructions(input) {
  console.log('📝 Collecting special instructions:', input);
  
  // Check if we already have special instructions and are now collecting time preference
  if (stateMachine.customerData?.specialInstructions && 
      stateMachine.customerData.specialInstructions !== 'Standard plumbing service - no special requirements') {
    console.log('📝 Special instructions already collected, treating input as time preference');
    return await collectTimePreference(input);
  }
  
  // Store the instructions
  if (!stateMachine.customerData) stateMachine.customerData = {};
  
  if (input.toLowerCase().includes('no') || input.toLowerCase().includes('nothing') || input.toLowerCase().includes('none')) {
    stateMachine.customerData.specialInstructions = 'Standard plumbing service - no special requirements';
  } else {
    stateMachine.customerData.specialInstructions = input;
  }
  
  console.log('📝 Special instructions recorded:', stateMachine.customerData.specialInstructions);
  
  // Now transition to collect time preference instead of direct booking
  const transitionSuccess = transitionTo('collect_time_preference');
  if (!transitionSuccess) {
    console.error('❌ Failed to transition to collect_time_preference, forcing state change');
    stateMachine.currentState = 'collect_time_preference';
  }
  
  return "Thank you for those details. Now, what time would work best for you? We have availability today, tomorrow, or later this week. Would you prefer a morning or afternoon appointment?";
}

/**
 * Confirm appointment slot with customer
 */
async function confirmSlot(input) {
  console.log('✅ Confirming appointment slot:', input);
  
  if (input.toLowerCase().includes('yes') || input.toLowerCase().includes('confirm')) {
    transitionTo('collect_special_instructions');
    return "Excellent! Your appointment is confirmed. Do you have any special instructions for our plumber, such as gate access codes or specific areas to focus on?";
  } else {
    transitionTo('book_appointment');
    return "No problem, let me find another time that works better for you. What day and time would you prefer?";
  }
}

/**
 * Email confirmation verification
 */
async function verifyEmailConfirmation(email, appointmentId) {
  console.log(`📧 Verifying email confirmation for ${email}, appointment ${appointmentId}`);
  // Implementation would check email delivery status
  return true;
}

/**
 * Send confirmation email wrapper
 */
async function sendConfirmationEmail(clientData, appointmentData, appointmentId) {
  const { sendBookingConfirmationEmail } = require('./professional-email-service');
  
  try {
    await sendBookingConfirmationEmail(
      clientData.email,
      clientData.name,
      appointmentData,
      appointmentId,
      clientData.address
    );
    console.log('✅ Confirmation email sent successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to send confirmation email:', error);
    await notifyError(error, 'sendConfirmationEmail');
    return false;
  }
}

// Export main functions and utilities
module.exports = { 
  handleInput,
  handleTimeout,
  verifyEmailConfirmation,
  sendConfirmationEmail,
  terminateCall,
  setCallerPhoneNumber,
  
  // State management
  getStateMachine: () => stateMachine,
  resetStateMachine,
  
  // Analytics
  getBotAnalytics: () => ({ ...botAnalytics }),
  getConversationInsights: () => ({ ...conversationInsights }),
  
  // Legacy compatibility functions
  stateMachine, // For backward compatibility
  calculateTravelTime: require('./modules/travelOptimization').calculateTravelTime,
  calculateEmailTravelTime: require('./modules/travelOptimization').estimateBrisbaneTravelTime,
  generatePhoneBasedReference: require('./modules/enhancedBookingFlow').generateAppointmentReference,
  extractNameFromInput: require('./modules/dataExtraction').extractNameFromInput,
  isValidName: require('./modules/dataExtraction').isValidName,
  extractMinutesFromTravelTime: require('./modules/travelOptimization').extractMinutesFromTravelTime,
  roundToNextAppointmentSlot: require('./modules/travelOptimization').roundToNextAppointmentSlot,
  collectSpecialInstructions
};
