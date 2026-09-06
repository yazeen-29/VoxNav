# Context Companion (Expo)

This is the React Native/Expo companion for iOS and Android.

```bash
cd mobile-companion
npm install
npm start
```

It prompts for an enrolled strong device biometric before showing private context: typically fingerprint on Android and Face ID/Touch ID on iOS. Face ID requires a development build; it is not available in Expo Go.

## Local medication recall (patient device)

After biometric unlock, add a named medication routine and tap **Record as taken**. Recording the same routine again within four hours opens a recall dialog using only its name and previous recorded time. **Keep earlier record** adds no entry; **Record another entry** saves an explicitly chosen second entry. Pending decisions survive restart.

Medication records and audit facts stay in versioned SecureStore records, with no network or Supabase dependency. The app retains up to 10 routines and the 20 latest consistency checks. Backgrounding or tapping **Lock private context** ends the session. These are self-reported logs, not consumption verification or dosage instructions.

Use **Log out / switch role** to return to the Patient/Caretaker selection screen. It ends the current session and removes only the selected role preference; it does not delete local reminders, medication logs, or the caretaker-password verifier.

Run `npm test` for engine/storage checks. See [MEDICATION_TEST_PLAN.md](MEDICATION_TEST_PLAN.md) for physical-device acceptance steps.

## Local appointment completion recall (patient device)

After biometric unlock, create an appointment with its name and future local date/time. **Mark completed** records the appointment only when the patient chooses. A repeated completion attempt for that exact appointment opens a recall dialog with the appointment name and prior recorded time. The person can keep the earlier record or mark it incomplete to correct it.

The app keeps up to 20 upcoming appointments and 20 recent completed appointments. **Recent checks** combines the 20 newest appointment and medication consistency events and exposes only the facts shown during repeat checks. Appointment records are local, self-reported, and do not verify attendance or connect to a calendar, caretaker, or cloud service. See [LEVEL2_APPOINTMENT_TEST_PLAN.md](LEVEL2_APPOINTMENT_TEST_PLAN.md) for device validation.

## Access roles

At first launch, choose the role for that device. **Patient** mode uses the enrolled device biometric and has no password to remember. **Caretaker** mode requires a password of at least 12 characters; Android stores only a salted PBKDF2 verifier, never the password itself. A caretaker password unlocks only that caretaker device. It does not unlock a patient's phone or create access to patient data until a separate encrypted pairing flow is completed.

## Android notification review (development build only)

The Android app includes a native notification listener. After biometric unlock, the patient/caretaker chooses the specific chat apps and keywords to review, grants Android notification-listener access in system settings, and reviews each match before it is saved. Matches are stored locally for up to 30 minutes and full chat histories are never read or uploaded.

This cannot run inside Expo Go because it contains a custom Android service. Build and install the Android development app instead:

```bash
npx expo run:android
```

That requires Android Studio, the Android SDK, and a connected Android device/emulator. Alternatively configure an Expo EAS development build. The implementation intentionally does not request overlay/accessibility permission and does not attempt to control banking apps.

## Saving a sent message (explicit share only)

Android chat apps do not reliably expose sent messages as notifications, and this app does not scrape chats or use Accessibility. To save an outgoing message, select it in the chat app, use Android's **Share** action, and choose **Context Companion**. The shared text becomes a temporary review candidate; it is still not saved until the person taps **Save reminder**.

Caretaker sharing is deliberately not active yet: approved reminders remain local until a reviewed, end-to-end encrypted invitation and key-sharing flow is added. Before shipping, connect the audited encrypted-vault client used by the browser app, store the device key with SecureStore, and add ciphertext-only sync. Do not treat this prototype as a finished mobile security implementation.
# Context Companion mobile companion

## Local trusted-person prototype

Patient mode now includes an explicitly initiated trusted-person check. It uses
the front camera only after the patient chooses **Enroll with consent** or
**Check a person now**. Each short-lived camera photo is processed locally then
deleted by the Android module. The app stores a normalized local face template,
not an enrollment photo, for each consented person; removing a person deletes
that local template.

The two-photo blink movement prompt helps avoid accidental captures but is not
anti-spoofing or identity proof. It must not be used for money, clinical or
emergency decisions. See `android/app/src/main/assets/TRUSTED_PERSON_MODEL_NOTICE.txt`
for the bundled-model sources, checksums and licences.

## Caretaker cloud-account preparation

The **Patient** screen has no cloud email, password or vault-passphrase flow:
the patient uses the device biometric only. The **Caretaker** screen can create
or sign in to a caretaker cloud account after its separate caretaker password
has unlocked the app.

Patient-approved pairing is metadata-only at this stage: the patient generates
a 10-minute QR code, the caretaker scans it, and the patient approves the
caretaker's supplied name/relationship. A pairing does **not** share contacts,
face templates, reminders, or any vault record yet. Encrypted per-device key
sharing is required before such sharing can be enabled.

Apply both `../supabase/migrations/202609060002_trusted_directory_vault.sql`
and `../supabase/migrations/202609060003_patient_caretaker_pairing.sql`, then
enable **Anonymous Sign-ins** in Supabase Auth for the patient device. Copy
`.env.example` to `.env.local` and add only the Supabase URL and publishable
key. Do not use a service-role key in the mobile app or shared patient
passwords as a substitute for pairing.

## Development-only AI fact extraction

The optional `extract-care-facts` Supabase Edge Function uses Groq during
development and has no automatic caller in the app. It accepts only an
explicitly submitted excerpt of at most 1,200 characters and returns typed
suggestions for human review; it must not receive face data, contacts, raw chat
history, or medical/financial decisions. The Groq key lives only in a Supabase
Function secret. See `../supabase/README.md` for deployment.
