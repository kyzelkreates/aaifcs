-- ============================================================
-- APEX AI — Supabase Database Schema
-- Run this in your Supabase SQL editor to create all tables.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists postgis;

-- ── Vehicles ─────────────────────────────────────────────────
create table if not exists vehicles (
  id             uuid primary key default uuid_generate_v4(),
  reg_number     text not null,
  make           text,
  model          text,
  year           int,
  vin            text,
  type           text default 'van',  -- hgv|van|car|tanker|reefer|flatbed|minibus
  status         text default 'idle', -- active|idle|maintenance|offline|decommissioned
  fuel_type      text default 'diesel',
  fuel_level     int,
  odometer_km    numeric,
  driver_id      uuid,
  driver_name    text,
  last_location  text,
  lat            double precision,
  lng            double precision,
  speed          int,
  last_service   date,
  next_service   date,
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists vehicles_status_idx on vehicles(status);
create index if not exists vehicles_driver_idx on vehicles(driver_id);

-- ── Drivers ──────────────────────────────────────────────────
create table if not exists drivers (
  id                uuid primary key default uuid_generate_v4(),
  full_name         text not null,
  email             text,
  phone             text,
  employee_id       text,
  licence_type      text,
  licence_expiry    date,
  status            text default 'active', -- active|off_duty|on_break|suspended|inactive
  safety_score      int default 100,
  hours_this_week   numeric,
  vehicle_id        uuid references vehicles(id) on delete set null,
  vehicle_reg       text,
  emergency_contact text,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists drivers_status_idx on drivers(status);

-- ── Vehicle Telemetry ─────────────────────────────────────────
create table if not exists vehicle_telemetry (
  id          uuid primary key default uuid_generate_v4(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  lat         double precision,
  lng         double precision,
  speed       int,
  heading     int,
  fuel_level  int,
  engine_on   boolean default true,
  odometer_km numeric,
  created_at  timestamptz default now()
);

create index if not exists telemetry_vehicle_idx on vehicle_telemetry(vehicle_id, created_at desc);

-- ── Safety Alerts ─────────────────────────────────────────────
create table if not exists safety_alerts (
  id          uuid primary key default uuid_generate_v4(),
  type        text not null, -- speeding|harsh_brake|harsh_acceleration|fatigue|...
  severity    text not null default 'medium', -- low|medium|high|critical
  driver_id   uuid references drivers(id) on delete set null,
  driver_name text,
  vehicle_id  uuid references vehicles(id) on delete set null,
  vehicle_reg text,
  description text,
  resolved    boolean default false,
  resolved_at timestamptz,
  created_at  timestamptz default now()
);

create index if not exists safety_alerts_severity_idx on safety_alerts(severity);
create index if not exists safety_alerts_resolved_idx on safety_alerts(resolved);

-- ── Driver Scores ─────────────────────────────────────────────
create table if not exists driver_scores (
  id         uuid primary key default uuid_generate_v4(),
  driver_id  uuid not null references drivers(id) on delete cascade,
  score      int not null,
  date       date not null,
  created_at timestamptz default now()
);

create unique index if not exists driver_scores_unique on driver_scores(driver_id, date);

-- ── Dispatch Jobs ─────────────────────────────────────────────
create table if not exists dispatch_jobs (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  origin       text,
  destination  text,
  priority     text default 'normal',     -- low|normal|high|urgent
  status       text default 'pending',    -- pending|assigned|in_progress|completed|cancelled
  driver_id    uuid references drivers(id) on delete set null,
  driver_name  text,
  vehicle_id   uuid references vehicles(id) on delete set null,
  vehicle_reg  text,
  scheduled_at timestamptz,
  assigned_at  timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists dispatch_status_idx on dispatch_jobs(status);
create index if not exists dispatch_priority_idx on dispatch_jobs(priority);

-- ── Compliance Records ────────────────────────────────────────
create table if not exists compliance_records (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  category     text not null,  -- licence|vehicle|hours|tachograph|insurance|mot|tax|training
  entity_id    uuid,
  entity_name  text,
  status       text default 'pending', -- pass|fail|warning|pending|expired
  expiry_date  date,
  document_ref text,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists compliance_status_idx  on compliance_records(status);
create index if not exists compliance_category_idx on compliance_records(category);
create index if not exists compliance_expiry_idx   on compliance_records(expiry_date);

-- ── Incidents ─────────────────────────────────────────────────
create table if not exists incidents (
  id              uuid primary key default uuid_generate_v4(),
  title           text not null,
  type            text default 'other',
  severity        text default 'medium',
  status          text default 'open',
  driver_name     text,
  vehicle_reg     text,
  location        text,
  description     text,
  incident_date   timestamptz,
  injuries        boolean default false,
  property_damage boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists incidents_status_idx   on incidents(status);
create index if not exists incidents_severity_idx on incidents(severity);

-- ── Message Channels ─────────────────────────────────────────
create table if not exists message_channels (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  participants uuid[],
  last_message text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Messages ──────────────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default uuid_generate_v4(),
  channel_id  uuid not null references message_channels(id) on delete cascade,
  sender_id   uuid,
  sender_name text,
  content     text not null,
  type        text default 'text', -- text|alert|system|location
  created_at  timestamptz default now()
);

create index if not exists messages_channel_idx on messages(channel_id, created_at);

-- ── Driver Hours ──────────────────────────────────────────────
create table if not exists driver_hours (
  id         uuid primary key default uuid_generate_v4(),
  driver_id  uuid not null references drivers(id) on delete cascade,
  date       date not null,
  hours      numeric not null,
  created_at timestamptz default now()
);

-- ── RLS (Row Level Security) ──────────────────────────────────
-- Enable RLS on all tables
alter table vehicles           enable row level security;
alter table drivers            enable row level security;
alter table vehicle_telemetry  enable row level security;
alter table safety_alerts      enable row level security;
alter table driver_scores      enable row level security;
alter table dispatch_jobs      enable row level security;
alter table compliance_records enable row level security;
alter table incidents          enable row level security;
alter table message_channels   enable row level security;
alter table messages           enable row level security;
alter table driver_hours       enable row level security;

-- Allow authenticated users full access (adjust per role in production)
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'vehicles','drivers','vehicle_telemetry','safety_alerts',
    'driver_scores','dispatch_jobs','compliance_records',
    'incidents','message_channels','messages','driver_hours'
  ] loop
    execute format('
      create policy if not exists "Authenticated full access" on %I
      for all using (auth.role() = ''authenticated'')
      with check (auth.role() = ''authenticated'');
    ', tbl);
  end loop;
end;
$$;

-- ── Realtime ──────────────────────────────────────────────────
-- Enable realtime on high-frequency tables
alter publication supabase_realtime add table vehicle_telemetry;
alter publication supabase_realtime add table safety_alerts;
alter publication supabase_realtime add table dispatch_jobs;
alter publication supabase_realtime add table messages;

-- ── Seed (optional demo data) ─────────────────────────────────
-- Uncomment to insert sample vehicles:
/*
insert into vehicles (reg_number, make, model, year, type, status, fuel_level, odometer_km, driver_name)
values
  ('AB12 CDE', 'Mercedes', 'Actros', 2022, 'hgv',  'active',      78, 124500, 'J. Smith'),
  ('XY34 FGH', 'Ford',     'Transit', 2021, 'van', 'active',      55, 88200,  'A. Jones'),
  ('PQ56 IJK', 'Volvo',    'FH16',    2023, 'hgv', 'idle',        92, 32000,  'B. Taylor'),
  ('LM78 NOP', 'DAF',      'XF',      2020, 'hgv', 'maintenance', 15, 210000, null),
  ('QR90 STU', 'Renault',  'Master',  2022, 'van', 'offline',     0,  55000,  null);
*/
