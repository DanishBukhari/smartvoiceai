const axios = require('axios');

// Token management
let currentAccessToken = process.env.GHL_ACCESS_TOKEN;
let tokenExpiry = null;

/**
 * Refresh GHL access token using refresh token
 */
async function refreshGhlToken() {
  try {
    if (!process.env.GHL_REFRESH_TOKEN) {
      console.warn('No GHL refresh token available, using API key fallback');
      return process.env.GHL_API_KEY;
    }

    console.log('Refreshing GHL access token...');
    
    const response = await axios.post('https://services.gohighlevel.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: process.env.GHL_REFRESH_TOKEN,
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
    }, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (response.data.access_token) {
      currentAccessToken = response.data.access_token;
      // Set expiry time (typically 1 hour, subtract 5 minutes for safety)
      tokenExpiry = Date.now() + ((response.data.expires_in || 3600) - 300) * 1000;
      
      console.log('GHL token refreshed successfully');
      return currentAccessToken;
    } else {
      throw new Error('No access token in refresh response');
    }
  } catch (error) {
    console.error('GHL token refresh failed:', error.response?.data || error.message);
    // Fallback to API key if available
    if (process.env.GHL_API_KEY) {
      console.log('Falling back to GHL API key');
      return process.env.GHL_API_KEY;
    }
    throw new Error('GHL authentication failed - no valid tokens available');
  }
}

/**
 * Get valid GHL token, refreshing if necessary
 */
async function getValidGhlToken() {
  try {
    // Check if we need to refresh the token
    if (!currentAccessToken || (tokenExpiry && Date.now() >= tokenExpiry)) {
      return await refreshGhlToken();
    }
    
    return currentAccessToken;
  } catch (error) {
    console.error('Failed to get valid GHL token:', error.message);
    throw error;
  }
}

async function createOrUpdateContact(contactData) {
  try {
    console.log('Creating/updating GHL contact...', { hasId: !!contactData.id });
    
    // Get valid token (will refresh if needed)
    const token = await getValidGhlToken();
    
    const response = await axios({
      method: contactData.id ? 'PUT' : 'POST',
      url: contactData.id
        ? `https://rest.gohighlevel.com/v1/contacts/${contactData.id}?locationId=${process.env.GHL_LOCATION_ID}`
        : `https://rest.gohighlevel.com/v1/contacts?locationId=${process.env.GHL_LOCATION_ID}`,
      data: contactData,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('GHL contact operation successful:', { 
      contactId: response.data.contact?.id,
      method: contactData.id ? 'PUT' : 'POST'
    });
    
    return response.data.contact;
  } catch (error) {
    // Handle 401 unauthorized - token might be expired, try once more
    if (error.response?.status === 401) {
      console.log('GHL API returned 401, attempting token refresh and retry...');
      try {
        // Force token refresh
        currentAccessToken = null;
        tokenExpiry = null;
        
        // Get new token and retry
        const newToken = await getValidGhlToken();
        
        const retryResponse = await axios({
          method: contactData.id ? 'PUT' : 'POST',
          url: contactData.id
            ? `https://rest.gohighlevel.com/v1/contacts/${contactData.id}?locationId=${process.env.GHL_LOCATION_ID}`
            : `https://rest.gohighlevel.com/v1/contacts?locationId=${process.env.GHL_LOCATION_ID}`,
          data: contactData,
          headers: {
            Authorization: `Bearer ${newToken}`,
            'Content-Type': 'application/json',
          },
        });
        
        console.log('GHL contact operation successful after retry:', { 
          contactId: retryResponse.data.contact?.id,
          method: contactData.id ? 'PUT' : 'POST'
        });
        
        return retryResponse.data.contact;
      } catch (retryError) {
        console.error('GHL contact save failed after token refresh retry:', retryError.response?.data || retryError.message);
        throw retryError;
      }
    }
    
    console.error('GHL contact save failed:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      contactData: { ...contactData, id: contactData.id ? '[REDACTED]' : undefined }
    });
    throw error;
  }
}

async function checkAppointmentAvailability(start, end) {
  try {
    const response = await axios.get(
      `https://rest.gohighlevel.com/v1/appointments?locationId=${process.env.GHL_LOCATION_ID}&start=${start.toISOString()}&end=${end.toISOString()}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        },
      }
    );
    return response.data.appointments.length === 0;
  } catch (error) {
    console.error('GHL Availability Error:', error.response?.data || error.message);
    return false;
  }
}

async function bookAppointment(contactId, slot) {
  try {
    const appointmentData = {
      contactId: contactId,
      startTime: slot.start.toISOString(),
      endTime: slot.end.toISOString(),
      title: 'Plumbing Appointment',
      locationId: process.env.GHL_LOCATION_ID,
    };
    const response = await axios.post(
      `https://rest.gohighlevel.com/v1/appointments`,
      appointmentData,
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('GHL Booking Error:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { 
  createOrUpdateContact, 
  checkAppointmentAvailability, 
  bookAppointment,
  refreshGhlToken,
  getValidGhlToken 
};