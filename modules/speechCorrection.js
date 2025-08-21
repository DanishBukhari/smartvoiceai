/**
 * Speech Recognition Correction Module
 * Fixes common STT errors for plumbing terminology
 */

const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Common plumbing-related speech corrections
const commonCorrections = new Map([
  // Toilet-related corrections
  ['north lushin', 'not flushing'],
  ['north russian', 'not flushing'],
  ['not rushing', 'not flushing'],
  ['toilet flush in', 'toilet flushing'],
  ['told it', 'toilet'],
  ['toy lit', 'toilet'],
  ['toy let', 'toilet'],
  
  // Leak-related corrections
  ['lee king', 'leaking'],
  ['linking', 'leaking'],
  ['league', 'leak'],
  ['leek', 'leak'],
  
  // Location corrections
  ['adelaide street', 'Adelaide Street'],
  ['queen street', 'Queen Street'],
  ['george street', 'George Street'],
  ['bistin city', 'Brisbane City'],
  ['bismarck', 'Brisbane'],
  ['qid', 'QLD'],
  ['qui', 'QLD'],
  
  // Common issues
  ['hot water', 'hot water'],
  ['cold water', 'cold water'],
  ['tap dripping', 'tap dripping'],
  ['faucet', 'tap'],
  ['spigot', 'tap'],
  
  // Numbers and codes
  ['gift card', 'gate code'],
  ['side door', 'side door'],
  ['access code', 'access code'],
]);

/**
 * Apply basic corrections for common speech recognition errors
 */
function applyBasicCorrections(text) {
  if (!text) return text;
  
  let corrected = text.toLowerCase();
  
  // Apply common corrections
  for (const [wrong, right] of commonCorrections) {
    const regex = new RegExp(wrong, 'gi');
    corrected = corrected.replace(regex, right);
  }
  
  // Fix common number/code patterns
  corrected = corrected.replace(/(\d+)\s*dollars?\s*(\d+)\s*cents?/gi, '$1$2');
  corrected = corrected.replace(/gift\s*card\s*is\s*\$?(\d+)\.?(\d+)?\s*(\d+)/gi, 'gate code is $1$2$3');
  
  return corrected;
}

/**
 * Use AI to correct speech recognition errors in plumbing context
 */
async function correctWithAI(originalText, context = '') {
  if (!originalText || originalText.length < 3) return originalText;
  
  try {
    const prompt = `
You are a speech recognition correction specialist for a plumbing company's voice assistant.

ORIGINAL TEXT (may contain STT errors): "${originalText}"
CONTEXT: ${context || 'Customer calling about plumbing issue'}

TASK: Correct speech recognition errors while preserving the original meaning. Focus on:

1. Common plumbing terms that might be misheard:
   - "not flushing" (often heard as "north russian", "north lushin", "not rushing")
   - "leaking" (often heard as "lee king", "linking")
   - "toilet" (often heard as "toy lit", "told it")
   - "blocked" (often heard as "block", "blog")
   - "hot water" (often heard as "heart water")

2. Brisbane locations:
   - Street names (Adelaide, Queen, George, etc.)
   - "Brisbane" (often heard as "Bismarck", "Bistin")
   - "QLD" (often heard as "QID", "qui")

3. Contact details:
   - Email addresses (spell out if unclear)
   - Phone numbers (format as digits)
   - Gate codes (numbers, not "gift card")

RULES:
- Only correct obvious STT errors
- Keep the original meaning intact
- If unsure, keep the original text
- Return just the corrected text, nothing else

CORRECTED TEXT:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    });

    const corrected = response.choices[0].message.content.trim();
    
    // Validate the correction isn't too different
    if (corrected.length > originalText.length * 2) {
      console.log('⚠️ AI correction too different, using basic correction');
      return applyBasicCorrections(originalText);
    }
    
    console.log(`🔧 Speech corrected: "${originalText}" → "${corrected}"`);
    return corrected;
    
  } catch (error) {
    console.error('❌ AI speech correction failed:', error);
    return applyBasicCorrections(originalText);
  }
}

/**
 * Correct speech recognition with context awareness
 */
async function correctSpeechWithContext(text, conversationState = '', previousText = '') {
  if (!text) return text;
  
  // First apply basic corrections
  let corrected = applyBasicCorrections(text);
  
  // Build context for AI correction
  const context = [
    conversationState && `Current conversation state: ${conversationState}`,
    previousText && `Previous customer input: ${previousText}`,
    'Customer is calling about plumbing services'
  ].filter(Boolean).join('. ');
  
  // Use AI for more complex corrections if needed
  if (shouldUseAICorrection(text)) {
    corrected = await correctWithAI(corrected, context);
  }
  
  return corrected;
}

/**
 * Determine if AI correction is needed
 */
function shouldUseAICorrection(text) {
  const complexPatterns = [
    /north\s+\w+/i,  // "north russian", "north lushin"
    /\$\d+\.\d+\s+\d+/,  // Price patterns that might be codes
    /bismarck|bistin|qid/i,  // Location mishears
    /toy\s+lit|told\s+it/i,  // Toilet mishears
    /lee\s+king|linking/i,   // Leaking mishears
  ];
  
  return complexPatterns.some(pattern => pattern.test(text));
}

module.exports = {
  applyBasicCorrections,
  correctWithAI,
  correctSpeechWithContext,
  shouldUseAICorrection
};
