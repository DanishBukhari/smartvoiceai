// modules/issueClassification.js - Issue detection and classification
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Issue-specific questions for technical diagnosis
const issueQuestions = {
  'toilet': [
    "What's happening with your toilet? Blocked, leaking, running, or not flushing?",
    "Is it still leaking or has it stopped?",
    "How many toilets or showers do you have?",
  ],
  'sink/tap': [
    "What's the problem with your sink? Is it leaking, blocked, or no water coming out?",
    "Is it the hot water, cold water, or both that's affected?",
    "Where exactly is the leak coming from - the tap, underneath, or the pipes?",
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

function classifyPlumbingIssue(input) {
  const text = input.toLowerCase();
  
  // Toilet issues
  if (text.includes('toilet') || text.includes('flush') || text.includes('flushing')) {
    if (text.includes('flush') || text.includes('flushing') || text.includes('won\'t flush') || text.includes('not flush')) {
      return {
        type: 'toilet_flush',
        description: 'a toilet that won\'t flush properly',
        followUp: 'This is a common issue that our plumbers can fix quickly.'
      };
    }
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'toilet_leak',
        description: 'a leaking toilet',
        followUp: 'Toilet leaks can waste water and cause damage, so it\'s good you\'re getting it fixed.'
      };
    }
    if (text.includes('block') || text.includes('blocked') || text.includes('clog')) {
      return {
        type: 'toilet_blocked',
        description: 'a blocked toilet',
        followUp: 'Blocked toilets need professional attention to avoid overflow issues.'
      };
    }
    return {
      type: 'toilet_general',
      description: 'a toilet issue',
      followUp: 'Our plumbers are experienced with all types of toilet problems.'
    };
  }
  
  // Hot water issues
  if (text.includes('hot water') || text.includes('water heater')) {
    if (text.includes('no hot water') || text.includes('cold water only')) {
      return {
        type: 'hot_water_none',
        description: 'no hot water',
        followUp: 'No hot water can be caused by several issues that our technicians can diagnose.'
      };
    }
    if (text.includes('not enough') || text.includes('runs out')) {
      return {
        type: 'hot_water_insufficient',
        description: 'insufficient hot water',
        followUp: 'This could be a capacity or efficiency issue with your water heater.'
      };
    }
    return {
      type: 'hot_water_general',
      description: 'a hot water system issue',
      followUp: 'Hot water problems require specialized knowledge to fix safely.'
    };
  }
  
  // Sink and tap issues
  if (text.includes('sink') || text.includes('basin') || text.includes('tap') || text.includes('faucet')) {
    const isKitchen = text.includes('kitchen');
    const isBathroom = text.includes('bathroom') || text.includes('bath');
    const sinkType = isKitchen ? 'kitchen sink' : isBathroom ? 'bathroom sink' : 'sink';
    
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'sink_leak',
        description: `a leaking ${sinkType}`,
        followUp: 'Sink leaks can cause water damage, so it\'s good you\'re getting it fixed promptly.'
      };
    }
    if (text.includes('block') || text.includes('blocked') || text.includes('clog') || text.includes('drain')) {
      return {
        type: 'sink_blocked',
        description: `a blocked ${sinkType}`,
        followUp: 'Blocked sinks need professional drain cleaning to prevent recurring issues.'
      };
    }
    if (text.includes('broken') || text.includes('not working') || text.includes('no water')) {
      return {
        type: 'sink_broken',
        description: `a broken ${sinkType}`,
        followUp: 'This could be a tap mechanism or supply line issue that needs professional repair.'
      };
    }
    if (text.includes('drip') || text.includes('dripping')) {
      return {
        type: 'tap_dripping',
        description: `a dripping tap`,
        followUp: 'Dripping taps waste water and the constant sound can be annoying.'
      };
    }
    return {
      type: 'sink_general',
      description: `a ${sinkType} issue`,
      followUp: 'Our plumbers can handle all types of sink and tap problems.'
    };
  }
  
  // Emergency situations
  if (text.includes('burst') || text.includes('flooding') || text.includes('emergency')) {
    return {
      type: 'emergency',
      description: 'an emergency plumbing situation',
      followUp: 'This sounds urgent - we\'ll prioritize your appointment.'
    };
  }
  
  // Sink issues
  if (text.includes('sink') || text.includes('basin')) {
    const isKitchen = text.includes('kitchen');
    const isBathroom = text.includes('bathroom') || text.includes('bath');
    const sinkType = isKitchen ? 'kitchen sink' : isBathroom ? 'bathroom sink' : 'sink';
    
    if (text.includes('leak') || text.includes('leaking')) {
      return {
        type: 'sink_leak',
        description: `a leaking ${sinkType}`,
        followUp: 'Sink leaks can cause water damage, so it\'s important to get them fixed promptly.'
      };
    }
    if (text.includes('block') || text.includes('blocked') || text.includes('drain')) {
      return {
        type: 'sink_blocked',
        description: `a blocked ${sinkType}`,
        followUp: 'Blocked sinks are usually caused by buildup in the pipes that our plumbers can clear.'
      };
    }
    return {
      type: 'sink_general',
      description: `a ${sinkType} problem`,
      followUp: 'Our plumbers handle all types of sink and tap issues.'
    };
  }
  
  // Leak issues (general)
  if (text.includes('leak') || text.includes('leaking')) {
    if (text.includes('pipe')) {
      return {
        type: 'pipe_leak',
        description: 'a pipe leak',
        followUp: 'Pipe leaks can cause significant damage, so quick action is important.'
      };
    }
    return {
      type: 'leak_general',
      description: 'a water leak',
      followUp: 'Water leaks should be addressed quickly to prevent damage.'
    };
  }
  
  return null;
}

// Fast analysis using GPT-3.5-turbo for speed
async function analyzeFastInput(input) {
  const startTime = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Quick analysis. Return one word: toilet, drain, leak, emergency, booking, or general'
        },
        {
          role: 'user',
          content: input
        }
      ],
      max_tokens: 5,
      temperature: 0,
    });
    
    const analysisTime = Date.now() - startTime;
    console.log(`⚡ Fast analysis completed in ${analysisTime}ms`);
    
    const result = response.choices[0].message.content.trim().toLowerCase();
    return {
      issue: result.includes('toilet') ? 'toilet issue' : 
             result.includes('drain') ? 'drain issue' :
             result.includes('leak') ? 'leak issue' :
             result.includes('emergency') ? 'emergency' :
             result.includes('booking') ? 'booking request' : 'general plumbing',
      urgency: result.includes('emergency') ? 'high' : 'medium',
      emotion: 'calm',
      knowledge: 'basic',
    };
  } catch (error) {
    console.error('Fast analysis failed:', error);
    return { issue: 'general plumbing', urgency: 'medium', emotion: 'calm', knowledge: 'basic' };
  }
}

function detectBookingIntent(input) {
  const lowerInput = input.toLowerCase();
  
  const bookingIntentKeywords = [
    'need a plumber', 'need plumber', 'want a plumber', 'want plumber', 
    'call a plumber', 'get a plumber', 'book a plumber', 'schedule a plumber',
    'plumbing problem', 'plumbing issue', 'plumbing help', 'plumber please',
    'need help with plumbing', 'plumbing service', 'plumbing appointment',
    'book', 'schedule', 'appointment', 'booking'
  ];
  
  return bookingIntentKeywords.some(keyword => lowerInput.includes(keyword));
}

function detectEmergency(input) {
  const emergencyKeywords = /\b(burst|flooding|emergency|urgent|asap|right now|immediate|water everywhere|overflowing|gushing|can't turn off|major leak)\b/i;
  return emergencyKeywords.test(input);
}

module.exports = {
  classifyPlumbingIssue,
  analyzeFastInput,
  detectBookingIntent,
  detectEmergency,
  issueQuestions
};
