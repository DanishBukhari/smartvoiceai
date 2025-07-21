const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

async function getAccessToken() {
  try {
    await oauth2Client.getAccessToken();
    console.log('Google Access Token acquired');
    return oauth2Client.credentials.access_token;
  } catch (error) {
    console.error('getAccessToken: Authentication error', error.message, error.stack);
    return null;
  }
}

async function getLastAppointment(accessToken, beforeDate) {
  try {
    const response = await calendar.events.list({
      calendarId,
      timeMax: beforeDate.toISOString(),
      maxResults: 1,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = response.data.items;
    if (events.length) {
      console.log('getLastAppointment: Last appointment', events[0]);
      return events[0];
    }
    return null;
  } catch (error) {
    console.error('getLastAppointment: Error', error.message, error.stack);
    return null;
  }
}

async function getNextAvailableSlot(accessToken, afterDate) {
  try {
    const response = await calendar.freebusy.query({
      resource: {
        timeMin: afterDate.toISOString(),
        timeMax: new Date(afterDate.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = response.data.calendars[calendarId].busy;
    if (busy.length === 0) {
      return afterDate;
    }
    // Find first free slot after busy periods
    let currentTime = afterDate;
    for (const interval of busy) {
      const intervalStart = new Date(interval.start);
      if (currentTime < intervalStart) {
        return currentTime;
      }
      currentTime = new Date(interval.end);
    }
    return currentTime;
  } catch (error) {
    console.error('getNextAvailableSlot: Error', error.message, error.stack);
    return null;
  }
}

async function isSlotFree(accessToken, start, end) {
  try {
    const response = await calendar.freebusy.query({
      resource: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = response.data.calendars[calendarId].busy;
    return busy.length === 0;
  } catch (error) {
    console.error('isSlotFree: Error', error.message, error.stack);
    return false;
  }
}

async function createAppointment(accessToken, eventDetails) {
  try {
    const response = await calendar.events.insert({
      calendarId,
      resource: eventDetails,
    });
    console.log('createAppointment: Success', response.data.id);
    return response.data;
  } catch (error) {
    console.error('createAppointment: Error', error.message, error.stack);
    return null;
  }
}

module.exports = { getAccessToken, getLastAppointment, getNextAvailableSlot, isSlotFree, createAppointment };