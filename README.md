# Context Companion

Context Companion is a local-first mobile prototype that helps people with memory difficulties handle everyday uncertainty with small, clear next steps.

It is designed to support independence and dignity. It is **not** a diagnostic tool, emergency service, medication verifier, or replacement for clinical care.

## What the prototype does

- Uses a device biometric for patient access; no patient password needs to be remembered.
- Provides a simple in-app tutorial that is available even before unlocking.
- Keeps medication and appointment recall records locally on the device.
- Lets a person create reviewed recall cards such as “Call pharmacy about refill” and schedule a gentle local follow-up.
- Offers one-tap support actions: call a configured close friend or open directions home in Google Maps.
- Reviews notification previews only from apps the person explicitly selects: WhatsApp, Telegram, Messenger, and Gmail.
- Requires every notification match to be reviewed before it becomes a saved reminder.
- Lets the patient share a redacted, approved-reminder summary through Android’s normal share sheet. Nothing is sent automatically.
- Includes a browser-based **Memory Confidence Timeline** with confirmed activities, voluntary confidence check-ins, and a synthetic clinical-context review demo.

## Privacy boundaries

Context Companion is deliberately conservative:

- It does not read chat histories, email inboxes, contacts, photos, or GPS location in the background.
- Notification review uses only previews from selected apps and holds a match locally until it is reviewed or expires.
- A full notification preview is never included in the shareable summary.
- The web dashboard stores its prototype data in the current browser. It is not a live caretaker portal or a cloud-sync system.
- Clinical-context testing accepts synthetic text only and requires human confirmation of every displayed fact.
- The app does not diagnose Alzheimer’s, predict behaviour, make medical decisions, or claim that a task was completed.

## Run the mobile app

```bash
cd mobile-companion
npm install
npm start
```

For the Android development build and its native capabilities, connect an Android device with USB debugging enabled, then run:

```bash
adb reverse tcp:8081 tcp:8082
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Use a Metro server on port `8082`; the USB reverse rule lets the phone reach it at `http://localhost:8081`.

## Run the web dashboard

```bash
cd mobile-companion
npm run web -- --port 8083
```

Open `http://localhost:8083` in a browser.

The dashboard includes demonstration data by default. Use only de-identified synthetic text in the clinical-context review prototype; a ready-made example is available at [synthetic-clinical-report-demo.txt](mobile-companion/samples/synthetic-clinical-report-demo.txt).

## Test and verify

```bash
cd mobile-companion
npm test
npx expo export --platform android
npx expo export --platform web
```

## Repository layout

```text
mobile-companion/  React Native patient app and browser dashboard
supabase/          Optional prototype backend migrations and functions
samples/           Synthetic test material
planning/          Project plans, handoff notes, status, and team task briefs
```

## Current prototype status

This repository is an active hackathon prototype. The core patient experience, local recall, reviewed reminders, tutorial, support actions, notification-preview review, and web dashboard are implemented. End-to-end encrypted cross-device sharing and production clinical-document handling remain future work.
