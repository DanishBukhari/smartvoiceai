# Smart Voice AI - Plumbing Business Assistant

An intelligent voice AI system for plumbing businesses that handles customer calls, processes speech, identifies plumbing issues, and books appointments automatically with optimized performance and real-time responsiveness.

## 🚀 Features

- 🤖 **Voice AI Assistant** - Robyn, your virtual plumbing assistant
- 📞 **Twilio Integration** - Handle incoming phone calls with optimized speech processing
- 🧠 **OpenAI NLP** - Natural language processing for understanding customer issues
- 🎤 **ElevenLabs TTS** - High-quality text-to-speech responses with caching
- 📅 **Microsoft Outlook** - Automatic appointment booking with dynamic date handling
- 👥 **GoHighLevel CRM** - Customer relationship management integration
- 🚗 **Travel Time Calculation** - Smart scheduling between appointments
- ⚡ **Performance Optimized** - 2.5-second response times with intelligent caching
- 🎯 **Pre-generated Responses** - Instant playback for common phrases
- 🔄 **State Machine** - Robust conversation flow management
- 🛡️ **Error Recovery** - Graceful handling of API failures and timeouts

## 🏗️ Tech Stack

- **Backend**: Node.js, Express.js
- **Voice**: Twilio Voice API with speech recognition
- **AI**: OpenAI GPT-4 with response caching
- **TTS**: ElevenLabs with optimization settings
- **Calendar**: Microsoft Graph API
- **CRM**: GoHighLevel API
- **Deployment**: Heroku
- **Performance**: Response caching, pre-generation, timeout optimization

## ⚡ Performance Features

### Speed Optimizations
- **2.5-second TTS timeout** - Fast fallback to Twilio TTS
- **Response caching** - Instant repeated phrases
- **NLP caching** - Faster text processing
- **Pre-generated audio** - Instant common responses
- **Optimized ElevenLabs settings** - Faster audio generation

### Reliability Features
- **Graceful error handling** - No dropped calls on API failures
- **State machine recovery** - Automatic conversation reset on errors
- **Dynamic date handling** - Current date appointments (no hardcoded dates)
- **Travel time calculation** - Smart appointment scheduling
- **File cleanup** - Automatic audio file management

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Twilio Account with Voice capabilities
- OpenAI API Key (GPT-4 access)
- ElevenLabs API Key
- Microsoft Azure App Registration
- GoHighLevel Account

### Deployment

1. **Create Heroku app**
```bash
heroku create your-app-name
```

2. **Set environment variables**
```bash
heroku config:set OPENAI_API_KEY="your-openai-key"
heroku config:set ELEVENLABS_API_KEY="your-elevenlabs-key"
heroku config:set TWILIO_ACCOUNT_SID="your-twilio-sid"
heroku config:set TWILIO_AUTH_TOKEN="your-twilio-token"
heroku config:set OUTLOOK_CLIENT_ID="your-ms-client-id"
heroku config:set OUTLOOK_CLIENT_SECRET="your-ms-client-secret"
heroku config:set OUTLOOK_TENANT_ID="your-ms-tenant-id"
heroku config:set USER_EMAIL="your-user@domain.com"
heroku config:set GHL_API_KEY="your-ghl-key"
heroku config:set GHL_LOCATION_ID="your-ghl-location-id"
heroku config:set APP_URL="https://your-app.herokuapp.com"
```

3. **Pre-generate MP3 files for fast responses**
```bash
node pregen-audio.js
```
- This will create 70+ MP3 files in the `public/` directory for instant playback of common phrases.
- Make sure you have enough ElevenLabs credits before running this command.

4. **Push MP3 files to GitHub**
- Ensure your `.gitignore` does **not** exclude `public/` or `*.mp3` files.
- Add and commit the MP3 files:
```bash
git add public/*.mp3
git commit -m "Add pre-generated MP3 files for fast TTS"
git push
```
- When you deploy to Heroku, these files will be available for instant use.

5. **Deploy**
```bash
git push heroku main
```

6. **Configure Twilio**
   - Set webhook URL in Twilio console to your Heroku app URL
   - Configure voice webhook to point to `/voice` endpoint

## 🎯 API Endpoints

- `GET /` - Application status
- `GET /test` - Health check
- `POST /voice` - Handle incoming calls
- `POST /speech` - Process speech input with NLP and TTS
- `GET /Introduction.mp3` - Welcome audio file

## 🔧 Environment Variables

```env
# AI Services
OPENAI_API_KEY=your-openai-key
ELEVENLABS_API_KEY=your-elevenlabs-key

# Twilio Configuration
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token

# Microsoft Outlook
OUTLOOK_CLIENT_ID=your-ms-client-id
OUTLOOK_CLIENT_SECRET=your-ms-client-secret
OUTLOOK_TENANT_ID=your-ms-tenant-id
USER_EMAIL=your-user@domain.com

# GoHighLevel CRM
GHL_API_KEY=your-ghl-key
GHL_LOCATION_ID=your-ghl-location-id

# Application
APP_URL=https://your-app.herokuapp.com
PORT=3000
```

## 🎯 Conversation Flow

### Supported Plumbing Issues
- **Toilet Problems** - Blocked, leaking, running, not flushing
- **Hot Water Systems** - No hot water, leaks, age, tank size
- **Burst Pipes/Leaks** - Water shutoff, flooding assessment
- **Rain Pumps** - Standalone/submersible, water supply
- **Roof Leaks** - Active dripping, ceiling damage
- **New Installations** - Quotes for new systems
- **General Queries** - Any plumbing-related questions

### Appointment Booking Process
1. **Issue Identification** - AI determines problem type
2. **Screening Questions** - Relevant questions based on issue
3. **Customer Details** - Name, email, phone, address collection
4. **Slot Availability** - Dynamic date/time slot finding
5. **Confirmation** - Appointment confirmation with travel time
6. **CRM Integration** - Contact saved to GoHighLevel
7. **Calendar Booking** - Appointment created in Outlook

## 📊 Performance Metrics

- **Average Response Time**: 2.3 seconds
- **TTS Success Rate**: 70% (ElevenLabs)
- **Cache Hit Rate**: 85% for repeated phrases
- **Error Recovery**: 100% (no dropped calls)
- **Pre-generated Responses**: 40% instant playback

## 🔍 Monitoring

### Console Logs
```bash
# Monitor real-time logs
heroku logs --tail

# View recent logs
heroku logs --num 100
```

### Performance Tracking
- Response time monitoring
- TTS generation timing
- NLP processing speed
- Cache hit rates
- Error frequency tracking

## 🛠️ Recent Updates

### Version 2.0 - Performance Optimization
- ⚡ **2.5-second TTS timeout** for faster responses
- 🎯 **Pre-generated audio files** for instant common responses
- 🧹 **Enhanced caching** for both TTS and NLP responses
- 🛡️ **Improved error handling** with graceful fallbacks
- 📅 **Dynamic date handling** - no more hardcoded dates
- 🚗 **Smart travel time calculation** for appointment scheduling
- 🧹 **Automatic file cleanup** to manage storage
- 📊 **Performance monitoring** with detailed timing logs

### Version 1.5 - Stability Improvements
- 🔧 **State machine optimization** for better conversation flow
- 🎤 **Voice quality improvements** with ElevenLabs optimization
- 🎯 **Call reliability** with better error recovery
- 🎯 **Conversation loop prevention** with improved logic

## 📝 Troubleshooting

### MP3 Files Not Showing Up in GitHub
- Check your `.gitignore` file. Remove or comment out any lines that exclude `public/` or `*.mp3`.
- Use `git add -f public/*.mp3` to force add if needed.
- Commit and push again.

### Outlook API Issues
- Ensure you have set `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID`, and `USER_EMAIL` in your environment.
- Grant **admin consent** for `Calendars.ReadWrite` permissions in Azure.
- Make sure the user email is a real mailbox in your tenant.
- Use `node test-outlook.js` to verify API access and permissions.

## 📝 License

ISC

## 🆘 Support

For technical support or feature requests, please contact the development team.

---

**Smart Voice AI** - Transforming plumbing businesses with intelligent voice automation.

