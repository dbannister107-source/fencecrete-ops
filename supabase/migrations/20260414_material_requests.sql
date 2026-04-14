-- Material Requests — digitized PMR form for ordering from production plant
-- Run via: supabase db push, or paste into Supabase SQL Editor

create table if not exists material_requests (
  id uuid primary key default gen_random_uuid(),
  request_date date default current_date,
  requested_by text,
  job_number text,
  job_name text,
  address text,
  city_state_zip text,
  crew_on_job text,
  material_style text,
  color_name text,
  color_code text,
  height_of_fence text,
  linear_feet numeric,
  second_height text,
  second_linear_feet numeric,
  projected_start_date date,
  status text default 'pending',
  confirmed_by text,
  confirmed_at timestamptz,
  estimated_ship_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists material_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references material_requests(id) on delete cascade,
  size_design text,
  item_type text,
  mat_qty_each integer,
  ship_date date,
  backorder boolean default false,
  notes text
);

create index if not exists idx_mat_req_status on material_requests(status);
create index if not exists idx_mat_req_job_number on material_requests(job_number);
create index if not exists idx_mat_req_created on material_requests(created_at desc);
create index if not exists idx_mat_req_items_req on material_request_items(request_id);

alter table material_requests enable row level security;
alter table material_request_items enable row level security;

drop policy if exists "public all" on material_requests;
drop policy if exists "public all" on material_request_items;
create policy "public all" on material_requests for all using (true) with check (true);
create policy "public all" on material_request_items for all using (true) with check (true);
