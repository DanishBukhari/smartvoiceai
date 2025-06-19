const { getResponse } = require('./nlp');
const { createOrUpdateContact } = require('./ghl');
const { getAccessToken, getLastAppointment, getNextAvailableSlot, createAppointment } = require('./outlook');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const stateMachine = {
  currentState: 'start',
  conversationHistory: [],
  clientData: {},
  issueType: null,
  urgency: null,
  questionIndex: 0,
  nextSlot: null,
};

const issueQuestions = {
  'toilet': [
    "I’m so sorry you’re dealing with this—what’s happening? Blocked, leaking, running, or not flushing?",
    "Is it still leaking or stopped?",
    "How many toilets or showers do you have?",
  ],
  'burst/leak': [
    "That sounds stressful—has the water been shut off, or is it still running?",
    "Is there any flooding inside or outside?",
  ],
  'hot-water': [
    "No hot water can really throw your day off—do you have any hot water at all?",
    "Is it Gas, Electric, or Solar?",
    "Do you see any leak—steady drip or fast?",
    "Roughly how old—under ten years or over ten?",
    "What size tank—125 L, 250 L, 315 L, or other?",
  ],
  'rain-pump': [
    "Thank you for calling us—let's get you sorted. Is the pump standalone or submersible?",
    "Does it supply toilets, laundry, or garden?",
    "Are those fixtures still getting water?",
  ],
  'roof leak': [
    "Thank you for calling us—let's see what we can do for you. Is water actively dripping inside right now?",
    "Do you see the ceiling bulging or sagging?",
  ],
  'new install/quote': [
    "Could you describe what you’d like us to quote—new installation, repair, or inspection?",
  ],
  'other': [
    "Could you describe what you’d like us to quote—new installation, repair, or inspection?",
  ],
};

async function calculateTravelTime(origin, destination) {
  try {
    const prompt = `Estimate the driving time in minutes from "${origin}" to "${destination}" in a typical urban area. Provide only the number of minutes.`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
    });
    const travelTime = parseInt(response.choices[0].message.content.trim());
    return isNaN(travelTime) ? 30 : travelTime; // Default to 30 minutes if invalid
  } catch (error) {
    console.error('Travel Time Calculation Error:', error);
    return 30; // Fallback to 30 minutes
  }
}

async function handleInput(input) {
  stateMachine.conversationHistory.push({ role: 'user', content: input });

  if (stateMachine.currentState === 'start') {
    const issuePrompt = `Identify the issue type from the user's query: Toilet, Burst/Leak, Hot-Water, Rain-Pump, Roof Leak, New Install/Quote, or Other. Query: "${input}"`;
    stateMachine.issueType = (await getResponse(issuePrompt)).toLowerCase();
    if (issueQuestions[stateMachine.issueType]) {
      stateMachine.currentState = stateMachine.issueType;
      stateMachine.questionIndex = 0;
      return await askNextQuestion();
    } else {
      stateMachine.currentState = 'general';
      return await handleGeneralQuery(input);
    }
  } else if (issueQuestions[stateMachine.currentState]) {
    stateMachine.clientData[`${stateMachine.currentState}_${stateMachine.questionIndex}`] = input;
    stateMachine.questionIndex++;
    return await askNextQuestion();
  } else if (stateMachine.currentState === 'collect_details') {
    return await collectClientDetails(input);
  } else if (stateMachine.currentState === 'confirm_details') {
    return await confirmClientDetails(input);
  } else if (stateMachine.currentState === 'book_appointment') {
    return await handleAppointmentBooking(input);
  } else if (stateMachine.currentState === 'confirm_slot') {
    return await confirmSlot(input);
  } else if (stateMachine.currentState === 'general') {
    return await handleGeneralQuery(input);
  }
}

async function askNextQuestion() {
  const questions = issueQuestions[stateMachine.currentState];
  if (stateMachine.questionIndex < questions.length) {
    const response = await getResponse(questions[stateMachine.questionIndex], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  } else {
    stateMachine.urgency = triageUrgency(stateMachine.clientData, stateMachine.currentState);
    stateMachine.currentState = 'collect_details';
    return await collectClientDetails('');
  }
}

function triageUrgency(data, issue) {
  if (issue === 'toilet' && data['toilet_2'] === '1' && data['toilet_1'].toLowerCase().includes('unusable')) return 'URGENT';
  if (issue === 'burst/leak' && (data['burst/leak_0'].toLowerCase().includes('running') || data['burst/leak_1'].toLowerCase().includes('flooding'))) return 'URGENT';
  if (issue === 'hot-water' && (data['hot-water_0'].toLowerCase().includes('no') || data['hot-water_2'].toLowerCase().includes('fast'))) return 'URGENT';
  if (issue === 'rain-pump' && data['rain-pump_2'].toLowerCase().includes('no')) return 'URGENT';
  if (issue === 'roof leak' && (data['roof leak_0'].toLowerCase().includes('yes') || data['roof leak_1'].toLowerCase().includes('yes'))) return 'URGENT';
  return 'routine';
}

async function collectClientDetails(input) {
  const details = ['name', 'email', 'phone', 'address', 'source'];
  const currentDetail = details.find(d => !stateMachine.clientData[d]);
  if (currentDetail) {
    if (input) stateMachine.clientData[currentDetail] = input;
    const prompts = {
      name: "Could I get your full name—could you spell that so I get it right?",
      email: "Your email—please spell it out.",
      phone: "Your phone number, please?",
      address: "Your street and suburb—could you spell those too?",
      source: "If you don’t mind me asking, how did you find out about us—Google, a friend, BNI, something else?",
    };
    const response = await getResponse(prompts[currentDetail], stateMachine.conversationHistory);
    stateMachine.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  } else {
    const confirmation = `Let me confirm: Name: ${stateMachine.clientData.name}, Email: ${stateMachine.clientData.email}, Phone: ${stateMachine.clientData.phone}, Address: ${stateMachine.clientData.address}. Did I get that exactly right?`;
    stateMachine.currentState = 'confirm_details';
    stateMachine.conversationHistory.push({ role: 'assistant', content: confirmation });
    return confirmation;
  }
}

async function confirmClientDetails(input) {
  if (input.toLowerCase().includes('yes')) {
    if (stateMachine.urgency === 'URGENT') {
      await saveContact();
      return "I know this is urgent. Tamsin from our Operations team will get back to you ASAP. Anything else before I let you go?";
    } else {
      stateMachine.currentState = 'book_appointment';
      return "Great! I’ll check our calendar—when would you like your appointment?";
    }
  } else {
    stateMachine.clientData = {};
    stateMachine.currentState = 'collect_details';
    return "I’m sorry, let’s try that again. Could I get your full name—could you spell that so I get it right?";
  }
}

async function handleAppointmentBooking(input) {
  const accessToken = await getAccessToken();
  if (!accessToken) return "I'm sorry, I couldn’t access the calendar. Please try again later.";

  const minStartDate = new Date('2025-06-20T07:00:00Z');
  const now = new Date();
  let earliestStartTime = now > minStartDate ? now : minStartDate;

  const lastAppointment = await getLastAppointment(accessToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  if (lastAppointment) {
    const lastEndTime = new Date(lastAppointment.end.dateTime);
    const lastLocation = lastAppointment.location?.displayName || 'Unknown';
    const travelTime = await calculateTravelTime(lastLocation, stateMachine.clientData.address);
    const buffer = 30; // 30-minute job buffer
    earliestStartTime = new Date(Math.max(lastEndTime.getTime(), minStartDate.getTime()) + (travelTime + buffer) * 60 * 1000);
  }

  const nextSlot = await getNextAvailableSlot(accessToken, earliestStartTime);
  if (!nextSlot) return "I’m sorry, no slots are available soon. Would you like to try another day?";

  stateMachine.nextSlot = nextSlot;
  const formattedSlot = nextSlot.toLocaleString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: 'numeric', hour12: true });
  const confirmation = `Our next available slot is ${formattedSlot} UTC. Does that work for you?`;
  stateMachine.conversationHistory.push({ role: 'assistant', content: confirmation });
  stateMachine.currentState = 'confirm_slot';
  return confirmation;
}

async function confirmSlot(input) {
  if (input.toLowerCase().includes('yes') || input.toLowerCase().includes('okay')) {
    const accessToken = await getAccessToken();
    const eventDetails = {
      subject: 'Plumbing Appointment',
      start: { dateTime: stateMachine.nextSlot.toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(stateMachine.nextSlot.getTime() + 60 * 60 * 1000).toISOString(), timeZone: 'UTC' },
      location: { displayName: stateMachine.clientData.address },
    };
    const appointment = await createAppointment(accessToken, eventDetails);
    if (appointment) {
      await saveContact();
      const formattedTime = stateMachine.nextSlot.toLocaleString('en-US', { timeZone: 'UTC' });
      return `All set, ${stateMachine.clientData.name}! Your appointment is booked for ${formattedTime} UTC. Anything else?`;
    } else {
      return "I’m sorry, I couldn’t book the appointment. Please try again later.";
    }
  } else {
    stateMachine.currentState = 'book_appointment';
    return "No worries! When would you like your appointment instead?";
  }
}

async function handleGeneralQuery(input) {
  const response = await getResponse(`Answer the user's query: "${input}". If you don’t know, say "I’m not sure about that, but I can help with plumbing issues!"`, stateMachine.conversationHistory);
  stateMachine.conversationHistory.push({ role: 'assistant', content: response });
  return response;
}

async function saveContact() {
  const contactData = {
    firstName: stateMachine.clientData.name.split(' ')[0],
    lastName: stateMachine.clientData.name.split(' ').slice(1).join(' ') || '',
    email: stateMachine.clientData.email,
    phone: stateMachine.clientData.phone,
    address: stateMachine.clientData.address,
    customFields: [
      { id: 'AKnXqcpVmWwVSKaN4f5Q', value: stateMachine.urgency === 'URGENT' ? `URGENT: ${stateMachine.issueType}` : stateMachine.issueType },
    ],
    tags: ['biz-card-scan', stateMachine.clientData.source?.toLowerCase() || 'unknown'],
  };
  const contact = await createOrUpdateContact(contactData);
  stateMachine.clientData.contactId = contact.id;
}

module.exports = { handleInput };