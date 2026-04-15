-- User profiles for Supabase Auth integration
-- Keyed by email so profiles can be seeded before auth users are invited.
-- auth_user_id is populated on first sign-in (or manually via dashboard).

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  email text unique not null,
  full_name text,
  title text,
  location text,
  role text check (role in ('admin','sales_director','sales_rep','pm','production','billing','viewer')),
  market text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_user_profiles_email on user_profiles(lower(email));
create index if not exists idx_user_profiles_auth on user_profiles(auth_user_id);

alter table user_profiles enable row level security;

-- Authenticated users can read all profiles (internal team tool — needed to
-- resolve sales rep / PM names across pages). Non-recursive to avoid RLS loops.
drop policy if exists "authenticated read" on user_profiles;
create policy "authenticated read" on user_profiles for select to authenticated using (true);

-- Anon also needs read for the existing app flow (many pages read anonymously)
drop policy if exists "anon read" on user_profiles;
create policy "anon read" on user_profiles for select to anon using (true);

-- Users can update their own profile row (matched by auth_user_id)
drop policy if exists "update own" on user_profiles;
create policy "update own" on user_profiles for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- Helper function: backfill auth_user_id on first login when a seeded
-- profile exists for the user's email. Called from a trigger on auth.users.
create or replace function public.link_user_profile_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_profiles
     set auth_user_id = new.id, updated_at = now()
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_profile on auth.users;
create trigger on_auth_user_created_link_profile
  after insert on auth.users
  for each row execute function public.link_user_profile_on_signup();

-- Seed rows for every team member. Idempotent via on conflict on email.
insert into user_profiles (email, full_name, title, location, role, market) values
  ('david@fencecrete.com','David Bannister','CEO','HQ','admin',null),
  ('alex@fencecrete.com','Alex Hanno','CFO','HQ','admin',null),
  ('ccontreras@fencecrete.com','Carlos Contreras','SVP Operations','San Antonio','admin','San Antonio'),
  ('laura@fencecrete.com','Laura Sheffy','Sales Director','Houston','sales_director','Houston'),
  ('matt@fencecrete.com','Matt Booth','Sales Consultant','San Antonio','sales_rep','San Antonio'),
  ('yuda@fencecrete.com','Yuda Doliner','Sales Consultant','San Antonio','sales_rep','San Antonio'),
  ('nathan@fencecrete.com','Nathan Savage','Sales Consultant','Houston','sales_rep','Houston'),
  ('ryne@fencecrete.com','Ryne Tutor','Sales Consultant','Houston','sales_rep','Houston'),
  ('ray@fencecrete.com','Ray Garcia','Project Manager','San Antonio','pm','San Antonio'),
  ('manuel@fencecrete.com','Manuel Salazar','Operations Manager','Houston','pm','Houston'),
  ('jr@fencecrete.com','Rafael Anaya Jr.','Project Manager','Houston','pm','Houston'),
  ('doug@fencecrete.com','Doug Monroe','Project Manager','Dallas-Fort Worth','pm','Dallas-Fort Worth'),
  ('max@fencecrete.com','Max Rodriguez','Production Manager','San Antonio','production','San Antonio'),
  ('luis@fencecrete.com','Luis Gaytan','Plant Supervisor','San Antonio','production','San Antonio'),
  ('amiee@fencecrete.com','Amiee Gonzales','Contract/Accounting Admin','San Antonio','billing','San Antonio'),
  ('mary@fencecrete.com','Mary Barbe','AR & Billing','San Antonio','billing','San Antonio'),
  ('virginiag@fencecrete.com','Virginia Garcia','Accounting Specialist','San Antonio','billing','San Antonio'),
  ('marisol@fencecrete.com','Marisol Gonzalez','AP & Payroll','San Antonio','billing','San Antonio'),
  ('valerie@fencecrete.com','Valerie Davis','Accounting Admin','Houston','billing','Houston'),
  ('violet@fencecrete.com','Violet Mendez','HR Director','HQ','viewer',null),
  ('yvonne@fencecrete.com','Yvonne Garcia','Admin Assistant','San Antonio','viewer','San Antonio'),
  ('larry@fencecrete.com','Larry Delgado','Mechanic','San Antonio','viewer','San Antonio'),
  ('aaron@fencecrete.com','Aaron Lloyd','Mechanic','Houston','viewer','Houston'),
  ('wang@woodlake-group.com','Chester Wang','PE Sponsor','Woodlake Group','viewer',null),
  ('mike@lakestatepartners.com','Mike Kell','PE Sponsor','Lake State Partners','viewer',null)
on conflict (email) do update set
  full_name = excluded.full_name,
  title = excluded.title,
  location = excluded.location,
  role = excluded.role,
  market = excluded.market,
  updated_at = now();

-- NEXT STEP: invite each of these users from the Supabase Dashboard
-- (Authentication → Users → Invite User). When they click the emailed link
-- and set a password, the on_auth_user_created_link_profile trigger will
-- automatically populate auth_user_id on their pre-seeded profile row.
