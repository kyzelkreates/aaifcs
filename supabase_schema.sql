-- ============================================================
-- AP3X Fleet Control OS — Supabase Schema
-- Run this in your Supabase SQL Editor to provision all tables.
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── drivers ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drivers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online','offline','driving','on_break','idle')),
  current_task    UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  online          BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── tasks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','assigned','accepted','in_progress','completed','cancelled')),
  assigned_driver       UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  assigned_driver_name  TEXT,
  assigned_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fix forward reference: add tasks FK to drivers after tasks is created
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS current_task UUID REFERENCES public.tasks(id) ON DELETE SET NULL;

-- ─── fleet_nodes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_nodes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  node_name   TEXT NOT NULL,
  online      BOOLEAN NOT NULL DEFAULT false,
  telemetry   JSONB,
  last_seen   TIMESTAMPTZ
);

-- ─── dashboard_events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settings (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key     TEXT NOT NULL UNIQUE,
  value   JSONB
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_driver ON public.tasks(assigned_driver);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at      ON public.tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drivers_status        ON public.drivers(status);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_type ON public.dashboard_events(type);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_time ON public.dashboard_events(created_at DESC);

-- ─── Updated_at triggers ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Row Level Security ───────────────────────────────────────
ALTER TABLE public.drivers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings         ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated + anon reads (AP3X uses anon key)
CREATE POLICY "Public read drivers"          ON public.drivers          FOR SELECT USING (true);
CREATE POLICY "Public write drivers"         ON public.drivers          FOR ALL    USING (true);
CREATE POLICY "Public read tasks"            ON public.tasks            FOR SELECT USING (true);
CREATE POLICY "Public write tasks"           ON public.tasks            FOR ALL    USING (true);
CREATE POLICY "Public read fleet_nodes"      ON public.fleet_nodes      FOR SELECT USING (true);
CREATE POLICY "Public write fleet_nodes"     ON public.fleet_nodes      FOR ALL    USING (true);
CREATE POLICY "Public read dashboard_events" ON public.dashboard_events FOR SELECT USING (true);
CREATE POLICY "Public write dashboard_events"ON public.dashboard_events FOR ALL    USING (true);
CREATE POLICY "Public read settings"         ON public.settings         FOR SELECT USING (true);
CREATE POLICY "Public write settings"        ON public.settings         FOR ALL    USING (true);

-- ─── Realtime ─────────────────────────────────────────────────
-- Enable realtime for the tables that need live sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_events;

-- ─── Seed example data (optional — remove if not needed) ──────
-- INSERT INTO public.drivers (name, status, online) VALUES
--   ('Alex Rivera', 'idle', true),
--   ('Priya Sharma', 'driving', true),
--   ('Marcus Chen', 'offline', false);

-- ============================================================
-- PWA JOB SYNC — Schema additions (run after initial schema)
-- ============================================================

-- ─── tasks: extra columns for full PWA job lifecycle ─────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS accepted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason      TEXT,
  ADD COLUMN IF NOT EXISTS completion_notes   TEXT,
  ADD COLUMN IF NOT EXISTS stops              JSONB,
  ADD COLUMN IF NOT EXISTS waypoints          JSONB,
  ADD COLUMN IF NOT EXISTS pickup_address     TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_address    TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_id         UUID,
  ADD COLUMN IF NOT EXISTS vehicle_reg        TEXT,
  ADD COLUMN IF NOT EXISTS driver_name        TEXT;

-- ─── push_subscriptions: store driver PWA Web Push endpoints ─
-- Each driver device registers here so the backend can push
-- job notifications directly to their phone even when the
-- PWA tab is closed.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,   -- public key
  auth        TEXT NOT NULL,   -- auth secret
  device_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_driver ON public.push_subscriptions(driver_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read push_subscriptions"  ON public.push_subscriptions FOR SELECT USING (true);
CREATE POLICY "Public write push_subscriptions" ON public.push_subscriptions FOR ALL    USING (true);

-- ─── driver_locations: real-time GPS store per driver ─────────
-- Replaces localStorage-only GPS — fleet dashboard reads this.
CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id   UUID PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  speed       DOUBLE PRECISION DEFAULT 0,
  heading     DOUBLE PRECISION DEFAULT 0,
  accuracy    DOUBLE PRECISION,
  status      TEXT DEFAULT 'offline',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read driver_locations"  ON public.driver_locations FOR SELECT USING (true);
CREATE POLICY "Public write driver_locations" ON public.driver_locations FOR ALL    USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;
