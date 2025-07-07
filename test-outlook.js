require('dotenv').config();
const { getAccessToken } = require('./outlook');
const axios = require('axios');

const userEmail = process.env.USER_EMAIL;

async function testOutlookAPI() {
  if (!userEmail) {
    console.error('USER_EMAIL not set in .env');
    process.exit(1);
  }
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.error('Failed to get access token');
    process.exit(1);
  }
  console.log('✅ Access token acquired');

  // 1. List upcoming events
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events?$orderby=start/dateTime&$top=5`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('📅 Upcoming events:');
    response.data.value.forEach(ev => {
      console.log(`- ${ev.subject} (${ev.start.dateTime} - ${ev.end.dateTime})`);
    });
  } catch (err) {
    console.error('❌ Error listing events:', err.response?.data || err.message);
  }

  // 2. Try to create a test event
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events`;
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60000);
    const event = {
      subject: 'Test Booking Event',
      start: { dateTime: now.toISOString(), timeZone: 'UTC' },
      end: { dateTime: in30min.toISOString(), timeZone: 'UTC' },
      body: { contentType: 'HTML', content: 'This is a test event from the API.' },
    };
    const response = await axios.post(url, event, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('✅ Test event created:', response.data.id);
  } catch (err) {
    console.error('❌ Error creating event:', err.response?.data || err.message);
  }
}

testOutlookAPI(); 