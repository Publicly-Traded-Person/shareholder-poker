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

-- Portrait consent (spec docs/superpowers/specs/2026-08-26-portrait-consent-pages-design.md).
-- One ask per player per set. Created by tools/portrait-asks.ts, never by hand.
CREATE TABLE IF NOT EXISTS portrait_asks (
  token      TEXT PRIMARY KEY,     -- 32 hex, random. NOT derived from handle:
                                   -- a derivable token makes the roster enumerable.
  handle     TEXT NOT NULL,        -- keys on handle, never email: roster already
                                   -- maps email to handle; a second email home
                                   -- would be a second door through the boundary.
  set_slug   TEXT NOT NULL,        -- 'YYYY-MM', matches site/cards/<set_slug>/
  variants   TEXT NOT NULL,        -- JSON array of variant ids; array order IS display order
  metal      TEXT,                 -- rarity metal for this set's card: foil |
                                   -- sapphire | copper | pewter. Read by the
                                   -- consent page to duotone a self-uploaded
                                   -- panel; written by portrait-asks.ts, never
                                   -- by hand. Nullable because asks staged
                                   -- before 2026-08-27 predate it; the runbook
                                   -- carries the one-time ALTER for deployed
                                   -- databases (IF NOT EXISTS cannot add it).
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,        -- 60 days out; an expired ask 404s, same as unknown
  UNIQUE(handle, set_slug)         -- re-staging a player replaces their ask (new token,
                                   -- so a previously shared link goes dead)
);

-- APPEND-ONLY. The latest row for a token is the current answer.
-- Deliberately not an UPDATE: a player who approves in September and changes
-- their mind in March must be able to withdraw, and withdrawal must not erase
-- the fact that consent was once given. Consent has a history and the schema
-- holds it. Read with: ORDER BY rowid DESC LIMIT 1 (append order). Never
-- order by answered_at: the ledger has two writers on two clocks, and a
-- skewed timestamp must not let an old approval outrank a fresh withdrawal.
CREATE TABLE IF NOT EXISTS portrait_answers (
  token       TEXT NOT NULL,
  answer      TEXT NOT NULL CHECK (answer IN ('approved','declined')),
  variant     TEXT,                -- chosen variant id when approved; NULL when declined
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Serves the per-token lookup (WHERE token = ?) that both live readers use to
-- fetch a token's answer rows before resolving the current one by rowid. The
-- answered_at component orders results for that lookup only; it is never
-- relied on to pick the current answer (see the read note above).
CREATE INDEX IF NOT EXISTS portrait_answers_token_time
  ON portrait_answers (token, answered_at DESC);
