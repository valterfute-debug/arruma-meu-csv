-- Apply once through Supabase migrations. Passwords belong only to Supabase Auth.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
create policy "Read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, phone)
  values(new.id, trim(new.raw_user_meta_data->>'full_name'), new.raw_user_meta_data->>'phone');
  return new;
end;
$$;
revoke all on function public.create_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();

create table public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checkout_ref uuid unique,
  provider_id text unique,
  state text not null default 'none',
  paid_until timestamptz,
  updated_at timestamptz not null default now()
);
-- Clients cannot set plan, price, dates or provider IDs.
alter table public.billing_accounts enable row level security;
revoke all on public.billing_accounts from anon, authenticated;

create table public.api_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  bucket timestamptz not null,
  hits integer not null,
  primary key(user_id, action)
);
alter table public.api_limits enable row level security;
revoke all on public.api_limits from anon, authenticated;

create function public.consume_api_limit(p_user uuid, p_action text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.api_limits(user_id, action, bucket, hits)
  values(p_user, p_action, date_trunc('minute',now()), 1)
  on conflict(user_id, action) do update set
    hits = case when api_limits.bucket = date_trunc('minute',now()) then api_limits.hits + 1 else 1 end,
    bucket = date_trunc('minute',now())
  returning hits into n;
  return n <= p_limit;
end;
$$;

-- Lock prevents concurrent clicks from creating two recurring contracts.
-- An uncertain provider response deliberately remains 'creating' until reconciled.
create function public.claim_checkout(p_user uuid)
returns public.billing_accounts language plpgsql security definer set search_path = '' as $$
declare account public.billing_accounts;
begin
  insert into public.billing_accounts(user_id) values(p_user) on conflict do nothing;
  select * into account from public.billing_accounts where user_id = p_user for update;
  if account.state = 'creating' or account.provider_id is not null or account.paid_until > now() then
    raise exception 'CHECKOUT_ALREADY_EXISTS';
  end if;
  update public.billing_accounts set checkout_ref = gen_random_uuid(), state = 'creating', updated_at = now()
  where user_id = p_user returning * into account;
  return account;
end;
$$;
revoke all on function public.consume_api_limit(uuid,text,integer), public.claim_checkout(uuid) from public, anon, authenticated;
grant execute on function public.consume_api_limit(uuid,text,integer), public.claim_checkout(uuid) to service_role;
grant all on public.profiles, public.billing_accounts, public.api_limits to service_role;
