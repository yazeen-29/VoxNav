# Supabase encrypted-vault setup

1. Create a Supabase project and enable email/password authentication.
2. Run `migrations/202609050001_encrypted_vault.sql` in the SQL editor or through the Supabase CLI.
3. Copy `demo-webapp/.env.example` to `demo-webapp/.env.local` and fill in the project URL and anonymous key.
4. Run the React app. The browser encrypts context before `vault_records` is written.

The anonymous key is safe to expose in a client app; the service-role key is not. Do not add plaintext context, search keywords, contacts, action targets, or decryption keys to this database.

## Mobile trusted-person encrypted backup

Apply `migrations/202609060002_trusted_directory_vault.sql` and then
`migrations/202609060003_patient_caretaker_pairing.sql` before using mobile
pairing. Enable **Anonymous Sign-ins** in Supabase Auth: the patient device
uses that device-bound account only after biometric unlock, while a caretaker
uses their separate email/password account.

The pairing migration stores a hash of a 10-minute QR secret plus state and the
caretaker-provided label. It stores no patient names, contacts, photos, face
templates, reminders or encrypted-vault records, and a pairing alone reveals
none of those to the caretaker. Per-device encrypted vault-key sharing remains
required before any vault record may be shared.

## Development AI provider (Groq)

`functions/extract-care-facts` is a provider adapter for Level 2/3 development.
It uses Groq's strict JSON-schema output with the default
`openai/gpt-oss-20b` model, but does not persist excerpts or model outputs.
The mobile app has no automatic call site; connect it only to an explicit,
consent-screened feature that treats its result as a human-review suggestion.

Install the Supabase CLI, authenticate it, and link your project. Then set the
secret locally in your terminal (never in `.env.local` or the mobile app) and
deploy:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set GROQ_API_KEY=YOUR_GROQ_KEY GROQ_MODEL=openai/gpt-oss-20b
npx supabase functions deploy extract-care-facts
```

The function requires a valid Supabase user JWT. Keep its `verify_jwt = true`
setting in `config.toml`; do not expose the Groq key to the client.
