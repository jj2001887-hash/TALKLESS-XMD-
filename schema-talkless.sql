-- TALKLESS ULTRA — Neon pairing schema
-- Apply once in the Neon SQL editor (or via psql).
-- Talkless uses its own tables so it can share the same Neon DB as other bots.

CREATE TABLE IF NOT EXISTS talkless_pairing_requests (
  id           SERIAL PRIMARY KEY,
  phone        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending -> processing -> code_generated -> connected / failed / expired
  pairing_code TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT now() + interval '5 minutes',
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talkless_sessions (
  id         TEXT PRIMARY KEY,
  phone      TEXT,
  status     TEXT DEFAULT 'disconnected',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talkless_premium_keys (
  id         SERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  status     TEXT NOT NULL DEFAULT 'unused',   -- unused / used
  used_phone TEXT,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talkless_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
