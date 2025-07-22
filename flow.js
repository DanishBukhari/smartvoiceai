// flow.js
const { getResponse } = require('./nlp');
const {
  getAccessToken,
  getLastAppointment,
  getNextAvailableSlot,
  isSlotFree,
  createAppointment
} = require('./outlook');
const { createOrUpdateContact } = require('./ghl');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Question sequences by issue
const issueQuestions = {
  'toilet': [
    "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    "Is it still leaking or has it stopped?",
    "How many toilets or showers do you have?"
  ],
  'hot water system': [
    "Do you have any hot water at all?",
    "Is your hot water system gas, electric, or solar?",
    "Do you notice any leaks—steady drip or fast?",
    "How old is the system—under 10 years or over?",
    "What's the tank size—125L, 250L, 315L, or something else?"
  ],
  'burst/leak': [
    "Has the water been shut off, or is it still running?",
    "Is there flooding inside or outside?"
  ],
  'rain-pump': [
    "Is your rainwater pump standalone or submersible?",
    "Does it supply toilets, laundry, or garden?",
    "Are those fixtures still getting water?"
  ],
  'roof leak': [
    "Is water dripping inside right now?",
    "Is the ceiling bulging or sagging?"
  ],
  'new install/quote': [
    "What would you like us to quote—new installation, repair, or inspection?"
  ],
  'other': [
    "Can you describe the issue or what you need?"
  ]
};

// ————— Learning / Analytics (unchanged) —————
const conversationInsights = { /* … */ };
const botAnalytics = { /* … */ };

// ————— Helper: travel time estimate —————
async function calculateTravelTime(origin, destination) {
  const prompt = `Estimate the driving time in minutes from "${origin}" to "${destination}" in a typical Australian urban area. Return only the number of minutes.`;
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8
    });
    const mins = parseInt(resp.choices[0].message.content.trim(), 10);
    return isNaN(mins) ? 30 : mins;
  } catch {
    return 30;
  }
}

// ————— Main entry —————
async function handleInput(input, confidence = 1.0) {
  // Validation
  if (!input || confidence < 0.3) {
    return confidence < 0.3
      ? "Sorry, I didn't quite catch that. Could you please repeat?"
      : "I didn't catch that. Could you repeat, please?";
  }

  stateMachine.conversationHistory.push({ role: 'user', content: input });
  let response;

  try {
    switch (stateMachine.currentState) {
      case 'start':
        response = await handleStart(input);
        break;

      case 'toilet':
      case 'hot water system':
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
        stateMachine.currentState = 'general';
        response = await getResponse(`I’m sorry, I got a bit turned around. You said: "${input}". How can I help?`, stateMachine.conversationHistory);
    }

  } catch (err) {
    response = await getResponse(
      `I’m having trouble right now. You said: "${input}". Could you clarify or ask in a different way?`,
      stateMachine.conversationHistory
    );
  }

  return response;
}

// ————— handleStart: identify issue fast‑path + AI fallback —————
async function handleStart(input) {
  const lower = input.toLowerCase();
  const fast = {
    toilet: "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    'hot water': "Do you have any hot water at all?",
    water: "Do you have any hot water at all?",
    leak: "Has the water been shut off, or is it still running?",
    pipe: "Has the water been shut off, or is it still running?",
    pump: "Is your rainwater pump standalone or submersible?",
    roof: "Is water dripping inside right now?",
    quote: "What would you like us to quote—new installation, repair, or inspection?"
  };

  for (const [key, question] of Object.entries(fast)) {
    if (lower.includes(key)) {
      stateMachine.issueType = key === 'hot water' || key === 'water' ? 'hot water system' : key;
      stateMachine.currentState = stateMachine.issueType;
      stateMachine.questionIndex = 0;
      return question;
    }
  }

  // AI fallback to categorize
  const categorizePrompt = `
Analyze this customer query and identify the primary plumbing issue. Return exactly one of:
toilet, hot water system, burst/leak, rain-pump, roof leak, new install/quote, other.
Customer: "${input}"
`;
  const cat = (await getResponse(categorizePrompt)).trim().toLowerCase();
  if (issueQuestions[cat]) {
    stateMachine.issueType = cat;
    stateMachine.currentState = cat;
    stateMachine.questionIndex = 0;
    return askNextQuestion('');
  }

  stateMachine.currentState = 'general';
  return handleGeneralQuery(input);
}

// ————— askNextQuestion: advance through issueQuestions —————
async function askNextQuestion(input) {
  const state = stateMachine.currentState;
  // save answer
  if (input) {
    stateMachine.clientData[`${state}_${stateMachine.questionIndex}`] = input;
  }

  const qList = issueQuestions[state];
  if (stateMachine.questionIndex < qList.length) {
    let q = qList[stateMachine.questionIndex];
    // optionally contextualize
    if (stateMachine.questionIndex > 0) {
      const prev = stateMachine.clientData[`${state}_${stateMachine.questionIndex - 1}`];
      q = await getResponse(
        `Based on the customer's answer "${prev}", rephrase: "${q}". Keep it natural.`
      );
    }
    stateMachine.questionIndex++;
    return getResponse(q, stateMachine.conversationHistory);
  }

  // all done → ask booking
  stateMachine.currentState = 'ask_booking';
  stateMachine.questionIndex = 0;
  return getResponse(
    stateMachine.clientData.urgent
      ? "This sounds urgent. Would you like me to book an emergency appointment for you?"
      : "Would you like to book an appointment for this?",
    stateMachine.conversationHistory
  );
}

// ————— askBooking: detect “yes” or name → collect details —————
async function askBooking(input) {
  if (/^(yes|sure|please book|appointment)/i.test(input) ||
      /^[a-zA-Z\s]+$/.test(input) && !/no/i.test(input)) {
    // if plain name
    if (/^[a-zA-Z\s]+$/.test(input.trim()) && !/yes/i.test(input)) {
      stateMachine.clientData.name = input.trim();
    }
    stateMachine.currentState = 'collect_details';
    return collectClientDetails('');
  }
  stateMachine.currentState = 'general';
  return getResponse("Okay, what else can I help you with?", stateMachine.conversationHistory);
}

// ————— collectClientDetails: name → email → address → time prompt —————
async function collectClientDetails(input) {
  const needed = ['name', 'email', 'address'];
  const next = needed.find(n => !stateMachine.clientData[n]);
  if (next) {
    if (input) stateMachine.clientData[next] = input;
    const prompts = {
      name: "What's your full name, please?",
      email: "Could I have your email address?",
      address: "And your full address?"
    };
    return getResponse(prompts[next], stateMachine.conversationHistory);
  }

  // all details in → go to booking time
  stateMachine.currentState = 'book_appointment';
  return getResponse(
    "When would you like your appointment? Please give me a date & time (e.g. “tomorrow at 9 AM Brisbane time”).",
    stateMachine.conversationHistory
  );
}

// ————— handleAppointmentBooking: parse or ASAP, find next slot —————
async function handleAppointmentBooking(input) {
  const token = await getAccessToken();
  if (!token) return "Sorry, I can't access the calendar right now.";

  // Brisbane‐localized “now”
  const nowBris = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' })
  );
  // Build today 7 AM–7 PM range
  const today = new Date(nowBris.setHours(0,0,0,0));
  let earliest = new Date(today.getTime() + 7*3600*1000);
  const late =      new Date(today.getTime() + 19*3600*1000);
  if (nowBris > late) {
    earliest = new Date(today.getTime() + 24*3600*1000 + 7*3600*1000);
  } else if (nowBris > earliest) {
    earliest = nowBris;
  }

  // Check last appointment + travel
  const last = await getLastAppointment(token, new Date(today.getTime() + 7*24*3600*1000));
  if (last) {
    const end = new Date(last.end.dateTime);
    const travel = await calculateTravelTime(last.location.displayName||'Unknown', stateMachine.clientData.address);
    earliest = new Date(Math.max(end, earliest.getTime()) + (travel+30)*60000);
  }

  let slot;
  if (/asap|urgent|soon/i.test(input)) {
    slot = await getNextAvailableSlot(token, earliest);
    if (!slot || slot > late) {
      return "Sorry, no slots are available today. Would you like another day?";
    }
  } else {
    // parse ISO from user
    const parsePrompt = `
Parse the date/time from: "${input}". Assume Brisbane time. 
Return an ISO string like "2025-07-24T09:00:00", or "invalid" if you can't.
`;
    let iso = await getResponse(parsePrompt);
    if (iso === 'invalid') {
      return getResponse("Sorry, I didn't understand. When would you like your appointment?", stateMachine.conversationHistory);
    }
    const dt = new Date(iso);
    const endDt = new Date(dt.getTime()+3600*1000);
    if (dt >= earliest && await isSlotFree(token, dt, endDt)) {
      slot = dt;
    } else {
      slot = await getNextAvailableSlot(token, earliest);
      if (!slot || slot > late) {
        return "Sorry, no slots are available today. Another day?";
      }
    }
  }

  stateMachine.nextSlot = slot;
  const formatted = slot.toLocaleString('en-US', {
    timeZone: 'Australia/Brisbane',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });

  stateMachine.currentState = 'confirm_slot';
  return getResponse(`The next available slot is ${formatted} Brisbane time. Does that work for you?`, stateMachine.conversationHistory);
}

// ————— confirmSlot: yes → instructions, no → retry —————
async function confirmSlot(input) {
  if (/^(yes|okay|that works)/i.test(input)) {
    stateMachine.currentState = 'special_instructions';
    return getResponse("Great! Any special instructions, like gate codes or security details?", stateMachine.conversationHistory);
  }
  stateMachine.currentState = 'book_appointment';
  return getResponse("No problem—when would you prefer instead?", stateMachine.conversationHistory);
}

// ————— collectSpecialInstructions + finalize booking —————
async function collectSpecialInstructions(input) {
  stateMachine.clientData.specialInstructions = input;

  // Save contact in GHL
  try {
    const [first, ...rest] = (stateMachine.clientData.name || '').split(' ');
    await createOrUpdateContact({
      firstName: first || '',
      lastName: rest.join(' ') || '',
      email: stateMachine.clientData.email,
      address: stateMachine.clientData.address,
      customField: { specialInstructions: input || 'None' }
    });
  } catch {}

  // Create Outlook event
  try {
    const token = await getAccessToken();
    const start = stateMachine.nextSlot.toISOString();
    const end   = new Date(stateMachine.nextSlot.getTime()+3600*1000).toISOString();
    const event = await createAppointment(token, {
      subject: 'Plumbing Appointment',
      start: { dateTime: start, timeZone: 'UTC' },
      end:   { dateTime: end,   timeZone: 'UTC' },
      location: { displayName: stateMachine.clientData.address },
      body: { content: `Instructions: ${input}`, contentType: 'text' }
    });
    const confirmTime = stateMachine.nextSlot.toLocaleString('en-US',{
      timeZone:'Australia/Brisbane',
      weekday:'long', month:'long', day:'numeric',
      hour:'numeric', minute:'numeric', hour12:true
    });
    stateMachine.currentState = 'general';
    return getResponse(
      `All set, ${stateMachine.clientData.name}! Your appointment is booked for ${confirmTime} Brisbane time. Anything else I can help with?`,
      stateMachine.conversationHistory
    );
  } catch {
    return "Sorry, there was an error finalizing your booking. Please try again later.";
  }
}

// ————— general Q&A —————
async function handleGeneralQuery(input) {
  return getResponse(input, stateMachine.conversationHistory);
}

module.exports = { handleInput, stateMachine };
