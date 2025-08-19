// modules/inputValidation.js - Input validation and transcription error correction
const { getResponse } = require('../nlp');

// Fast response patterns for common inputs
const quickResponses = {
  'hello': "Hello! I'm Robyn from Assure Fix Plumbing. What plumbing issue can I help you with today?",
  'hi': "Hi there! I'm Robyn from Assure Fix Plumbing. What plumbing problem do you need fixed?",
  'toilet': "I can help with your toilet issue. What's happening - is it not flushing, leaking, or blocked?",
  'sink': "I can help with your sink problem. Is it leaking, blocked, or no water coming out?",
  'drain': "I can help with your drain problem. Is it completely blocked or draining slowly?",
  'leak': "I can help with that leak. Where is it leaking from - toilet, tap, or pipe?",
  'tap': "I can help with your tap issue. Is it dripping, won't turn off, or no water?",
  'hot water': "I can help with your hot water problem. Do you have any hot water at all?",
  'emergency': "I understand this is urgent. What's the emergency - burst pipe, flooding, or no hot water?",
  'booking': "I can book an appointment for you. What plumbing issue needs fixing?",
  'appointment': "I can schedule an appointment for you. What plumbing problem do you need fixed?",
  'yes': "Great! Let me help you with that.",
  'no': "No problem. Is there anything else I can help you with?",
  'plumber': "I'm here to help with your plumbing needs! What specific issue are you experiencing?",
};

function validateAndCorrectInput(input) {
  if (!input || typeof input !== 'string') return input;
  let corrected = input.trim();
  
  // Fix specific email patterns with numbers
  corrected = corrected
    .replace(/\bf\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)\s*@/gi, 'fyedahira$1@')
    .replace(/\bs\s*y\s*e\s*d\s*a\s*h\s*i\s*r\s*a\s*(\d+)\s*@/gi, 'syedahira$1@')
    .replace(/(\d+)six\.@/gi, '$1@')
    .replace(/six\.@/gi, '@');
  
  // Handle spaced letters in names (but not in email addresses)
  const parts = corrected.split('@');
  if (parts.length === 2) {
    parts[0] = parts[0]
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3$4')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2');
    corrected = parts.join('@');
  } else {
    corrected = corrected
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3$4')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2$3')
      .replace(/\b([a-zA-Z])\s+([a-zA-Z])\b/g, '$1$2');
  }
  
  // Common transcription error corrections
  const corrections = {
    'toy': 'toilet',
    'target': 'toilet',
    'breastband': 'Brisbane',
    'flash': 'flush',
    'gmail dot com': 'gmail.com',
    'outlook dot com': 'outlook.com',
    'yahoo dot com': 'yahoo.com',
    'hotmail dot com': 'hotmail.com',
    'straight': 'street',
    'rode': 'road',
    'yeah': 'yes',
    'yep': 'yes',
    'yup': 'yes',
    'nah': 'no',
    'nope': 'no',
  };

  for (const [wrong, right] of Object.entries(corrections)) {
    const regex = new RegExp('\\b' + wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    corrected = corrected.replace(regex, right);
  }

  return corrected;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const localPart = email.split('@')[0];
  const domainPart = email.split('@')[1];
  
  if (!emailRegex.test(email)) return false;
  if (!localPart || !domainPart) return false;
  
  // Check for common invalid patterns
  if (localPart.includes('..') || localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (domainPart.includes('..') || domainPart.startsWith('.') || domainPart.endsWith('.')) return false;
  
  const domainParts = domainPart.split('.');
  if (domainParts.length < 2 || domainParts.some(part => part.length === 0)) return false;
  
  return true;
}

function correctEmailFromTranscription(input) {
  if (!input || typeof input !== 'string') return input;
  
  let corrected = input.trim().toLowerCase();
  
  corrected = corrected
    // Fix numerical words to numbers
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    .replace(/\bzero\b/g, '0')
    // Fix domain extensions
    .replace(/\bat\s+g\s*mail\s*dot\s*com/g, '@gmail.com')
    .replace(/\bat\s+gmail\s*dot\s*com/g, '@gmail.com')
    .replace(/\bat\s+yahoo\s*dot\s*com/g, '@yahoo.com')
    .replace(/\bat\s+hotmail\s*dot\s*com/g, '@hotmail.com')
    .replace(/\bat\s+outlook\s*dot\s*com/g, '@outlook.com')
    // Fix spacing around @ and dots
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    // Remove invalid patterns
    .replace(/(\d+)six\.@/g, '$1@')
    .replace(/six\.@/g, '@')
    
    
  return corrected;
}

function getQuickResponse(input) {
  const cleanInput = input.toLowerCase().trim();
  
  // Direct matches for greetings and simple responses
  if (quickResponses[cleanInput]) {
    return quickResponses[cleanInput];
  }
  
  // Smart partial matches
  for (const [key, response] of Object.entries(quickResponses)) {
    if (key === 'hello' || key === 'hi' || key === 'yes' || key === 'no') {
      if (cleanInput === key) {
        return response;
      }
    } else if (key.includes(' ')) {
      if (cleanInput.includes(key)) {
        return response;
      }
    } else {
      const words = cleanInput.split(' ');
      if (words.includes(key) || 
          cleanInput.startsWith(key) || 
          cleanInput.endsWith(key)) {
        return response;
      }
    }
  }
  
  return null;
}

module.exports = {
  validateAndCorrectInput,
  validateEmail,
  correctEmailFromTranscription,
  getQuickResponse,
  quickResponses
};
