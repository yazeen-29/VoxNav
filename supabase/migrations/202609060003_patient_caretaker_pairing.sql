-- Patient-approved, metadata-only pairing. This migration intentionally does
-- not grant a caretaker access to a trusted-person vault or any other patient
-- record. A later encrypted key-sharing migration is required for that.
create extension if not exists pgcrypto;

create table if not exists public.patient_pairing_invites (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'open' check (state in ('open', 'claimed', 'approved', 'cancelled')),
  caretaker_id uuid references auth.users(id) on delete set null,
  caretaker_label text check (char_length(caretaker_label) between 1 and 80),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  approved_at timestamptz
);

create table if not exists public.patient_caretaker_pairings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  caretaker_id uuid not null references auth.users(id) on delete cascade,
  caretaker_label text not null check (char_length(caretaker_label) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  unique (patient_id, caretaker_id)
);

alter table public.patient_pairing_invites enable row level security;
alter table public.patient_caretaker_pairings enable row level security;

revoke all on public.patient_pairing_invites, public.patient_caretaker_pairings from anon;
grant select on public.patient_pairing_invites, public.patient_caretaker_pairings to authenticated;

create policy "Patients read only their own pairing invites"
  on public.patient_pairing_invites for select to authenticated
  using ((select auth.uid()) = patient_id);

create policy "A paired patient or caretaker reads pairing metadata"
  on public.patient_caretaker_pairings for select to authenticated
  using ((select auth.uid()) = patient_id or (select auth.uid()) = caretaker_id);

-- The QR contains a high-entropy one-time bearer secret. Its hash is the only
-- secret stored in Postgres. The function returns no patient metadata.
create or replace function public.create_patient_pairing_invite(p_secret_hash text)
returns table(id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid pairing request';
  end if;

  update public.patient_pairing_invites
    set state = 'cancelled'
    where patient_id = auth.uid() and state in ('open', 'claimed') and expires_at > timezone('utc', now());

  return query
    insert into public.patient_pairing_invites (patient_id, secret_hash, expires_at)
    values (auth.uid(), p_secret_hash, timezone('utc', now()) + interval '10 minutes')
    returning patient_pairing_invites.id, patient_pairing_invites.expires_at;
end;
$$;

create or replace function public.claim_patient_pairing_invite(p_secret text, p_caretaker_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if auth.uid() is null
    or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true'
    or char_length(p_secret) < 32
    or char_length(p_caretaker_label) not between 1 and 80 then
    raise exception 'Invalid pairing request';
  end if;

  update public.patient_pairing_invites
    set state = 'claimed', caretaker_id = auth.uid(), caretaker_label = btrim(p_caretaker_label), claimed_at = timezone('utc', now())
    where secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
      and state = 'open'
      and expires_at > timezone('utc', now())
    returning id into claimed_id;

  if claimed_id is null then
    raise exception 'This pairing code is expired, already used, or invalid';
  end if;
  return claimed_id;
end;
$$;

create or replace function public.decide_patient_pairing_invite(p_invite_id uuid, p_approve boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.patient_pairing_invites%rowtype;
  pairing_id uuid;
begin
  select * into invite_row from public.patient_pairing_invites
    where id = p_invite_id and patient_id = auth.uid() and state = 'claimed' and expires_at > timezone('utc', now())
    for update;
  if not found then
    raise exception 'That pairing request cannot be approved';
  end if;

  if not p_approve then
    update public.patient_pairing_invites set state = 'cancelled' where id = invite_row.id;
    return null;
  end if;

  insert into public.patient_caretaker_pairings (patient_id, caretaker_id, caretaker_label)
    values (invite_row.patient_id, invite_row.caretaker_id, invite_row.caretaker_label)
    on conflict (patient_id, caretaker_id) do update set revoked_at = null, caretaker_label = excluded.caretaker_label
    returning id into pairing_id;
  update public.patient_pairing_invites set state = 'approved', approved_at = timezone('utc', now()) where id = invite_row.id;
  return pairing_id;
end;
$$;

revoke all on function public.create_patient_pairing_invite(text) from public, anon;
revoke all on function public.claim_patient_pairing_invite(text, text) from public, anon;
revoke all on function public.decide_patient_pairing_invite(uuid, boolean) from public, anon;
grant execute on function public.create_patient_pairing_invite(text) to authenticated;
grant execute on function public.claim_patient_pairing_invite(text, text) to authenticated;
grant execute on function public.decide_patient_pairing_invite(uuid, boolean) to authenticated;
