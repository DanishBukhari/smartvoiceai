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
const { handleDetailCollection, confirmSlot, collectSpecialInstructions } = require('./modules/bookingFlow');
const { notifyError } = require('./notifications');

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
  
  // STEP 1: Input validation and correction
  if (input && typeof input === 'string') {
    input = validateAndCorrectInput(input);
    console.log('✅ Corrected input:', input);
  }
  
  // STEP 2: Confidence and completeness check
  if (!input || input.trim().length === 0 || confidence < 0.3) {
    if (confidence < 0.3) {
      return "Sorry, I didn't quite catch that. Could you please speak a bit more clearly?";
    }
    return "Go on...";
  }
  
  // STEP 3: Quick response check for common inputs (performance optimization)
  const quickResponse = getQuickResponse(input);
  if (quickResponse && stateMachine.currentState === 'start') {
    console.log('⚡ Using quick response');
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
    
    // PRIORITY 3: Emergency detection (highest priority)
    if (detectEmergency(input) && stateMachine.currentState !== 'urgent_booking') {
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
        case 'burst/leak':
        case 'rain-pump':
        case 'roof leak':
        case 'new install/quote':
        case 'other':
          response = await askNextQuestion(input);
          break;
          
        // Booking flow states
        case 'ask_booking':
          const { handleBookingRequest } = require('./modules/bookingFlow');
          response = await handleBookingRequest(input);
          break;
          
        case 'collect_details':
          response = await handleDetailCollection(input);
          break;
          
        case 'book_appointment':
          const { proceedToBooking } = require('./modules/bookingFlow');
          response = await proceedToBooking();
          break;
          
        case 'confirm_slot':
          response = await confirmSlot(input);
          break;
          
        case 'collect_special_instructions':
          response = await collectSpecialInstructions(input);
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
    
    if (lowerInput.includes('hot water') || lowerInput.includes('water heater')) {
      transitionTo('hot water system', 'pattern match - hot water');
      return "I see you have a hot water issue. Do you have any hot water at all?";
    }
    
    if (lowerInput.includes('book') || lowerInput.includes('appointment')) {
      const { handleBookingRequest } = require('./modules/bookingFlow');
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
      const { handleDetailCollection } = require('./modules/bookingFlow');
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
  generatePhoneBasedReference: require('./modules/bookingFlow').generateAppointmentReference,
  extractNameFromInput: require('./modules/dataExtraction').extractNameFromInput,
  isValidName: require('./modules/dataExtraction').isValidName,
  extractMinutesFromTravelTime: require('./modules/travelOptimization').extractMinutesFromTravelTime,
  roundToNextAppointmentSlot: require('./modules/travelOptimization').roundToNextAppointmentSlot,
  collectSpecialInstructions
};
