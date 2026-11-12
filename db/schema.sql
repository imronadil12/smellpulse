-- SmellPulse MVP — PostgreSQL Production Schema
-- Compatible with Neon Serverless Postgres, Supabase, and standard PostgreSQL 15+

CREATE TABLE IF NOT EXISTS anonymous_clients (
  id UUID PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS observations (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES anonymous_clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('odor', 'no_odor')),
  intensity SMALLINT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ NULL,
  withdrawn_at TIMESTAMPTZ NULL,
  hidden_at TIMESTAMPTZ NULL,
  hidden_reason TEXT NULL,
  CONSTRAINT observations_kind_intensity_check CHECK (
    (kind = 'odor' AND intensity BETWEEN 1 AND 5) OR
    (kind = 'no_odor' AND intensity IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_observations_submitted_at
  ON observations (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_observations_client_submitted
  ON observations (client_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY,
  observation_id UUID NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('hide', 'restore')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO office_settings (key, value)
VALUES ('safety_contact', 'Facilities Desk · Ext. 4400 / (555) 019-9400')
ON CONFLICT (key) DO NOTHING;
