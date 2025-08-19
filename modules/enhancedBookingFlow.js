/**
 * Enhanced Booking Flow with Offline Calendar Support
 * This module provides booking functionality with graceful fallbacks when external services are unavailable
 */

const { 
  stateMachine, 
  transitionTo, 
  addToHistory, 
  updateClientData, 
  updateCustomerData,
  hasCompleteDetails
} = require('./stateMachine');
const { sendBookingConfirmationEmail } = require('../professional-email-service');

// Simple in-memory appointment storage for testing/fallback
let fallbackAppointments = [];

/**
 * Handles the complete booking request with fallback mechanisms
 */
async function handleBookingRequest(userInput) {
  console.log('📅 Starting booking request...');
  
  try {
    // Check if we have all required customer details
    const requiredDetails = ['name', 'address', 'email'];
    const hasAllDetails = requiredDetails.every(detail => 
      stateMachine.customerData && stateMachine.customerData[detail]
    );
    
    if (!hasAllDetails) {
      console.log('📋 Missing customer details, starting collection...');
      // First extract any data from current input, then start collection
      const currentCustomerData = stateMachine.customerData || {};
      const extractedData = extractDataFromInput(userInput, currentCustomerData);
      if (extractedData && Object.keys(extractedData).length > 0) {
        updateCustomerData(extractedData);
        console.log('📊 Extracted data during booking request:', extractedData);
        
        // Re-check if we now have all details
        const updatedHasAllDetails = requiredDetails.every(detail => 
          stateMachine.customerData && stateMachine.customerData[detail]
        );
        
        if (updatedHasAllDetails) {
          console.log('🎯 All details collected after extraction, proceeding to appointment booking');
          return await proceedToBooking(userInput);
        }
      }
      
      return await startDetailCollection(userInput);
    }
    
    // All details available, proceed to appointment booking
    console.log('🎯 All details collected, proceeding to appointment booking');
    return await proceedToBooking(userInput);
    
  } catch (error) {
    console.error('handleBookingRequest error:', error);
    return "I'm having some technical difficulties with the booking system. Let me take your details manually and call you back to confirm the appointment.";
  }
}

/**
 * Enhanced booking process with AI-powered smart scheduling
 */
async function proceedToBooking(userInput = '') {
  console.log('🗺️ Analyzing location for optimal booking:', stateMachine.customerData?.address);
  
  try {
    // Use smart scheduler for intelligent appointment booking
    const appointment = await findOptimalAppointmentSlot(
      stateMachine.customerData?.address,
      stateMachine.customerData?.issueDescription || 'General plumbing service',
      stateMachine.customerData
    );
    
    if (appointment && appointment.start) {
      // Store the appointment details
      stateMachine.bookingDetails = {
        reference: appointment.reference,
        dateTime: appointment.start,
        customer: stateMachine.customerData,
        issue: stateMachine.currentIssue,
        location: stateMachine.customerData?.address,
        estimatedDuration: `${appointment.estimatedDuration} minutes`,
        travelTime: appointment.travelTime,
        priority: appointment.priority,
        analysis: appointment.analysis
      };
      
      // Generate confirmation response - ensure proper Brisbane time display
      const appointmentTime = new Date(appointment.start).toLocaleString('en-AU', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Australia/Brisbane',
        hour12: true
      });
      
      // Store the properly formatted time for consistent display
      const formattedTime = new Date(appointment.start).toLocaleString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Brisbane',
        hour12: true
      });
      
      transitionTo('booking_complete');
      
      // Try to create actual calendar appointment
      try {
        const { getAccessToken, createAppointment } = require('../outlook');
        const accessToken = await getAccessToken();
        
        if (accessToken) {
          const eventDetails = {
            summary: `Plumbing Service - ${stateMachine.customerData?.name || 'Customer'}`,
            location: stateMachine.customerData?.address || 'Customer Location',
            description: `Customer: ${stateMachine.customerData?.name || 'N/A'}
Phone: ${stateMachine.customerData?.phone || stateMachine.callerPhoneNumber || 'N/A'}
Email: ${stateMachine.customerData?.email || 'N/A'}
Issue: ${stateMachine.customerData?.issue || 'Plumbing service'}
Special Instructions: ${stateMachine.customerData?.specialInstructions || 'None'}
Reference: ${appointment.reference}`,
            start: {
              dateTime: appointment.start.toISOString(),
              timeZone: 'Australia/Brisbane',
            },
            end: {
              dateTime: appointment.end.toISOString(),
              timeZone: 'Australia/Brisbane',
            },
            attendees: [
              { email: stateMachine.customerData?.email || 'noreply@usherfix.com' }
            ]
          };
          
          const calendarEvent = await createAppointment(accessToken, eventDetails);
          if (calendarEvent && calendarEvent.id) {
            appointment.calendarEventId = calendarEvent.id;
            console.log('✅ Calendar appointment created successfully:', calendarEvent.id);
          }
        }
      } catch (calendarError) {
        console.log('⚠️ Calendar creation failed, continuing with booking confirmation:', calendarError.message);
        // Don't fail the booking if calendar creation fails
      }
      
      // Send confirmation email
      try {
        // Ensure phone number is available for email
        const phoneNumber = stateMachine.customerData?.phone || stateMachine.callerPhoneNumber;
        
        const emailBookingDetails = {
          customerEmail: stateMachine.customerData?.email,
          customerName: stateMachine.customerData?.name,
          customerAddress: stateMachine.customerData?.address,
          customerPhone: phoneNumber,
          appointmentTime: appointment.start,
          referenceNumber: appointment.reference,
          issueDescription: stateMachine.customerData?.issue || 
                           stateMachine.customerData?.issueDescription ||
                           stateMachine.currentIssue?.description || 
                           'Plumbing service',
          specialInstructions: stateMachine.customerData?.specialInstructions || 'Standard plumbing service - no special requirements',
          travelMinutes: appointment.travelTime || '20-30 minutes', // Use string version for display
          totalBufferMinutes: appointment.totalBuffer || 0,
          serviceDuration: appointment.estimatedDuration || appointment.serviceDuration || 60
        };
        
        console.log('📧 Email booking details - Phone:', emailBookingDetails.customerPhone);
        console.log('📧 Email booking details - All data:', JSON.stringify(emailBookingDetails, null, 2));
        
        await sendBookingConfirmationEmail(emailBookingDetails);
        console.log('✅ Confirmation email sent successfully');
        
        // Update last booked job location for travel optimization
        try {
          const { updateLastBookedJobLocation } = require('./travelOptimization');
          updateLastBookedJobLocation(stateMachine.customerData?.address);
        } catch (travelOptError) {
          console.log('⚠️ Could not update last booked job location:', travelOptError.message);
        }
        
        // Set appointment booking flags
        stateMachine.appointmentBooked = true;
        stateMachine.appointmentId = appointment.calendarEventId || appointment.reference;
        stateMachine.referenceNumber = appointment.reference;
        console.log('📋 Appointment booking status updated');
        
      } catch (emailError) {
        console.error('❌ Failed to send confirmation email:', emailError);
        // Don't fail the booking if email fails
        // Still mark as booked since the appointment slot was created
        stateMachine.appointmentBooked = true;
        stateMachine.appointmentId = appointment.calendarEventId || appointment.reference;
        stateMachine.referenceNumber = appointment.reference;
      }
      
      return `Perfect! I've scheduled your appointment for ${formattedTime}. ` +
             `Your reference number is ${appointment.reference}. ` +
             `Our plumber will arrive at ${stateMachine.customerData?.address} ` +
             `and you'll receive a confirmation email at ${stateMachine.customerData?.email}. ` +
             `Is there anything else I can help you with?`;
    } else {
      // Fallback to manual scheduling
      transitionTo('manual_scheduling');
      return "I'm having trouble finding an available appointment slot right now. " +
             "Let me check our schedule and get back to you shortly. " +
             "Is there a preferred day or time that would work better for you?";
    }
    
  } catch (error) {
    console.error('proceedToBooking error:', error);
    transitionTo('manual_scheduling');
    return "I'm experiencing some technical difficulties with our scheduling system. " +
           "Let me take your preferred time and have our office call you back to confirm the appointment. " +
           "What day and time would work best for you?";
  }
}

/**
 * Finds optimal appointment slot with enhanced fallback logic
 */
/**
 * Find optimal appointment slot using AI-powered smart scheduling
 */
async function findOptimalAppointmentSlot(customerAddress, issueDescription, customerData = {}, priority = 'standard') {
  console.log('🧠 Using AI-powered smart scheduling...');
  
  try {
    // Import smart scheduler
    const { findOptimalAppointmentSlot: smartScheduler } = require('./smartScheduler');
    
    // Get access token for calendar integration
    let accessToken = null;
    try {
      const { OAuth2Client } = require('google-auth-library');
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID, 
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        oauth2Client.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });
        const { credentials } = await oauth2Client.refreshAccessToken();
        accessToken = credentials.access_token;
        console.log('Google Access Token acquired for smart scheduling');
      }
    } catch (error) {
      console.log('📅 Google Calendar integration not available:', error.message);
    }
    
    // Use smart scheduler to find optimal slot
    const smartResult = await smartScheduler(customerAddress, issueDescription, customerData, accessToken);
    
    if (smartResult && smartResult.start) {
      // Convert to appointment format with calendar integration
      const appointment = {
        start: smartResult.start,
        end: smartResult.end,
        reference: generateAppointmentReference(),
        type: smartResult.type || 'smart_scheduled',
        location: customerAddress,
        priority: smartResult.priority,
        estimatedDuration: smartResult.estimatedDuration,
        travelTime: smartResult.travelTime,
        travelMinutes: smartResult.travelMinutes,
        analysis: smartResult.analysis,
        score: smartResult.score
      };
      
      // Create calendar event if access token available
      if (accessToken) {
        try {
          const { createAppointment } = require('../outlook');
          const calendarEventId = await createAppointment(
            accessToken,
            appointment.start,
            appointment.end,
            customerData?.name || 'Customer',
            customerAddress,
            issueDescription,
            customerData?.specialInstructions
          );
          appointment.calendarEventId = calendarEventId;
          console.log(`✅ Smart scheduled appointment with calendar event: ${calendarEventId}`);
        } catch (calendarError) {
          console.log('⚠️ Calendar event creation failed:', calendarError.message);
        }
      }
      
      console.log(`🎯 Smart scheduling result:
        📅 Time: ${appointment.start.toLocaleString()}
        ⏱️ Duration: ${appointment.estimatedDuration} minutes
        🚗 Travel: ${appointment.travelTime}
        🎚️ Priority: ${appointment.priority}
        🧠 Analysis: ${appointment.analysis?.complexity} complexity`);
      
      return appointment;
    }
  } catch (error) {
    console.log('⚠️ Smart scheduling failed, using fallback:', error.message);
  }
  
  // Fallback to original logic if smart scheduling fails
  try {
    // Try external calendar integration first
    const externalSlot = await tryExternalCalendarIntegration(customerAddress, issueDescription, priority);
    if (externalSlot) {
      return externalSlot;
    }
    
    // Fallback to intelligent local scheduling
    console.log('📅 Using intelligent local scheduling fallback...');
    return generateIntelligentFallbackSlot(customerAddress, issueDescription, priority);
    
  } catch (error) {
    console.error('findOptimalAppointmentSlot error:', error);
    // Final fallback to basic scheduling
    return generateBasicFallbackSlot(priority);
  }
}

/**
 * Attempts to use external calendar integration
 */
async function tryExternalCalendarIntegration(customerAddress, issueType, priority) {
  try {
    // Check if external modules are available
    const outlook = require('../outlook');
    const travelOptimization = require('./travelOptimization');
    
    if (typeof outlook.getAccessToken === 'function') {
      console.log('🔗 Attempting external calendar integration...');
      
      const accessToken = await outlook.getAccessToken();
      if (accessToken) {
        const externalResult = await travelOptimization.findMostEfficientSlot(
          accessToken, 
          customerAddress, 
          issueType, 
          priority
        );
        
        // Convert external result to proper appointment format
        if (externalResult && externalResult.slot) {
          // Extract numeric minutes from travel time string for calculations
          const { extractMinutesFromTravelTime } = require('./travelOptimization');
          const travelMinutes = extractMinutesFromTravelTime(externalResult.travelTime);
          
          return {
            start: externalResult.slot.start,
            end: externalResult.slot.end,
            reference: generateAppointmentReference(),
            type: 'external_calendar',
            location: customerAddress,
            priority: priority,
            travelTime: externalResult.travelTime, // Keep string version for display
            travelMinutes: travelMinutes, // Add numeric version for calculations
            serviceDuration: externalResult.serviceDuration || 60,
            totalBuffer: externalResult.totalBuffer || 0
          };
        }
      }
    }
  } catch (error) {
    console.log('🔄 External calendar integration failed, using fallback:', error.message);
  }
  
  return null;
}

/**
 * Generates intelligent fallback appointment slots
 */
function generateIntelligentFallbackSlot(customerAddress, issueType, priority) {
  const now = new Date();
  let appointmentDate = new Date(now);
  
  // Determine urgency-based scheduling
  if (priority === 'emergency') {
    // Emergency: Next available slot (within 2 hours)
    appointmentDate.setHours(appointmentDate.getHours() + 2);
  } else if (priority === 'urgent') {
    // Urgent: Same day or next business day
    if (appointmentDate.getHours() >= 16) { // After 4 PM
      appointmentDate.setDate(appointmentDate.getDate() + 1);
      appointmentDate.setHours(9, 0, 0, 0);
    } else {
      appointmentDate.setHours(appointmentDate.getHours() + 4);
    }
  } else {
    // Standard: Next business day during business hours (9 AM - 5 PM)
    appointmentDate.setDate(appointmentDate.getDate() + 1);
    
    // Set to business hours: random time between 9 AM and 4 PM to avoid same time
    const businessHourStart = 9;
    const businessHourEnd = 16; // 4 PM to allow for 1-hour appointments
    const randomHour = businessHourStart + Math.floor(Math.random() * (businessHourEnd - businessHourStart));
    const randomMinute = Math.random() < 0.5 ? 0 : 30; // Either :00 or :30
    appointmentDate.setHours(randomHour, randomMinute, 0, 0);
    
    // Skip weekends
    if (appointmentDate.getDay() === 0) { // Sunday
      appointmentDate.setDate(appointmentDate.getDate() + 1);
    } else if (appointmentDate.getDay() === 6) { // Saturday
      appointmentDate.setDate(appointmentDate.getDate() + 2);
    }
  }
  
  // Round to next 30-minute slot
  const minutes = appointmentDate.getMinutes();
  if (minutes < 30) {
    appointmentDate.setMinutes(30, 0, 0);
  } else {
    appointmentDate.setHours(appointmentDate.getHours() + 1, 0, 0, 0);
  }
  
  const appointment = {
    start: appointmentDate,
    end: new Date(appointmentDate.getTime() + 60 * 60 * 1000), // 1 hour
    reference: generateAppointmentReference(),
    type: 'fallback_intelligent',
    location: customerAddress,
    priority: priority
  };
  
  // Store in fallback system
  fallbackAppointments.push(appointment);
  
  console.log(`📅 Generated intelligent fallback slot: ${appointmentDate.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
  return appointment;
}

/**
 * Generates basic fallback appointment slot
 */
function generateBasicFallbackSlot(priority) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Generate random business hour appointment to avoid same time every time
  const businessHours = [9, 10, 11, 13, 14, 15, 16]; // 9 AM - 4 PM (skip lunch hour 12)
  const randomHour = businessHours[Math.floor(Math.random() * businessHours.length)];
  const randomMinute = Math.random() < 0.5 ? 0 : 30; // Either :00 or :30
  
  tomorrow.setHours(randomHour, randomMinute, 0, 0);
  
  return {
    start: tomorrow,
    end: new Date(tomorrow.getTime() + 60 * 60 * 1000),
    reference: generateAppointmentReference(),
    type: 'fallback_basic',
    priority: priority
  };
}

/**
 * Generates unique appointment reference
 */
function generateAppointmentReference() {
  const phoneNumber = stateMachine.callerPhoneNumber || '+61000000000';
  const timestamp = Date.now().toString().slice(-6);
  const phoneDigits = phoneNumber.replace(/[^\d]/g, '').slice(-4);
  const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `PLB-${phoneDigits}-${timestamp}-${randomSuffix}`;
}

/**
 * Enhanced detail collection with better validation
 */
async function startDetailCollection(userInput) {
  console.log('📋 Starting enhanced detail collection...');
  
  // First, try to extract data from the current input if provided
  if (userInput && userInput.trim().length > 0) {
    const currentData = stateMachine.customerData || {};
    const extractedData = extractDataFromInput(userInput, currentData);
    if (extractedData && Object.keys(extractedData).length > 0) {
      updateCustomerData(extractedData);
      console.log('📊 Extracted data in startDetailCollection:', extractedData);
    }
  }
  
  // Check what details we already have
  const currentData = stateMachine.customerData || {};
  const clientData = stateMachine.clientData || {};
  
  // Ensure caller phone number is stored in customer data if available
  if (stateMachine.callerPhoneNumber && !currentData.phone) {
    updateCustomerData({ phone: stateMachine.callerPhoneNumber });
    console.log('📞 Auto-set phone number from caller:', stateMachine.callerPhoneNumber);
  }
  
  console.log('📊 Current customer data:', currentData);
  console.log('📊 Client data status:', clientData);
  console.log('📞 Caller phone number available:', stateMachine.callerPhoneNumber);
  
  // Determine what we need to collect next (proper order)
  const missingDetails = [];
  
  if (!currentData.name) missingDetails.push('name');
  if (!currentData.email) missingDetails.push('email');
  if (!currentData.address) missingDetails.push('address');
  
  // Only collect phone if not available from caller ID and not in customer data
  if (!currentData.phone && !stateMachine.callerPhoneNumber) {
    missingDetails.push('phone');
  } else if (stateMachine.callerPhoneNumber && !currentData.phone) {
    // Auto-store caller phone number in customer data
    updateCustomerData({ phone: stateMachine.callerPhoneNumber });
    console.log(`📞 Auto-detected phone number: ${stateMachine.callerPhoneNumber}`);
  }
  
  // Ask for special instructions AFTER address is collected (optional but prompted)
  if (!currentData.specialInstructions && currentData.address) {
    missingDetails.push('specialInstructions');
  }
  
  if (missingDetails.length === 0) {
    console.log('🎯 All details collected, proceeding to booking');
    return await proceedToBooking(userInput);
  }
  
  // Ask for the next missing detail
  const nextDetail = missingDetails[0];
  transitionTo('collect_details');
  
  switch (nextDetail) {
    case 'name':
      return "I'll need to get some details to book your appointment. Could I start with your name?";
    case 'address':
      return "Thank you. What's your full address including suburb and postcode?";
    case 'email':
      return "Perfect. And what's your email address for the booking confirmation?";
    case 'phone':
      return "Great. What's the best phone number to reach you on?";
    case 'specialInstructions':
      stateMachine.askingForSpecialInstructions = true; // Set flag
      return "Do you have any special instructions or access requirements for our technician? For example, gate codes, preferred entry points, or specific areas to avoid?";
    default:
      return "I need a few more details to complete your booking. Let's start with your name and address.";
  }
}

/**
 * Handles detail collection step by step
 */
async function handleDetailCollection(userInput) {
  console.log('📋 Collecting detail:', userInput);
  
  // Update conversation history
  addToHistory('user', userInput);
  
  // Extract data from user input using basic parsing
  const existingData = stateMachine.customerData || {};
  const extractedData = extractDataFromInput(userInput, existingData);
  
  // Update customer data using proper synchronization function
  if (extractedData && Object.keys(extractedData).length > 0) {
    updateCustomerData(extractedData);
    console.log('📊 Updated customer data:', stateMachine.customerData);
  }
  
  // Check if we have all details now
  // Note: phone is auto-detected from caller ID, so not required to be asked for
  const currentData = stateMachine.customerData || {};
  
  // Auto-store caller phone number if available and not already stored
  if (stateMachine.callerPhoneNumber && !currentData.phone) {
    updateCustomerData({ phone: stateMachine.callerPhoneNumber });
    console.log(`📞 Auto-detected phone number: ${stateMachine.callerPhoneNumber}`);
  }
  
  // Required details (phone is auto-detected, not manually collected)
  const hasName = !!(currentData.name);
  const hasEmail = !!(currentData.email);
  const hasAddress = !!(currentData.address);
  const hasPhone = !!(currentData.phone || stateMachine.callerPhoneNumber);
  
  // Special instructions are optional, not required for booking
  const hasAllDetails = hasName && hasEmail && hasAddress && hasPhone;
  
  if (hasAllDetails) {
    console.log('🎯 All details collected, proceeding to appointment booking');
    return await proceedToBooking(userInput);
  } else {
    return await startDetailCollection(userInput);
  }
}

/**
 * Improved data extraction from user input with better validation
 */
function extractDataFromInput(input, currentCustomerData = {}) {
  const data = {};
  const lowerInput = input.toLowerCase();
  
  // Extract name (improved pattern matching)
  const namePatterns = [
    /(?:my name is|i'm|i am|this is|it's|call me)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /^([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s|$)/,  // Direct name format like "Sara Johns"
    /^([A-Z][a-z]+\s[A-Z][a-z]+)$/,  // Exact name match for direct responses
    /sure[.,]?\s*my name is\s+([^,.]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      const potentialName = match[1].trim();
      // Validate it's not an email or address and is a proper name
      if (!potentialName.includes('@') && !potentialName.includes('gmail') && 
          potentialName.length >= 2 && potentialName.length <= 50 &&
          /^[a-zA-Z\s'-]+$/.test(potentialName)) {
        data.name = potentialName;
        break;
      }
    }
  }
  
  // Extract email (strict pattern) - only extract if it's clearly an email
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
  const emailMatch = input.match(emailPattern);
  if (emailMatch) {
    data.email = emailMatch[0];
    // Do NOT treat this as an address
    console.log('📧 Email extracted:', data.email);
  }
  
  // Extract address (only if no email detected and contains proper address indicators)
  if (!data.email && !input.includes('@')) {
    const addressPatterns = [
      /(?:the )?(?:full )?address is\s+(.+)/i,  // "The full address is ..."
      /(\d+[^@,]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl)[^@,]*(?:,\s*[^@,]+)*)/i,
      /(?:my address is|i live at|address is)\s+([^@.]+)/i,
      /(\d+\/\d+\s+[^@,]+(?:street|st|avenue|ave|road|rd)[^@,]*)/i,
      /^(\d+\s+[^@,]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl)[^@]*)/i // Direct address format
    ];
    
    for (const pattern of addressPatterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        const potentialAddress = match[1].trim();
        // Make sure it's not an email domain and has proper address characteristics
        if (!potentialAddress.includes('@') && potentialAddress.length > 5 &&
            (/\d/.test(potentialAddress) || /street|st|avenue|ave|road|rd|drive|dr|qld|nsw|vic|act|sa|wa|nt/i.test(potentialAddress))) {
          data.address = potentialAddress;
          console.log('🏠 Address extracted:', data.address);
          break;
        }
      }
    }
    
    // Check if this looks like a postcode/state addition to existing incomplete address
    if (currentCustomerData.address && 
        !currentCustomerData.address.includes('QLD') && 
        !currentCustomerData.address.includes('NSW') && 
        /^[A-Z]{2,3}\s+\d{4}\.?$/i.test(input.trim())) {
      // This looks like a state/postcode addition (e.g., "QLD 4000.")
      const combined = `${currentCustomerData.address.replace(/[,.]$/, '')}, ${input.trim().replace(/\.$/, '')}`;
      data.address = combined;
      console.log('🏠 Combined address with postcode:', data.address);
    }
  }
  
  // Extract phone number (if not email or address)
  if (!data.email && !data.address) {
    const phonePatterns = [
      /(\+?61\s?[0-9\s\-()]{8,})/,
      /(\(?0[0-9\s\-()]{8,})/,
      /(?:phone|number|mobile|contact)\s+(?:is\s+)?(\+?[\d\s\-()]{8,})/i
    ];
    
    for (const pattern of phonePatterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        const phone = match[1].trim();
        if (phone.length >= 8) {
          data.phone = phone;
          console.log('📞 Phone extracted:', data.phone);
          break;
        }
      }
    }
  }
  
  // Extract special instructions (only when we're specifically asking for them)
  if (stateMachine.askingForSpecialInstructions && !data.name && !data.email && !data.address && !data.phone) {
    const specialInstructionsPatterns = [
      /^(no|none|nothing|no special|nothing special|standard|not really|nope)/i, // Negative responses
      /^(gate code|gate|access code|buzzer|intercom|back entrance|side entrance|key under|parking)/i, // Specific instructions
      /^(please|yes|sure|the|my|there|you|call|ring|knock)/i, // Positive response indicators
    ];
    
    // Check if it matches special instructions patterns or is a reasonable instruction
    let isSpecialInstruction = false;
    for (const pattern of specialInstructionsPatterns) {
      if (pattern.test(input)) {
        isSpecialInstruction = true;
        break;
      }
    }
    
    // Also accept longer responses that seem like instructions
    if (!isSpecialInstruction && input.length > 3 && input.length < 200 && 
        !/^[A-Z]{2,3}\s+\d{4}\.?$/i.test(input.trim())) { // Exclude postcode patterns
      isSpecialInstruction = true;
    }
    
    if (isSpecialInstruction) {
      data.specialInstructions = input;
      stateMachine.askingForSpecialInstructions = false; // Clear flag
      console.log('📝 Special instructions extracted:', data.specialInstructions);
    }
  }
  
  return data;
}

module.exports = {
  handleBookingRequest,
  startDetailCollection,
  handleDetailCollection,
  proceedToBooking,
  findOptimalAppointmentSlot,
  generateAppointmentReference,
  extractDataFromInput
};
