// modules/addressValidator.js - Address validation and completion

/**
 * Validate if an address is complete
 */
function isCompleteAddress(address) {
  const addressLower = address.toLowerCase().trim();
  
  // Check for minimum components
  const hasNumber = /\d/.test(address);
  const hasStreet = /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|court|ct|place|pl|circuit|cct|crescent|cres|boulevard|blvd)\b/i.test(address);
  const hasSuburb = checkForAustralianSuburb(address);
  const hasPostcode = /\b\d{4}\b/.test(address);
  
  console.log('🏠 Address validation:', {
    address,
    hasNumber,
    hasStreet,
    hasSuburb,
    hasPostcode
  });
  
  // For Australian addresses, we need street number + street name at minimum
  // Suburb and postcode are helpful but not always spoken clearly
  return hasNumber && hasStreet;
}

/**
 * Check if address contains Australian suburb indicators
 */
function checkForAustralianSuburb(address) {
  const australianSuburbs = [
    'brisbane', 'melbourne', 'sydney', 'perth', 'adelaide', 'darwin', 'hobart',
    'city', 'cbd', 'north', 'south', 'east', 'west', 'upper', 'lower',
    'park', 'vale', 'hill', 'mount', 'beach', 'creek', 'river', 'bay',
    'springs', 'gardens', 'heights', 'grove', 'wood', 'field', 'view'
  ];
  
  const addressLower = address.toLowerCase();
  return australianSuburbs.some(suburb => addressLower.includes(suburb));
}

/**
 * Suggest address completion based on partial input
 */
function suggestAddressCompletion(partialAddress) {
  const missingComponents = [];
  
  if (!/\d/.test(partialAddress)) {
    missingComponents.push('street number');
  }
  
  if (!/\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|court|ct|place|pl|circuit|cct|crescent|cres|boulevard|blvd)\b/i.test(partialAddress)) {
    missingComponents.push('street name');
  }
  
  if (!checkForAustralianSuburb(partialAddress)) {
    missingComponents.push('suburb');
  }
  
  if (!/\b\d{4}\b/.test(partialAddress)) {
    missingComponents.push('postcode');
  }
  
  return missingComponents;
}

/**
 * Parse and clean address input
 */
function parseAddress(input) {
  // Clean up common speech-to-text issues
  let cleaned = input
    .replace(/\b(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\b/g, '$1$2$3$4') // Join scattered postcodes
    .replace(/\b(queen|king|main|george|smith|brown)\s+(street|st|road|rd|avenue|ave)\b/gi, '$1 $2')
    .replace(/\b(brisbane|melbourne|sydney)\s+(city|cbd)\b/gi, '$1 $2')
    .trim();
  
  return cleaned;
}

module.exports = {
  isCompleteAddress,
  suggestAddressCompletion,
  parseAddress,
  checkForAustralianSuburb
};
