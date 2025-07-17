// test_openai.js
require('dotenv').config();
const { OpenAI } = require('openai');

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY in your environment');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Fetch list of models as a lightweight health check
    const response = await openai.models.list();
    console.log('✅ API key is valid! Available models:');
    response.data
      .slice(0, 5)
      .forEach((model) => console.log(` • ${model.id}`));
  } catch (err) {
    console.error('❌ API key test failed:', err.message || err);
    process.exit(1);
  }
})();
