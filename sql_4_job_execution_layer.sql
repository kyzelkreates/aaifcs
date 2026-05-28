-- ============================================================
-- AP3X JOB EXECUTION CONTROL LAYER — Schema Additions
-- sql_4_job_execution_layer.sql
--
-- ADDITIVE ONLY. Does NOT modify any existing tables.
-- Run AFTER sql_1, sql_2, sql_3.
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. job_execution_state
--    One row per job per driver. Tracks the driver's decision
--    (accept/reject) and live execution phase.
-- ============================================================
CREATE TABLE IF NOT EXISTS job_execution_state (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id         UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  driver_id      TEXT        NOT NULL,
  tenant_id      TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN (
                               'pending','accepted','rejected',
                               'in_progress','paused','completed','cancelled'
                             )),
  accepted_at    TIMESTAMPTZ,
  rejected_at    TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  paused_at      TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jes_job_id    ON job_execution_state(job_id);
CREATE INDEX IF NOT EXISTS idx_jes_driver_id ON job_execution_state(driver_id);
CREATE INDEX IF NOT EXISTS idx_jes_status    ON job_execution_state(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jes_updated_at ON job_execution_state;
CREATE TRIGGER trg_jes_updated_at
  BEFORE UPDATE ON job_execution_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 2. job_stops
--    Ordered stop list for a job. Locked on acceptance.
--    sequence_index enforces stop order (1-based).
-- ============================================================
CREATE TABLE IF NOT EXISTS job_stops (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id              UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  stop_index          SMALLINT    NOT NULL,           -- 1-based, locked on job acceptance
  stop_type           TEXT        NOT NULL DEFAULT 'dropoff'
                                  CHECK (stop_type IN (
                                    'pickup','dropoff','depot','inspection','waypoint'
                                  )),
  label               TEXT,                           -- human label e.g. "Pickup – Warehouse A"
  address             TEXT,                           -- raw address string (geocoded on accept)
  location_lat        DOUBLE PRECISION,
  location_lng        DOUBLE PRECISION,
  geofence_radius_m   INT         DEFAULT 150,        -- arrival detection radius
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending','en_route','arrived',
                                    'validated','skipped','failed'
                                  )),
  arrived_at          TIMESTAMPTZ,
  validated_at        TIMESTAMPTZ,
  skipped_at          TIMESTAMPTZ,
  skip_reason         TEXT,
  skip_approved_by    TEXT,                           -- dispatcher ID if dispatcher approved skip
  time_window_start   TIMESTAMPTZ,
  time_window_end     TIMESTAMPTZ,
  notes               TEXT,
  proof_url           TEXT,                           -- photo/signature URL (future)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, stop_index)
);

CREATE INDEX IF NOT EXISTS idx_js_job_id     ON job_stops(job_id);
CREATE INDEX IF NOT EXISTS idx_js_status     ON job_stops(status);
CREATE INDEX IF NOT EXISTS idx_js_stop_type  ON job_stops(stop_type);

DROP TRIGGER IF EXISTS trg_js_updated_at ON job_stops;
CREATE TRIGGER trg_js_updated_at
  BEFORE UPDATE ON job_stops
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 3. job_events_log
--    Immutable append-only audit trail.
--    Every critical driver action is written here.
--    This is the grant-readiness / compliance backbone.
-- ============================================================
CREATE TABLE IF NOT EXISTS job_events_log (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID        NOT NULL,                  -- NOT FK — keeps log even if task deleted
  driver_id    TEXT        NOT NULL,
  tenant_id    TEXT,
  event_type   TEXT        NOT NULL
               CHECK (event_type IN (
                 'JOB_RECEIVED',
                 'JOB_ACCEPTED',
                 'JOB_REJECTED',
                 'JOB_STARTED',
                 'JOB_PAUSED',
                 'JOB_RESUMED',
                 'JOB_COMPLETED',
                 'JOB_CANCELLED',
                 'STOP_EN_ROUTE',
                 'STOP_ARRIVED',
                 'STOP_VALIDATED',
                 'STOP_SKIPPED',
                 'STOP_FAILED',
                 'ROUTE_DEVIATION',
                 'ROUTE_INTERRUPTED',
                 'EMERGENCY_STOP',
                 'GEOFENCE_ENTERED',
                 'GEOFENCE_EXITED'
               )),
  stop_id      UUID,                                  -- populated for STOP_* events
  stop_index   SMALLINT,
  payload      JSONB       NOT NULL DEFAULT '{}',     -- full context snapshot
  driver_lat   DOUBLE PRECISION,                      -- GPS at time of event
  driver_lng   DOUBLE PRECISION,
  device_ts    TIMESTAMPTZ,                           -- device clock (may differ from server)
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()     -- server clock — authoritative
);

-- Immutable — no UPDATE trigger needed
CREATE INDEX IF NOT EXISTS idx_jel_job_id     ON job_events_log(job_id);
CREATE INDEX IF NOT EXISTS idx_jel_driver_id  ON job_events_log(driver_id);
CREATE INDEX IF NOT EXISTS idx_jel_event_type ON job_events_log(event_type);
CREATE INDEX IF NOT EXISTS idx_jel_ts         ON job_events_log(ts DESC);


-- ============================================================
-- 4. route_interruption_log
--    Separate table for controlled mid-job interruptions.
--    Dispatcher approval tracking included.
-- ============================================================
CREATE TABLE IF NOT EXISTS route_interruption_log (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID        NOT NULL,
  driver_id         TEXT        NOT NULL,
  tenant_id         TEXT,
  interruption_type TEXT        NOT NULL
                    CHECK (interruption_type IN (
                      'route_override',
                      'job_pause',
                      'emergency_stop',
                      'stop_reorder',
                      'stop_skip_request',
                      'job_cancel_request'
                    )),
  reason            TEXT        NOT NULL,
  driver_lat        DOUBLE PRECISION,
  driver_lng        DOUBLE PRECISION,
  speed_at_event    REAL,
  approved_by       TEXT,                             -- dispatcher profile_id, null = self-approved
  approval_ts       TIMESTAMPTZ,
  resolution        TEXT
                    CHECK (resolution IN (
                      'approved','denied','auto_approved','pending'
                    )) DEFAULT 'pending',
  resolved_at       TIMESTAMPTZ,
  ts                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ril_job_id    ON route_interruption_log(job_id);
CREATE INDEX IF NOT EXISTS idx_ril_driver_id ON route_interruption_log(driver_id);
CREATE INDEX IF NOT EXISTS idx_ril_type      ON route_interruption_log(interruption_type);


-- ============================================================
-- RLS POLICIES
-- Enable RLS so drivers only see their own execution rows.
-- Control OS (service_role) sees everything.
-- ============================================================

ALTER TABLE job_execution_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_stops            ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_interruption_log ENABLE ROW LEVEL SECURITY;

-- Drivers: read own rows only (job_execution_state)
DROP POLICY IF EXISTS "driver_own_execution" ON job_execution_state;
CREATE POLICY "driver_own_execution" ON job_execution_state
  FOR ALL USING (auth.uid()::TEXT = driver_id);

-- Dispatchers / admins: read all (based on profiles.role)
DROP POLICY IF EXISTS "dispatcher_all_execution" ON job_execution_state;
CREATE POLICY "dispatcher_all_execution" ON job_execution_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('dispatcher','admin')
    )
  );

-- job_stops: read if driver owns the job
DROP POLICY IF EXISTS "driver_job_stops" ON job_stops;
CREATE POLICY "driver_job_stops" ON job_stops
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM job_execution_state jes
      WHERE jes.job_id = job_stops.job_id
      AND jes.driver_id = auth.uid()::TEXT
    )
  );

-- Dispatcher read all stops
DROP POLICY IF EXISTS "dispatcher_all_stops" ON job_stops;
CREATE POLICY "dispatcher_all_stops" ON job_stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('dispatcher','admin')
    )
  );

-- job_events_log + route_interruption_log: driver writes own, dispatcher reads all
DROP POLICY IF EXISTS "driver_own_events" ON job_events_log;
CREATE POLICY "driver_own_events" ON job_events_log
  FOR ALL USING (auth.uid()::TEXT = driver_id);

DROP POLICY IF EXISTS "dispatcher_all_events" ON job_events_log;
CREATE POLICY "dispatcher_all_events" ON job_events_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dispatcher','admin'))
  );

DROP POLICY IF EXISTS "driver_own_interruptions" ON route_interruption_log;
CREATE POLICY "driver_own_interruptions" ON route_interruption_log
  FOR ALL USING (auth.uid()::TEXT = driver_id);

DROP POLICY IF EXISTS "dispatcher_all_interruptions" ON route_interruption_log;
CREATE POLICY "dispatcher_all_interruptions" ON route_interruption_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dispatcher','admin'))
  );


-- ============================================================
-- REALTIME — enable publications for live streaming
-- ============================================================
-- Run this block if you need Realtime subscriptions on these tables:
-- ALTER PUBLICATION supabase_realtime ADD TABLE job_execution_state;
-- ALTER PUBLICATION supabase_realtime ADD TABLE job_stops;
-- ALTER PUBLICATION supabase_realtime ADD TABLE job_events_log;
-- ALTER PUBLICATION supabase_realtime ADD TABLE route_interruption_log;
-- (Uncomment above lines to enable — requires supabase_realtime publication to exist)

-- ============================================================
-- Done.
-- ============================================================
