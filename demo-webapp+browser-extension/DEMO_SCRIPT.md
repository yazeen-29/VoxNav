# Context Before Consequence — Demo Script

## Before presenting

1. Start the local backend from `alzheimers_guardrail` with `venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
2. From `demo-webapp`, run `npm install` once and `npm run dev` to serve the React dashboard at port 3000. Load the Firefox temporary add-on from `browser-extension/manifest.json`.
3. Reload the extension and hard-refresh the demo page after any extension edit.
4. For the privacy-vault walkthrough, create a vault with a 12+ character demo passphrase, save the displayed recovery key, then add a synthetic reminder. Do not use real personal data in the hackathon demo.
5. On a supported browser/device, unlock the vault and select **Set up device biometric**. The browser may show Face ID, Touch ID, Windows Hello, or another platform verifier.

## Two-minute walkthrough

1. Open the demo page and say: “This is decision support, not automation. Every record shown here is synthetic.”
2. Open the extension popup. Show that it is on and that the sensitivity slider is saved: high sensitivity checks all risk levels; low sensitivity checks only high risk.
3. Choose **Send document**. Point out the concise reason, the end-to-end timing, and the privacy audit: the tool identifies what it used and what it deliberately did not use.
4. Open **Why am I seeing this?**. Say: “It is a voluntary cognitive-accessibility guardrail. It does not diagnose a condition or make a decision.”
5. Show **Snooze 5 min** or **Turn off** to demonstrate that the user can opt out immediately. Re-enable it in the popup if needed.
6. Choose **Delete file**, **Cancel appointment**, and **Transfer $100**. Note that each has action-specific synthetic context and the user always retains **Continue** and **Cancel**.
7. Double-click an action to demonstrate rapid-click protection: only one context request is made.
8. Explain the vault boundary: “The backend still uses fixed synthetic context. Matching user-added vault entries are passed only in memory to this page's extension modal; optional Supabase sync stores ciphertext only.”

## Closing line

“Context Before Consequence gives the smallest useful reminder before a consequential digital action, while leaving the final choice entirely with the person.”
