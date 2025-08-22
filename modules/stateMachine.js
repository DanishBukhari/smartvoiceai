// modules/stateMachine.js - Centralized state management
const stateMachine = {
  // Core state
  currentState: 'start',
  conversationHistory: [],
  clientData: {},
  customerData: {}, // Main customer data storage
  
  // Issue tracking
  issueType: null,
  questionIndex: 0,
  
  // Booking state
  nextSlot: null,
  bookingRetryCount: 0,
  appointmentBooked: false,
  appointmentId: null,
  bookingDetails: null, // Store complete booking information
  referenceNumber: null, // Store reference number separately
  recommendedSlot: null, // Store recommended time slot for confirmation
  
  // Detail collection
  collectingDetail: null, // 'name', 'email', 'address', 'phone', 'specialInstructions'
  detailsCollectionStep: 0, // 0=name, 1=email, 2=address, 3=phone, 4=specialInstructions, 5=confirm_all
  allDetailsCollected: false,
  confirmingAllDetails: false,
  modifyingDetail: null,
  askingForSpecialInstructions: false, // Flag to track when we're asking for special instructions
  
  // Time preference handling
  collectingTimePreference: false,
  timePreferenceCollected: false,
  awaitingTimeConfirmation: false,
  
  // Confirmation flows
  spellingConfirmation: false,
  tempCollectedValue: null,
  awaitingConfirmation: false,
  pendingConfirmation: null,
  
  // Call management
  callerPhoneNumber: null,
  pendingTermination: false,
  callEndReason: null,
  
  // Flow flags
  needsBookingOffer: false,
  safetyConcern: false,
  urgent: false,
  needsEmpathy: false,
  troubleshootingProvided: false,
  
  // Legacy compatibility
  awaitingAddress: false,
  awaitingTime: false,
};

const stateTransitions = {
  'start': ['general', 'toilet', 'sink/tap', 'hot water system', 'burst/leak', 'rain-pump', 'roof leak', 'new install/quote', 'other', 'emergency'],
  'general': ['ask_booking', 'collect_details', 'booking_complete', 'urgent_booking', 'toilet', 'sink/tap', 'hot water system', 'burst/leak', 'rain-pump', 'roof leak', 'new install/quote', 'other'],
  'toilet': ['ask_booking', 'general'],
  'sink/tap': ['ask_booking', 'general'],
  'hot water system': ['ask_booking', 'general'],
  'burst/leak': ['urgent_booking', 'ask_booking'],
  'rain-pump': ['ask_booking', 'general'],
  'roof leak': ['ask_booking', 'general'],
  'new install/quote': ['ask_booking', 'general'],
  'other': ['ask_booking', 'general'],
  'ask_booking': ['collect_details', 'booking_in_progress'],
  'collect_details': ['book_appointment', 'ask_booking', 'booking_complete', 'collect_details', 'collect_special_instructions'],
  'book_appointment': ['confirm_slot', 'collect_details'],
  'confirm_slot': ['collect_special_instructions', 'book_appointment'],
  'collect_special_instructions': ['collect_time_preference', 'booking_complete'],
  'collect_time_preference': ['confirm_time_slot', 'collect_time_preference', 'manual_scheduling'],
  'confirm_time_slot': ['booking_complete', 'collect_time_preference'],
  'booking_complete': ['general', 'ended', 'urgent_booking', 'collect_details'],
  'emergency': ['urgent_booking'],
  'urgent_booking': ['collect_details', 'booking_in_progress'],
  'manual_scheduling': ['collect_details', 'booking_complete']
};

function isValidTransition(fromState, toState) {
  return stateTransitions[fromState]?.includes(toState) || false;
}

function resetStateMachine() {
  // Preserve caller phone number across resets
  const preservedCallerPhone = stateMachine.callerPhoneNumber;
  
  Object.assign(stateMachine, {
    currentState: 'start',
    conversationHistory: [],
    clientData: {},
    customerData: {},
    issueType: null,
    questionIndex: 0,
    nextSlot: null,
    bookingRetryCount: 0,
    appointmentBooked: false,
    appointmentId: null,
    bookingDetails: null,
    referenceNumber: null,
    collectingDetail: null,
    detailsCollectionStep: 0,
    allDetailsCollected: false,
    confirmingAllDetails: false,
    modifyingDetail: null,
    spellingConfirmation: false,
    tempCollectedValue: null,
    awaitingConfirmation: false,
    pendingConfirmation: null,
    callerPhoneNumber: preservedCallerPhone, // Preserve caller phone number
    pendingTermination: false,
    callEndReason: null,
    needsBookingOffer: false,
    safetyConcern: false,
    urgent: false,
    needsEmpathy: false,
    troubleshootingProvided: false,
    awaitingAddress: false,
    awaitingTime: false,
  });
  
  // If we have a preserved caller phone number, also set it in customer data
  if (preservedCallerPhone) {
    stateMachine.customerData.phone = preservedCallerPhone;
    stateMachine.clientData.phone = preservedCallerPhone;
    console.log(`🔄 State machine reset to initial state (preserved caller phone: ${preservedCallerPhone})`);
  } else {
    console.log('🔄 State machine reset to initial state');
  }
}

function transitionTo(newState, reason = '') {
  const oldState = stateMachine.currentState;
  
  if (isValidTransition(oldState, newState)) {
    stateMachine.currentState = newState;
    console.log(`🔄 State transition: ${oldState} → ${newState} ${reason ? `(${reason})` : ''}`);
    return true;
  } else {
    console.warn(`⚠️ Invalid state transition attempted: ${oldState} → ${newState}`);
    return false;
  }
}

function setCallerPhoneNumber(phoneNumber) {
  stateMachine.callerPhoneNumber = phoneNumber;
  stateMachine.customerData.phone = phoneNumber;
  stateMachine.clientData.phone = phoneNumber;
  console.log('📞 Caller phone number set:', phoneNumber);
}

function addToHistory(role, content) {
  stateMachine.conversationHistory.push({ role, content });
}

function getClientData() {
  return { ...stateMachine.clientData };
}

function updateClientData(data) {
  Object.assign(stateMachine.clientData, data);
  // Also update customerData for consistency
  Object.assign(stateMachine.customerData, data);
}

function updateCustomerData(data) {
  Object.assign(stateMachine.customerData, data);
  // Also update clientData for backward compatibility
  Object.assign(stateMachine.clientData, data);
}

function hasCompleteDetails() {
  const { name, email, address } = stateMachine.clientData;
  return !!(name && email && address);
}

module.exports = {
  stateMachine,
  isValidTransition,
  resetStateMachine,
  transitionTo,
  setCallerPhoneNumber,
  addToHistory,
  getClientData,
  updateClientData,
  updateCustomerData,
  hasCompleteDetails,
};
