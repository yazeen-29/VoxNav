# Local medication recall acceptance

## Automated checks

Run `npm test` from `mobile-companion/`. The tests use an injected clock and in-memory SecureStore adapter; they do not change the phone's time or patient data. Coverage includes the real two-hour timestamp comparison, exactly four hours and just beyond it, independent routines, midnight, future timestamps, pending recovery, both resolutions, bounded audit retention, corrupt/missing data, failed writes, and session invalidation before context reads or commit.

Run `npx expo export --platform android` to validate the JavaScript bundle. For native validation, run `JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=/home/gsk/Android/Sdk ./gradlew :app:compileDebugKotlin` from `mobile-companion/android/`.

## Physical Android device

Use the existing patient device with its enrolled biometric. Do not clear app storage, change the device role, or bypass authentication for testing. The following steps intentionally create a local test routine; use a name that clearly marks it as test data.

1. Launch the Android development app and unlock with the patient biometric. Confirm **Medication routines** appears above notification review. Existing approved reminders should remain available.
2. Add **Test morning routine**. Tap **Record as taken** once and note the displayed timestamp. Tap again: the dialog must use the actual first recorded timestamp and routine name. An immediate repeat tests the same rule as the automated two-hour case.
3. Expand **Why am I seeing this?**. Confirm it refers only to this routine and time and makes no claim about actual consumption or dosage.
4. Choose **Keep earlier record**. Confirm the timestamp stays unchanged. Repeat the attempt and choose **Record another entry**; the last-recorded timestamp must update.
5. Trigger another repeat, lock the app using the dialog button, and unlock again. The pending decision must return. Repeat with Android Back, background/foreground, and closing/relaunching the app.
6. Rapidly tap the record button. There must be no duplicate entries from one pending operation, and a pending decision must block further recording until resolved.
7. Verify large font settings and TalkBack: the dialog heading receives focus, content scrolls, buttons are announced, status changes are readable, and focus returns to the relevant routine after resolving.
8. Verify failed biometric authentication leaves records hidden. Returning from background requires fresh authentication. A caretaker device must not show medication routines or claim access to patient data.

## Boundaries

Records are self-reported, local, and scoped to this patient device. No medication scheduling, dosage advice, remote caregiver delivery, camera matching, or cloud schema is included. Names cannot currently be renamed or removed from the UI. Storage retains each routine's latest entry and the twenty latest checks; it is not a complete medication history. A device-clock anomaly or storage error blocks the logging check without replacing the earlier committed data.

The SecureStore manifest references fixed pairs of slots. Referenced slots are authoritative; interrupted writes may leave an unreferenced encrypted slot, which is reused on later writes. Successful commits remove superseded slots on a best-effort basis. A save already committing when the app backgrounds may finish, but its result cannot repopulate the locked screen; the next unlock reloads committed state.
