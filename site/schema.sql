-- poker-rsvp-db schema. STRUCTURE ONLY.
-- Rows in these tables contain email addresses and NEVER enter git:
-- the database lives in D1, seeds run from gitignored local files, and
-- exports go to stdout, not to files in this repo. That separation is
-- load-bearing, not incidental (spec section 3).

CREATE TABLE IF NOT EXISTS rsvps (
  email        TEXT NOT NULL,
  display_name TEXT NOT NULL,
  game         TEXT NOT NULL,           -- YYYY-MM-DD
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, game)             -- one RSVP per email per game (upsert)
);

-- Known-player mapping so regulars get their handle shown automatically.
-- Seeded manually via: wrangler d1 execute poker-rsvp-db --file <gitignored-seed.sql>
CREATE TABLE IF NOT EXISTS roster (
  email  TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  slug   TEXT NOT NULL
);
