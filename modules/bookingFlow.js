// modules/bookingFlow.js - Comprehensive booking and appointment management
const { getResponse } = require('../nlp');
const { getAccessToken, createAppointment } = require('../outlook');
const { createOrUpdateContact } = require('../ghl');
const { sendBookingConfirmationEmail } = require('../professional-email-service');
const { analyzeLocationForBooking } = require('../location-optimizer');
const { notifyError, notifySuccess } = require('../notifications');
const { findMostEfficientSlot } = require('./travelOptimization');
const { stateMachine, transitionTo, addToHistory, updateClientData, hasCompleteDetails } = require('./stateMachine');

const BRISBANE_TZ = 'Australia/Brisbane';

async function handleBookingRequest(input) {
  console.log('📅 Processing booking request...');
  
  // Check if we have complete customer details
  if (hasCompleteDetails()) {
    console.log('✅ Complete details available, proceeding with booking');
    return await executeBooking();
  } else {
    console.log('ℹ️ Missing details, starting collection process');
    transitionTo('collect_details', 'missing customer details');
    return await startDetailCollection();
  }
}

async function startDetailCollection() {
  const missingDetails = [];
  const { name, email, address } = stateMachine.clientData;
  
  if (!name) missingDetails.push('name');
  if (!email) missingDetails.push('email');
  if (!address) missingDetails.push('address');
  
  const response = `Great! I'll need to collect a few details to book your appointment. I need your ${missingDetails.join(', ')}. You can give me all of them together if it's easier, or we can go one by one. What would you prefer?`;
  
  stateMachine.collectingDetail = missingDetails[0];
  stateMachine.detailsCollectionStep = 0;
  
  addToHistory('assistant', response);
  return response;
}

async function handleDetailCollection(input) {
  const { collectingDetail, detailsCollectionStep } = stateMachine;
  
  console.log(`📋 Collecting detail: ${collectingDetail}, step: ${detailsCollectionStep}`);
  
  switch (collectingDetail) {
    case 'name':
      return await collectName(input);
    case 'email':
      return await collectEmail(input);
    case 'address':
      return await collectAddress(input);
    case 'phone':
      return await collectPhone(input);
    default:
      return await proceedToBooking();
  }
}

async function collectName(input) {
  const { extractNameFromInput, isValidName } = require('./dataExtraction');
  
  const name = extractNameFromInput(input);
  
  if (name && isValidName(name)) {
    updateClientData({ name });
    
    const response = `Thank you, ${name}. Could I have your email address?`;
    stateMachine.collectingDetail = 'email';
    stateMachine.detailsCollectionStep = 1;
    
    addToHistory('assistant', response);
    return response;
  } else {
    const response = "I need your full name for the appointment. Could you please provide your first and last name?";
    addToHistory('assistant', response);
    return response;
  }
}

async function collectEmail(input) {
  const { validateEmail, correctEmailFromTranscription } = require('./inputValidation');
  
  const emailMatch = input.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  
  if (emailMatch) {
    const correctedEmail = correctEmailFromTranscription(emailMatch[0]);
    
    if (validateEmail(correctedEmail)) {
      updateClientData({ email: correctedEmail });
      
      const response = `Perfect! And your full address? Please include street number, street name, suburb, and postcode.`;
      stateMachine.collectingDetail = 'address';
      stateMachine.detailsCollectionStep = 2;
      
      addToHistory('assistant', response);
      return response;
    }
  }
  
  const response = "I need a valid email address to send you the appointment confirmation. Could you please provide your email?";
  addToHistory('assistant', response);
  return response;
}

async function collectAddress(input) {
  const { validateAustralianAddress } = require('./dataExtraction');
  
  if (validateAustralianAddress(input)) {
    updateClientData({ address: input.trim() });
    
    // Set phone from caller ID if available
    if (stateMachine.callerPhoneNumber) {
      updateClientData({ phone: stateMachine.callerPhoneNumber });
    }
    
    stateMachine.allDetailsCollected = true;
    transitionTo('book_appointment', 'all details collected');
    
    return await proceedToBooking();
  } else {
    const response = "I need your complete address including street number, street name, suburb, and postcode. For example: '123 Main Street, Brisbane, QLD 4000'. Could you please provide your full address?";
    addToHistory('assistant', response);
    return response;
  }
}

async function proceedToBooking() {
  console.log('🎯 All details collected, proceeding to appointment booking');
  
  try {
    const accessToken = await getAccessToken();
    
    // Analyze location and get optimized appointment slot
    const locationAnalysis = await analyzeLocationForBooking(stateMachine.clientData.address);
    
    if (!locationAnalysis.feasible) {
      const response = `I apologize, but we don't currently service ${stateMachine.clientData.address}. Our service area covers Brisbane and surrounding suburbs. Is there another address we can help you with?`;
      addToHistory('assistant', response);
      return response;
    }
    
    // Find the most efficient appointment slot
    const smartSlotResult = await findMostEfficientSlot(
      accessToken,
      stateMachine.clientData.address,
      stateMachine.clientData.issueDescription || 'plumbing service',
      stateMachine.urgent ? 'urgent' : 'standard'
    );
    
    if (smartSlotResult && smartSlotResult.slot) {
      stateMachine.nextSlot = smartSlotResult.slot;
      transitionTo('confirm_slot', 'slot found');
      
      const appointmentTime = new Date(smartSlotResult.slot.start).toLocaleString('en-AU', {
        timeZone: BRISBANE_TZ,
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      const response = `Perfect! Based on travel time calculation (${smartSlotResult.travelTime}), the earliest available appointment is ${appointmentTime}. This ensures our plumber arrives with adequate time for your service. Would you like me to book this appointment for you?`;
      
      addToHistory('assistant', response);
      return response;
    } else {
      const response = "I'm having trouble finding an available appointment slot right now. Let me check our schedule and get back to you shortly. Is there a preferred day or time that would work better for you?";
      addToHistory('assistant', response);
      return response;
    }
  } catch (error) {
    console.error('Error in booking process:', error);
    await notifyError(error, 'proceedToBooking');
    
    const response = "I'm experiencing a technical issue with our booking system. Let me take your details and have someone call you back within the hour to confirm your appointment. Is that okay?";
    addToHistory('assistant', response);
    return response;
  }
}

async function confirmSlot(input) {
  const lowerInput = input.toLowerCase();
  
  if (lowerInput.includes('yes') || lowerInput.includes('book') || lowerInput.includes('confirm')) {
    return await executeBooking();
  } else if (lowerInput.includes('no') || lowerInput.includes('different') || lowerInput.includes('another')) {
    transitionTo('book_appointment', 'customer wants different time');
    const response = "No worries! When would you prefer instead? I can check for morning, afternoon, or evening appointments.";
    addToHistory('assistant', response);
    return response;
  } else {
    // Customer might be providing a preference
    const response = "I understand you'd like a different time. Let me check what else is available. Would you prefer morning, afternoon, or evening?";
    addToHistory('assistant', response);
    return response;
  }
}

async function executeBooking() {
  console.log('⚡ Executing appointment booking...');
  
  try {
    const accessToken = await getAccessToken();
    const { clientData, nextSlot, callerPhoneNumber } = stateMachine;
    
    // Generate appointment reference
    const appointmentId = generateAppointmentReference(callerPhoneNumber || clientData.phone);
    
    // Create appointment in Outlook
    const appointmentData = {
      subject: `Plumbing Service - ${clientData.name}`,
      body: {
        contentType: 'Text',
        content: `Service for: ${clientData.issueDescription || 'Plumbing service'}\n` +
                `Customer: ${clientData.name}\n` +
                `Phone: ${clientData.phone || callerPhoneNumber}\n` +
                `Email: ${clientData.email}\n` +
                `Address: ${clientData.address}\n` +
                `Reference: ${appointmentId}\n` +
                `Special Instructions: ${clientData.specialInstructions || 'None'}`
      },
      start: {
        dateTime: nextSlot.start,
        timeZone: BRISBANE_TZ
      },
      end: {
        dateTime: nextSlot.end,
        timeZone: BRISBANE_TZ
      },
      location: {
        displayName: clientData.address
      }
    };
    
    const appointment = await createAppointment(accessToken, appointmentData);
    
    if (appointment) {
      // Save contact to GHL
      await saveContactToGHL(clientData, appointmentId);
      
      // Send confirmation email
      await sendConfirmationEmail(clientData, appointmentData, appointmentId);
      
      stateMachine.appointmentId = appointmentId;
      stateMachine.appointmentBooked = true;
      transitionTo('collect_special_instructions', 'appointment booked successfully');
      
      const appointmentTime = new Date(nextSlot.start).toLocaleString('en-AU', {
        timeZone: BRISBANE_TZ,
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      const response = `Excellent! I've booked your appointment for ${appointmentTime}. Reference number: ${appointmentId}. Any special instructions, like gate codes or security details?`;
      
      addToHistory('assistant', response);
      await notifySuccess(`Appointment booked: ${clientData.name} - ${appointmentTime}`);
      
      return response;
    } else {
      throw new Error('Failed to create appointment in Outlook');
    }
  } catch (error) {
    console.error('Booking execution failed:', error);
    await notifyError(error, 'executeBooking');
    
    const response = "I encountered an issue while booking your appointment. I've saved your details and someone will call you within the hour to confirm your booking. Thank you for your patience.";
    addToHistory('assistant', response);
    return response;
  }
}

async function collectSpecialInstructions(input) {
  console.log('📝 Collecting special instructions...');
  
  updateClientData({ specialInstructions: input || 'None' });
  
  transitionTo('booking_complete', 'special instructions collected');
  
  const response = await getResponse(
    "Perfect! Your appointment is all set. You'll receive an email confirmation shortly with all the details. Is there anything else I can help you with today?",
    stateMachine.conversationHistory
  );
  
  addToHistory('assistant', response);
  return response;
}

async function saveContactToGHL(clientData, appointmentId) {
  try {
    const contactData = {
      firstName: clientData.name?.split(' ')[0] || '',
      lastName: clientData.name?.split(' ').slice(1).join(' ') || '',
      email: clientData.email,
      phone: clientData.phone,
      address: clientData.address,
      customField: {
        specialInstructions: clientData.specialInstructions || 'None',
        issueDescription: clientData.issueDescription || 'Plumbing service',
        appointmentReference: appointmentId,
      },
    };
    
    await createOrUpdateContact(contactData);
    console.log('✅ Contact saved to GHL');
  } catch (error) {
    console.error('Failed to save contact to GHL:', error);
    await notifyError(error, 'saveContactToGHL');
  }
}

async function sendConfirmationEmail(clientData, appointmentData, appointmentId) {
  try {
    await sendBookingConfirmationEmail(
      clientData.email,
      clientData.name,
      appointmentData,
      appointmentId,
      clientData.address
    );
    console.log('✅ Confirmation email sent');
  } catch (error) {
    console.error('Failed to send confirmation email:', error);
    await notifyError(error, 'sendConfirmationEmail');
  }
}

function generateAppointmentReference(phoneNumber) {
  if (!phoneNumber) {
    return 'APT' + Date.now().toString().slice(-6);
  }
  
  // Use last 4 digits of phone + timestamp
  const phoneDigits = phoneNumber.replace(/\D/g, '').slice(-4);
  const timestamp = Date.now().toString().slice(-4);
  return `APT${phoneDigits}${timestamp}`;
}

module.exports = {
  handleBookingRequest,
  startDetailCollection,
  handleDetailCollection,
  collectName,
  collectEmail,
  collectAddress,
  proceedToBooking,
  confirmSlot,
  executeBooking,
  collectSpecialInstructions,
  generateAppointmentReference
};
