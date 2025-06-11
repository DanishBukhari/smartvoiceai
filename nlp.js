const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getResponse(prompt, conversationHistory = []) {
  try {
    const messages = [
      {
        role: 'system',
        content: `You are Robyn, a warm, empathetic receptionist for Usher Fix Plumbing. Speak energetically, loudly, and friendly, using colloquial language and natural fillers (e.g., "Ohh," "Hmm," "Well"). Follow the provided workflow, ask one question at a time, and wait for the answer. Collect name, email, phone, and address for all clients. Do not book appointments before May 28, 2025. Triage urgency based on rules and handle general knowledge questions.`
      },
      ...conversationHistory,
      { role: 'user', content: prompt }
    ];
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      max_tokens: 200,
      temperature: 0.7,
    });
    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI NLP Error:', error);
    return "I'm sorry, I didn't catch that. Could you say it again, please?";
  }
}

module.exports = { getResponse };