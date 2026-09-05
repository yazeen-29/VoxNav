# Supabase encrypted-vault setup

1. Create a Supabase project and enable email/password authentication.
2. Run `migrations/202609050001_encrypted_vault.sql` in the SQL editor or through the Supabase CLI.
3. Copy `demo-webapp/.env.example` to `demo-webapp/.env.local` and fill in the project URL and anonymous key.
4. Run the React app. The browser encrypts context before `vault_records` is written.

The anonymous key is safe to expose in a client app; the service-role key is not. Do not add plaintext context, search keywords, contacts, action targets, or decryption keys to this database.
