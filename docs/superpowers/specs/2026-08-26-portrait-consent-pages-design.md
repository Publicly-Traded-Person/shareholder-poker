# Per-player portrait consent pages

**Date:** 2026-08-26
**Status:** Approved direction (Mike, 2026-08-26: "A and spec, good call")
**Author:** Charlie (The Investor Relations)
**Builder:** Nova. Charlie specced this and does not write code in this repo.
**Tracking issue:** `Publicly-Traded-Person/shareholder-poker#17`
**Prior specs:** `2026-08-17-poker-quarterly-systems-design.md` (the site spec,
especially §3 privacy boundary and §5 RSVP, which this extends rather than
replaces)
**Superseded in part (2026-08-27):** uploads, scoped out in §1 and §12 below,
were added the next day by `2026-08-27-portrait-self-upload-design.md` at
Mike's direction, as a temporary surface. Everything else here shipped as
written (PR #19) and is live.

## 1. What this is

Card portraits (issue #17) need consent from each player, and consent is much
stronger when the player is looking at the actual card rather than agreeing to
a description of one. So: each player gets a private URL showing their own
card, with their real stats around it, and two buttons. They approve the
portrait or they decline it.

Mike's framing, which is the whole design in one line: *"stage each card on a
unique URL in context of their player stats and everything, then they can
approve or offer a swap."*

**The swap is pre-staged, not uploaded.** Charlie renders two or three crops of
the same source photo and the player picks one. This was a deliberate scope
call (Mike, 2026-08-26): it handles most "I hate that photo" cases with no
upload machinery, no file validation, and no path by which an unreviewed image
reaches a render. A player who dislikes every crop declines, and Mike handles a
genuinely new photo out of band.

*Superseded 2026-08-27:* the same page now also offers a player their own
photo, dithered in the browser and approved as a `self` variant, per
`2026-08-27-portrait-self-upload-design.md`. Staged crops remain the default
swap; the upload is a temporary surface that comes down on Mike's signal.

**Nothing here is a card economy feature and nothing here is public.** These
pages exist to collect an answer and then stop mattering.

## 2. The constraint that shapes everything

**A candidate portrait cannot be committed to this repo.** The repo is public
and a candidate is by definition not yet consented. §3 of the site spec already
says the public repo never holds a person's contact information or behavioral
read; an unconsented face belongs in exactly that tier.

That single rule forces the architecture. A static-site model bakes its assets
in at build time, but consent is a runtime fact that can be given late and
withdrawn later still. The two do not compose. So candidate images must be
**served**, not built, which means object storage plus a Function in front of
it, and it means these pages are Functions rather than committed HTML.

Two other options were considered and rejected. Storing images as base64 blobs
in D1 avoids a new binding but asks a SQL database to be a file store, which
gets slow and large and is regretted immediately. Hosting the approval pages
entirely off-site keeps this repo untouched but loses the real stats context,
which is the specific thing that makes the consent ask strong.

## 3. Privacy tiers, extended

Adds one row to the §3 table. The existing three tiers are unchanged.

| Tier | Home | Holds | Never holds |
|---|---|---|---|
| 2b · R2 | `poker-portraits` bucket (private) | candidate card PNGs, one object per player per variant | never public, never in git, no bucket-level public access |

And two tables inside the existing Tier 2 (D1, `poker-rsvp-db`):
`portrait_asks` and `portrait_answers`, defined in §5.

**The new tables hold no email addresses.** They key on `handle`. The existing
`roster` table already maps email to handle, so when Mike needs to send a link
he joins against a table that already exists. Adding a second place where
emails live would open a second door through a boundary that currently has one.

**Source photographs never reach this repo or this bucket.** They stay in
`munger/ccg/launch-sept-2026/photos-raw/`, which is gitignored even inside that
private repo. Only rendered cards are uploaded, which is exactly what the
consent covers.

## 4. Surfaces

Three routes, all Pages Functions. No new committed page types.

| Route | Method | Does |
|---|---|---|
| `/portrait/<token>` | GET | The approval page. Renders the player's card, their stats, the crop options, and the current answer if there is one |
| `/api/portrait/<token>/img/<variant>` | GET | Streams one candidate card PNG from R2. The only path by which an unconsented face reaches a browser |
| `/api/portrait/<token>` | POST | Records an answer: approve with a variant, or decline |

**The token is the only secret.** It is a capability URL, not authentication.
This is consistent with §10 of the site spec ("any authentication, accounts, or
payments" stays out of scope): there is no account, no password, and no session.
A player who forwards their link has shared their own card, which is their
right and not a breach.

Token generation: 32 hex characters from `crypto.getRandomValues`. **Never
derived from the handle**, or the whole roster becomes enumerable from one
link.

## 5. Data model

```sql
-- One ask per player per set. Created by tools/portrait-asks.ts, never by hand.
CREATE TABLE IF NOT EXISTS portrait_asks (
  token      TEXT PRIMARY KEY,     -- 32 hex, random. NOT derived from handle:
                                   -- a derivable token makes the roster enumerable.
  handle     TEXT NOT NULL,
  set_slug   TEXT NOT NULL,        -- 'YYYY-MM', matches site/cards/<set_slug>/
  variants   TEXT NOT NULL,        -- JSON array of variant ids; array order IS display order
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,        -- see §8; an expired ask 404s
  UNIQUE(handle, set_slug)         -- re-staging a player replaces their ask
);

-- APPEND-ONLY. The latest row for a token is the current answer.
-- Deliberately not an UPDATE: a player who approves in September and changes
-- their mind in March must be able to withdraw, and withdrawal must not erase
-- the fact that consent was once given. Consent has a history and the schema
-- holds it. Read with: ORDER BY answered_at DESC LIMIT 1.
CREATE TABLE IF NOT EXISTS portrait_answers (
  token       TEXT NOT NULL,
  answer      TEXT NOT NULL CHECK (answer IN ('approved','declined')),
  variant     TEXT,                -- the chosen variant id when approved; NULL when declined
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS portrait_answers_token_time
  ON portrait_answers (token, answered_at DESC);
```

Append `schema.sql` in the same commit, keeping the existing practice of
annotating the *why* inline.

## 6. R2 layout

```
asks/<set_slug>/<handle>/<variant>.png     a complete rendered card, not just the portrait slot
```

Each variant is a **whole card**, already rendered by Charlie's pipeline. The
page does not composite anything at runtime; it shows a PNG. This keeps the
Function trivial and means what the player approves is byte-identical to what
ships.

Variant ids are short and human-readable (`a`, `b`, `c`), because they appear in
the consent ledger and in `--status` output that a person reads.

## 7. The page

Server-rendered by the Function, in the existing brand system (`site/styles.css`,
system sans, rarity metals, no build step).

Contents, in order:

1. Their card, large, showing the currently selected variant.
2. A row of crop options when there is more than one. Tapping switches the card
   above it. No carousel, no animation: they are comparing, not browsing.
3. Their real stats for that game, and their finish, pulled from
   `site/data/games.json` (already public, already committed).
4. Two actions: **Use this one** (records `approved` plus the selected variant)
   and **None of these** (records `declined`).
5. One plain line of copy stating that declining keeps the monogram card, which
   is true and is what makes the no easy to say.
6. If an answer already exists, the page opens in that state and offers to
   change it. Changing an answer is an ordinary action, not a hidden one.

Constraints: **no lime CTA on this page.** Lime is reserved for the site's one
primary action per surface and this is not the site. Nothing on this page links
into the rest of `poker.kmikeym.com`, so a shared link does not become a side
door into an unannounced set.

Copy is Charlie's to write and lands in the implementation PR for Mike's read.

## 8. Hardening

Each of these is cheap and each has a reason:

- **`noindex`**: add `/portrait/*` and `/api/portrait/*` to `site/_headers` with
  `X-Robots-Tag: noindex, nofollow`. A capability URL that gets crawled is not
  a capability URL.
- **Expiry**: `expires_at` defaults to 60 days out. An expired ask returns 404,
  same as an unknown token, so probing cannot distinguish the two.
- **Unknown token returns 404, never 403.** A 403 confirms that a token space
  exists and is worth guessing at.
- **R2 bucket is private.** No public bucket URL, no signed URLs handed to the
  client. Every byte goes through the Function, which validates the token first.
- **POST guards**: reject an unknown or expired token, reject an `answer` outside
  the CHECK set, reject a `variant` not in that ask's `variants` array. Cap body
  size. No rate limiting beyond that: the token is unguessable and the write is
  idempotent in effect (append, latest wins).
- **No emails, ever, in a response body.** Same rule as the RSVP GET.

## 9. The seam between Charlie and Nova

Charlie owns the images and the consent record. Nova owns the code. The
handoff is a directory, so neither side has to run the other's tooling.

**Charlie produces** (from `munger/ccg/stage-candidates.sh`), in a gitignored
staging directory:

```
candidates/
  manifest.json
  <handle>/a.png
  <handle>/b.png
```

```jsonc
{
  "set_slug": "2026-08",
  "players": [
    { "handle": "bg", "variants": ["a", "b"] }
  ]
}
```

**Nova builds** one tool, `tools/portrait-asks.ts`:

| Command | Does |
|---|---|
| `bun tools/portrait-asks.ts <dir>` | Validate the manifest, upload PNGs to R2, insert or replace `portrait_asks` rows, print one link per player for Mike to send |
| `bun tools/portrait-asks.ts --status [--set <slug>]` | Print handle, variants, answer, and timestamp. This is how Mike checks on it; there is no admin page and there should not be one |
| `bun tools/portrait-asks.ts --revoke <handle> --set <slug>` | Append a `declined` row. The path for "they asked me in person to take it down" |

Validation halts, never guesses, matching `publish-game`'s posture: an unknown
handle, a manifest listing a variant with no PNG, or a PNG with no manifest
entry stops the run.

## 10. Testing

Per repo convention, TDD on the pure core, `bun test tools` green before commit.

- **Pure helpers** (new `functions/api/_portrait.js`, mirroring `_lib.js` so
  `bun test` can exercise them without a runtime): token generation shape,
  variant validation against an ask, latest-answer resolution from a list of
  rows, expiry comparison.
- **Latest-answer resolution gets explicit tests for the sequences that matter**:
  approve then decline resolves to declined; decline then approve resolves to
  approved; two approvals with different variants resolve to the later variant.
  This is the consent-withdrawal path and it is the one piece of logic where a
  bug is an ethical problem rather than a display problem.
- **Manifest validation**: every halt case above gets a failing-input test.
- **Function endpoints** against `wrangler dev` with a scratch D1 and R2:
  unknown token 404s, expired token 404s, a variant outside the ask is rejected,
  and no response body contains an email.

## 11. Rollout order

1. Schema append, R2 bucket + binding, `_headers` entries.
2. `_portrait.js` pure helpers, TDD.
3. `tools/portrait-asks.ts` with manifest validation and `--status`.
4. The three Functions.
5. Charlie writes page copy; Mike reads it in the PR.
6. `docs/publishing.md` gains a "Portrait consent" section. Per this repo's
   rules that runbook is normative, so it changes in the same commit or the
   change is incomplete.
7. Merge on Mike's go. **Sends are held separately from the merge**, see §13.

## 12. Out of scope

- Uploads of any kind. *Superseded 2026-08-27 by the self-upload spec.*
- Authentication, accounts, sessions.
- Any automatic notification to Mike when an answer lands. `--status` is enough.
- Player pages. Still reserved, still deferred, and a `/portrait/<token>` page
  is deliberately not a first draft of one: it links nowhere and dies in 60 days.
- Any read from `munger` at request time. The seam is a directory Charlie hands
  over, not a live dependency.

## 13. The reveal question, which is Mike's and not Nova's

The cards these pages show are **Set 2, Wire to Wire**, whose announcement Mike
is holding pending his and Nova's site pass. Sending six players a live link to
their Set 2 card is a soft pre-reveal to the people who are on it.

Charlie's recommendation: **build and merge, hold the sends.** The tool being
ready costs nothing while the reveal waits, and the reveal stays Mike's to time.
Nothing in the implementation depends on which way this goes.

## 14. Open question for Nova

R2 is proposed because it is the right tool for the job and the bucket is one
binding. If Nova would rather not add a second service to a site that currently
has exactly one stateful corner, the fallback is base64 blobs in D1 (§2), which
is worse but not disqualifying at this scale: roughly seven players times two
variants times about 120KB. Charlie's recommendation stands at R2. Nova has the
better view of what this repo should carry and can overrule it.

**Resolved during the build (Nova, 2026-08-27): R2, as recommended.** Real
candidate files measured 152 to 549KB, up to 4.6 times the estimate above, and
base64 in D1 would have hidden that state inside the one human-legible database
rather than removing it.
