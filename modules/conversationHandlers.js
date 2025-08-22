// modules/conversationHandlers.js - Main conversation flow handlers
const { getResponse } = require('../nlp');
const { 
  classifyPlumbingIssue, 
  analyzeFastInput, 
  detectBookingIntent, 
  detectEmergency,
  issueQuestions 
} = require('./issueClassification');
const { getQuickResponse } = require('./inputValidation');
const { extractCustomerData, extractCustomerDataFromHistory } = require('./dataExtraction');
const { stateMachine, transitionTo, addToHistory, updateClientData, updateCustomerData } = require('./stateMachine');
const { handleBookingRequest, handleDetailCollection } = require('./bookingFlow');

/**
 * Check if input contains a specific issue description (not just generic booking request)
 */
function hasIssueDescription(input) {
  const issueKeywords = [
    'toilet', 'sink', 'tap', 'faucet', 'drain', 'pipe', 'leak', 'burst',
    'hot water', 'water heater', 'shower', 'bath', 'kitchen', 'bathroom',
    'blocked', 'clogged', 'running', 'dripping', 'broken', 'not working',
    'overflow', 'flooding', 'no water', 'cold water', 'no hot water'
  ];
  
  const lowerInput = input.toLowerCase();
  return issueKeywords.some(keyword => lowerInput.includes(keyword));
}

async function handleStart(input) {
  console.log('🚀 Starting conversation flow...');
  
  const lowerInput = input.toLowerCase();
  
  // Check for emergency situations FIRST (highest priority)
  if (detectEmergency(input)) {
    console.log('🚨 Emergency detected');
    stateMachine.urgent = true;
    stateMachine.safetyConcern = true;
    transitionTo('urgent_booking', 'emergency detected');
    return await handleUrgentBooking(input);
  }
  
  // Fast-path for direct issue classification (before booking intent check)
  const commonIssues = {
    'toilet': "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    'hot water': "Do you have any hot water at all?",
    'water': "Do you have any hot water at all?",
    'sink': "What's the problem with your sink? Is it leaking, blocked, or no water coming out?",
    'tap': "What's the problem with your tap? Is it leaking, blocked, or no water coming out?",
    'faucet': "What's the problem with your faucet? Is it leaking, blocked, or no water coming out?",
    'leak': "Has the water been shut off, or is it still running?",
    'pipe': "Has the water been shut off, or is it still running?",
    'drain': "Is it completely blocked or draining slowly?",
    'emergency': "I understand this is urgent. What's the emergency - burst pipe, flooding, or no hot water?"
  };
  
  for (const [keyword, response] of Object.entries(commonIssues)) {
    if (lowerInput.includes(keyword)) {
      console.log(`⚡ Fast-path response for: ${keyword}`);
      
      if (keyword === 'water') {
        stateMachine.issueType = 'hot water system';
      } else if (['sink', 'tap', 'faucet'].includes(keyword)) {
        stateMachine.issueType = 'sink/tap';
      } else {
        stateMachine.issueType = keyword;
      }
      
      transitionTo(stateMachine.issueType, `${keyword} issue detected`);
      stateMachine.questionIndex = 1; // Set to 1 since we're providing the first question (index 0)
      addToHistory('assistant', response);
      return response;
    }
  }
  
  // Check for pure booking intent (without specific issue description)
  if (detectBookingIntent(input) && !hasIssueDescription(input)) {
    console.log('📅 Pure booking intent detected');
    transitionTo('general', 'booking intent detected');
    stateMachine.needsBookingOffer = true;
    return "Hi there! I can definitely help you with that. What kind of plumbing issue are you experiencing today?";
  }
  
  // Fall back to AI classification for complex cases
  try {
    const analysis = await analyzeFastInput(input);
    
    if (analysis.issue.includes('toilet')) {
      stateMachine.issueType = 'toilet';
      transitionTo('toilet', 'AI classified as toilet');
    } else if (analysis.issue.includes('sink') || analysis.issue.includes('tap') || analysis.issue.includes('faucet')) {
      stateMachine.issueType = 'sink/tap';
      transitionTo('sink/tap', 'AI classified as sink/tap');
    } else if (analysis.issue.includes('water')) {
      stateMachine.issueType = 'hot water system';
      transitionTo('hot water system', 'AI classified as hot water');
    } else if (analysis.issue.includes('leak')) {
      stateMachine.issueType = 'burst/leak';
      transitionTo('burst/leak', 'AI classified as leak');
    } else {
      transitionTo('general', 'general classification');
      return await handleGeneralQuery(input);
    }
    
    return await askNextQuestion('');
  } catch (error) {
    console.error('Start handler error:', error);
    transitionTo('general', 'error fallback');
    return "I'm here to help with your plumbing needs. Could you tell me what issue you're experiencing?";
  }
}

async function askNextQuestion(input) {
  console.log(`❓ Asking next question for ${stateMachine.issueType}, index: ${stateMachine.questionIndex}`);
  
  // Check for booking interrupt
  if (input && detectBookingIntent(input)) {
    console.log('📅 Booking interrupt detected');
    transitionTo('ask_booking', 'customer wants to book immediately');
    return await handleBookingRequest(input);
  }
  
  const questions = issueQuestions[stateMachine.issueType];
  
  if (questions && stateMachine.questionIndex < questions.length) {
    const question = questions[stateMachine.questionIndex];
    
    // Store the customer's answer if provided
    if (input && input.trim().length > 0) {
      const dataKey = `${stateMachine.issueType.replace(/\s+/g, '_')}_${stateMachine.questionIndex}`;
      updateClientData({ [dataKey]: input.trim() });
    }
    
    stateMachine.questionIndex++;
    addToHistory('assistant', question);
    return question;
  } else {
    // Completed all questions, move to booking
    console.log('✅ Technical diagnosis complete, offering booking');
    transitionTo('ask_booking', 'technical questions completed');
    
    const issueClassification = classifyPlumbingIssue(
      Object.values(stateMachine.clientData).join(' ')
    );
    
    if (issueClassification) {
      updateClientData({ issueDescription: issueClassification.description });
      const response = `I understand you're dealing with ${issueClassification.description}. ${issueClassification.followUp} Would you like me to schedule an appointment for a technician to come out and take care of this for you?`;
      addToHistory('assistant', response);
      return response;
    } else {
      const response = "Based on what you've told me, this sounds like something our experienced plumbers can help you with. Would you like me to schedule an appointment for a technician to come out and take care of this?";
      addToHistory('assistant', response);
      return response;
    }
  }
}

async function handleGeneralQuery(input) {
  console.log('💬 Handling general query...');
  
  // Define technical states once for use throughout the function
  const technicalStates = ['toilet', 'sink/tap', 'hot water system', 'burst/leak', 'other'];
  
  // Extract customer data first
  const customerDataExtracted = extractCustomerData(input);
  console.log('📊 Extracted customer data:', customerDataExtracted);
  
  // If we're already in a technical diagnosis state, don't restart the diagnosis
  if (technicalStates.includes(stateMachine.currentState)) {
    console.log(`🔧 Already in technical diagnosis state (${stateMachine.currentState}), continuing with questions`);
    return await askNextQuestion(input);
  }
  
  // Handle booking offer response
  if (stateMachine.needsBookingOffer) {
    stateMachine.needsBookingOffer = false;
    
    const lowerInput = input.toLowerCase();
    
    // Check if customer described an issue - Route to proper technical diagnosis
    if (lowerInput.length > 5 && (
      lowerInput.includes('toilet') || lowerInput.includes('sink') || lowerInput.includes('pipe') ||
      lowerInput.includes('leak') || lowerInput.includes('water') || lowerInput.includes('drain') ||
      lowerInput.includes('hot water') || lowerInput.includes('shower') || lowerInput.includes('tap') ||
      lowerInput.includes('block') || lowerInput.includes('clog') || lowerInput.includes('fix') ||
      lowerInput.includes('repair') || lowerInput.includes('problem') || lowerInput.includes('issue')
    )) {
      // Store the issue description in customerData
      updateClientData({ issueDescription: input });
      updateCustomerData({ issue: input });
      
      console.log('🔧 Issue detected, routing to technical diagnosis');
      
      // Route to proper technical diagnosis instead of jumping to booking
      if (lowerInput.includes('toilet')) {
        stateMachine.issueType = 'toilet';
        transitionTo('toilet', 'toilet issue detected');
        stateMachine.questionIndex = 0;
        console.log('🚽 Starting toilet diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('sink') || lowerInput.includes('tap') || lowerInput.includes('faucet')) {
        stateMachine.issueType = 'sink/tap';
        transitionTo('sink/tap', 'sink/tap issue detected');
        stateMachine.questionIndex = 0;
        console.log('🚰 Starting sink/tap diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('hot water') || lowerInput.includes('water heater')) {
        stateMachine.issueType = 'hot water system';
        transitionTo('hot water system', 'hot water issue detected');
        stateMachine.questionIndex = 0;
        console.log('🔥 Starting hot water diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('leak') || lowerInput.includes('burst') || lowerInput.includes('pipe')) {
        stateMachine.issueType = 'burst/leak';
        transitionTo('burst/leak', 'leak/burst issue detected');
        stateMachine.questionIndex = 0;
        console.log('💧 Starting leak/burst diagnosis');
        return await askNextQuestion('');
      } else {
        stateMachine.issueType = 'other';
        transitionTo('other', 'general issue detected');
        stateMachine.questionIndex = 0;
        return await askNextQuestion('');
      }
    }
  }
  
  // Extract customer data from input
  const historyData = extractCustomerDataFromHistory(stateMachine.conversationHistory);
  const currentInputData = await extractCustomerData(input);
  Object.assign(historyData, currentInputData);
  updateClientData(historyData);
  
  console.log('📊 Extracted customer data:', historyData);
  
  // Check if we're in detail collection mode
  if (stateMachine.collectingDetail) {
    return await handleDetailCollection(input);
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
  
  // Check for complete booking data
  const hasCompleteData = historyData.name && historyData.email && historyData.address;
  const bookingTriggers = ['schedule', 'book', 'appointment', 'time', 'today', 'tomorrow'];
  const hasBookingIntent = bookingTriggers.some(trigger => normalizedInput.includes(trigger));
  
  if (hasCompleteData && hasBookingIntent) {
    console.log('✅ Complete data + booking intent detected');
    return await handleBookingRequest(input);
  }
  
  // Handle providing contact details
  const isProvidingDetails = currentInputData.name || currentInputData.email || currentInputData.address || currentInputData.phone;
  if (isProvidingDetails && !stateMachine.allDetailsCollected) {
    console.log('📝 Customer providing contact details');
    transitionTo('collect_details', 'customer providing details');
    return await handleDetailCollection(input);
  }
  
  // Handle service questions or issue descriptions (only if not already in technical diagnosis)
  const serviceTypeKeywords = /\b(toilet|bathroom|kitchen|sink|tap|faucet|drain|pipe|water heater|hot water|cold water|shower|bath|leak|block|clog|repair|install|replace|maintenance)/i;
  
  if (serviceTypeKeywords.test(input) && input.length > 10 && !technicalStates.includes(stateMachine.currentState)) {
    console.log('🔧 Service description detected');
    
    const issueClassification = classifyPlumbingIssue(input);
    if (issueClassification) {
      updateClientData({ issueDescription: issueClassification.description });
      updateCustomerData({ issue: input });
      
      const lowerInput = input.toLowerCase();
      
      // Route to technical diagnosis first, not directly to booking
      if (lowerInput.includes('toilet')) {
        stateMachine.issueType = 'toilet';
        transitionTo('toilet', 'toilet issue detected');
        stateMachine.questionIndex = 0;
        console.log('🚽 Starting toilet technical diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('sink') || lowerInput.includes('tap') || lowerInput.includes('faucet')) {
        stateMachine.issueType = 'sink/tap';
        transitionTo('sink/tap', 'sink/tap issue detected');
        stateMachine.questionIndex = 0;
        console.log('🚰 Starting sink/tap technical diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('hot water') || lowerInput.includes('water heater')) {
        stateMachine.issueType = 'hot water system';
        transitionTo('hot water system', 'hot water issue detected');
        stateMachine.questionIndex = 0;
        console.log('🔥 Starting hot water technical diagnosis');
        return await askNextQuestion('');
      } else if (lowerInput.includes('leak') || lowerInput.includes('burst') || lowerInput.includes('pipe')) {
        stateMachine.issueType = 'burst/leak';
        transitionTo('burst/leak', 'leak/burst issue detected');
        stateMachine.questionIndex = 0;
        console.log('💧 Starting leak/burst technical diagnosis');
        return await askNextQuestion('');
      } else {
        // For unclassified issues, offer booking directly
        const response = `I understand you're dealing with ${issueClassification.description}. ${issueClassification.followUp} Would you like me to schedule an appointment to get this fixed for you?`;
        transitionTo('ask_booking', 'issue classified');
        addToHistory('assistant', response);
        return response;
      }
    }
  }
  
  // Default helpful response
  const response = await getResponse(
    "I'm here to help with all your plumbing needs. Whether it's a toilet issue, hot water problem, leak, or any other plumbing concern, I can schedule an appointment with our experienced technicians. What specific issue are you experiencing?",
    stateMachine.conversationHistory
  );
  
  addToHistory('assistant', response);
  return response;
}

async function handleUrgentBooking(input) {
  console.log('🚨 Handling urgent booking...');
  
  stateMachine.urgent = true;
  
  // Extract issue from input
  const issueClassification = classifyPlumbingIssue(input);
  if (issueClassification) {
    updateClientData({ issueDescription: issueClassification.description });
  }
  
  const response = "I understand this is urgent. For emergency situations, we prioritize immediate assistance. I'll need to collect your contact details quickly so we can get a plumber out to you as soon as possible. What's your name and address?";
  
  transitionTo('collect_details', 'urgent situation');
  addToHistory('assistant', response);
  return response;
}

async function handleAppointmentCancellation() {
  const response = "I can help you cancel your appointment. Could you please provide your appointment reference number or the name and address for the booking?";
  addToHistory('assistant', response);
  return response;
}

async function handleAppointmentPostponement() {
  const response = "I can help you reschedule your appointment. What time would work better for you? I can check availability for today, tomorrow, or later this week.";
  addToHistory('assistant', response);
  return response;
}

async function handleBookingComplete(input) {
  console.log('✅ Handling booking complete state...');
  
  const lowerInput = input.toLowerCase();
  
  // 🚨 FIX: Detect when customer wants to CHANGE booking time or book for DIFFERENT day
  const wantsToChangeTime = (
    lowerInput.includes('tomorrow') ||
    lowerInput.includes('change') ||
    lowerInput.includes('reschedule') ||
    lowerInput.includes('cancel') ||
    lowerInput.includes('different') ||
    lowerInput.includes('not') ||
    (lowerInput.includes('book') && (lowerInput.includes('tomorrow') || lowerInput.includes('different'))) ||
    lowerInput.includes('prefer')
  );
  
  if (wantsToChangeTime) {
    console.log('🔄 Customer wants to change booking time, transitioning to time preference collection');
    
    // Reset time-related data but keep customer details
    if (stateMachine.selectedSlot) {
      delete stateMachine.selectedSlot;
    }
    
    // Transition back to time preference collection
    transitionTo('collect_time_preference', 'customer wants to change booking time');
    
    return "I understand you'd like to change the appointment time. What time would work better for you? I can check availability for today, tomorrow, or later this week.";
  }
  
  // Handle appointment time inquiries with stored booking details
  if (lowerInput.includes('time') || lowerInput.includes('when') || lowerInput.includes('appointment')) {
    const bookingDetails = stateMachine.bookingDetails;
    if (bookingDetails && bookingDetails.dateTime) {
      const appointmentTime = new Date(bookingDetails.dateTime).toLocaleString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Brisbane',
        hour12: true
      });
      
      return `Your appointment is scheduled for ${appointmentTime}. ` +
             `Reference number: ${bookingDetails.reference || stateMachine.referenceNumber}. ` +
             `Anything else I can help you with?`;
    }
  }
  
  // Enhanced detection for wanting to end call
  const endCallKeywords = [
    'no', 'nothing', 'that\'s all', 'goodbye', 'bye', 'thanks', 'thank you',
    'that\'s it', 'all good', 'i\'m good', 'nope', 'not really', 'no thank you',
    'no thanks', 'that\'s everything', 'all set', 'good to go', 'perfect',
    'great', 'awesome', 'excellent', 'sounds good', 'okay thanks', 'ok thanks'
  ];
  
  const wantsToEnd = endCallKeywords.some(keyword => lowerInput.includes(keyword));
  
  if (wantsToEnd) {
    transitionTo('ended', 'customer completed');
    
    const closingResponse = await getResponse(
      "Perfect! Your appointment is confirmed and you'll receive an email confirmation shortly. Thank you for choosing Assure Fix Plumbing. Have a great day!",
      stateMachine.conversationHistory
    );
    
    addToHistory('assistant', closingResponse);
    
    // Set termination flag
    stateMachine.pendingTermination = {
      reason: 'customer_completed',
      timestamp: new Date().toISOString(),
      shouldClose: true
    };
    
    return closingResponse;
  }
  
  // If customer has another question/issue
  if (lowerInput.includes('yes') || lowerInput.includes('another') || 
      lowerInput.includes('also') || lowerInput.includes('question')) {
    
    const continueResponse = "Of course! What else can I help you with today?";
    transitionTo('general', 'customer has more questions');
    addToHistory('assistant', continueResponse);
    return continueResponse;
  }
  
  // For any other input, check if it's a new issue
  transitionTo('general', 'processing additional input');
  return await handleGeneralQuery(input);
}

module.exports = {
  handleStart,
  askNextQuestion,
  handleGeneralQuery,
  handleUrgentBooking,
  handleAppointmentCancellation,
  handleAppointmentPostponement,
  handleBookingComplete
};
