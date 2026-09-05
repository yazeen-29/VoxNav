# Context Companion (Expo)

This is the React Native/Expo companion for iOS and Android.

```bash
cd mobile-companion
npm install
npm start
```

It prompts for an enrolled strong device biometric before showing private context: typically fingerprint on Android and Face ID/Touch ID on iOS. Face ID requires a development build; it is not available in Expo Go.

## Device roles

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
