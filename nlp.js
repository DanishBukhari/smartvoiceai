
// nlp.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Add caching for NLP responses
const nlpCache = new Map();

const BRISBANE_TZ = 'Australia/Brisbane';
const currentDate = new Date().toLocaleDateString('en-US', { timeZone: BRISBANE_TZ, weekday: 'long', month: 'long', day: 'numeric' });

const systemPrompt = `You are Robyn, a friendly, energetic voice agent for Usher Fix Plumbing in Australia. Today's date is ${currentDate} Brisbane time.

CORE CAPABILITIES:
- Understand and categorize plumbing issues accurately
- Ask relevant follow-up questions based on context
- Handle multiple issues in one conversation
- Provide helpful advice when appropriate
- Remember conversation context and customer details

CONVERSATION STYLE:
- Be warm, professional, and empathetic
- Use natural, conversational language
- Acknowledge customer concerns
- Provide reassurance for urgent issues
- Keep responses concise but helpful

PLUMBING EXPERTISE:
- Understand technical plumbing terms and issues
- Ask diagnostic questions to assess severity
- Provide basic safety advice (e.g., "Turn off water if leaking")
- Explain what to expect during service visits
- Handle emergency vs. routine maintenance appropriately

APPOINTMENT BOOKING:
- Collect all necessary customer details efficiently
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

Keep responses natural, helpful, and focused on solving the customer's plumbing needs.`;

async function getResponse(prompt, conversationHistory = []) {
  console.log('getResponse: Called with prompt', prompt);
  
  // Check cache for simple prompts
  const cacheKey = prompt.toLowerCase().trim();
  if (nlpCache.has(cacheKey)) {
    console.log('NLP: Using cached response');
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
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      max_tokens: 150,
      temperature: 0.5,
    });
    const response = completion.choices[0].message.content.trim();
    
    // Cache the response
    nlpCache.set(cacheKey, response);
    if (nlpCache.size > 100) {
      const firstKey = nlpCache.keys().next().value;
      nlpCache.delete(firstKey);
    }
    
    console.log('getResponse: Response', response);
    return response;
  } catch (error) {
    console.error('getResponse: OpenAI error', error.message, error.stack);
    return "I'm sorry, I didn't catch that. Could you say it again, please?";
  }
}

module.exports = { getResponse };