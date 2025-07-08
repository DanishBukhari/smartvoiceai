require('dotenv').config();
const { getAccessToken } = require('./outlook');
const axios = require('axios');

const userEmail = process.env.USER_EMAIL;

async function testOutlookConnection() {
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

  // Test connection to the user's mailbox
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${userEmail}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('✅ Outlook API is connected! User info:');
    console.log({
      id: response.data.id,
      displayName: response.data.displayName,
      mail: response.data.mail,
      userPrincipalName: response.data.userPrincipalName,
    });
  } catch (err) {
    if (err.response) {
      console.error('❌ Error connecting to Outlook API:', err.response.status, err.response.data);
    } else {
      console.error('❌ Error connecting to Outlook API:', err.message);
    }
  }
}

testOutlookConnection(); 