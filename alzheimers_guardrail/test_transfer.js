// Specific test for TRANSFER action

function parsePrivacyLog(privacyLog) {
  // Format privacy log - handle both formats (from backend and potential mock)
  let usedMessages = 0, usedContacts = 0, usedFiles = 0, usedCalendar = 0, usedAmounts = 0;
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
      else if (item.startsWith('Amount:')) usedAmounts++;
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
        } else if (item.includes('contact') || item.contains('contacts')) {
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
  if (usedAmounts > 0) usedParts.push(`${usedAmounts} amount${usedAmounts !== 1 ? 's' : ''}`);
  
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

// Test TRANSFER specifically
const transferResult = parsePrivacyLog({
  "used": ["1 message: 'Send $100 to Alice for invoice #1234'", 'Recipient: Alice', 'Amount: $100'],
  "not_used": ['30 other messages', '10 files', '8 calendar events']
});

console.log('TRANSFER RESULT:');
console.log('  USED:', transferResult.used);
console.log('  NOT USED:', transferResult.notUsed);
console.log();
console.log('Expected from plan:');
console.log('  USED: "1 message, 1 contact, 1 amount"');
console.log('  NOT USED: "30 messages, 10 files, 8 events"');
