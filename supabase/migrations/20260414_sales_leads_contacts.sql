-- Sales CRM — leads (pipeline) table
-- NOTE: contacts table already exists in DB with its own schema
-- (columns: name, company, type, title, phone, email, market, notes, ...)
-- We reuse the existing contacts table rather than recreating.
-- Run via: supabase db push, or paste into Supabase SQL Editor

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  contact_name text,
  contact_phone text,
  contact_email text,
  project_description text,
  market text,
  sales_rep text,
  source text,
  estimated_value numeric,
  estimated_lf numeric,
  fence_type text,
  stage text default 'new_lead',
  expected_close_date date,
  proposal_sent_date date,
  proposal_value numeric,
  win_probability integer,
  won_date date,
  lost_date date,
  loss_reason text,
  loss_notes text,
  job_number text,
  notes text,
  follow_up_date date,
  stage_entered_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leads_stage on leads(stage);
create index if not exists idx_leads_market on leads(market);
create index if not exists idx_leads_sales_rep on leads(sales_rep);

alter table leads enable row level security;

drop policy if exists "public all" on leads;
create policy "public all" on leads for all using (true) with check (true);
