// Test script to verify content script privacy log parsing logic

function parsePrivacyLog(privacyLog) {
  // Format privacy log - handle both formats (from backend and potential mock)
  let usedMessages = 0, usedContacts = 0, usedFiles = 0, usedCalendar = 0;
  let notUsedMessages = 0, notUsedFiles = 0, notUsedCalendar = 0, notUsedContacts = 0;
  
  if (privacyLog.used && typeof privacyLog.used === 'object') {
    // New format from backend: { used: [strings], not_used: [strings] }
    // We need to parse the strings to count items
    const usedItems = privacyLog.used || [];
    const notUsedItems = privacyLog.not_used || [];
    
    // Count used items
    usedItems.forEach(item => {
      if (item.includes('message')) usedMessages++;
      else if (item.includes('contact') || item.startsWith('Recipient:') || item.startsWith('Participant:')) usedContacts++;
      else if (item.includes('file') || item.startsWith('Document:')) usedFiles++;
      else if (item.includes('calendar') || item.includes('event')) usedCalendar++;
    });
    
    // Count not used items - extract numbers from strings like "47 other messages"
    notUsedItems.forEach(item => {
      // Extract number from string
      const match = item.match(/^(\d+)/);
      if (match) {
        const count = parseInt(match[1]);
        if (item.includes('message') || item.includes('messages')) {
          notUsedMessages = count;
        } else if (item.includes('file') || item.includes('files')) {
          notUsedFiles = count;
        } else if (item.includes('calendar') || item.includes('event')) {
          notUsedCalendar = count;
        } else if (item.includes('contact') || item.includes('contacts')) {
          notUsedContacts = count;
        }
      }
    });
  } else if (privacyLog.used && privacyLog.used.messages !== undefined) {
    // Old mock format: { used: { messages: X, contacts: Y }, notUsed: { ... } }
    usedMessages = privacyLog.used.messages || 0;
    usedContacts = privacyLog.used.contacts || 0;
    usedFiles = privacyLog.used.files || 0;
    usedCalendar = privacyLog.used.calendar || 0;
    notUsedMessages = privacyLog.notUsed.messages || 0;
    notUsedFiles = privacyLog.notUsed.files || 0;
    notUsedCalendar = privacyLog.notUsed.calendar || 0;
    notUsedContacts = privacyLog.notUsed.contacts || 0;
  }

  // Build USED line - only show non-zero counts
  const usedParts = [];
  if (usedMessages > 0) usedParts.push(`${usedMessages} message${usedMessages !== 1 ? 's' : ''}`);
  if (usedContacts > 0) usedParts.push(`${usedContacts} contact${usedContacts !== 1 ? 's' : ''}`);
  if (usedFiles > 0) usedParts.push(`${usedFiles} file${usedFiles !== 1 ? 's' : ''}`);
  if (usedCalendar > 0) usedParts.push(`${usedCalendar} event${usedCalendar !== 1 ? 's' : ''}`);
  
  // Build NOT USED line - only show non-zero counts
  const notUsedParts = [];
  if (notUsedMessages > 0) notUsedParts.push(`${notUsedMessages} message${notUsedMessages !== 1 ? 's' : ''}`);
  if (notUsedFiles > 0) notUsedParts.push(`${notUsedFiles} file${notUsedFiles !== 1 ? 's' : ''}`);
  if (notUsedCalendar > 0) notUsedParts.push(`${notUsedCalendar} event${notUsedCalendar !== 1 ? 's' : ''}`);
  if (notUsedContacts > 0) notUsedParts.push(`${notUsedContacts} contact${notUsedContacts !== 1 ? 's' : ''}`);

  return {
    used: usedParts.length > 0 ? usedParts.join(', ') : 'none',
    notUsed: notUsedParts.length > 0 ? notUsedParts.join(', ') : 'none'
  };
}

// Test cases based on actual backend responses
console.log('Testing privacy log parsing logic...\n');

// SEND_DOCUMENT test
const sendDocResult = parsePrivacyLog({
  "used": ["1 message: 'john@example.com asked for Medical_Report.pdf on Aug 28'", 'Recipient: john@example.com', 'Document: Medical_Report.pdf'],
  "not_used": ['47 other messages', '12 files', '8 calendar events', '15 contacts']
});
console.log('SEND_DOCUMENT:');
console.log('  USED:', sendDocResult.used);
console.log('  NOT USED:', sendDocResult.notUsed);
console.log();

// DELETE_FILE test
const deleteFileResult = parsePrivacyLog({
  "used": ["1 file metadata: 'temp_file.txt last modified Jul 15, 2024'", 'File: temp_file.txt'],
  "not_used": ['43 other files', '20 messages', '10 calendar events']
});
console.log('DELETE_FILE:');
console.log('  USED:', deleteFileResult.used);
console.log('  NOT USED:', deleteFileResult.notUsed);
console.log();

// CANCEL_APPT test
const cancelApptResult = parsePrivacyLog({
  "used": ["1 calendar event: 'Appointment with Dr. Smith tomorrow at 2:00 PM'", 'Participant: Dr. Smith'],
  "not_used": ['35 other calendar events', '50 messages', '12 files']
});
console.log('CANCEL_APPT:');
console.log('  USED:', cancelApptResult.used);
console.log('  NOT USED:', cancelApptResult.notUsed);
console.log();

// TRANSFER test
const transferResult = parsePrivacyLog({
  "used": ["1 message: 'Send $100 to Alice for invoice #1234'", 'Recipient: Alice', 'Amount: $100'],
  "not_used": ['30 other messages', '10 files', '8 calendar events']
});
console.log('TRANSFER:');
console.log('  USED:', transferResult.used);
console.log('  NOT USED:', transferResult.notUsed);
console.log();

console.log('Expected results from plan:');
console.log('SEND_DOCUMENT: USED: "1 message, 1 contact" • NOT USED: "47 messages, 12 files, 8 events, 15 contacts"');
console.log('DELETE_FILE: USED: "1 file" • NOT USED: "43 files, 20 messages, 10 events"');
console.log('CANCEL_APPT: USED: "1 event, 1 contact" • NOT USED: "35 events, 50 messages, 12 files"');
console.log('TRANSFER: USED: "1 message, 1 contact, 1 amount" • NOT USED: "30 messages, 10 files, 8 events"');
