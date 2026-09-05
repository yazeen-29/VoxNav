-- Context Before Consequence stores only client-encrypted vault records here.
-- Never add plaintext reminder text, keywords, contacts, or page/action data.
create table if not exists public.vault_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.vault_records enable row level security;

create policy "Users read only their own encrypted vault records"
  on public.vault_records for select
  using (auth.uid() = user_id);

create policy "Users insert only their own encrypted vault records"
  on public.vault_records for insert
  with check (auth.uid() = user_id);

create policy "Users update only their own encrypted vault records"
  on public.vault_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete only their own encrypted vault records"
  on public.vault_records for delete
  using (auth.uid() = user_id);

create index if not exists vault_records_user_updated_idx
  on public.vault_records (user_id, updated_at desc);
