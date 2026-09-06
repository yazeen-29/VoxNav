-- Encrypted backup/sync for the mobile trusted-person directory.
-- `ciphertext` contains every name, relationship, phone, note and face
-- template after client-side AES-GCM encryption. Never add plaintext profile
-- fields, images, embeddings, or a server-side vector index to this table.
create table if not exists public.trusted_directory_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_envelope jsonb not null,
  format_version integer not null default 1 check (format_version = 1),
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.trusted_directory_vaults enable row level security;

revoke all on public.trusted_directory_vaults from anon;
grant select, insert, update, delete on public.trusted_directory_vaults to authenticated;

create policy "Users read their own encrypted trusted directory"
  on public.trusted_directory_vaults for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert their own encrypted trusted directory"
  on public.trusted_directory_vaults for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update their own encrypted trusted directory"
  on public.trusted_directory_vaults for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete their own encrypted trusted directory"
  on public.trusted_directory_vaults for delete to authenticated
  using (auth.uid() = user_id);
