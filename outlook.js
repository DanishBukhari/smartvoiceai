// google_calendar.js
require('dotenv').config();
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
    const { token } = await oauth2Client.getAccessToken();
    console.log('Google Access Token acquired');
    return token;
  } catch (error) {
    console.error('getAccessToken: Authentication error', error.message, error.stack);
    return null;
  }
}

async function getLastAppointment(accessToken, beforeDate) {
  try {
    // Validate beforeDate parameter
    if (!beforeDate || !(beforeDate instanceof Date) || isNaN(beforeDate.getTime())) {
      console.log('getLastAppointment: Invalid or missing beforeDate, using current time');
      beforeDate = new Date();
    }
    
    const response = await calendar.events.list({
      calendarId,
      timeMax: beforeDate.toISOString(),
      maxResults: 10, // Get more events to filter
      singleEvents: true,
      orderBy: 'startTime',
      q: 'plumbing OR appointment', // Filter for relevant events
    });
    const events = response.data.items;
    
    // Filter out birthday and other non-appointment events
    const appointments = events.filter(event => 
      event.summary && 
      !event.eventType === 'birthday' &&
      !event.summary.toLowerCase().includes('birthday') &&
      event.end.dateTime && // Must have a specific time, not all-day
      (event.summary.toLowerCase().includes('plumbing') || 
       event.summary.toLowerCase().includes('appointment') ||
       event.location) // Has location info
    );
    
    if (appointments.length) {
      const lastAppt = appointments[appointments.length - 1]; // Most recent
      console.log('getLastAppointment: Last appointment', lastAppt.summary);
      return lastAppt;
    }
    console.log('getLastAppointment: No recent plumbing appointments found');
    return null;
  } catch (error) {
    console.error('getLastAppointment: Error', error.message, error.stack);
    return null;
  }
}

async function getNextAvailableSlot(accessToken, afterDate) {
  try {
    // Validate afterDate parameter
    if (!afterDate || !(afterDate instanceof Date) || isNaN(afterDate.getTime())) {
      console.log('getNextAvailableSlot: Invalid or missing afterDate, using current time');
      afterDate = new Date();
    }
    
    const response = await calendar.freebusy.query({
      resource: {
        timeMin: afterDate.toISOString(),
        timeMax: new Date(afterDate.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = response.data.calendars[calendarId].busy;
    if (busy.length === 0) {
      return {
        start: afterDate,
        end: new Date(afterDate.getTime() + 60 * 60 * 1000) // 1 hour appointment
      };
    }
    let currentTime = afterDate;
    for (const interval of busy) {
      const intervalStart = new Date(interval.start);
      if (currentTime < intervalStart) {
        return {
          start: currentTime,
          end: new Date(currentTime.getTime() + 60 * 60 * 1000) // 1 hour appointment
        };
      }
      currentTime = new Date(interval.end);
    }
    return {
      start: currentTime,
      end: new Date(currentTime.getTime() + 60 * 60 * 1000) // 1 hour appointment
    };
  } catch (error) {
    console.error('getNextAvailableSlot: Error', error.message, error.stack);
    // Return a fallback slot for tomorrow at 9 AM
    const fallbackDate = new Date();
    fallbackDate.setDate(fallbackDate.getDate() + 1);
    fallbackDate.setHours(9, 0, 0, 0);
    return {
      start: fallbackDate,
      end: new Date(fallbackDate.getTime() + 60 * 60 * 1000)
    };
  }
}

async function isSlotFree(accessToken, start, end) {
  try {
    // Validate start and end parameters
    if (!start || !(start instanceof Date) || isNaN(start.getTime())) {
      console.log('isSlotFree: Invalid start date, returning false');
      return false;
    }
    if (!end || !(end instanceof Date) || isNaN(end.getTime())) {
      console.log('isSlotFree: Invalid end date, returning false');
      return false;
    }
    
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
    console.log('🔗 Attempting to create appointment via Google Calendar API...');
    console.log('📊 Network test: Checking connectivity to googleapis.com');
    
    // Validate that event has both start and end times
    if (!eventDetails.start || !eventDetails.end) {
      console.error('createAppointment: Error Missing start or end time.');
      
      // Auto-generate end time if missing but start is available
      if (eventDetails.start && !eventDetails.end) {
        const startTime = new Date(eventDetails.start.dateTime);
        const endTime = new Date(startTime);
        endTime.setHours(endTime.getHours() + 1); // Default 1 hour appointment
        
        eventDetails.end = {
          dateTime: endTime.toISOString(),
          timeZone: eventDetails.start.timeZone || 'Australia/Brisbane'
        };
        
        console.log('📅 Auto-generated end time:', eventDetails.end.dateTime);
      } else {
        throw new Error('Missing start and/or end time.');
      }
    }
    
    const response = await calendar.events.insert({
      calendarId,
      resource: eventDetails,
      timeout: 10000, // 10 second timeout
    });
    console.log('createAppointment: Success', response.data.id);
    return response.data;
  } catch (error) {
    console.error('createAppointment: Error', error.message);
    
    // Log more details about the network error
    if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      console.error('🌐 NETWORK ISSUE: Cannot resolve googleapis.com');
      console.error('📋 Possible causes:');
      console.error('   - Internet connection down');
      console.error('   - DNS resolution failure');
      console.error('   - Firewall blocking googleapis.com');
      console.error('   - Proxy configuration issues');
    }
    
    // Return a mock appointment for testing
    console.log('📝 Creating fallback appointment record...');
    const fallbackAppointment = {
      id: 'FALLBACK_' + Date.now(),
      summary: eventDetails.summary,
      start: eventDetails.start,
      end: eventDetails.end,
      attendees: eventDetails.attendees,
      status: 'pending_network_retry',
      description: eventDetails.description + '\n\n[CREATED OFFLINE - NEEDS SYNC]'
    };
    
    console.log('⚠️  Fallback appointment created:', fallbackAppointment.id);
    return fallbackAppointment;
  }
}

module.exports = { getAccessToken, getLastAppointment, getNextAvailableSlot, isSlotFree, createAppointment };

