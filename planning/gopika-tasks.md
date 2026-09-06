# Gopika - Action Interceptor & Browser Extension Lead
## Difficulty: MEDIUM-HIGH

### STAGE 1: FOUNDATION (T+0 to T+10 HR)
- Build fake demo webapp (localhost:3000/demo) with 4 buttons: [Send Doc], [Delete File], [Cancel Appt], [Transfer $]
- Implement action parser: button click → structured data ({action: "...", target: {...}})
- Set up browser extension skeleton: Manifest V3, background.js, content_script.js
- Implement basic content script: inject into demo webapp, intercept button clicks

### STAGE 2: CORE LOOP (T+10 to T+20 HR)
- Complete content script: send structured actions to GSK's backend via WebSocket
- Add data validation checks: validate action structure, sanitize inputs (XSS prevention)
- Receive context/explanation from GSK → trigger decision UI display
- Handle WebSocket reconnection + error states (network timeouts)
- Test action flow: button click → GSK engine → Yazeen context → Adithya UI

### STAGE 3: POLISH & DEMO (T+20 to T+30 HR)
- Optimize extension overhead (<300ms) + cross-browser testing
- Implement user preference persistence (ON/OFF state, sensitivity slider)
- Stress test: rapid clicks, invalid actions, extension disable/re-enable
- Demo rehearsal with pre-recorded/ simulated tics (for backup)
- Final extension packaging + manifest validation
