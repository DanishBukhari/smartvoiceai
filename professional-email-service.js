require('dotenv').config();
const https = require('https');

async function sendBookingConfirmationEmail(bookingDetails) {
  try {
    console.log('📧 Sending professional booking confirmation email to:', bookingDetails.customerEmail);
    
    // Format appointment time for display
    const appointmentTime = bookingDetails.appointmentTime
      ? new Date(bookingDetails.appointmentTime).toLocaleString('en-AU', {
          timeZone: 'Australia/Brisbane',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      : 'To Be Confirmed';

    // Generate reference number if not provided
    const referenceNumber = bookingDetails.referenceNumber || `PLB-${Date.now().toString().slice(-6)}`;

    // Calculate and format travel time display
    const travelMinutesInput = bookingDetails.travelMinutes || '20-30 minutes';
    const totalBufferMinutes = bookingDetails.totalBufferMinutes || 0;
    
    // Calculate dynamic service duration if not provided
    let serviceDuration = bookingDetails.serviceDuration;
    if (!serviceDuration) {
      const { calculateServiceDuration } = require('./modules/travelOptimization');
      const issueDescription = bookingDetails.issueDescription || bookingDetails.issue || 'general plumbing';
      serviceDuration = calculateServiceDuration(issueDescription);
      console.log(`📧 Dynamic service duration calculated: ${serviceDuration} minutes for "${issueDescription}"`);
    }
    
    const jobCompletionBuffer = 30; // Standard 30-minute job completion buffer
    
    // Extract numeric minutes from travel time (if it's a string)
    function extractTravelMinutes(travelInput) {
      if (typeof travelInput === 'number') return travelInput;
      if (typeof travelInput === 'string') {
        // Handle range format like "20-30 minutes"
        const rangeMatch = travelInput.match(/(\d+)-(\d+)/);
        if (rangeMatch) {
          return Math.ceil((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
        }
        // Handle single number format like "25 minutes"
        const singleMatch = travelInput.match(/(\d+)/);
        if (singleMatch) {
          return parseInt(singleMatch[1]);
        }
      }
      return 25; // Default fallback
    }
    
    const travelMinutes = extractTravelMinutes(travelMinutesInput);
    
    // Format travel time for display
    const formatTravelTime = (travelInput) => {
      if (typeof travelInput === 'string' && travelInput.includes('-')) {
        return travelInput; // Keep original range format
      }
      const minutes = extractTravelMinutes(travelInput);
      if (minutes <= 15) return `${minutes} minutes`;
      if (minutes <= 30) return `${minutes} minutes`;
      if (minutes <= 60) return `${minutes} minutes`;
      return `${Math.round(minutes)} minutes`;
    };
    
    // Format total time estimation
    const formatTotalEstimation = (totalBuffer, serviceTime, travelMins) => {
      if (totalBuffer > 0 && travelMins > 0) {
        return `${totalBuffer} minutes total (${serviceTime} min service + ${travelMins} min travel)`;
      }
      
      // Use actual service time if available
      if (serviceTime && serviceTime > 0) {
        const hours = Math.round(serviceTime / 60 * 10) / 10; // Round to 1 decimal
        if (hours <= 1) {
          return `${serviceTime} minutes`;
        } else if (hours <= 1.5) {
          return `1-1.5 hours`;
        } else if (hours <= 2) {
          return `1.5-2 hours`;
        } else {
          return `${hours} hours`;
        }
      }
      
      return '1-2 hours'; // Fallback only when no service time available
    };

    // Prepare template parameters for the professional HTML template
    const templateParams = {
      // Customer Details
      customer_name: bookingDetails.customerName || 'Valued Customer',
      customer_phone: bookingDetails.customerPhone || 'Not provided',
      to_email: bookingDetails.customerEmail,
      customer_address: bookingDetails.customerAddress || 'Brisbane, QLD (Address to be confirmed)',
      
      // Service Details
      issue_description: bookingDetails.issueDescription || 'General plumbing service',
      estimated_duration: formatTotalEstimation(totalBufferMinutes, serviceDuration, travelMinutes),
      travel_time: formatTravelTime(travelMinutesInput),
      total_buffer_minutes: totalBufferMinutes > 0 ? `${totalBufferMinutes} minutes` : 'Calculating...',
      job_completion_buffer: `${serviceDuration} minutes`,
      travel_time_minutes: travelMinutes > 0 ? `${travelMinutes} minutes` : 'Calculating...',
      
      // Appointment Details
      appointment_time: appointmentTime,
      
      // Special Instructions
      special_instructions: bookingDetails.specialInstructions || 'Standard plumbing service - no special requirements',
      
      // Booking Reference
      reference_number: referenceNumber,
      
      // Company Details
      company_phone: '(07) 3608 1688',
      company_email: 'bookings@usherfixplumbing.com',
      
      // Email headers
      from_name: 'Usher Fix Plumbing',
      from_email: 'bookings@usherfixplumbing.com',
      to_name: bookingDetails.customerName || 'Valued Customer',
      subject: `✅ Plumbing Appointment Confirmed - ${appointmentTime} - Usher Fix Plumbing`
    };

    // Prepare EmailJS payload
    const postData = JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID, // Make sure this template ID uses the professional HTML template
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      template_params: templateParams,
    });

    const options = {
      hostname: 'api.emailjs.com',
      port: 443,
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Origin': 'https://dashboard.emailjs.com',
        'Referer': 'https://dashboard.emailjs.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('📧 EmailJS response:', { status: res.statusCode, data });
          if (res.statusCode === 200) {
            console.log('✅ Professional email sent successfully via EmailJS');
            console.log(`📋 Email details: ${templateParams.customer_name} | ${templateParams.appointment_time} | Ref: ${templateParams.reference_number}`);
            resolve({
              success: true,
              timestamp: new Date().toISOString(),
              service: 'EmailJS Professional',
              referenceNumber: referenceNumber,
              emailSent: templateParams.to_email,
              details: 'Professional appointment confirmation email sent with comprehensive service details',
            });
          } else {
            console.error('❌ EmailJS error:', res.statusCode, data);
            reject(new Error(`EmailJS failed with status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('❌ HTTPS request error:', error);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('❌ Failed to send professional booking confirmation email:', error);
    console.log('📧 MANUAL FOLLOW-UP REQUIRED: Send confirmation email to', bookingDetails.customerEmail);
    console.log('📋 Booking details:', JSON.stringify(bookingDetails, null, 2));
    throw new Error(`Professional email sending failed: ${error.message}`);
  }
}

async function sendSMSConfirmation(bookingDetails) {
  try {
    if (!bookingDetails.phone || bookingDetails.phone === 'Not provided') {
      console.log('📱 No phone number available for SMS backup');
      return { success: false, reason: 'No phone number provided' };
    }

    // Import Twilio dynamically to avoid errors if not configured
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const appointmentTime = bookingDetails.appointmentTime
      ? new Date(bookingDetails.appointmentTime).toLocaleString('en-AU', {
          timeZone: 'Australia/Brisbane',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : 'TBD';

    const referenceNumber = bookingDetails.referenceNumber || `PLB-${Date.now().toString().slice(-6)}`;

    const smsMessage = `🔧 Usher Fix Plumbing - APPOINTMENT CONFIRMED!\n\n` +
                       `📅 ${appointmentTime}\n` +
                       `📍 ${bookingDetails.address || 'Brisbane, QLD'}\n` +
                       `🆔 Ref: ${referenceNumber}\n` +
                       `🔧 Issue: ${(bookingDetails.issue || 'Plumbing service').substring(0, 50)}...\n\n` +
                       `📞 We'll call 30min before arrival\n` +
                       `📧 Detailed email confirmation sent\n` +
                       `ℹ️ Changes/Cancel: (07) 3608 1688`;

    await client.messages.create({
      body: smsMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: bookingDetails.phone,
    });

    console.log('✅ SMS confirmation sent successfully to:', bookingDetails.phone);
    return { 
      success: true, 
      phone: bookingDetails.phone, 
      timestamp: new Date().toISOString(),
      referenceNumber: referenceNumber
    };
  } catch (error) {
    console.error('❌ SMS sending failed:', error);
    return { success: false, error: error.message };
  }
}

// Enhanced booking confirmation that handles both email and calendar
async function sendCompleteBookingConfirmation(bookingDetails) {
  try {
    console.log('🚀 Sending complete booking confirmation (Email + SMS + Calendar)...');
    
    const results = {
      email: null,
      sms: null,
      calendar: null,
      timestamp: new Date().toISOString(),
      referenceNumber: bookingDetails.referenceNumber || `PLB-${Date.now().toString().slice(-6)}`
    };

    // 1. Send Professional Email
    try {
      results.email = await sendBookingConfirmationEmail(bookingDetails);
      console.log('✅ Professional email confirmation completed');
    } catch (emailError) {
      console.error('❌ Email confirmation failed:', emailError);
      results.email = { success: false, error: emailError.message };
    }

    // 2. Send SMS Backup
    try {
      results.sms = await sendSMSConfirmation(bookingDetails);
      console.log('✅ SMS backup confirmation completed');
    } catch (smsError) {
      console.error('❌ SMS confirmation failed:', smsError);
      results.sms = { success: false, error: smsError.message };
    }

    // 3. Calendar integration is handled separately by createAppointment function
    console.log('📅 Google Calendar integration handled by createAppointment function');
    results.calendar = { success: true, note: 'Handled by createAppointment function' };

    console.log('📊 Complete booking confirmation results:', results);
    return results;
    
  } catch (error) {
    console.error('❌ Complete booking confirmation failed:', error);
    throw error;
  }
}

module.exports = { 
  sendBookingConfirmationEmail, 
  sendSMSConfirmation, 
  sendCompleteBookingConfirmation 
};
