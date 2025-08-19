// modules/dataExtraction.js - Customer data extraction and validation
const { validateEmail, correctEmailFromTranscription } = require('./inputValidation');

// Extract customer data from conversation input
async function extractCustomerData(input) {
  const data = {};
  
  // Name extraction (2+ words, alphabetic characters)
  const nameMatch = input.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
  if (nameMatch && isValidName(nameMatch[1])) {
    data.name = nameMatch[1];
  }
  
  // Email extraction
  const emailMatch = input.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) {
    const correctedEmail = correctEmailFromTranscription(emailMatch[0]);
    if (validateEmail(correctedEmail)) {
      data.email = correctedEmail;
    }
  }
  
  // Phone number extraction
  const phoneMatch = input.match(/(?:\+61|0)(?:\s*[2-9]){1}(?:\s*\d){8}/);
  if (phoneMatch) {
    data.phone = phoneMatch[0].replace(/\s+/g, '');
  }
  
  // Address extraction (more comprehensive with error correction)
  const addressPatterns = [
    /\b\d+\s+[A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln)\b[^,]*,?\s*[A-Za-z\s]+,?\s*(?:QLD|Queensland|Q\s*I\s*D|Q\s*L\s*D)\s*\d{4}/i,
    /\b\d+\/\d+\s+[A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln)\b[^,]*,?\s*[A-Za-z\s]+,?\s*(?:QLD|Queensland|Q\s*I\s*D|Q\s*L\s*D)\s*\d{4}/i,
    /\bUnit\s*\d+\/\d+\s+[A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln)\b[^,]*,?\s*[A-Za-z\s]+,?\s*(?:QLD|Queensland|Q\s*I\s*D|Q\s*L\s*D)\s*\d{4}/i
  ];
  
  for (const pattern of addressPatterns) {
    const addressMatch = input.match(pattern);
    if (addressMatch) {
      // Apply address cleanup function
      data.address = cleanupAddress(addressMatch[0].trim());
      break;
    }
  }
  
  return data;
}

function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  
  const trimmedName = name.trim();
  
  // Check for minimum length and word count
  if (trimmedName.length < 2 || trimmedName.split(' ').length < 2) return false;
  
  // Check if it's not a plumbing-related term
  const plumbingTerms = [
    'toilet', 'sink', 'tap', 'pipe', 'water', 'leak', 'drain', 'flush', 'block',
    'plumber', 'plumbing', 'repair', 'fix', 'issue', 'problem', 'service'
  ];
  
  const lowerName = trimmedName.toLowerCase();
  if (plumbingTerms.some(term => lowerName.includes(term))) return false;
  
  // Check for valid name pattern (letters, spaces, hyphens, apostrophes)
  if (!/^[A-Za-z\s'-]+$/.test(trimmedName)) return false;
  
  return true;
}

function extractNameFromInput(input) {
  const words = input.trim().split(/\s+/);
  
  // Look for 2+ consecutive capitalized words
  for (let i = 0; i < words.length - 1; i++) {
    const potentialName = words.slice(i, i + 2).join(' ');
    if (isValidName(potentialName)) {
      return potentialName;
    }
  }
  
  // Look for 3+ consecutive capitalized words
  for (let i = 0; i < words.length - 2; i++) {
    const potentialName = words.slice(i, i + 3).join(' ');
    if (isValidName(potentialName)) {
      return potentialName;
    }
  }
  
  return null;
}

// Extract data from conversation history
function extractCustomerDataFromHistory(conversationHistory = []) {
  const data = {};
  
  // Go through conversation history to extract missed details
  for (const message of conversationHistory) {
    if (message.role === 'user') {
      const extractedData = extractCustomerData(message.content);
      Object.assign(data, extractedData);
    }
  }
  
  return data;
}

function validateAustralianAddress(address) {
  if (!address || typeof address !== 'string') return false;
  
  // Must contain a number, street name, and Queensland postcode
  const hasNumber = /\b\d+/.test(address);
  const hasStreetType = /(street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|lane|ln)\b/i.test(address);
  const hasQldPostcode = /\b(?:QLD|Queensland)\s*\d{4}\b/i.test(address);
  
  return hasNumber && hasStreetType && hasQldPostcode;
}

function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return false;
  
  // Remove spaces and check Australian format
  const cleaned = phone.replace(/\s+/g, '');
  return /^(?:\+61|0)[2-9]\d{8}$/.test(cleaned);
}

function cleanupAddress(address) {
  if (!address) return address;
  
  // Common transcription error corrections
  let cleaned = address
    .replace(/\bQ\s*I\s*D\b/gi, 'QLD')         // "Q I D" -> "QLD"
    .replace(/\bQ\s*L\s*D\b/gi, 'QLD')         // "Q L D" -> "QLD"
    .replace(/\bPitts?\s*Citty\b/gi, 'Pitts City')  // "Pitts Citty" -> "Pitts City"
    .replace(/\bStreet\s*Street\b/gi, 'Street')     // Remove duplicate Street
    .replace(/\s{2,}/g, ' ')                        // Multiple spaces to single
    .trim();
  
  return cleaned;
}

module.exports = {
  extractCustomerData,
  extractCustomerDataFromHistory,
  extractNameFromInput,
  isValidName,
  validateAustralianAddress,
  validatePhoneNumber,
  cleanupAddress
};
