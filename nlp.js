
// nlp.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Add caching for NLP responses and performance tracking
const nlpCache = new Map();
const responseTimeTracker = {
  times: [],
  addTime: function(time) {
    this.times.push(time);
    if (this.times.length > 100) this.times.shift(); // Keep last 100
  },
  getAverage: function() {
    return this.times.reduce((a, b) => a + b, 0) / this.times.length;
  }
};

// Preload common responses for instant replies
const preloadedResponses = new Map([
  ['hello', 'Hello! How can I help you with your plumbing needs today?'],
  ['hi', 'Hi there! What plumbing issue can I help you with?'],
  ['yes', 'Great! Let me help you with that.'],
  ['no', 'No problem at all. Is there anything else I can help you with?'],
  ['thank you', 'You\'re very welcome! Happy to help.'],
  ['thanks', 'My pleasure! Anything else I can assist with?'],
]);

// Initialize cache with preloaded responses
preloadedResponses.forEach((value, key) => {
  nlpCache.set(key, value);
});

const BRISBANE_TZ = 'Australia/Brisbane';
const currentDate = new Date().toLocaleDateString('en-US', { timeZone: BRISBANE_TZ, weekday: 'long', month: 'long', day: 'numeric' });

const systemPrompt = `You are Robyn, a friendly, energetic voice agent for Assure Fix Plumbing in Australia. Today's date is ${currentDate} Brisbane time.

IMPORTANT CONVERSATION RULES:
- You are ALREADY introduced as Robyn - DO NOT repeat your name unless specifically asked
- DO NOT say "My name is Robyn" in every response
- Only introduce yourself in the first greeting or when explicitly asked
- Focus on helping the customer, not repeating who you are

CORE CAPABILITIES:
- Understand and categorize plumbing issues accurately
- Ask relevant follow-up questions based on context
- Handle multiple issues in one conversation
- Provide helpful advice when appropriate
- Remember conversation context and customer details

CONVERSATION STYLE:
- Be warm, professional, and empathetic
- Don't rush and don't shout the customer's name even if it comes with "!"
- Use natural, conversational language
- Acknowledge customer concerns
- Provide reassurance for urgent issues
- Keep responses concise but helpful
- Ask every question one by one
- AVOID repeating your name unnecessarily

PLUMBING EXPERTISE:
- Understand technical plumbing terms and issues
- Ask diagnostic questions to assess severity
- Provide basic safety advice (e.g., "Turn off water if leaking")
- Explain what to expect during service visits
- Handle emergency vs. routine maintenance appropriately

APPOINTMENT BOOKING:
- Collect all necessary customer details efficiently
- Make sure you have Name, Email, Address, and special instructions (if any)
- Explain appointment process clearly
- Handle scheduling preferences flexibly
- Provide clear next steps and expectations

CONTEXT AWARENESS:
- Remember previous parts of conversation
- Build on earlier information
- Avoid repeating questions already answered
- Adapt responses based on customer urgency

EMERGENCY HANDLING:
- Identify urgent situations (burst pipes, no hot water in winter)
- Provide immediate safety advice
- Prioritize emergency bookings appropriately
- Show appropriate concern and urgency

Keep responses natural, helpful, don't rush, and focused on solving the customer's plumbing needs using less words. NEVER repeat your name unless specifically asked.`;

async function getResponse(prompt, conversationHistory = []) {
  const startTime = Date.now();
  console.log('getResponse: Called with prompt', prompt.substring(0, 50) + '...');
  
  // Only cache very simple, static responses - not complex prompts
  const cacheKey = prompt.toLowerCase().trim();
  const isSimplePrompt = prompt.length < 50 && !prompt.includes('\n') && !prompt.includes('Perfect!') && !prompt.includes('Thank you!');
  
  if (isSimplePrompt && nlpCache.has(cacheKey)) {
    const endTime = Date.now();
    responseTimeTracker.addTime(endTime - startTime);
    console.log('NLP: Using cached response (', endTime - startTime, 'ms)');
    return nlpCache.get(cacheKey);
  }
  
  try {
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...conversationHistory,
      { role: 'user', content: prompt }
    ];
    
    // LATENCY OPTIMIZATION: Use faster model and reduce tokens
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Faster, cheaper model
      messages: messages,
      max_tokens: 100, // Reduced from 150
      temperature: 0.3, // Reduced for more predictable, faster responses
      stream: false, // Ensure we get the full response at once
    });
    const response = completion.choices[0].message.content.trim();
    
    // Only cache simple responses to avoid inappropriate reuse
    if (isSimplePrompt && response.length < 100) {
      nlpCache.set(cacheKey, response);
      if (nlpCache.size > 200) { // Increased cache size
        const firstKey = nlpCache.keys().next().value;
        nlpCache.delete(firstKey);
      }
    }
    
    const endTime = Date.now();
    responseTimeTracker.addTime(endTime - startTime);
    console.log('getResponse: Response', response, '(', endTime - startTime, 'ms)');
    return response;
  } catch (error) {
    const endTime = Date.now();
    responseTimeTracker.addTime(endTime - startTime);
    console.error('getResponse: OpenAI error', error.message, '(', endTime - startTime, 'ms)');
    return "I'm sorry, I didn't catch that. Could you say it again, please?";
  }
}

module.exports = { getResponse, responseTimeTracker, nlpCache };