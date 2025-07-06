//the scenarios of the texts
const { getResponse } = require('./nlp');
const { getAccessToken, getLastAppointment, getNextAvailableSlot, createAppointment } = require('./outlook');
const { createOrUpdateContact } = require('./ghl');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const stateMachine = {
  currentState: 'start',
  conversationHistory: [],
  clientData: {},
  issueType: null,
  questionIndex: 0,
  nextSlot: null,
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

async function handleInput(input) {
  console.log('handleInput: Processing', input);
  
  // Add input validation
  if (!input || input.trim().length === 0) {
    return "I didn't catch that. Could you please repeat what you said?";
  }
  
  stateMachine.conversationHistory.push({ role: 'user', content: input });

  try {
    switch (stateMachine.currentState) {
      case 'start':
        return await handleStart(input);
      case 'hot water system':
      case 'toilet':
      case 'burst/leak':
      case 'rain-pump':
      case 'roof leak':
      case 'new install/quote':
      case 'other':
        return await askNextQuestion(input);
      case 'ask_booking':
        return await askBooking(input);
      case 'collect_details':
        return await collectClientDetails(input);
      case 'book_appointment':
        return await handleAppointmentBooking(input);
      case 'confirm_slot':
        return await confirmSlot(input);
      case 'special_instructions':
        return await collectSpecialInstructions(input);
      case 'general':
        return await handleGeneralQuery(input);
      default:
        // Reset to start if in unknown state
        stateMachine.currentState = 'start';
        return await handleStart(input);
    }
  } catch (error) {
    console.error('handleInput error:', error);
    return "I'm sorry, I'm having trouble processing that. Could you please try again?";
  }
}

async function handleStart(input) {
  console.log('handleStart: Identifying issue');
  const issuePrompt = `Identify the plumbing issue from: toilet, hot water system, burst/leak, rain-pump, roof leak, new install/quote, other. Query: "${input}"`;
  stateMachine.issueType = (await getResponse(issuePrompt)).toLowerCase();
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
  const questions = issueQuestions[stateMachine.currentState];
  if (input) stateMachine.clientData[`${stateMachine.currentState}_${stateMachine.questionIndex}`] = input;
  if (stateMachine.questionIndex < questions.length) {
    const response = await getResponse(questions[stateMachine.questionIndex], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.questionIndex++;
    console.log('askNextQuestion: Response', response);
    return response;
  } else {
    stateMachine.currentState = 'ask_booking';
    const response = await getResponse("Would you like to book an appointment for this?", stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('askNextQuestion: Booking prompt', response);
    return response;
  }
}

async function askBooking(input) {
  console.log('askBooking: User response', input);
  if (input.toLowerCase().includes('yes')) {
    stateMachine.currentState = 'collect_details';
    return await collectClientDetails('');
  } else {
    stateMachine.currentState = 'general';
    return await getResponse("Okay, how else can I assist you today?", stateMachine.conversationHistory);
  }
}

async function collectClientDetails(input) {
  console.log('collectClientDetails: Current data', stateMachine.clientData);
  const details = ['name', 'email', 'phone', 'address'];
  const currentDetail = details.find(d => !stateMachine.clientData[d]);
  if (currentDetail) {
    if (input) stateMachine.clientData[currentDetail] = input;
    const prompts = {
      name: "What's your full name, please?",
      email: "Could I have your email address?",
      phone: "What's your phone number?",
      address: "And your full address?",
    };
    const response = await getResponse(prompts[currentDetail], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('collectClientDetails: Prompt', response);
    return response;
  } else {
    stateMachine.currentState = 'book_appointment';
    const response = await getResponse("When would you like your appointment? Our day starts at 7 AM UTC.", stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    console.log('collectClientDetails: Booking prompt', response);
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

  // Use dynamic dates instead of hardcoded May 28
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

  const lastAppointment = await getLastAppointment(accessToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  if (lastAppointment) {
    const lastEndTime = new Date(lastAppointment.end.dateTime);
    const lastLocation = lastAppointment.location?.displayName || 'Unknown';
    const travelTime = await calculateTravelTime(lastLocation, stateMachine.clientData.address);
    const buffer = 30;
    earliestStartTime = new Date(Math.max(lastEndTime.getTime(), minStartDate.getTime()) + (travelTime + buffer) * 60 * 1000);
    console.log('handleAppointmentBooking: Earliest start time with travel', earliestStartTime);
  }

  const nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
  if (!nextSlot || nextSlot > maxEndDate) {
    console.log('handleAppointmentBooking: No slot available');
    return "Sorry, no slots are available today. Would you like to try another day?";
  }

  stateMachine.nextSlot = nextSlot;
  const formattedSlot = nextSlot.toLocaleString('en-US', { 
    timeZone: 'UTC', 
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: true,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
  const response = await getResponse(`The next available slot is ${formattedSlot} UTC. Does that work for you?`, stateMachine.conversationHistory);
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

  // Book appointment with better error handling
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const eventDetails = {
      subject: 'Plumbing Appointment',
      start: { dateTime: stateMachine.nextSlot.toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(stateMachine.nextSlot.getTime() + 60 * 60 * 1000).toISOString(), timeZone: 'UTC' },
      location: { displayName: stateMachine.clientData.address },
      body: { content: `Special Instructions: ${input || 'None'}`, contentType: 'text' },
    };
    
    const appointment = await createAppointment(accessToken, eventDetails);
    if (appointment) {
      const formattedTime = stateMachine.nextSlot.toLocaleString('en-US', { 
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      });
      const response = await getResponse(`All set, ${stateMachine.clientData.name}! Your appointment is booked for ${formattedTime} UTC. Anything else I can help with?`, stateMachine.conversationHistory);
      stateMachine.conversationHistory.push({ role: 'assistant', content: response });
      stateMachine.currentState = 'general';
      console.log('collectSpecialInstructions: Appointment booked', formattedTime);
      return response;
    } else {
      throw new Error('Appointment creation returned null');
    }
  } catch (error) {
    console.error('collectSpecialInstructions: Booking failed', error);
    const response = await getResponse("I'm sorry, I couldn't book the appointment due to a technical issue. Please try calling back later or contact us directly.", stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    stateMachine.currentState = 'general';
    return response;
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

module.exports = { handleInput, stateMachine, handleTimeout };