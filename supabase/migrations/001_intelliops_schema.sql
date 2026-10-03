-- ============================================================================
-- IntelliOps · Cold Chain Guardian — Supabase schema
-- Run in Supabase: SQL Editor → paste → Run. Safe to run more than once, and
-- safe on an existing project (it only adds what is missing).
-- ============================================================================

-- gen_random_uuid() is built into Postgres 13+ (Supabase), no extension needed.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('coordinator', 'driver')),
  full_name text not null,
  phone text,
  vehicle_number text,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists vehicle_number text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
do $$ begin
  create unique index if not exists profiles_vehicle_number_key on public.profiles (vehicle_number) where vehicle_number is not null;
exception when unique_violation then raise notice 'Two drivers share a vehicle number — unique index skipped';
end $$;

-- ---------------------------------------------------------------- shipments
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_number text not null,
  driver_id uuid references public.profiles (id) on delete set null,
  status text not null default 'IN_TRANSIT',
  temperature numeric(5, 2),
  origin text,
  destination text,
  created_at timestamptz not null default now()
);
alter table public.shipments add column if not exists current_latitude double precision;
alter table public.shipments add column if not exists current_longitude double precision;
alter table public.shipments add column if not exists location_accuracy integer;
alter table public.shipments add column if not exists location_shared_at timestamptz;
alter table public.shipments add column if not exists current_temperature numeric(5, 2);
alter table public.shipments add column if not exists current_humidity numeric(5, 2);
alter table public.shipments add column if not exists weather_updated_at timestamptz;
alter table public.shipments add column if not exists tracking_status text default 'NOT_STARTED';
alter table public.shipments add column if not exists last_seen_at timestamptz;
alter table public.shipments add column if not exists last_seen_status text;
do $$ begin
  create unique index if not exists shipments_shipment_number_key on public.shipments (shipment_number);
exception when unique_violation then raise notice 'Duplicate shipment numbers found — unique index skipped (seed.mjs needs it)';
end $$;
create index if not exists shipments_driver_id_idx on public.shipments (driver_id);

-- ---------------------------------------------------------------- recovery instructions
create table if not exists public.recovery_instructions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  instruction text not null,
  status text not null default 'SENT' check (status in ('SENT', 'ACKNOWLEDGED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
alter table public.recovery_instructions add column if not exists acknowledged_at timestamptz;
create index if not exists recovery_instructions_driver_idx on public.recovery_instructions (driver_id, created_at desc);

-- ---------------------------------------------------------------- GPS history (live map trail)
create table if not exists public.gps_positions (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  driver_id uuid references public.profiles (id) on delete set null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy integer,
  speed_kmh numeric(6, 1),
  recorded_at timestamptz not null default now()
);
create index if not exists gps_positions_shipment_time_idx on public.gps_positions (shipment_id, recorded_at desc);

-- ---------------------------------------------------------------- helper
create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator');
$$;

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.shipments enable row level security;
alter table public.recovery_instructions enable row level security;
alter table public.gps_positions enable row level security;

-- profiles: you see yourself, everyone sees coordinators (driver app shows who to call), coordinators see all
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated
  using (id = auth.uid() or role = 'coordinator' or public.is_coordinator());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- shipments: drivers see and update only their own; coordinators everything
drop policy if exists "shipments read" on public.shipments;
create policy "shipments read" on public.shipments
  for select to authenticated
  using (driver_id = auth.uid() or public.is_coordinator());

drop policy if exists "shipments update" on public.shipments;
create policy "shipments update" on public.shipments
  for update to authenticated
  using (driver_id = auth.uid() or public.is_coordinator())
  with check (driver_id = auth.uid() or public.is_coordinator());

drop policy if exists "shipments insert coordinator" on public.shipments;
create policy "shipments insert coordinator" on public.shipments
  for insert to authenticated
  with check (public.is_coordinator());

-- recovery instructions: coordinators send, drivers read + acknowledge their own
drop policy if exists "instructions read" on public.recovery_instructions;
create policy "instructions read" on public.recovery_instructions
  for select to authenticated
  using (driver_id = auth.uid() or public.is_coordinator());

drop policy if exists "instructions insert coordinator" on public.recovery_instructions;
create policy "instructions insert coordinator" on public.recovery_instructions
  for insert to authenticated
  with check (public.is_coordinator());

drop policy if exists "instructions update" on public.recovery_instructions;
create policy "instructions update" on public.recovery_instructions
  for update to authenticated
  using (driver_id = auth.uid() or public.is_coordinator())
  with check (driver_id = auth.uid() or public.is_coordinator());

-- GPS: drivers write points for their own shipment; coordinators read all
drop policy if exists "gps read" on public.gps_positions;
create policy "gps read" on public.gps_positions
  for select to authenticated
  using (driver_id = auth.uid() or public.is_coordinator());

drop policy if exists "gps insert own" on public.gps_positions;
create policy "gps insert own" on public.gps_positions
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.shipments s where s.id = shipment_id and s.driver_id = auth.uid())
  );

-- ---------------------------------------------------------------- realtime
do $$
declare
  t text;
begin
  foreach t in array array['shipments', 'recovery_instructions', 'gps_positions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then raise notice 'publication supabase_realtime not found — enable Realtime in the dashboard';
    end;
  end loop;
end $$;
