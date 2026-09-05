# Context Before Consequence — Handoff

## Goal

Build a Firefox browser extension and demo web app that presents the minimum necessary context before a user completes a high-consequence digital action. The tool informs; it never decides for the user.

Supported demo actions:

- `SEND_DOCUMENT`
- `DELETE_FILE`
- `CANCEL_APPT`
- `TRANSFER`

All contextual data is synthetic and should remain clearly treated as demo data.

## Current Status

### Core demo: working in code

- FastAPI WebSocket backend performs validation, transparent risk scoring, context lookup, explanation generation, and privacy logging.
- Four demo actions return valid live backend responses.
- Firefox Manifest V2 extension has a popup with an ON/OFF toggle and a last-action privacy-log display.
- The content script now captures demo button clicks directly. This intentionally avoids depending on a page `CustomEvent`, which is fragile across Firefox's page/content-script boundary.
- When ON, the page has a blue outline; when OFF, the outline is removed and actions are ignored.
- A decision modal presents explanation, privacy audit, and Continue/Cancel controls.
- The content script has a 5-second timeout and a readable error modal for unavailable/unresponsive backend service.

### Important latest fixes

1. `browserApi` was missing from `content_script.js`, causing a runtime crash before event handlers registered. It is now declared.
2. The old `voxnav-action` bridge was replaced by direct capture of the four demo button IDs.
3. Extension state handling was simplified: popup → background → content script.
4. The backend was found stopped during troubleshooting. Start it before using the demo.

## Canonical Paths

```text
/home/gsk/VoxNav/
├── HANDOFF.md
├── alzheimers_guardrail/
│   ├── backend/main.py                 # FastAPI WebSocket endpoint: /ws/audio
│   ├── risk_engine/scorer.py           # transparent scorer/policy
│   ├── context_engine/processor.py     # action-specific context + privacy logs
│   ├── venv/
│   └── test_websocket.py               # tests all 4 actions against live backend
└── demo-webapp+browser-extension/
    ├── demo-webapp/
    │   ├── src/main.jsx
    │   ├── src/styles.css
    │   └── package.json
    └── browser-extension/
        ├── manifest.json
        ├── background.js
        ├── content_script.js
        └── popup/
            ├── popup.html
            └── popup.js
```

Do not rely on the duplicate/older files in the repository without checking them first. The paths above are the integrated demo currently being worked on.

## Run the Demo

Use two terminals.

### Terminal 1: backend

```bash
cd /home/gsk/VoxNav/alzheimers_guardrail
venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

### Terminal 2: React demo page

```bash
cd /home/gsk/VoxNav/demo-webapp+browser-extension/demo-webapp
npm install
npm run dev
```

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Load or reload `/home/gsk/VoxNav/demo-webapp+browser-extension/browser-extension/manifest.json` as a temporary add-on.
3. **After every extension code edit, click Reload there and hard-refresh the demo with `Ctrl+Shift+R`.** Firefox otherwise continues running the old content script.
4. Open `http://127.0.0.1:3000`.

Expected:

- Toggle OFF: blue outline disappears; clicking a demo action does nothing.
- Toggle ON: blue outline returns; clicking an action opens the context modal.
- Popup shows the latest privacy log after an action.

## Verified Backend Results

`venv/bin/python test_websocket.py` returned valid responses for all four actions.

| Action | Risk | Example context |
| --- | --- | --- |
| SEND_DOCUMENT | HIGH (0.815) | Recipient requested the document on Aug 28 |
| DELETE_FILE | HIGH (0.690) | File was last modified for Henderson project |
| CANCEL_APPT | MEDIUM (0.490) | Appointment with Dr. Smith tomorrow at 2 PM |
| TRANSFER | MEDIUM (0.393) | Similar $100 transfer to Alice on Aug 20 |

Privacy logs contain exact source items under `used` and excluded source counts under `not_used`.

## Stage 3 Status

### Completed core items

- End-to-end demo architecture
- Four action types
- Input validation in backend
- Transparent risk score and risk level
- Context explanation and privacy audit
- Decision UI
- Firefox extension toggle with storage
- Backend connection error/timeout feedback

### Stage 3 polish: completed

1. Popup sensitivity slider persists a risk threshold: high (all), balanced (medium/high), or low (high only).
2. The backend returns processing time and the extension displays/logs client round-trip latency. A local run measured 45.3 ms or less for all four actions, below 500 ms.
3. Rapid clicks are coalesced while a request is in flight.
4. Automated tests cover malformed/non-object payloads, missing fields, invalid transfer amounts, rapid clicks, and a stalled backend timeout.
5. The decision modal includes “Why am I seeing this?”, a five-minute per-tab snooze, and an immediate turn-off control.
6. The modal has dialog semantics, initial/return focus, Escape and Tab handling, visible focus styles, non-diagnostic wording, and synthetic-data labels in the modal and demo page.
7. `demo-webapp+browser-extension/DEMO_SCRIPT.md` provides a two-minute rehearsal flow.

## Constraints

- Firefox is the primary browser; keep Manifest V2 for the current hackathon demo.
- No medical diagnosis/claims. This is a cognitive-accessibility guardrail, not an Alzheimer's detector.
- Do not expose raw/private data beyond the minimum contextual summary.
- Preserve user autonomy: Continue/Cancel remain the user's choice.
- The current React vault is local-first and encrypted; optional Supabase configuration stores ciphertext only. See `docs/PRIVACY_ARCHITECTURE.md` before connecting a real project.

## Suggested Next Task

Implement rapid-click protection plus a short “Why am I seeing this?” disclosure in the decision modal, then test the four actions again in Firefox.

## Clean Prompt for a New Chat

```text
Read /home/gsk/VoxNav/HANDOFF.md. Continue the Context Before Consequence project from the suggested next task. Work directly in the existing files, keep Firefox Manifest V2 compatibility, and verify changes before reporting completion.
```
