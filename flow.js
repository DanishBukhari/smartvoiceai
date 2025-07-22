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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const stateMachine = {
  currentState: 'start',
  questionIndex: 0,
  conversationHistory: [],
  clientData: {},
  issueType: null,
  nextSlot: null,
  bookingRetryCount: 0
};

const issueQuestions = {
  toilet: [
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
  other: [
    "Can you describe the issue or what you need?"
  ]
};

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

async function handleInput(input, confidence = 1.0) {
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
      default:
        response = await getResponse(
          `I’m a bit lost—could you clarify? You said: "${input}".`,
          stateMachine.conversationHistory
        );
        stateMachine.currentState = 'general';
    }
  } catch {
    response = await getResponse(
      `Sorry, I ran into an error. Could you rephrase?`,
      stateMachine.conversationHistory
    );
  }

  return response;
}

async function handleStart(input) {
  const lower = input.toLowerCase();
  const fast = {
    toilet: 'toilet',
    'hot water': 'hot water system',
    water: 'hot water system',
    leak: 'burst/leak',
    pump: 'rain-pump',
    roof: 'roof leak',
    quote: 'new install/quote'
  };
  for (const key of Object.keys(fast)) {
    if (lower.includes(key)) {
      stateMachine.issueType = fast[key];
      stateMachine.currentState = fast[key];
      stateMachine.questionIndex = 0;
      return issueQuestions[fast[key]][0];
    }
  }

  const prompt = `
Analyze this customer query and choose one category: toilet, hot water system, burst/leak, rain-pump, roof leak, new install/quote, or other.
Customer: "${input}"
Return only the category name.
`;
  const category = (await getResponse(prompt)).trim().toLowerCase();
  if (issueQuestions[category]) {
    stateMachine.issueType = category;
    stateMachine.currentState = category;
    stateMachine.questionIndex = 0;
    return issueQuestions[category][0];
  }

  stateMachine.currentState = 'general';
  return getResponse(input, stateMachine.conversationHistory);
}

async function askNextQuestion(input) {
  const state = stateMachine.currentState;
  if (input) {
    stateMachine.clientData[`${state}_${stateMachine.questionIndex}`] = input;
  }
  const qs = issueQuestions[state];
  if (stateMachine.questionIndex < qs.length - 1) {
    stateMachine.questionIndex++;
    return qs[stateMachine.questionIndex];
  }

  stateMachine.currentState = 'ask_booking';
  return stateMachine.clientData.urgent
    ? "This sounds urgent. Shall I book an emergency appointment for you?"
    : "Would you like to book an appointment for this?";
}

async function askBooking(input) {
  if (/^(yes|sure|please book|appointment)/i.test(input)) {
    stateMachine.currentState = 'collect_details';
    return "Great—let's get some details. What's your full name?";
  }
  stateMachine.currentState = 'general';
  return "Okay, what else can I help with today?";
}

async function collectClientDetails(input) {
  const fields = ['name', 'email', 'address'];
  for (const f of fields) {
    if (!stateMachine.clientData[f]) {
      if (input) stateMachine.clientData[f] = input;
      const questions = {
        name: "What's your full name, please?",
        email: "Could I have your email address?",
        address: "And your full address?"
      };
      return questions[f];
    }
  }
  stateMachine.currentState = 'book_appointment';
  return "When would you like your appointment? (e.g. “tomorrow at 9 AM Brisbane time”).";
}

async function handleAppointmentBooking(input) {
  const token = await getAccessToken();
  if (!token) return "Sorry, calendar access is unavailable right now.";

  const nowBris = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' })
  );
  const todayStart = new Date(nowBris.setHours(7, 0, 0, 0));
  const todayEnd   = new Date(nowBris.setHours(19, 0, 0, 0));
  let earliest = nowBris > todayStart ? nowBris : todayStart;
  if (nowBris > todayEnd) {
    earliest = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  }

  const last = await getLastAppointment(token, new Date());
  if (last) {
    const travel = await calculateTravelTime(
      last.location.displayName || 'Unknown',
      stateMachine.clientData.address
    );
    earliest = new Date(
      Math.max(new Date(last.end.dateTime).getTime(), earliest.getTime()) +
        (travel + 30) * 60000
    );
  }

  let slot;
  if (/asap|urgent/i.test(input)) {
    slot = await getNextAvailableSlot(token, earliest);
  } else {
    const parsePrompt = `
Extract an ISO datetime in Brisbane time from: "${input}". 
Return "invalid" if you can't.
`;
    const iso = await getResponse(parsePrompt);
    if (iso === 'invalid') {
      return "Sorry, I didn't understand that time. When would you like the appointment?";
    }
    const dt = new Date(iso);
    const dtEnd = new Date(dt.getTime() + 3600000);
    if (dt >= earliest && (await isSlotFree(token, dt, dtEnd))) {
      slot = dt;
    } else {
      slot = await getNextAvailableSlot(token, earliest);
    }
  }

  if (!slot) {
    return "No slots available then—would you like another day?";
  }

  stateMachine.nextSlot = slot;
  stateMachine.currentState = 'confirm_slot';
  const human = slot.toLocaleString('en-US', {
    timeZone: 'Australia/Brisbane',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: true
  });
  return `The next available slot is ${human} Brisbane time. Does that work?`;
}

async function confirmSlot(input) {
  if (/^(yes|that works|okay)/i.test(input)) {
    stateMachine.currentState = 'special_instructions';
    return "Great! Any special instructions, like gate codes or security details?";
  }
  stateMachine.currentState = 'book_appointment';
  return "Okay—when would you prefer instead?";
}

async function collectSpecialInstructions(input) {
  stateMachine.clientData.specialInstructions = input;
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
  try {
    const token = await getAccessToken();
    const start = stateMachine.nextSlot.toISOString();
    const end = new Date(stateMachine.nextSlot.getTime() + 3600000).toISOString();
    await createAppointment(token, {
      subject: 'Plumbing Appointment',
      start: { dateTime: start, timeZone: 'UTC' },
      end:   { dateTime: end,   timeZone: 'UTC' },
      location: { displayName: stateMachine.clientData.address },
      body: { content: `Instructions: ${input}`, contentType: 'text' }
    });
    stateMachine.currentState = 'general';
    const confirm = stateMachine.nextSlot.toLocaleString('en-US', {
      timeZone: 'Australia/Brisbane',
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: true
    });
    return `All set, ${stateMachine.clientData.name}! Your appointment is booked for ${confirm}. Anything else?`;
  } catch {
    return "Sorry, something went wrong finalizing the booking.";
  }
}

module.exports = { handleInput, stateMachine };
