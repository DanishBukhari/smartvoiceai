// flow.js
//the scenarios of the texts
const { getResponse } = require('./nlp');
const { getAccessToken, getLastAppointment, getNextAvailableSlot, isSlotFree, createAppointment } = require('./outlook');
const { createOrUpdateContact } = require('./ghl');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BRISBANE_TZ = 'Australia/Brisbane';

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
    "Any leaks—steady drip or fast?",
    "How old is it—under 10 years or over?",
    "What's the tank size—125L, 250L, 315L, or other?",
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
    "What would you like us to quote—new installation, repair, or inspection?",
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

async function calculateTravelTime(origin, destination) {
  console.log('calculateTravelTime: Calculating from', origin, 'to', destination);
  try {
    const prompt = `Estimate the driving time in minutes from "${origin}" to "${destination}" in a typical Australian urban area. Return only the number of minutes.`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
    });
    const travelTime = parseInt(response.choices[0].message.content.trim());
    const result = isNaN(travelTime) ? 30 : travelTime;
    console.log('calculateTravelTime: Result', result);
    return result;
  } catch (error) {
    console.error('calculateTravelTime: Error', error.message, error.stack);
    return 30;
  }
}

async function handleInput(input, confidence = 1.0) {
  console.log('=== handleInput START ===');
  console.log('Input:', input);
  console.log('Confidence:', confidence);
  console.log('Current State:', stateMachine.currentState);
  console.log('Question Index:', stateMachine.questionIndex);
  console.log('Client Data:', stateMachine.clientData);
  
  // Learn from input
  await learnFromInput(input);
  
  // Improved input validation
  if (!input || input.trim().length === 0 || confidence < 0.3) {
    if (confidence < 0.3) {
      return "Sorry, I didn't quite catch that. Could you please repeat what you said, or speak a bit more clearly?";
    }
    return "I didn't catch that. Could you please repeat what you said?";
  }

  stateMachine.conversationHistory.push({ role: 'user', content: input });

  try {
    let response;
    switch (stateMachine.currentState) {
      case 'start':
        response = await handleStart(input);
        break;
      case 'hot water system':
      case 'toilet':
      case 'burst/leak':
      case 'rain-pump':
      case 'roof leak':
      case 'new install/quote':
      case 'other':
        response = await askNextQuestion(input);
        break;
      case 'ask_booking':
        response = await askBooking(input);
        break;
      case 'collect_details':
        response = await collectClientDetails(input);
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
      case 'general':
        response = await handleGeneralQuery(input);
        break;
      default:
        console.log('Unknown state, attempting recovery...');
        // Try to understand what the customer wants
        const recoveryResponse = await getResponse(`The customer said: "${input}". 
        Based on this, what should I ask them? Consider if they're:
        1. Describing a new issue
        2. Answering a previous question
        3. Asking for help
        4. Ending the conversation
        
        Return a natural response that helps continue the conversation.`);
        
        stateMachine.currentState = 'general';
        response = recoveryResponse;
    }
    
    console.log('=== handleInput END ===');
    console.log('Response:', response);
    console.log('New State:', stateMachine.currentState);
    return response;
  } catch (error) {
    console.error('handleInput error:', error);
    
    // Smart error recovery
    const recoveryPrompt = `I'm having trouble understanding. The customer said: "${input}". 
    Provide a helpful response that:
    1. Acknowledges the difficulty
    2. Asks for clarification
    3. Offers to help in a different way`;
    
    return await getResponse(recoveryPrompt);
  }
}

async function learnFromInput(input) {
  // Analyze input for patterns
  const analysis = await getResponse(`Analyze this customer input: "${input}". 
  Extract and return ONLY a valid JSON object with these fields:
  - issue: main issue mentioned
  - urgency: urgency level (low/medium/high)
  - emotion: customer emotion (frustrated/calm/urgent)
  - knowledge: technical knowledge level (basic/intermediate/advanced)
  - safety: safety concerns (yes/no/none)
  
  Return ONLY the JSON object, no markdown formatting or additional text.`);
  
  try {
    let jsonStr = analysis.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    
    const insights = JSON.parse(jsonStr);
    
    // Store insights for future improvements
    if (insights.issue) {
      const count = conversationInsights.commonIssues.get(insights.issue) || 0;
      conversationInsights.commonIssues.set(insights.issue, count + 1);
    }
    
    // Adjust response based on customer emotion
    if (insights.emotion === 'frustrated') {
      stateMachine.clientData.needsEmpathy = true;
    }
    
    if (insights.safety === 'yes') {
      stateMachine.clientData.safetyConcern = true;
    }
  } catch (error) {
    console.log('Learning analysis failed:', error);
    // Don't let this break the conversation flow
  }
}

async function handleStart(input) {
  console.log('handleStart: Identifying issue');
  
  // Add fast-path for common first responses
  const commonIssues = {
    'toilet': "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    'hot water': "Do you have any hot water at all?",
    'water': "Do you have any hot water at all?",
    'leak': "Has the water been shut off, or is it still running?",
    'pipe': "Has the water been shut off, or is it still running?",
    'pump': "Is the pump standalone or submersible?",
    'roof': "Is water dripping inside right now?",
    'quote': "What would you like us to quote—new installation, repair, or inspection?"
  };
  
  // Quick check for common keywords
  const lowerInput = input.toLowerCase();
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
  
  // Store customer's response
  if (input) {
    stateMachine.clientData[`${stateMachine.currentState}_${stateMachine.questionIndex}`] = input;
    
    // Analyze response for urgency or additional issues
    const urgencyCheck = await getResponse(`Analyze this response for urgency: "${input}". Is this an emergency situation? Return only "yes" or "no".`);
    if (urgencyCheck.toLowerCase().includes('yes')) {
      stateMachine.clientData.urgent = true;
    }
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
    return response;
  } else {
    // Smart booking suggestion based on issue severity
    let bookingPrompt = "Would you like to book an appointment for this?";
    
    if (stateMachine.clientData.urgent) {
      bookingPrompt = "This sounds urgent. Would you like me to book an emergency appointment for you?";
    }
    
    stateMachine.currentState = 'ask_booking';
    const response = await getResponse(bookingPrompt, stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('askNextQuestion: Booking prompt', response);
    return response;
  }
}

async function askBooking(input) {
  console.log('askBooking: User response', input);
  
  // Check if user wants to book (says yes or provides their name)
  if (input.toLowerCase().includes('yes') || 
      input.toLowerCase().includes('book') || 
      input.toLowerCase().includes('appointment') ||
      // Check if input looks like a name (contains letters and possibly spaces)
      /^[a-zA-Z\s]+$/.test(input.trim())) {
    
    // If they provided a name directly, store it
    if (/^[a-zA-Z\s]+$/.test(input.trim()) && !input.toLowerCase().includes('yes')) {
      stateMachine.clientData.name = input.trim();
      console.log('askBooking: Stored name directly:', input.trim());
    }
    
    stateMachine.currentState = 'collect_details';
    stateMachine.questionIndex = 0;
    return await collectClientDetails('');
  } else {
    stateMachine.currentState = 'general';
    return await getResponse("Okay, how else can I assist you today?", stateMachine.conversationHistory);
  }
}

async function collectClientDetails(input) {
  console.log('collectClientDetails: Current data', stateMachine.clientData);
  const details = ['name', 'email', 'address']; // Removed 'phone' since it's auto-set
  const currentDetail = details.find(d => !stateMachine.clientData[d]);
  if (currentDetail) {
    if (input) stateMachine.clientData[currentDetail] = input;
    const prompts = {
      name: "What's your full name, please?",
      email: "Could I have your email address?",
      address: "And your full address?",
    };
    const response = await getResponse(prompts[currentDetail], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('collectClientDetails: Prompt', response);
    return response;
  } else {
    // stateMachine.currentState = 'book_appointment';
    stateMachine.awaitingAddress = false;
    stateMachine.awaitingTime    = true;
    let response;
    if (stateMachine.clientData.urgent) {
      // For urgent, directly compute and propose next slot
      response = await handleAppointmentBooking('asap'); // Pass 'asap' to indicate urgent
    } else {
     response = await getResponse("When would you like your appointment? Please give me a date & time (e.g. “tomorrow at 9 AM UTC”).", stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      console.log('collectClientDetails: Booking prompt', response);
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
  const now = new Date().toLocaleString('en-US', { timeZone: BRISBANE_TZ });
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

  const lastAppointment = await getLastAppointment(accessToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  if (lastAppointment) {
    const lastEndTime = new Date(lastAppointment.end.dateTime);
    const lastLocation = lastAppointment.location?.displayName || 'Unknown';
    const travelTime = await calculateTravelTime(lastLocation, stateMachine.clientData.address);
    const buffer = 30;
    earliestStartTime = new Date(Math.max(lastEndTime.getTime(), minStartDate.getTime()) + (travelTime + buffer) * 60 * 1000);
    console.log('handleAppointmentBooking: Earliest start time with travel', earliestStartTime);
  }

  let nextSlot;
  if (stateMachine.clientData.urgent || input.toLowerCase().includes('asap') || input.toLowerCase().includes('soon')) {
    nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
    if (!nextSlot || nextSlot > maxEndDate) {
      console.log('handleAppointmentBooking: No slot available');
      return "Sorry, no slots are available today. Would you like to try another day?";
    }
  } else {
    // Parse preferred time from input
    const parsePrompt = `Parse the preferred appointment time from: "${input}". Current time is ${now.toISOString()}. Return ISO datetime string (YYYY-MM-DDTHH:mm:00Z) or "invalid" if can't parse. Assume UTC. If no date, use today or tomorrow if past.`;
    let preferredStr = await getResponse(parsePrompt);
    if (preferredStr === "invalid") {
      return await getResponse("Sorry, I didn't understand the time. When would you like your appointment?", stateMachine.conversationHistory);
    }
    const preferred = new Date(preferredStr);
    if (isNaN(preferred.getTime())) {
      return await getResponse("Sorry, I didn't understand the time. When would you like your appointment?", stateMachine.conversationHistory);
    }
    
    const preferredEnd = new Date(preferred.getTime() + 60 * 60 * 1000);
    const isFree = await isSlotFree(accessToken, preferred, preferredEnd);
    if (preferred >= earliestStartTime && isFree) {
      nextSlot = preferred;
    } else {
      nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
      if (!nextSlot || nextSlot > maxEndDate) {
        console.log('handleAppointmentBooking: No slot available');
        return "Sorry, no slots are available today. Would you like to try another day?";
      }
    }
  }
  const BRISBANE_TZ = 'Australia/Brisbane'
  stateMachine.nextSlot = nextSlot;
  const formattedSlot = nextSlot.toLocaleString('en-US', { 
    timeZone: BRISBANE_TZ, 
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: true,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
  const response = await getResponse(`The next available slot is ${formattedSlot} Brisbane time. Does that work for you?`, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  stateMachine.currentState = 'confirm_slot';
  console.log('handleAppointmentBooking: Slot offered', formattedSlot);
  return response;
}

async function confirmSlot(input) {
  console.log('confirmSlot: User response', input);
  if (input.toLowerCase().includes('yes') || input.toLowerCase().includes('okay')) {
    stateMachine.currentState = 'special_instructions';
    const response = await getResponse("Great! Any special instructions, like gate codes or security details?", stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('confirmSlot: Asking for instructions', response);
    return response;
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

  // Save contact to GHL with better error handling
  try {
    const contactData = {
      firstName: stateMachine.clientData.name?.split(' ')[0] || '',
      lastName: stateMachine.clientData.name?.split(' ').slice(1).join(' ') || '',
      email: stateMachine.clientData.email,
      phone: stateMachine.clientData.phone,
      address: stateMachine.clientData.address,
      customField: {
        specialInstructions: input || 'None'
      }
    };
    await createOrUpdateContact(contactData);
    console.log('collectSpecialInstructions: Contact saved to GHL');
  } catch (error) {
    console.error('collectSpecialInstructions: GHL contact save failed', error);
    // Don't fail the entire booking if GHL fails
  }

  // Book appointment with better error handling and retry logic
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const eventDetails = {
      summary: 'Plumbing Appointment',
      start: { dateTime: stateMachine.nextSlot.toISOString(), timeZone: BRISBANE_TZ },
      end: { dateTime: new Date(stateMachine.nextSlot.getTime() + 60 * 60 * 1000).toISOString(), timeZone: BRISBANE_TZ },
      location: stateMachine.clientData.address,
      description: `Special Instructions: ${input || 'None'}`,
    };
    
    const appointment = await createAppointment(accessToken, eventDetails);
    if (appointment) {
      const formattedTime = stateMachine.nextSlot.toLocaleString('en-US', { 
        timeZone: BRISBANE_TZ,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      });
      stateMachine.bookingRetryCount = 0; // Reset on success
      const response = await getResponse(`All set, ${stateMachine.clientData.name}! Your appointment is booked for ${formattedTime} Brisbane time. Anything else I can help with?`, stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      stateMachine.currentState = 'general';
      console.log('collectSpecialInstructions: Appointment booked', formattedTime);
      return response;
    } else {
      throw new Error('Appointment creation returned null');
    }
  } catch (error) {
    console.error('collectSpecialInstructions: Booking failed', error);
    // Increment retry count
    stateMachine.bookingRetryCount = (stateMachine.bookingRetryCount || 0) + 1;
    if (stateMachine.bookingRetryCount < 2) {
      // Retry booking
      return await collectSpecialInstructions(input);
    } else {
      // Give up and inform the user
      stateMachine.bookingRetryCount = 0; // Reset for next conversation
      const response = "Sorry, there was an error with your booking. The chat will now end.";
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      stateMachine.currentState = 'ended'; // Mark chat as ended
      return response;
    }
  }
}

async function handleGeneralQuery(input) {
  console.log('handleGeneralQuery: Processing', input);
  const response = await getResponse(input.includes('AI') ? "Yep, I'm an AI assistant for Usher Fix Plumbing! How can I help you?" : input, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  console.log('handleGeneralQuery: Response', response);
  return response;
}

// Add this function to handle conversation timeouts
async function handleTimeout() {
  const response = await getResponse("It seems like you're not responding. Is there anything else I can help you with today?", stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
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

module.exports = { handleInput, stateMachine, handleTimeout }