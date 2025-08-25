// modules/appointmentCache.js - In-memory cache for appointments scheduled in current session
// This prevents double-booking when multiple appointments are scheduled quickly before calendar sync

const sessionAppointments = new Map();

/**
 * Add an appointment to the session cache
 */
function addSessionAppointment(appointmentData) {
  const id = generateSessionId();
  const appointment = {
    id,
    start: appointmentData.start,
    end: appointmentData.end,
    location: appointmentData.location || appointmentData.address,
    summary: appointmentData.summary || `Plumbing Service - ${appointmentData.customerName || 'Customer'}`,
    description: appointmentData.description || appointmentData.issueDescription,
    sessionTimestamp: new Date(),
    status: 'pending_calendar_sync'
  };
  
  sessionAppointments.set(id, appointment);
  console.log(`📝 Added appointment to session cache: ${appointment.start.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} - ${appointment.end.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
  
  return appointment;
}

/**
 * Get all session appointments that haven't expired
 */
function getSessionAppointments() {
  const now = new Date();
  const validAppointments = [];
  
  // Remove expired session appointments (older than 1 hour)
  for (const [id, appointment] of sessionAppointments.entries()) {
    if (now - appointment.sessionTimestamp > 60 * 60 * 1000) {
      sessionAppointments.delete(id);
      console.log(`🗑️  Removed expired session appointment: ${id}`);
    } else {
      validAppointments.push(appointment);
    }
  }
  
  return validAppointments;
}

/**
 * Clear all session appointments (for testing or session reset)
 */
function clearSessionAppointments() {
  const count = sessionAppointments.size;
  sessionAppointments.clear();
  console.log(`🧹 Cleared ${count} session appointments`);
}

/**
 * Remove a specific session appointment (when successfully synced to calendar)
 */
function removeSessionAppointment(id) {
  const removed = sessionAppointments.delete(id);
  if (removed) {
    console.log(`✅ Removed synced session appointment: ${id}`);
  }
  return removed;
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return `SESSION_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get combined list of calendar appointments and session appointments
 */
function getCombinedAppointments(calendarAppointments = []) {
  const sessionAppts = getSessionAppointments();
  const combined = [...calendarAppointments, ...sessionAppts];
  
  console.log(`📊 Combined appointments: ${calendarAppointments.length} from calendar + ${sessionAppts.length} from session = ${combined.length} total`);
  
  return combined;
}

module.exports = {
  addSessionAppointment,
  getSessionAppointments,
  clearSessionAppointments,
  removeSessionAppointment,
  getCombinedAppointments
};
