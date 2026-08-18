# poker.quarterly.systems — Design Spec

**Date:** 2026-08-17
**Owner:** Charlie (drafts, builds, publishes on Mike's go) · **Approver:** Mike
**Status:** Approved in conversation 2026-08-17; this document is the written record.
**Board:** replaces the deferred "Poker Counter" scoped in `operations#25`; supersedes the README-scoreboard beat (beat 5) of the monthly routine.

---

## 1. What this is

The public home for K5M Shareholder Poker at `poker.quarterly.systems`: game ledgers, chip-race graphs, the CCG player cards, standings and trophies, and the RSVP front door for the next game.

**Audience and posture (Mike's framing):** the primary visitor is the community of existing players. The site sells the sizzle: how fun this is, who the characters are, what happened last time. The clear CTA on top of that is RSVP for the next game. Retention audience, acquisition CTA.

**Canonical-surface rule:** this site is canonical for all poker facts (standings, trophies, results). The wiki (`base.quarterly.systems`) gets a short page saying what Shareholder Poker is and linking here. Pointers, not copies. No poker standings ever live in two places.

## 2. Where it lives

- **Repo:** `Publicly-Traded-Person/shareholder-poker` (already public, already holds game issues and the scoreboard README). Site under `site/`.
- **Hosting:** Cloudflare Pages, `pages_build_output_dir = "site"`, **no build step** — the Summit-site pattern (`shareholder-summit-2026`). Cloudflare serves committed files; all generation happens at publish time on Charlie's machine.
- **DNS:** `poker.quarterly.systems` CNAME to the Pages project.
- **README:** shrinks to what-this-is + rules + a link to the site. The season scoreboard section is retired (see §6).

## 3. Privacy boundary (three tiers)

The rule: **the public repo never holds a person's contact information or their behavioral read.**

| Tier | Home | Holds | Never holds |
|---|---|---|---|
| 1 · Public repo | `shareholder-poker` git | ledgers, chip races, card PNGs, handles, names (cleared by Mike 7/15), finishes, dollar amounts, `games.json` | emails, tokens, opponent reads |
| 2 · D1 | `poker-rsvp-db` (Cloudflare) | `rsvps` (email, display name, game, timestamp), `roster` (email → handle/slug map) | — rows never enter git |
| 3 · Private | `kmikeym/munger` | raw PokerNow logs, opponent profiles (behavioral reads on named shareholders) | — does not feed the site at build time |

Details:

- `site/schema.sql` is committed (structure is documentation); rows are not. Follow the Summit repo's practice of annotating *why* in the schema file.
- Roster seeding runs via `wrangler d1 execute` from a **gitignored** local file. `.gitignore` carries the entry plus a README line explaining it, so nobody helpfully commits a CSV later.
- Reminder sends require exporting emails from D1. That export is a single command printing to stdout, run by Mike or Charlie on Mike's go; the list never transits a file in the repo.
- The cards are the public, dignity-ruled projection of munger's data. The profiles underneath stay in munger. No CI path connects the private repo to the public site.

## 4. Content model

### URL structure

```
/                       sizzle home (see §7)
/games/                 index, newest first, generated
/games/<YYYY-MM-DD>/    ledger + chip race + cards minted/changed that night
/cards/                 set gallery
/cards/<YYYY-MM>/       one set (e.g. 2026-07 "The Founder's Table")
/standings/             all-time results, trophies, rarity ladder — generated
/player/<slug>          RESERVED, not built in v1 (see §5)
```

### The spine: `site/data/games.json`

One public-safe file. Standings, the games index, and card stat boxes derive from it; nothing derived is hand-maintained. Shape:

```json
{
  "nextGame": { "date": "2026-09-08", "time": "19:00 PT" },
  "players": [
    { "slug": "chris-ganz",  "name": "Chris Ganz",  "aka": ["LEWD", "ccml415"] },
    { "slug": "webvee",      "name": "Gene",         "aka": ["webvee"] },
    { "slug": "kmikeym",     "name": "Mike",         "aka": ["kmikeym"] }
  ],
  "games": [
    {
      "date": "2026-08-11",
      "hands": 211, "startingStack": 5000, "buyIn": 50,
      "entries": 8, "pot": 400,
      "results": [
        { "slug": "thomas-dunlap", "handle": "spladow", "finish": 1,
          "payout": 280, "rebuys": 0, "trophies": ["hope-slayer"] }
      ]
    }
  ]
}
```

- `handle` records what the log actually said that night; `slug` is the stable identity. The Chris case (`LEWD` in Aug ledgers, `ccml415` in the July README) is the proof this split is needed **today**, not speculatively.
- Trophy state (Hope Coin holder, Slayer skull counts) is computed from the game stream, not stored as a mutable field.

### Player pages (deferred, made cheap)

`/player/<slug>` is reserved by the slug system. A player page is a filter over `games.json`; nothing gets harder by waiting. Decision on record: **slugs now, pages later** (Mike, 8/17).

## 5. RSVP (the one stateful corner)

**Flow (Mike's spec):** visitor enters email → logged to D1 (the reminder list) → public confirmed-list shows a display name.

- Display name resolution: if the email matches `roster`, show the handle; otherwise **prefill an editable display-name field with the email local-part**. The visitor can overwrite before submitting. This prevents publishing `firstname.lastname` (a real name) without consent, with zero extra steps for regulars.
- Page shows the confirmed count + names for the next game. Public commitment is the seat-filling mechanic (the March pledge poll precedent).
- Implementation: one Pages Function `functions/api/rsvp.js` (POST = insert, GET = public list of display names + count only — **the GET never returns emails**). Copy the Summit `functions/api/review.js` pattern.
- Modest guards: server-side email syntax check, one RSVP per email per game (upsert), no third-party anything.
- Game date the form points at comes from `games.json` (`nextGame` field) so the form can't drift from reality.

## 6. Publish pipeline + automation ratchet

### v1: one command

`bun publish-game.ts <log.csv> --date <YYYY-MM-DD>` lives in `munger` (it needs the parser), writes into the local `shareholder-poker` checkout:

1. Parse log, compute public stats (`src/parse`, `src/stats` exist).
2. Resolve every handle to a slug; **halt on unknown handles** — never invent a player.
3. **Chip-conservation assertion:** final chips ÷ starting stack must equal entry count, else refuse to publish. (This check caught the Aug pot at $400 when join lines implied $350; July's ledger still carries an unresolved 8-vs-9 discrepancy from lacking it.)
4. Append the game to `games.json`.
5. Emit chip-race HTML into `site/games/<date>/`.
6. Regenerate `/standings/` and `/games/` index as committed HTML.

Charlie reviews the diff, adds the ledger narrative, commits. **Deploy = push, but only on Mike's explicit go** — publishing to a public surface stays gated regardless of tooling maturity.

### What stays manual in v1

Ledger narrative, card copy (dignity rule = judgment, not automated), card renders (mechanical but not first).

### The ratchet (each pass removes a named manual step)

| Pass | Removes |
|---|---|
| 1 (v1) | hand-writing standings, index, chip-race wiring, README scoreboard |
| 2 | hand-editing card HTML + manual Playwright screenshots (`render-cards.ts` reads `games.json`) |
| 3 | handle-reconcile guesswork (interactive roster prompt; new player auto-scaffolds a mint stub) |
| 4 | everything but the CSV export (drop log on the game issue, CI runs the rest — still gated on Mike's go) |

### Beat-5 replacement

`operations#25` beat 5 changes from "commit to README.md" to "site publish for game N is live." Absence remains detectable (no `/games/<date>/` page = beat didn't happen). The README's season table is retired with a pointer, so there is exactly one scoreboard.

## 7. Visual direction

Reference: **card shop, not dashboard.** The site must not read as a fintech admin panel.

- **Palette = the rarity ladder** (locked 7/15): foil gold, sapphire, copper, pewter as the accent system across section rules, standings rows, link states. The site's visual language *is* the cards'.
- **Lime quarantine:** the one primary CTA (RSVP) is lime per brand rule, isolated on a dark neutral band with no rarity metals adjacent.
- **Sections alternate light/dark** per brand rule.
- **Type:** heavy condensed display for names/finishes; monospace for all stats (mono makes the fixed 6-slot stat schema align as a set).
- **Reuse shipped effects:** pack-rip hero, foil shimmer on the champion card (from `munger/ccg/founders-table-*.html`), both behind `prefers-reduced-motion` guards.
- **Mobile first** (Discord-link-on-a-phone is the entry path). Home-page chip race is an annotated story (eliminations, lead changes), not the dense 7-line chart; the dense chart lives on the game page. Consult the dataviz skill before building the chart.
- **Home page order:** next game + RSVP → champion's foil → last game's chip race → 1-2 Legends stories → Hope Coin → RSVP again.

### Copy checklist (pre-publish, every page)

- No em dashes in site copy (brand rule).
- No "experiment" (brand rule).
- Dignity rule on every card line and every player mention.
- Site nouns: market/update/offers per IR voice rules where market talk appears.

## 8. Testing

- TDD for the pure core: slug resolution, standings computation, chip-conservation assertion, trophy-state derivation. Fixtures = the real July and August logs (July's known 8-vs-9 discrepancy becomes a test case for the assertion's failure path).
- RSVP function: local test against wrangler dev with a scratch D1; verify GET never leaks emails.
- Pattern precedent: `munger/digest.test.ts`.

## 9. Rollout order

1. Site scaffold + `games.json` seeded with July + August games (backfilled from the two ledgers).
2. `/games/`, `/standings/`, both game pages, chip races (Aug one exists; July's regenerates from its log).
3. Home page with RSVP pointing at the **September 8** game.
4. `/cards/2026-07/` from the shipped Pack 1 assets; `/cards/2026-08/` when the August set is built.
5. D1 + RSVP function + roster seed.
6. DNS live, README slimmed, wiki pointer page, board hygiene: close `shareholder-poker#5`/`#6`, file the site + Sept-game issues, update `operations#25` beat 5.

## 10. Out of scope

- Player pages (reserved via slugs; revisit after 2+ more games of data).
- Any authentication, accounts, or payments.
- Automated reminder *sending* (export stays a human-run command).
- Anything reading from munger at site build time.

## 11. Known small fixes bundled in

- Repo description says "8pm Pacific"; README and ledgers say 7pm PT. Fix description to 7pm.
- README's July table and the Aug ledger disagree on Chris's handle; the `aka` list resolves it, and the July set page should note the handle change once.
