-- ============================================================
-- AP3X Driver Safety Layer — SQL Schema (Additive Only)
-- DO NOT MODIFY existing Fleet OS tables.
-- Only creates NEW driver-safety-specific tables.
-- ============================================================

-- ─── 1. safety_incidents ─────────────────────────────────────
-- Stores every safety event: hazards, harsh events, fatigue alerts.
CREATE TABLE IF NOT EXISTS safety_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  task_id      UUID REFERENCES tasks(id)   ON DELETE SET NULL,
  type         TEXT NOT NULL,          -- 'hazard' | 'harsh_brake' | 'harsh_accel' | 'fatigue_alert' | 'collision' | 'speeding'
  subtype      TEXT,                   -- e.g. 'pothole', 'debris', 'flooding'
  notes        TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  speed_kmh    NUMERIC(6,2),
  severity     TEXT DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
  source       TEXT DEFAULT 'manual',  -- 'manual' | 'ai' | 'telemetry'
  ai_flags     JSONB,
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE safety_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers own their incidents"
  ON safety_incidents FOR ALL
  USING (auth.uid() = driver_id);

CREATE POLICY "Dispatchers read all incidents"
  ON safety_incidents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'dispatcher')
    )
  );

CREATE INDEX IF NOT EXISTS idx_safety_incidents_driver  ON safety_incidents(driver_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_task    ON safety_incidents(task_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_time    ON safety_incidents(reported_at DESC);


-- ─── 2. driver_route_memory ──────────────────────────────────
-- Local route snapshots synced from IndexedDB when online.
CREATE TABLE IF NOT EXISTS driver_route_memory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id         UUID REFERENCES tasks(id)    ON DELETE SET NULL,
  route_geometry  JSONB,              -- array of {lat, lng} waypoints
  stops           JSONB,              -- stop list
  deviations      JSONB,              -- deviation events
  risk_flags      JSONB,              -- AI-detected risk zones
  completion_pct  NUMERIC(5,2) DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE driver_route_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers own their route memory"
  ON driver_route_memory FOR ALL
  USING (auth.uid() = driver_id);

CREATE POLICY "Dispatchers read route memory"
  ON driver_route_memory FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'dispatcher')
    )
  );

CREATE INDEX IF NOT EXISTS idx_route_memory_driver ON driver_route_memory(driver_id);
CREATE INDEX IF NOT EXISTS idx_route_memory_task   ON driver_route_memory(task_id);


-- ─── 3. driver_dashcam_events ────────────────────────────────
-- Metadata-only log of dashcam clip captures (no video stored in DB).
CREATE TABLE IF NOT EXISTS driver_dashcam_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id         UUID REFERENCES tasks(id)    ON DELETE SET NULL,
  trigger         TEXT NOT NULL,      -- 'manual' | 'harsh_brake' | 'collision' | 'ai_hazard' | 'deviation'
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  speed_kmh       NUMERIC(6,2),
  heading         NUMERIC(5,1),
  duration_secs   INT,
  clip_local_key  TEXT,               -- IndexedDB key for local clip — NOT a cloud URL
  ai_flags        JSONB,
  telemetry_snap  JSONB,              -- speed, heading, accel at time of capture
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE driver_dashcam_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers own their dashcam events"
  ON driver_dashcam_events FOR ALL
  USING (auth.uid() = driver_id);

CREATE POLICY "Dispatchers read dashcam events"
  ON driver_dashcam_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'dispatcher')
    )
  );

CREATE INDEX IF NOT EXISTS idx_dashcam_driver  ON driver_dashcam_events(driver_id);
CREATE INDEX IF NOT EXISTS idx_dashcam_task    ON driver_dashcam_events(task_id);
CREATE INDEX IF NOT EXISTS idx_dashcam_time    ON driver_dashcam_events(captured_at DESC);


-- ─── 4. driver_safety_exports ────────────────────────────────
-- Audit log of every export action a driver performed.
CREATE TABLE IF NOT EXISTS driver_safety_exports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id      UUID REFERENCES tasks(id)    ON DELETE SET NULL,
  export_type  TEXT NOT NULL,         -- 'incidents_csv' | 'route_csv' | 'full_json'
  record_count INT  DEFAULT 0,
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE driver_safety_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers own their export log"
  ON driver_safety_exports FOR ALL
  USING (auth.uid() = driver_id);

CREATE INDEX IF NOT EXISTS idx_safety_exports_driver ON driver_safety_exports(driver_id);
