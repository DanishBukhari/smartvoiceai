const axios = require('axios');



async function createOrUpdateContact(data) {
  try {
    const response = await axios({
      method: data.id ? 'PUT' : 'POST',
      url: data.id
        ? `https://rest.gohighlevel.com/v1/contacts/${data.id}?locationId=${process.env.GHL_LOCATION_ID}`
        : `https://rest.gohighlevel.com/v1/contacts?locationId=${process.env.GHL_LOCATION_ID}`,
      data,
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.contact;
  } catch (error) {
    console.error('GHL Contact Error:', error.response?.data || error.message);
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

module.exports = { createOrUpdateContact, checkAppointmentAvailability, bookAppointment };