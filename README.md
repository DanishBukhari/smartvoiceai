# Smart Voice AI - Plumbing Business Assistant

An intelligent voice AI system for plumbing businesses that handles customer calls, processes speech, identifies plumbing issues, and books appointments automatically.

## Features

- 🤖 **Voice AI Assistant** - Robyn, your virtual plumbing assistant
- 📞 **Twilio Integration** - Handle incoming phone calls
- 🧠 **OpenAI NLP** - Natural language processing for understanding customer issues
- 🎤 **ElevenLabs TTS** - High-quality text-to-speech responses
- 📅 **Microsoft Outlook** - Automatic appointment booking
- 👥 **GoHighLevel CRM** - Customer relationship management
- 🚗 **Travel Time Calculation** - Smart scheduling between appointments

## Tech Stack

- **Backend**: Node.js, Express.js
- **Voice**: Twilio Voice API
- **AI**: OpenAI GPT-4
- **TTS**: ElevenLabs
- **Calendar**: Microsoft Graph API
- **CRM**: GoHighLevel API
- **Deployment**: Heroku

## Quick Start

### Prerequisites

- Node.js 18+
- Twilio Account
- OpenAI API Key
- ElevenLabs API Key
- Microsoft Azure App Registration
- GoHighLevel Account

### Local Development

1. Clone the repository
```bash
git clone <your-repo-url>
cd smartvoiceai
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. Start the server
```bash
npm start
```

5. Test locally
```bash
curl http://localhost:3000/test
```

### Deployment

1. Create Heroku app
```bash
heroku create your-app-name
```

2. Set environment variables
```bash
heroku config:set OPENAI_API_KEY="your-key"
heroku config:set ELEVENLABS_API_KEY="your-key"
heroku config:set TWILIO_ACCOUNT_SID="your-sid"
heroku config:set TWILIO_AUTH_TOKEN="your-token"
# ... add all other API keys
```

3. Deploy
```bash
git push heroku main
```

## API Endpoints

- `GET /test` - Health check
- `POST /voice` - Handle incoming calls
- `POST /speech` - Process speech input
- `GET /Introduction.mp3` - Welcome audio file

## Environment Variables

```env
OPENAI_API_KEY=your-openai-key
ELEVENLABS_API_KEY=your-elevenlabs-key
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
MICROSOFT_CLIENT_ID=your-ms-client-id
MICROSOFT_CLIENT_SECRET=your-ms-client-secret
MICROSOFT_TENANT_ID=your-ms-tenant-id
GHL_API_KEY=your-ghl-key
GHL_LOCATION_ID=your-ghl-location-id
APP_URL=https://your-app.herokuapp.com
```

## Testing

### Local Testing
```bash
# Health check
curl http://localhost:3000/test

# Test voice endpoint
curl -X POST http://localhost:3000/voice \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=test123"

# Test speech endpoint
curl -X POST http://localhost:3000/speech \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "SpeechResult=I have a leaking tap&CallSid=test123"
```

### Twilio Testing
1. Set webhook URL in Twilio console to your Heroku app URL
2. Make a test call to your Twilio number
3. Monitor logs: `heroku logs --tail`

## License

ISC

## Support

For support, contact [your-email@example.com] 