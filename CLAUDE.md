# CLAUDE.md

## Agent Identity: Nova
You are **Nova-shareholder-poker**, one instance of the distributed dev agent.
Read `/Users/kmikeym/Agenting/Nova/CLAUDE.md` and `/Users/kmikeym/Agenting/Nova/SOUL.md` first, every session.
Check `/Users/kmikeym/Agenting/Nova/memory/` for cross-project engineering lessons.
Local scratch/session state lives in this repo's own gitignored `.nova/` (create if absent).

## Who works here (this shapes everything below)

**Nova writes the code. Charlie maintains the site** — reviews diffs and runs
the monthly post-game publish without Nova in the loop. Every line of code and
every process step must be legible to someone who did not write it and touches
it once a month. When in doubt, over-explain.

### Comment and documentation rules (Mike's call, 2026-08-18)

This repo deliberately overrides Nova's default lean-comment style:

- **Every file opens with a header comment**: what it is, where it sits in the
  publish flow, and how to run it (for tools) or where it is served (for site
  files and functions).
- **Every exported function gets a comment**: what it takes, what it returns,
  and what it throws — plus the *why* behind any check or invariant (chip
  conservation, slug halts, the email boundary). Assume the reader is Charlie
  at 10pm after a poker game, not the author.
- **Every "never do X" carries its reason inline** where the temptation will
  occur (e.g. the `.gitignore` privacy notes, the schema.sql annotations —
  follow that existing pattern).
- **Process lives in `docs/publishing.md`** and it is normative: if the code's
  behavior changes, that runbook changes in the same commit or the change is
  incomplete.

## What this repo is

The K5M Shareholder Poker site, **live at https://poker.kmikeym.com** —
static committed HTML under `site/` on Cloudflare Pages (NO build step:
`pages_build_output_dir = "site"`), generators and tests under `tools/` (Bun +
TypeScript), one stateful corner at `functions/api/rsvp.js` (Pages Function +
D1 `poker-rsvp-db`). Spec: `docs/superpowers/specs/2026-08-17-poker-quarterly-systems-design.md`.

**Every push to `main` deploys the live site.** Work on a branch, PR to
`main`, merge on Mike's go for anything visitor-facing.

## Commands

```bash
bun test tools          # the suite (58 tests at ship). Green before any commit.
bun tools/render.ts     # regenerate site/standings/ + site/games/ from games.json
bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json
bun tools/chip-race.ts <log.csv> --date YYYY-MM-DD --start 5000 --out <file>
python3 -m http.server -d site   # local preview
```

## Invariants (each one is load-bearing; the code enforces most of them)

- **Privacy tiers (spec §3):** emails, RSVP/roster rows, and raw PokerNow logs
  NEVER enter git. Logs are runtime inputs read from outside the repo;
  committed fixtures are synthetic (invented players only). The RSVP GET never
  returns an email.
- **Never invent a player or a number.** Unknown handles halt `publish-game`
  (add to `aka` in `games.json`, never guess). Chip conservation, dense
  finishes, and payouts-sum-to-pot are refuse-to-publish checks: fix the
  input, never the check.
- **Generated pages are never hand-edited.** `site/standings/index.html` and
  `site/games/index.html` come from `bun tools/render.ts`; the drift check
  (`bun tools/render.ts && git diff --exit-code` on those files) must stay
  clean.
- **`site/data/games.json` stays in canonical `JSON.stringify(data, null, 2)`
  form** so a published game appends as a small diff Charlie can actually read.
- **Copy rules:** no em dashes in `site/` copy, the word "experiment" never
  appears, dignity rule on every player mention, exactly one lime CTA per page
  (RSVP) on a dark band. Names appear alongside handles.
- The RSVP form's game date comes from `games.json` (`nextGame`) at runtime;
  there is no date constant to update in `site/rsvp.js`.

## The monthly publish (Charlie's job — full runbook in docs/publishing.md)

Export log → write `results.json` → `bun tools/publish-game.ts` → write the
narrative page → update `nextGame` in `games.json` → review the whole diff →
**Mike's explicit go** → merge to `main` (deploys) → board hygiene.

## Known open items (as of 2026-08-18)

- April + June 2026 and the 2020 season are not yet in `games.json` (needs
  Mike's payout/rebuy records). The standings page says the record starts
  July 2026; that qualifier is hardcoded in `tools/render.ts` and must be
  updated (or derived from data) when backfilling.
- Spec gaps parked at ship: trophies + rarity ladder on `/standings/`
  (spec §4); rarity accent classes defined but barely used (§7).
