// Content script that runs in the demo webapp
// Intercepts voxnav-action events and sends them to background

console.log('[Content Script] LOADED - Action interceptor ready');

// Visual confirmation that content script is running
document.body.style.border = '3px solid blue';
document.body.style.padding = '5px';
console.log('[Content Script] Applied blue border and padding');

// Listen for the custom event from the demo webapp
window.addEventListener('voxnav-action', (event) => {
  const action = event.detail;
  console.log('[Content Script] Intercepted action:', action);

  // Send action to background for processing
  console.log('[Content Script] Sending action to background for processing:', action);
  browser.runtime.sendMessage(
    {
      type: 'actionRequest',
      action: action
    },
    (response) => {
      console.log('[Content Script] Received processing result from background:', response);

      // Display the explanation in a proper decision UI
      if (response && response.status === "success") {
        showDecisionUI(response.explanation, response.privacyLog, response.action);
      } else if (response && response.error) {
        alert(`Error: ${response.error}`);
      } else {
        alert('Action processed (no explanation available)');
      }
    }
  );
});

// Function to create and display the decision UI
function showDecisionUI(explanation, privacyLog, actionType) {
  // Create modal backdrop
  const backdrop = document.createElement('div');
  backdrop.style.position = 'fixed';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100%';
  backdrop.style.height = '100%';
  backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  backdrop.style.display = 'flex';
  backdrop.style.alignItems = 'center';
  backdrop.style.justifyContent = 'center';
  backdrop.style.zIndex = '10000';
  backdrop.style.fontFamily = 'Arial, sans-serif';

  // Create modal content
  const modal = document.createElement('div');
  modal.style.backgroundColor = 'white';
  modal.style.borderRadius = '8px';
  modal.style.padding = '24px';
  modal.style.width = '90%';
  modal.style.maxWidth = '400px';
  modal.style.maxHeight = '80vh';
  modal.style.overflowY = 'auto';
  modal.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';

  // Create title
  const title = document.createElement('h2');
  title.textContent = 'Context Before Consequence';
  title.style.color = '#2c3e50';
  title.style.textAlign = 'center';
  title.style.marginTop = '0';
  title.style.marginBottom = '20px';

  // Create explanation text
  const explanationEl = document.createElement('p');
  explanationEl.textContent = explanation;
  explanationEl.style.lineHeight = '1.6';
  explanationEl.style.color = '#34495e';
  explanationEl.style.marginBottom = '20px';

  // Create privacy log section
  const privacySection = document.createElement('div');
  privacySection.style.backgroundColor = '#ecf0f1';
  privacySection.style.borderRadius = '4px';
  privacySection.style.padding = '16px';
  privacySection.style.marginBottom = '24px';

  const privacyTitle = document.createElement('h3');
  privacyTitle.textContent = 'Privacy Audit';
  privacyTitle.style.color = '#2c3e50';
  privacyTitle.style.marginTop = '0';
  privacyTitle.style.marginBottom = '12px';
  privacyTitle.style.fontSize = '16px';

  const privacyDetails = document.createElement('p');
  privacyDetails.style.margin = '0';
  privacyDetails.style.fontSize = '14px';
  privacyDetails.style.color = '#7f8c8d';

  // Format privacy log
  const usedMessages = privacyLog.used.messages;
  const usedContacts = privacyLog.used.contacts;
  const notUsedMessages = privacyLog.notUsed.messages;
  const notUsedFiles = privacyLog.notUsed.files;
  const notUsedCalendar = privacyLog.notUsed.calendar;
  const notUsedContacts = privacyLog.notUsed.contacts;

  privacyDetails.innerHTML = `
    <strong>USED:</strong> ${usedMessages} message${usedMessages !== 1 ? 's' : ''}, ${usedContacts} contact${usedContacts !== 1 ? 's' : ''}<br>
    <strong>NOT USED:</strong> ${notUsedMessages} messages, ${notUsedFiles} files, ${notUsedCalendar} events, ${notUsedContacts} contacts
  `;

  privacySection.appendChild(privacyTitle);
  privacySection.appendChild(privacyDetails);

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.justifyContent = 'flex-end';
  buttonContainer.style.gap = '12px';

  // Create Continue button
  const continueBtn = document.createElement('button');
  continueBtn.textContent = 'Continue';
  continueBtn.style.backgroundColor = '#27ae60';
  continueBtn.style.color = 'white';
  continueBtn.style.border = 'none';
  continueBtn.style.padding = '10px 20px';
  continueBtn.style.borderRadius = '4px';
  continueBtn.style.cursor = 'pointer';
  continueBtn.style.fontWeight = 'bold';
  continueBtn.style.transition = 'background-color 0.2s';
  continueBtn.onmouseover = () => continueBtn.style.backgroundColor = '#219a52';
  continueBtn.onmouseout = () => continueBtn.style.backgroundColor = '#27ae60';
  continueBtn.onclick = () => {
    document.body.removeChild(backdrop);
    // In a real implementation, you might send the decision back to backend for logging
    console.log('[Content Script] User chose to Continue');
  };

  // Create Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.backgroundColor = '#e74c3c';
  cancelBtn.style.color = 'white';
  cancelBtn.style.border = 'none';
  cancelBtn.style.padding = '10px 20px';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontWeight = 'bold';
  cancelBtn.style.transition = 'background-color 0.2s';
  cancelBtn.onmouseover = () => cancelBtn.style.backgroundColor = '#c0392b';
  cancelBtn.onmouseout = () => cancelBtn.style.backgroundColor = '#e74c3c';
  cancelBtn.onclick = () => {
    document.body.removeChild(backdrop);
    console.log('[Content Script] User chose to Cancel');
  };

  // Create Verify button
  const verifyBtn = document.createElement('button');
  verifyBtn.textContent = 'Verify';
  verifyBtn.style.backgroundColor = '#3498db';
  verifyBtn.style.color = 'white';
  verifyBtn.style.border = 'none';
  verifyBtn.style.padding = '10px 20px';
  verifyBtn.style.borderRadius = '4px';
  verifyBtn.style.cursor = 'pointer';
  verifyBtn.style.fontWeight = 'bold';
  verifyBtn.style.transition = 'background-color 0.2s';
  verifyBtn.onmouseover = () => verifyBtn.style.backgroundColor = '#2980b9';
  verifyBtn.onmouseout = () => verifyBtn.style.backgroundColor = '#3498db';
  verifyBtn.onclick = () => {
    document.body.removeChild(backdrop);
    console.log('[Content Script] User chose to Verify');
    // In a real implementation, this might trigger additional verification steps
  };

  buttonContainer.appendChild(cancelBtn);
  buttonContainer.appendChild(verifyBtn);
  buttonContainer.appendChild(continueBtn);

  // Assemble modal
  modal.appendChild(title);
  modal.appendChild(explanationEl);
  modal.appendChild(privacySection);
  modal.appendChild(buttonContainer);

  // Add modal to backdrop
  backdrop.appendChild(modal);

  // Add backdrop to body
  document.body.appendChild(backdrop);
}

// Test messaging to background to verify basic communication
setTimeout(() => {
  try {
    console.log('[Content Script] Sending test message to background...');
    browser.runtime.sendMessage({test: 'content-script-ready'}, (response) => {
      console.log('[Content Script] Received test response:', response);
    });
  } catch (e) {
    console.error('[Content Script] Failed to send test message:', e);
  }
}, 1000);