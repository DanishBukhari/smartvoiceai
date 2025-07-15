// outlook.js - Added isSlotFree

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
const userEmail = process.env.USER_EMAIL;

async function getAccessToken() {
  console.log('getAccessToken: Requesting token');
  const tokenRequest = {
    scopes: ['https://graph.microsoft.com/.default'],
  };
  try {
    const response = await cca.acquireTokenByClientCredential(tokenRequest);
    console.log('getAccessToken: Token acquired');
    return response.accessToken;
  } catch (error) {
    console.error('getAccessToken: Authentication error', error.message, error.stack);
    return null;
  }
}

async function getLastAppointment(accessToken, beforeDate) {
  if (!userEmail) throw new Error('USER_EMAIL env variable not set');
  console.log('getLastAppointment: Fetching before', beforeDate);
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events?$filter=start/dateTime lt '${beforeDate.toISOString()}'&$orderby=start/dateTime desc&$top=1`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('getLastAppointment: Last appointment', response.data.value[0]);
    return response.data.value[0] || null;
  } catch (error) {
    console.error('getLastAppointment: Error', error.message, error.stack);
    return null;
  }
}

async function getNextAvailableSlot(accessToken, afterDate) {
  if (!userEmail) throw new Error('USER_EMAIL env variable not set');
  console.log('getNextAvailableSlot: Checking after', afterDate);
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/getSchedule`;
  const body = {
    schedules: [userEmail],
    startTime: { dateTime: afterDate.toISOString(), timeZone: 'UTC' },
    endTime: { dateTime: new Date(afterDate.getTime() + 12 * 60 * 60 * 1000).toISOString(), timeZone: 'UTC' },
    availabilityViewInterval: 60,
  };
  try {
    const response = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const schedule = response.data.value[0].scheduleItems;
    for (const item of schedule) {
      if (item.status === 'free') {
        console.log('getNextAvailableSlot: Found slot', item.start.dateTime);
        return new Date(item.start.dateTime);
      }
    }
    console.log('getNextAvailableSlot: No slot found');
    return null;
  } catch (error) {
    console.error('getNextAvailableSlot: Error', error.message, error.stack);
    return null;
  }
}

async function isSlotFree(accessToken, start, end) {
  if (!userEmail) throw new Error('USER_EMAIL env variable not set');
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/getSchedule`;
  const body = {
    schedules: [userEmail],
    startTime: { dateTime: start.toISOString(), timeZone: 'UTC' },
    endTime: { dateTime: end.toISOString(), timeZone: 'UTC' },
    availabilityViewInterval: 60,
  };
  try {
    const response = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const scheduleItems = response.data.value[0].scheduleItems;
    return scheduleItems.length === 0;
  } catch (error) {
    console.error('isSlotFree: Error', error.message, error.stack);
    return false;
  }
}

async function createAppointment(accessToken, eventDetails) {
  if (!userEmail) throw new Error('USER_EMAIL env variable not set');
  console.log('createAppointment: Creating', eventDetails);
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events`;
  try {
    const response = await axios.post(url, eventDetails, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('createAppointment: Success', response.data.id);
    return response.data;
  } catch (error) {
    console.error('createAppointment: Error', error.message, error.stack);
    return null;
  }
}

module.exports = { getAccessToken, getLastAppointment, getNextAvailableSlot, isSlotFree, createAppointment };