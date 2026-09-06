# Context Before Consequence — Project Status and Next Build Brief

Last updated: 2026-09-06  
Previous published baseline: `origin/main` at commit `c057617`. The medication increment below is a local working-tree change; it has not been committed or pushed.

## Product intent

Context Before Consequence is a cognitive-accessibility guardrail. It offers the minimum useful context before a consequential action and preserves the person's choice. It is not an Alzheimer's diagnostic tool, a surveillance product, or a banking-control tool.

The project currently has three related surfaces:

1. **Firefox extension + React demo** — contextual prompts before four synthetic, high-consequence browser actions.
2. **Encrypted browser vault** — local-first reminders and notes, with optional ciphertext-only Supabase sync foundation.
3. **Context Companion mobile app** — Android-first biometric/patient and password/caretaker access, plus consent-based notification review.

## Completed work

### 1. Firefox extension and backend demo — Stage 3 complete

Location: `alzheimers_guardrail/` and `demo-webapp+browser-extension/`

- FastAPI WebSocket backend validates requests, scores risk transparently, retrieves synthetic context, builds explanations, and returns privacy audit information.
- Supported actions: `SEND_DOCUMENT`, `DELETE_FILE`, `CANCEL_APPT`, and `TRANSFER`.
- React/Vite demo page replaces the previous static demo page and contains all four action cards.
- Firefox Manifest V2 extension directly captures the four demo action IDs, rather than relying on a fragile page-to-content-script event bridge.
- Popup has persistent enable/disable state, latest privacy-log display, and a sensitivity slider.
- Sensitivity modes: high (all alerts), balanced (medium/high), and low (high only).
- Content modal includes Continue, Cancel, Why am I seeing this?, a five-minute per-tab snooze, and immediate turn-off control.
- Modal has dialog semantics, focus management, Escape and Tab handling, visible focus styling, and non-stigmatizing language.
- Rapid clicks are coalesced while a request is in progress.
- Backend failures/timeouts have a readable error state; the content script has a five-second timeout.
- Request latency is returned and displayed. The live demo test measured less than 500 ms for all four actions.
- Unit/integration coverage exists for malformed data, invalid transfer amounts, rapid clicks, timeout behavior, privacy isolation, and the encrypted-vault helpers.
- `DEMO_SCRIPT.md` is a short rehearsal guide.

### 2. Browser encrypted vault — foundation complete, sharing incomplete

Location: `demo-webapp+browser-extension/demo-webapp/src/lib/`, `docs/`, and `supabase/`

- Browser vault records use AES-GCM encryption.
- The vault key can be protected by passphrase wrapping or a recovery-key flow using PBKDF2-SHA-256 (310,000 iterations).
- Vault data is stored locally in encrypted form.
- The React dashboard supports reminders, trusted contacts, and action notes.
- The extension can request a compact local context snapshot through the page bridge; snapshot text is not sent to the WebSocket backend.
- Browser WebAuthn is used as a platform-authenticator gate where supported. This can invoke Face ID/Touch ID/Windows Hello depending on device capabilities; it is not a universal Face ID guarantee.
- Optional Supabase client code and RLS migration are included for ciphertext-only records.
- `docs/PRIVACY_ARCHITECTURE.md` documents the threat model and boundaries.

### 3. Mobile Context Companion — Android development build foundation complete

Location: `mobile-companion/`

#### Access roles

- First launch asks for a device role.
- **Patient mode** uses the enrolled strong device biometric only. The patient does not need a password or recovery key.
- **Caretaker mode** requires a password of at least 12 characters.
- The Android native module stores a salted PBKDF2-HMAC-SHA256 verifier (310,000 iterations), not the caretaker password itself.
- A caretaker password unlocks only that caretaker device. It cannot unlock the patient's phone or unpaired patient records.

#### Consent-based notification review

- The patient/caretaker selects exact chat apps: WhatsApp, Telegram, and/or Messenger.
- The patient/caretaker configures local keywords; default examples are `money`, `payment`, `transfer`, and `₹`.
- Android's explicit Notification Access settings are opened by the app. Notification Access must be granted by the person in Android Settings.
- The native listener examines only notification title/text previews from selected apps. It does not read chat history.
- A matching preview creates a local, temporary candidate. Candidates are capped at 10 and expire after 30 minutes.
- The app posts a normal Android notification: “Possible reminder detected.” Android restrictions mean a background app cannot safely force a foreground popup.
- After biometric/password unlock, the candidate is visible in **Review before saving** and can be saved or discarded.
- Saved candidates appear in **Approved reminders**, stored using Expo SecureStore on the device.
- Android notification permission is requested at runtime.
- The app intentionally does **not** request or use `SYSTEM_ALERT_WINDOW` or any Accessibility service. Legacy storage and overlay permissions are blocked in app configuration.

#### Explicit outgoing-message option

- Sent/typed chat messages do not reliably create Android notifications and therefore cannot be safely captured by a Notification Listener.
- A native Android Share target was added. When the person deliberately chooses **Share → Context Companion** for text, the text becomes a temporary review candidate marked “Shared by you.”
- This is explicit consent, not keyboard logging, chat scraping, or accessibility automation.

#### Mobile platform limits

- Expo Go cannot run this app's native notification listener or native access module. Use an Android development build.
- iOS does not permit a third-party app to inspect notifications from other chat apps in this way; cross-app notification review is Android-only.
- Face ID is available on compatible iOS development builds, not Expo Go. Android uses a strong biometric such as fingerprint where enrolled.

## Actual device and build status

### First level up — local medication recall implemented (2026-09-06)

- The patient app supports up to 10 named medication routines, each with a **Record as taken** button. Names are trimmed, unique ignoring case, and limited to 60 characters.
- A deterministic check compares only the selected routine's latest self-reported entry with the device timestamp. An elapsed time of zero through four hours inclusive creates an `action_discontinuity` flag; different routines do not match.
- The recall dialog says **“You recorded Morning medication at 8:15.”** It uses exactly two facts: routine name and previous recorded timestamp, with a date when needed. This describes a log, not verified consumption or dosage advice.
- **Keep earlier record** resolves the flag without another entry. **Record another entry** saves a new self-reported entry and audits the override. Pending checks survive locking and restart.
- The local privacy gate requires an unlocked patient session, `medication_taken`, and purpose `medication_recall` before storage reads. This flow has no backend, network, notification-preview, note, or caretaker-data dependency.
- Versioned SecureStore records remain below 2 KB each. A manifest commits changes after referenced records are written; fixed pairs of record slots bound storage even after interrupted writes. Retention is the latest confirmed entry for each routine and the 20 most recent checks with linked flags and exact recall facts.
- Backgrounding and manual locking hide private context and invalidate old sessions. Late reads cannot populate a later session. Android Back from the recall dialog locks the app and leaves the check pending.
- `npm test` in `mobile-companion/` passes 20 automated tests covering timestamp boundaries, resolutions, retention, denied reads, interrupted writes, corrupt data, Unicode storage sizes, and session changes. Android bundle export and Java 21 Kotlin compilation passed. Physical-device biometric/interaction acceptance still requires the patient's unlock; it is not implied by the automated checks.
- No Supabase schema was added. Caregiver pairing/sharing, camera matching, embeddings, other action types, schedules, and dosage logic remain deferred. The broader first-level-up document's assumed base care schema is not present in this repository.

### Level 2 — local appointment completion recall implemented (2026-09-06)

- Patient mode now supports local named appointments using an Android date/time picker. New appointments must be scheduled at or after the current device time; the app retains up to 20 upcoming and 20 most recent completed appointments.
- **Mark completed** writes a self-reported completion. A second completion attempt for the same immutable appointment ID creates an `action_discontinuity` flag using only the appointment name and earlier recorded time. Two appointments with the same title on different dates remain separate.
- The person can keep the earlier completion or mark the appointment incomplete. Corrections return the appointment to upcoming state and are retained as local history events.
- **Recent checks** merges the 20 newest medication and appointment events. It labels outcomes and exposes only facts previously shown by a repeat check. It is available only after patient biometric unlock.
- Appointment policy is local and deny-by-default: `appointment_completed` with purpose `appointment_recall` may read only appointment records/checks for an unlocked patient session. It has no network, notification-preview, notes, or caretaker-data access.
- The Android date/time picker dependency is installed through Expo. `npm test` now passes 30 checks; Android bundle export and Java 21 Kotlin compilation pass. See `mobile-companion/LEVEL2_APPOINTMENT_TEST_PLAN.md` for physical-device validation.

### Earlier device setup verification

The Honor phone was connected successfully through ADB.

- Android SDK location: `/home/gsk/Android/Sdk`
- Development Java: `/usr/lib/jvm/java-21-openjdk`
- System Java 26 must not be used for this Gradle 8.14.3 project; Java 21 works.
- `adb devices -l` reported the Honor device as connected and authorised.
- Notification Access was confirmed enabled for `com.contextcompanion.app`.
- Android notification permission was confirmed granted.
- Selected packages and keywords were confirmed persisted on the device.
- `:app:compileDebugKotlin` completed successfully with Java 21 and the Android SDK.
- Expo Android bundle export completed successfully.

Use Fish shell commands for a device build:

```fish
set -lx JAVA_HOME /usr/lib/jvm/java-21-openjdk
set -lx PATH $JAVA_HOME/bin $PATH

cd /home/gsk/VoxNav/mobile-companion
npx expo run:android --device
```

If React Native asks for an Edge/Chromium executable for browser debugging, install Chromium on Arch and set `EDGE_PATH` to `/usr/bin/chromium`. This affects browser-based debugging, not the Android app itself.

## Important behaviour to remember

- A message **typed or sent by the patient in WhatsApp** will not become a candidate. It usually creates no Android notification.
- To test automatic keyword matching, send the Honor phone a **new incoming** message from another phone, with WhatsApp in the background and notification previews enabled. Example: “Please transfer ₹100 tomorrow.”
- A keyword match is currently **review-first**: it creates a candidate, then the person chooses Save reminder or Discard.
- The intended later care mode is automatic **provisional** saving for explicitly consented, high-confidence reminder categories, with caretaker review. It is not implemented yet.

## Pending work

### Required before calling the caretaker feature complete

1. **Caretaker–patient pairing**
   - Create authenticated patient and caretaker accounts.
   - Create invitation/approval flow, preferably QR-based plus explicit confirmation.
   - Support revoking a caretaker and device/session management.

2. **End-to-end encrypted shared vault**
   - Give each paired device its own encrypted vault-key access.
   - Store only ciphertext, IVs, record metadata, and pairing metadata on the server.
   - Do not upload plaintext keywords, message previews, reminders, contacts, or recovery material.
   - Finish secure cross-device recovery with caretaker-assisted recovery policy.

3. **Caretaker timeline**
   - Show paired patient's provisional and approved reminders on the caretaker device.
   - Add review/dismiss/correct actions, audit history, and clear timestamps/source labels.
   - Ensure the caretaker sees only records the pairing explicitly permits.

### Product decisions and features still to build

4. **Automatic provisional reminders**
   - Add a separately consented “care mode” for selected non-financial categories such as appointments and medications.
   - Auto-save as *provisional*, never silently as final truth; caretaker can correct/dismiss.
   - Keep payment/transfer language as high-priority review/alert only. Do not control or initiate financial actions.

5. **Money-safety design**
   - A notification listener can audit an incoming request or a bank-app confirmation notification, but cannot safely intercept a payment before it happens.
   - Do not add keyboard capture or Accessibility-based chat/banking scraping. Those would expose passwords/OTPs and violate the product privacy boundary.

6. **Reliable device testing**
   - Test incoming notifications from WhatsApp, Telegram, and Messenger on physical devices.
   - Test notification-preview-hidden behaviour, app background/foreground states, device reboot, Android battery optimisation, and revoked Notification Access.
   - Add native automated tests for candidate expiry, app selection, and Share intent handling.

7. **Production readiness**
   - Move hand-edited Android native additions into an Expo config plugin so `expo prebuild --clean` cannot remove them.
   - Configure production signing, EAS/development build profiles, release channels, crash reporting, and dependency/security review.
   - Finalise retention rules, consent copy, account recovery policy, deletion/export flows, and accessibility usability testing with caregivers.

8. **Repository housekeeping**
   - Decide whether extension backup files (`content_script.js.backup*`) should remain tracked.
   - Replace the generated Android debug keystore with appropriate release-signing workflow before any production release.
   - Resolve existing trailing-whitespace warnings in legacy/test/Windows-generated files if repository lint is enforced.

## Stage 3 conclusion

The original Stage 3 extension/demo polish scope is complete. The “Suggested Next Task” in `HANDOFF.md` is outdated; rapid-click protection and the Why-am-I-seeing-this disclosure are already implemented.

What remains is not unfinished Stage 3 polish. It is the next product stage: consented Android automation, encrypted patient–caretaker pairing, shared ciphertext vault access, and production-grade security/usability validation.

## Good next prompt

```text
Read `planning/PROJECT_STATUS.md` first. Implement the next approved Context Companion feature without weakening the privacy boundary: no keyboard logging, no Accessibility scraping, no banking overlays, and no plaintext cloud storage.
```
# Project status

## Current Android phone-local prototype

- Patient biometrics and a separate caretaker password gate.
- Local medication routines, repeat-aware checks and appointment tracking.
- Consent-limited notification-review and share-in context capture.
- Trusted-person local prototype: user-initiated front-camera flow, one-face
  validation, blink movement prompt, MobileFaceNet embeddings and local-only
  comparison. Camera photos are deleted after native processing.
- Optional Supabase trusted-directory vault foundation: Android AES-GCM
  encryption primitives and a per-user RLS migration, with no plaintext
  profile or biometric fields in cloud columns. Patient mode exposes no cloud
  credentials. Only the caretaker console can prepare a cloud account, and it
  is deliberately unable to upload or read patient data until patient-approved
  pairing and per-device key access are implemented.
- Patient-approved caretaker pairing: a patient-biometric session creates a
  short-lived QR invitation; a signed-in caretaker scans it and supplies a
  label; the patient must approve before the pairing becomes active. The server
  stores only a hash of the one-time secret and pairing metadata. No patient
  record is shared by this pairing.
- Level 2/3 insight-review prototype: a patient can explicitly submit a short
  note to the development Groq Edge Function for typed fact suggestions, then
  review the minimum context before saving. The local audit retains facts shown
  and privacy metadata, not the source note; it includes explainability,
  usefulness feedback, and an experimental review-only threshold. Optional
  harder-hours, supportive-fact, and hazard-label signals are local prototype
  settings, not live clinical prediction, narrative retrieval, or GPS.

## Important limitations

- Trusted-person matching is not identity proof, anti-spoofing, surveillance,
  medical decision support or financial authentication.
- Pairing does not yet include encrypted record/key sharing, caretaker data
  views, revocation UI, smart-glasses integration, or clinical escalation.
- Enrolled local templates are per-device and can be removed in Patient mode.
- The current on-device SecureStore directory has a deliberately small cap;
  an encrypted SQLite store and chunked sync are required before supporting
  hundreds or thousands of local profiles/templates.
- The insight review is not an LLM integration with the missing base-spec
  database, not a clinical decision system, and does not implement real
  caregiver permission-tier data sharing or longitudinal model training.
