const msal = require('@azure/msal-node');
const axios = require('axios');

const config = {
  auth: {
    clientId: process.env.OUTLOOK_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID}`,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
  },
};

const cca = new msal.ConfidentialClientApplication(config);

async function getAccessToken() {
  const tokenRequest = {
    scopes: ['https://graph.microsoft.com/.default'],
  };
  try {
    const response = await cca.acquireTokenByClientCredential(tokenRequest);
    return response.accessToken;
  } catch (error) {
    console.error('Authentication Error:', error);
    return null;
  }
}

async function getLastAppointment(accessToken, beforeDate) {
  const url = `https://graph.microsoft.com/v1.0/me/calendar/events?$filter=start/dateTime lt '${beforeDate.toISOString()}'&$orderby=start/dateTime desc&$top=1`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.value[0] || null;
  } catch (error) {
    console.error('Last Appointment Error:', error);
    return null;
  }
}

async function getNextAvailableSlot(accessToken, afterDate) {
  const url = `https://graph.microsoft.com/v1.0/me/calendar/getSchedule`;
  const body = {
    schedules: ['me'],
    startTime: { dateTime: afterDate.toISOString(), timeZone: 'UTC' },
    endTime: { dateTime: new Date(afterDate.getTime() + 24 * 60 * 60 * 1000).toISOString(), timeZone: 'UTC' },
    availabilityViewInterval: 30,
  };
  try {
    const response = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const schedule = response.data.value[0].scheduleItems;
    for (const item of schedule) {
      if (item.status === 'free') {
        return new Date(item.start.dateTime);
      }
    }
    return null;
  } catch (error) {
    console.error('Availability Check Error:', error);
    return null;
  }
}

async function createAppointment(accessToken, eventDetails) {
  const url = `https://graph.microsoft.com/v1.0/me/calendar/events`;
  try {
    const response = await axios.post(url, eventDetails, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  } catch (error) {
    console.error('Appointment Creation Error:', error);
    return null;
  }
}

module.exports = { getAccessToken, getLastAppointment, getNextAvailableSlot, createAppointment };

