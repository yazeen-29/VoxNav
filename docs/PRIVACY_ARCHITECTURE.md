# Privacy architecture

## Current product boundary

The legacy browser-extension demo sends a fixed synthetic action object to a local WebSocket backend. It does not create a database record and it does not send page text or extracted keywords to a cloud service.

The React vault encrypts user-created reminders, trusted-contact notes, and action notes in the browser before they are written to local storage or offered to the optional sync client. When unlocked on the local demo page, it provides at most three matching items to the extension through a same-page, in-memory bridge; those items are not added to the backend request.

## Data flow

```text
User-created context
        |
        v
Browser/mobile vault key -> AES-GCM ciphertext -> local encrypted record cache
                                                   |
                                                   v
                                      optional Supabase ciphertext sync
```

Matching runs on the client against unlocked records. The extension validates bridge messages, caps their size, and uses them only in its local decision modal. Supabase receives a record ID, ciphertext, IV, version, and timestamp only. It must never receive reminder text, keywords, contacts, browsing data, action targets, vault passphrases, recovery keys, or decryption keys.

## Key model

- A random vault key encrypts record payloads with AES-GCM.
- A passphrase-derived key wraps the vault key. The browser MVP uses Web Crypto PBKDF2-SHA-256 with 310,000 iterations; a production mobile/client implementation should use a reviewed Argon2id package where available.
- A randomly generated one-time recovery key separately wraps the vault key. Users must save it; the service cannot recover a lost passphrase and recovery key.
- Mobile device secrets belong in platform secure storage. Browser records are encrypted before local storage; browser storage itself is not treated as the security boundary.

## Device biometrics

- The React browser vault uses a WebAuthn platform credential with required user verification as a local biometric gate. The browser and operating system choose the available verifier: this may be Face ID/Touch ID on Apple hardware, Windows Hello, a fingerprint, or a device PIN. A browser extension cannot directly invoke Face ID by name.
- The Expo companion uses `expo-local-authentication` and requires an enrolled strong biometric before it shows private context. This is normally a fingerprint on Android and Face ID/Touch ID on iOS. Face ID testing requires a development build rather than Expo Go.
- Biometrics authorize the current device session. They do not solve lost-device or delegated caretaker recovery; that flow must be designed separately with explicit consent and auditability.

## Operating rules

- Explicitly added context only in v1. No background page scraping, keyword harvesting, or third-party account connection.
- Continue/Cancel remains the user's decision. The product does not diagnose medical conditions or make decisions for a person.
- Diagnostic events and product analytics are opt-in and aggregate-only. No raw context can enter logs.
- Apply `supabase/migrations/202609050001_encrypted_vault.sql` before enabling sync. Do not use a Supabase service-role key in a client.
