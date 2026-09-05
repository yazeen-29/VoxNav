// Test to see what items are in the used arrays for each action type

// Simulated backend responses from our actual testing
const responses = {
  SEND_DOCUMENT: {
    'used': ["1 message: 'john@example.com asked for Medical_Report.pdf on Aug 28'", 'Recipient: john@example.com', 'Document: Medical_Report.pdf'],
    'not_used': ['47 other messages', '12 files', '8 calendar events', '15 contacts']
  },
  DELETE_FILE: {
    'used': ["1 file metadata: 'temp_file.txt last modified Jul 15, 2024'", 'File: temp_file.txt'],
    'not_used': ['43 other files', '20 messages', '10 calendar events']
  },
  CANCEL_APPT: {
    'used': ["1 calendar event: 'Appointment with Dr. Smith tomorrow at 2:00 PM'", 'Participant: Dr. Smith'],
    'not_used': ['35 other calendar events', '50 messages', '12 files']
  },
  TRANSFER: {
    'used': ["1 message: 'Send $100 to Alice for invoice #1234'", 'Recipient: Alice', 'Amount: $100'],
    'not_used': ['30 other messages', '10 files', '8 calendar events']
  }
};

function analyzeUsedItems(actionType) {
  const usedItems = responses[actionType].used;
  console.log(`\n${actionType} used items:`);
  usedItems.forEach((item, index) => {
    console.log(`  [${index}] "${item}"`);
    
    // Check what conditions it matches
    const matches = [];
    if (item.includes('message')) matches.push('message');
    if (item.includes('contact') || item.startsWith('Recipient:') || item.startsWith('Participant:')) matches.push('contact');
    if (item.includes('file') || item.startsWith('Document:')) matches.push('file');
    if (item.includes('calendar') || item.includes('event')) matches.push('calendar');
    if (item.startsWith('Amount:')) matches.push('amount');
    
    console.log(`      Matches: ${matches.length > 0 ? matches.join(', ') : 'NONE'}`);
  });
}

for (const actionType of Object.keys(responses)) {
  analyzeUsedItems(actionType);
}
