/**
 * Conversational AI Detail Collection Engine
 * Transforms rigid questionnaire into natural conversation flow
 */

const { 
  stateMachine, 
  transitionTo, 
  addToHistory, 
  updateClientData, 
  updateCustomerData
} = require('./stateMachine');

/**
 * CONVERSATIONAL AI ENGINE - Replaces rigid questionnaire logic
 * This function understands WHAT customer said and responds naturally
 */
async function handleConversationalDetailCollection(userInput) {
  console.log('🧠 CONVERSATIONAL AI: Analyzing customer input:', userInput);
  
  // STEP 1: EXTRACT INFORMATION from what customer said
  const currentData = stateMachine.customerData || {};
  const extractedData = extractDataFromInput(userInput, currentData);
  
  // STEP 2: UPDATE our knowledge base
  if (extractedData && Object.keys(extractedData).length > 0) {
    updateCustomerData(extractedData);
    console.log('📊 AI EXTRACTED:', extractedData);
  }
  
  // STEP 3: ANALYZE what information we now have vs need
  const analysis = analyzeConversationProgress();
  
  // STEP 4: GENERATE CONVERSATIONAL RESPONSE based on context
  return await generateIntelligentResponse(userInput, extractedData, analysis);
}

/**
 * INTELLIGENT RESPONSE GENERATOR
 * Creates natural, contextual responses instead of rigid questions
 */
async function generateIntelligentResponse(userInput, extractedData, analysis) {
  const { missing, justProvided, currentData } = analysis;
  
  // CONVERSATIONAL LOGIC: Acknowledge what customer just told us
  let response = '';
  
  // ACKNOWLEDGE what customer just provided with better detection
  if (extractedData.name) {
    const name = extractedData.name;
    response += `Thanks ${name}! `;
  } else if (extractedData.email) {
    response += `Perfect! `;
  } else if (extractedData.address) {
    response += `Got it! `;
  } else if (extractedData.phone) {
    response += `Thank you! `;
  } else if (justProvided.includes('name')) {
    const name = currentData.name;
    response += `Thanks ${name}! `;
  } else if (justProvided.includes('email')) {
    response += `Perfect! `;
  } else if (justProvided.includes('address')) {
    response += `Got it! `;
  } else if (justProvided.includes('phone')) {
    response += `Thank you! `;
  }
  
  // INTELLIGENTLY ASK for next missing information
  if (missing.includes('name')) {
    response += "Could I get your name for the booking?";
  } else if (missing.includes('email')) {
    response += "What's the best email address for your confirmation?";
  } else if (missing.includes('address')) {
    response += "And what's your full address including suburb and postcode?";
  } else if (missing.includes('phone') && !stateMachine.callerPhoneNumber) {
    response += "What's the best phone number to reach you on?";
  } else if (missing.includes('specialInstructions')) {
    transitionTo('collect_special_instructions');
    response += "Do you have any special instructions for our plumber, such as gate access codes or specific areas to focus on?";
  } else {
    // ALL DETAILS COLLECTED - proceed to booking!
    console.log('✅ CONVERSATIONAL AI: All details collected, proceeding to time preference');
    transitionTo('collect_time_preference');
    response += "Thank you for those details. Now, what time would work best for you? We have availability today, tomorrow, or later this week. Would you prefer a morning or afternoon appointment?";
  }
  
  return response;
}

/**
 * CONVERSATION PROGRESS ANALYZER
 * Intelligently determines what we have vs what we need
 */
function analyzeConversationProgress() {
  const currentData = stateMachine.customerData || {};
  const required = ['name', 'email', 'address'];
  
  // Auto-detect phone from caller ID
  if (stateMachine.callerPhoneNumber && !currentData.phone) {
    updateCustomerData({ phone: stateMachine.callerPhoneNumber });
  }
  
  // Determine what we have vs what we need
  const missing = [];
  const available = [];
  
  required.forEach(field => {
    if (currentData[field]) {
      available.push(field);
    } else {
      missing.push(field);
    }
  });
  
  // Check if we need special instructions (optional but prompted)
  if (available.includes('address') && !currentData.specialInstructions && !stateMachine.specialInstructionsCollected) {
    missing.push('specialInstructions');
  }
  
  // Determine what was just provided (for acknowledgment)
  const justProvided = [];
  const conversationHistory = stateMachine.conversationHistory || [];
  
  // Simple logic to detect what was just provided
  if (conversationHistory.length >= 2) {
    const lastUserMessage = conversationHistory[conversationHistory.length - 1];
    if (lastUserMessage && lastUserMessage.role === 'user') {
      const input = lastUserMessage.content.toLowerCase();
      
      if (input.includes('@') && currentData.email) justProvided.push('email');
      if ((input.includes('my name is') || input.includes("i'm ")) && currentData.name) justProvided.push('name');
      if ((input.includes('street') || input.includes('road') || input.includes('qld')) && currentData.address) justProvided.push('address');
    }
  }
  
  return {
    missing,
    available,
    justProvided,
    currentData,
    isComplete: missing.length === 0
  };
}

/**
 * ENHANCED DATA EXTRACTION with conversation awareness
 */
function extractDataFromInput(input, existingData = {}) {
  if (!input || typeof input !== 'string') return {};
  
  const data = {};
  const lowerInput = input.toLowerCase().trim();
  
  // SMART NAME EXTRACTION - ENHANCED
  if (!existingData.name) {
    // Multiple patterns for name detection with better coverage
    const namePatterns = [
      /(?:my name is|my name's)\s+([a-zA-Z\s\d]+?)(?:\.|,|$|\s+and|\s+email|\s+@)/i,
      /(?:i'm|i am)\s+([a-zA-Z\s\d]+?)(?:\.|,|$|\s+and|\s+email|\s+@)/i,
      /(?:it's|this is)\s+([a-zA-Z\s\d]+?)(?:\.|,|$|\s+and|\s+email|\s+@)/i,
      /(?:call me)\s+([a-zA-Z\s\d]+?)(?:\.|,|$|\s+and|\s+email|\s+@)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\.?$/,  // Direct name format like "Sayeeda" or "Sara Johns"
      /^\s*([A-Z][a-z]+)\s*\.?\s*$/,  // Single name like "Sayeeda."
    ];
    
    for (const pattern of namePatterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        // Clean up the name - include numbers and spaces but validate
        const name = match[1].trim();
        if (name.length >= 2 && name.length <= 50 && 
            /^[a-zA-Z\s\d'-]+$/.test(name) &&
            !name.includes('@') && 
            !name.toLowerCase().includes('email') &&
            !name.toLowerCase().includes('address') &&
            !name.toLowerCase().includes('street')) {
          data.name = name;
          console.log('👤 Name extracted:', data.name);
          break;
        }
      }
    }
    
    // Fallback: If input looks like just a name (simple input) - ENHANCED
    if (!data.name && lowerInput.length <= 30 && /^[a-zA-Z\s\d'-]+$/.test(lowerInput) && 
        !lowerInput.includes('street') && !lowerInput.includes('@') && 
        !lowerInput.includes('apartment') && !lowerInput.includes('email') &&
        !lowerInput.includes('gmail') && !lowerInput.includes('yahoo') &&
        lowerInput.split(' ').length <= 4) {
      // Check if it looks like a proper name
      const words = lowerInput.trim().split(/\s+/);
      const isProperName = words.every(word => 
        word.length >= 1 && 
        (/^[A-Z]/.test(word) || /^[a-z]/.test(word)) && // Allow both cases for speech recognition
        !/^\d+$/.test(word) // Not just numbers
      );
      
      if (isProperName) {
        data.name = input.trim();
        console.log('👤 Name extracted (fallback):', data.name);
      }
    }
  }
  
  // SMART EMAIL EXTRACTION
  if (!existingData.email) {
    const emailMatch = input.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      data.email = emailMatch[0];
    }
  }
  
  // SMART ADDRESS EXTRACTION  
  if (!existingData.address && !data.email) { // Don't extract address if email was detected
    // Look for address patterns
    const addressIndicators = ['street', 'road', 'avenue', 'lane', 'drive', 'qld', 'queensland', 'brisbane'];
    const hasAddressKeyword = addressIndicators.some(indicator => lowerInput.includes(indicator));
    
    // CRITICAL FIX: Don't extract address from email domains
    const isEmailDomain = input.includes('@') && (input.includes('.com') || input.includes('.au') || input.includes('.org'));
    
    if (hasAddressKeyword && !isEmailDomain) {
      // Enhanced address cleaning with speech recognition corrections
      let address = input.trim();
      
      // Apply speech recognition corrections
      address = address.replace(/Bain City/gi, 'Brisbane');
      address = address.replace(/With Bain City/gi, 'Brisbane');
      address = address.replace(/\bQID\b/gi, 'QLD');
      address = address.replace(/\bBismayne\b/gi, 'Brisbane');
      
      // Clean up punctuation and formatting
      address = address.replace(/[,\.]+/g, ', ');
      address = address.replace(/,\s*,/g, ',');
      address = address.replace(/,\s*$/, '');
      address = address.replace(/^\s*,/, '');
      
      data.address = address;
    }
  } else {
    // Check if this looks like a postcode/state addition to existing address
    if (existingData.address && 
        !existingData.address.includes('QLD') && 
        !existingData.address.includes('NSW') && 
        !existingData.address.includes('VIC') && 
        !existingData.address.includes('WA') && 
        !existingData.address.includes('SA') && 
        !existingData.address.includes('ACT') && 
        !existingData.address.includes('NT')) {
      
      // Check for various postcode/suburb/state patterns
      const postcodePatterns = [
        /^([A-Z]{2,3}\s+\d{4})\.?$/i,  // "QLD 4000"
        /^\d{4}\.?$/i,                  // "4000"
        /^([A-Za-z\s]+,?\s*[A-Z]{2,3}\s+\d{4})\.?$/i,  // "Brisbane City, QLD 4000"
        /^([A-Za-z\s]+,?\s*\d{4})\.?$/i  // "Brisbane City, 4000"
      ];
      
      for (const pattern of postcodePatterns) {
        if (pattern.test(input.trim())) {
          const combined = `${existingData.address.replace(/[,.]$/, '')}, ${input.trim().replace(/\.$/, '')}`;
          data.address = combined;
          console.log('🏠 Combined address with postcode/suburb:', data.address);
          return data; // Return immediately to prevent treating as special instructions
        }
      }
    }
  }
  
  // SMART PHONE EXTRACTION (if not using caller ID)
  if (!existingData.phone && !stateMachine.callerPhoneNumber) {
    const phoneMatch = input.match(/(\+?61\s?[0-9\s]{8,12}|0[0-9\s]{8,10})/);
    if (phoneMatch) {
      data.phone = phoneMatch[0].replace(/\s+/g, '');
    }
  }
  
  return data;
}

/**
 * SMART CONVERSATION STARTER
 * Begins detail collection with natural conversation flow
 */
async function startConversationalDetailCollection(userInput) {
  console.log('🗣️ STARTING CONVERSATIONAL DETAIL COLLECTION');
  
  // Auto-detect phone from caller ID
  if (stateMachine.callerPhoneNumber) {
    updateCustomerData({ phone: stateMachine.callerPhoneNumber });
    console.log('📞 Caller phone number set:', stateMachine.callerPhoneNumber);
  }
  
  transitionTo('collect_details');
  
  // Try to extract any data from the initial input
  if (userInput && userInput.trim().length > 0) {
    const extractedData = extractDataFromInput(userInput, {});
    if (extractedData && Object.keys(extractedData).length > 0) {
      updateCustomerData(extractedData);
      console.log('📊 Pre-extracted data:', extractedData);
    }
  }
  
  // Generate intelligent opening
  const analysis = analyzeConversationProgress();
  
  if (analysis.missing.includes('name')) {
    return "I'll need to get some details to book your appointment. Could I start with your name?";
  } else if (analysis.missing.includes('email')) {
    return `Perfect! And what's your email address for the booking confirmation?`;
  } else if (analysis.missing.includes('address')) {
    return "Thank you. What's your full address including suburb and postcode?";
  } else {
    return await generateIntelligentResponse(userInput, {}, analysis);
  }
}

module.exports = {
  handleConversationalDetailCollection,
  startConversationalDetailCollection,
  generateIntelligentResponse,
  analyzeConversationProgress,
  extractDataFromInput
};
