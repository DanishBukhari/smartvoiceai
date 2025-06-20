const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getResponse(prompt, conversationHistory = []) {
  console.log('getResponse: Called with prompt', prompt);
  try {
    const messages = [
      {
        role: 'system',
        content: `You are Robyn, a friendly, energetic voice agent for Usher Fix Plumbing in Australia. Use ElevenLabs voice and OpenAI to answer plumbing queries naturally. For specific issues (e.g., hot water system), ask related screening questions one at a time. If the customer wants to book an appointment, collect name, email, phone, full address, and special instructions. Book in Outlook from 7 AM to 7 PM UTC, starting May 28, 2025. For second appointments, calculate travel time from the last appointment’s location. Save transcripts and recordings. Answer general plumbing questions or admit if unsure. If asked, confirm you're AI.`
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
    const response = completion.choices[0].message.content.trim();
    console.log('getResponse: Response', response);
    return response;
  } catch (error) {
    console.error('getResponse: OpenAI error', error.message, error.stack);
    return "I'm sorry, I didn't catch that. Could you say it again, please?";
  }
}

module.exports = { getResponse };