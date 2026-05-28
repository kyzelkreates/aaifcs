-- ============================================================
-- AP3X — Federation Layer Schema (Run 6)
-- Adds pairing_codes table + extends fleet_nodes for federation
-- Safe to run multiple times (IF NOT EXISTS / idempotent)
-- ============================================================

-- ─── pairing_codes ────────────────────────────────────────────
-- Stores active, pending, and expired pairing codes.
-- Fleet Control OS upserts here; realtime notifies Driver PWA.
CREATE TABLE IF NOT EXISTS public.pairing_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT NOT NULL UNIQUE,              -- APEX-XXXXXXXX-XXXX-FC
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | expired | failed | revoked
  tenant_id   TEXT,                              -- populated on registration
  fleet_id    TEXT,                              -- populated on registration
  attempts    INTEGER NOT NULL DEFAULT 0,        -- validation attempt count
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB                              -- fingerprint, company, version
);

-- ─── Extend fleet_nodes for federation identity ───────────────
ALTER TABLE public.fleet_nodes
  ADD COLUMN IF NOT EXISTS tenant_id        TEXT,
  ADD COLUMN IF NOT EXISTS fleet_entity_id  TEXT,
  ADD COLUMN IF NOT EXISTS pairing_token    TEXT,
  ADD COLUMN IF NOT EXISTS pairing_status   TEXT DEFAULT 'unregistered',
  ADD COLUMN IF NOT EXISTS company_name     TEXT,
  ADD COLUMN IF NOT EXISTS connected_since  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version          TEXT DEFAULT '1.0';

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pairing_codes_code       ON public.pairing_codes(code);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_status     ON public.pairing_codes(status);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON public.pairing_codes(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_nodes_tenant_id    ON public.fleet_nodes(tenant_id);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;

-- Fleet OS can read/write its own pairing codes (public open for MVP)
CREATE POLICY IF NOT EXISTS "Public read pairing_codes"
  ON public.pairing_codes FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Public write pairing_codes"
  ON public.pairing_codes FOR ALL USING (true);

-- ─── Realtime ─────────────────────────────────────────────────
-- fleet_nodes and dashboard_events already added in schema v1
-- Add pairing_codes to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pairing_codes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pairing_codes;
  END IF;
END $$;

-- ─── Auto-expire function ─────────────────────────────────────
-- Marks codes as expired when their expires_at passes
CREATE OR REPLACE FUNCTION expire_pairing_codes()
RETURNS void AS $$
BEGIN
  UPDATE public.pairing_codes
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
