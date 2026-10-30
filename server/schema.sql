-- Wanted's vote server: one D1 database.
-- wrangler d1 execute wanted --remote --file=schema.sql

-- One row per vote: one vote per mod per install.
CREATE TABLE IF NOT EXISTS votes (
  mod      TEXT NOT NULL,      -- normalised mod id: create, applied_energistics_2
  install  TEXT NOT NULL,      -- random id the app made on first start, not tied to a person
  created  INTEGER NOT NULL,   -- unix seconds
  PRIMARY KEY (mod, install)
);

-- Running totals, so the board is one small read.
CREATE TABLE IF NOT EXISTS tallies (
  mod      TEXT PRIMARY KEY,
  name     TEXT NOT NULL,      -- the name the first voter's app sent, trimmed to 48 characters
  votes    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tallies_by_votes ON tallies (votes DESC);

-- Per-IP rate limit. The address is stored only as a salted hash, per hour.
CREATE TABLE IF NOT EXISTS rate (
  ip       TEXT NOT NULL,
  hour     INTEGER NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, hour)
);
