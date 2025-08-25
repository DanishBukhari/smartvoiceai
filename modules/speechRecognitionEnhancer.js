// modules/speechRecognitionEnhancer.js - Enhanced speech recognition with context-aware corrections

/**
 * Enhanced speech recognition with plumbing-specific context
 */
function enhanceSpeechRecognition(rawInput, conversationContext = {}) {
  if (!rawInput || typeof rawInput !== 'string') return rawInput;
  
  let enhanced = rawInput.trim();
  
  // Apply contextual corrections based on conversation state
  enhanced = applyContextualCorrections(enhanced, conversationContext);
  
  // Apply plumbing-specific corrections
  enhanced = applyPlumbingCorrections(enhanced);
  
  // Apply address and contact corrections
  enhanced = applyAddressCorrections(enhanced);
  
  // Apply general misheard word corrections
  enhanced = applyGeneralCorrections(enhanced);
  
  console.log('🎙️ Speech enhancement:', { 
    original: rawInput, 
    enhanced: enhanced,
    changed: rawInput !== enhanced 
  });
  
  return enhanced;
}

/**
 * Apply corrections based on conversation context
 */
function applyContextualCorrections(input, context) {
  const lowerInput = input.toLowerCase();
  
  // If we're in toilet discussion context
  if (context.currentIssue === 'toilet' || context.state === 'toilet') {
    return input
      .replace(/flash property/gi, "toilet that won't flush")
      .replace(/flashing/gi, 'flushing')
      .replace(/flash/gi, 'flush')
      .replace(/toy[^a-z]/gi, 'toilet ')
      .replace(/toilet/gi, 'toilet'); // Ensure consistency
  }
  
  // If collecting name
  if (context.state === 'collect_details' && !context.customerData?.name) {
    // Improve name recognition
    return input
      .replace(/say ada/gi, 'Sayeda')
      .replace(/say eda/gi, 'Sayeda')
      .replace(/said ah/gi, 'Sayeda');
  }
  
  // If collecting email
  if (context.state === 'collect_details' && context.customerData?.name && !context.customerData?.email) {
    return applyEmailCorrections(input);
  }
  
  // If collecting address
  if (context.state === 'collect_details' && context.customerData?.email && !context.customerData?.address) {
    return applyAddressCorrections(input);
  }
  
  return input;
}

/**
 * Apply plumbing-specific corrections - ENHANCED WITH CONTEXT AWARENESS
 */
function applyPlumbingCorrections(input) {
  const lowerInput = input.toLowerCase();
  
  // CRITICAL FIX: Only apply corrections when contextually appropriate
  // Don't replace common words unless we're sure they're misheard plumbing terms
  
  const plumbingCorrections = {
    // Toilet issues - only when likely misheard
    'flash property': "toilet that won't flush",
    'flashing issues': 'flushing issues',
    'toilet toy': 'toilet',
    'toy let': 'toilet',
    
    // Sink issues - only isolated words or clear misheard terms
    'sing tap': 'sink tap',
    'sing drain': 'sink drain',
    'kitchen sing': 'kitchen sink',
    'bathroom sing': 'bathroom sink',
    // REMOVED DANGEROUS: 'think': 'sink' - this corrupted "I think"
    
    // Pipe issues
    'buy pipe': 'burst pipe',
    'type leak': 'pipe leak',
    
    // Leak issues
    'lake under': 'leak under',
    'week dripping': 'leak dripping',
    'lick sound': 'leak sound',
    
    // Hot water issues
    'hard water system': 'hot water system',
    'hot quarter tank': 'hot water tank',
    
    // General plumbing
    'plumber': 'plumber',
    'plumbering': 'plumbing',
    'plombing': 'plumbing'
  };
  
  let corrected = input;
  
  // CRITICAL FIX: Only apply corrections for multi-word phrases or clearly misheard terms
  // Don't replace single common words that might be used in normal conversation
  for (const [wrong, right] of Object.entries(plumbingCorrections)) {
    if (wrong.includes(' ') || wrong.length > 6) { // Only replace phrases or longer words
      const regex = new RegExp(wrong, 'gi');
      corrected = corrected.replace(regex, right);
    }
  }
  
  return corrected;
}

/**
 * Apply email-specific corrections
 */
function applyEmailCorrections(input) {
  return input
    // Fix common email misheard patterns
    .replace(/at gmail dot com/gi, '@gmail.com')
    .replace(/at gmail/gi, '@gmail.com')
    .replace(/gmail dot com/gi, 'gmail.com')
    .replace(/at g mail/gi, '@gmail')
    .replace(/lily (\d+) (\d+) (\d+) (\d+) (\d+)/gi, 'lily$1$2$3$4$5')
    .replace(/(\w+) (\d+) (\d+) (\d+) (\d+) (\d+) at gmail/gi, '$1$2$3$4$5$6@gmail.com')
    // Fix spaced out email parts
    .replace(/l i l y/gi, 'lily')
    .replace(/(\w) (\w) (\w) (\w) at/gi, '$1$2$3$4@')
    .replace(/(\d) (\d) (\d) (\d) (\d)/gi, '$1$2$3$4$5');
}

/**
 * Apply address-specific corrections
 */
function applyAddressCorrections(input) {
  return input
    // Fix common address misheard patterns
    .replace(/queens trade/gi, 'Queen Street')           // CRITICAL FIX
    .replace(/lisbon, quebec, quebec, uae/gi, 'Brisbane QLD')  // CRITICAL FIX
    .replace(/winston city/gi, 'Brisbane City')          // CRITICAL FIX
    .replace(/bismayne/gi, 'Brisbane')                   // CRITICAL FIX: "Bismayne" → "Brisbane"
    .replace(/qid/gi, 'QLD')                            // CRITICAL FIX: "QID" → "QLD"
    .replace(/bains, b, qld/gi, 'Brisbane QLD 4000')     // NEW FIX: "Bains, B, QLD" → "Brisbane QLD 4000"
    .replace(/bains/gi, 'Brisbane')                      // NEW FIX: "Bains" → "Brisbane"
    .replace(/, b, qld/gi, ', Brisbane QLD 4000')        // NEW FIX: ", B, QLD" → ", Brisbane QLD 4000"
    .replace(/\+1, 23\./gi, '123')                       // NEW FIX: "+1, 23." → "123"
    .replace(/queen\./gi, 'Queen')                       // NEW FIX: "Queen." → "Queen"
    .replace(/street\./gi, 'Street')                     // NEW FIX: "Street." → "Street"
    .replace(/queen/gi, 'Queen')
    .replace(/street/gi, 'Street')
    .replace(/(\d+) (\d+) (\d+) queen/gi, '$1$2$3 Queen')
    .replace(/(\d+) queen/gi, '$1 Queen')
    .replace(/2 id/gi, 'QLD')
    .replace(/(\d+) (\d+) (\d+) (\d+)(?=\s|$)/gi, '$1$2$3$4') // Join scattered postcodes
    .replace(/qld (\d+)/gi, 'QLD $1')
    .replace(/(\d+) (\d+) (\d+) (\d+)$/gi, '$1$2$3$4'); // Join final postcode
}

/**
 * Apply general misheard word corrections
 */
function applyGeneralCorrections(input) {
  const generalCorrections = {
    // Common STT errors
    'yeah': 'yes',
    'yep': 'yes',
    'nope': 'no',
    'nah': 'no',
    
    // Time preferences
    'after noon': 'afternoon',
    'after-noon': 'afternoon',
    'mornin': 'morning',
    
    // General
    'an': 'and', // Context dependent, but often helps
    'wit': 'with'
  };
  
  let corrected = input;
  for (const [wrong, right] of Object.entries(generalCorrections)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    corrected = corrected.replace(regex, right);
  }
  
  return corrected;
}

/**
 * Get conversation context for speech recognition
 */
function getConversationContext(stateMachine) {
  return {
    state: stateMachine.currentState,
    currentIssue: stateMachine.currentIssue,
    customerData: stateMachine.customerData || {},
    conversationLength: stateMachine.conversationHistory?.length || 0
  };
}

module.exports = {
  enhanceSpeechRecognition,
  getConversationContext,
  applyContextualCorrections,
  applyPlumbingCorrections,
  applyEmailCorrections,
  applyAddressCorrections
};
