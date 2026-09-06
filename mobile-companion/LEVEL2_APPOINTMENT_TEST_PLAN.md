# Local appointment completion recall acceptance

Run `npm test` from `mobile-companion/` to exercise the appointment engine, secure local storage, corrections, archive retention, privacy gate, and existing medication behavior. Export the Android bundle and compile the Android app with Java 21 before device testing.

On the patient device:

1. Unlock with the enrolled patient biometric. Confirm **Appointments**, **Medication routines**, and **Recent checks** appear; caretaker mode must not show them.
2. Add **Test pharmacy refill** and use the Android date/time picker to select a future time. A past selected time must show an error and leave no appointment record.
3. Tap **Mark completed**, then tap it again from Completed appointments. Confirm the dialog names the same appointment and displays the actual first completion time.
4. Choose **Keep earlier completion**. The appointment remains completed. Repeat the check and choose **Mark appointment incomplete**; it returns to Upcoming appointments and can later be marked completed again.
5. Use **Mark incomplete** directly from a completed appointment. Confirm Recent checks records the correction. Expand **Why was I shown this?** on a repeat check and confirm it displays only the appointment name and prior completion time.
6. Create two appointments with the same name on different dates. Completing one must not trigger a repeat check for the other.
7. Test background/foreground, manual lock, Android Back from the recall dialog, restart, rapid taps, large text, and TalkBack. Pending repeat checks must survive restart; old-session reads must not repopulate a locked screen.

This release does not connect to a calendar, verify attendance, use free-text extraction, run embeddings, share with caretakers, or sync appointment data. The date/time picker is Android-first; iOS support remains outside this increment.
