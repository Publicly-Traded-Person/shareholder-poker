# poker.kmikeym.com Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public Shareholder Poker site (ledgers, chip races, cards, standings, RSVP) at poker.kmikeym.com, with a one-command publish pipeline for future games.

**Architecture:** Static site under `site/` served by Cloudflare Pages with no build step; all derived pages (standings, games index) are committed HTML regenerated locally from `site/data/games.json` by tools under `tools/`. One Pages Function (`functions/api/rsvp.js`) + one D1 database is the only stateful corner. Private data (emails, raw logs, opponent reads) never enters the repo.

**Tech Stack:** Plain HTML/CSS/JS, Bun + TypeScript for tools and tests (`bun test`), Cloudflare Pages + Pages Functions + D1, wrangler.

**Spec:** `docs/superpowers/specs/2026-08-17-poker-quarterly-systems-design.md`

**Acceptance:** suite — operator reads diffs; committed test suite + per-task review is the verification.

**Deviation from spec (approved rationale):** spec §6 places `publish-game.ts` in the private munger repo. This plan places it and its libraries in `tools/` in THIS repo: the parsing logic is public-safe, and spec §3's own rule ("no CI path connects the private repo to the public site") is better served by the public site owning its generators. Raw PokerNow logs remain runtime inputs read from outside the repo and are NEVER committed; committed test fixtures are synthetic.

## Global Constraints

- No em dashes in any `site/` copy (brand rule). Use comma/period/colon/parens.
- The word "experiment" never appears in site copy (brand rule).
- Dignity rule: every player mention reads as the positive aspect of their style; truth-based, never mean.
- Exactly one lime primary CTA per page (the RSVP button); all other buttons white/black. Lime is quarantined on a dark neutral band with no rarity-metal color adjacent.
- Page sections alternate light and dark backgrounds; never stack two of the same tone.
- No build step on Cloudflare: `pages_build_output_dir = "site"`; every served file is committed.
- Emails, RSVP rows, roster rows, and raw PokerNow logs never enter git. The RSVP GET endpoint never returns email addresses.
- Real player names are cleared (Mike 7/15) and appear alongside handles.
- Tools run with Bun; tests use `bun test`; TypeScript for `tools/`, plain JS for `functions/` (Pages Functions runtime).
- Site must be responsive; mobile (Discord-link-on-a-phone) is the primary target.
- Repo working branch: `poker-site` (already exists; executors do not create branches).

---

### Task 1: Site scaffold and theme

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `wrangler.toml`
- Create: `site/_headers`
- Create: `site/404.html`
- Create: `site/styles.css`

**Interfaces:**
- Produces: CSS custom properties `--foil`, `--sapphire`, `--copper`, `--pewter`, `--lime`, `--ink`, `--paper`, `--band-dark`; section classes `band-light`, `band-dark`, `band-cta`; components `btn-primary` (lime), `stat` (monospace stat text), `card-frame`, table styling under `.ledger`; type stack: display font `"Arial Narrow", "Helvetica Neue Condensed", sans-serif-condensed, sans-serif` via class `display`, mono stack `"SF Mono", Menlo, Consolas, monospace` via class `stat`.

- [ ] **Step 1: Write `wrangler.toml`**

```toml
#:schema node_modules/wrangler/config-schema.json
# Cloudflare Pages config for poker.kmikeym.com.
# The site is static committed HTML served from site/ with NO build step;
# generation happens locally via tools/ (see docs/publishing.md).
name = "shareholder-poker"
compatibility_date = "2026-08-17"
pages_build_output_dir = "site"
```

(The D1 binding is added by the RSVP task; do not add it here.)

- [ ] **Step 2: Write `site/_headers`**

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

- [ ] **Step 3: Write `site/404.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Busted out | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body class="band-dark" style="min-height:100vh; display:grid; place-items:center; text-align:center;">
<main>
  <h1 class="display">That hand does not exist.</h1>
  <p>The page you wanted busted out. Rebuy at the <a href="/">home table</a>.</p>
</main>
</body>
</html>
```

- [ ] **Step 4: Write `site/styles.css`**

The full theme. Rarity metals as the accent system, light/dark band alternation, lime quarantined to `band-cta`, condensed display type for names, mono for stats:

```css
/* poker.kmikeym.com theme.
   Palette = the card rarity ladder (locked 2026-07-15):
   foil gold / sapphire / copper / pewter. Lime is reserved for the ONE
   primary CTA per page and never sits adjacent to a rarity metal. */
:root {
  --foil: #c9a227;
  --sapphire: #2b5d9e;
  --copper: #b06c3f;
  --pewter: #8a8d91;
  --lime: #c6f43a;
  --ink: #16181c;
  --paper: #f7f4ec;
  --band-dark: #1c1f26;
  --band-dark-ink: #eceae2;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.55;
}
img { max-width: 100%; height: auto; }
a { color: var(--sapphire); }

/* Alternating section bands. Author pages so no two same-tone bands touch. */
.band-light { background: var(--paper); color: var(--ink); padding: 3rem 1.25rem; }
.band-dark  { background: var(--band-dark); color: var(--band-dark-ink); padding: 3rem 1.25rem; }
.band-dark a { color: #9dc3f0; }
.band-cta   { background: #101216; color: var(--band-dark-ink); padding: 3rem 1.25rem; text-align: center; }
.band-inner { max-width: 720px; margin: 0 auto; }

/* Type */
.display {
  font-family: "Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", sans-serif;
  font-weight: 800;
  letter-spacing: .01em;
  text-transform: uppercase;
}
h1.display { font-size: clamp(1.9rem, 6vw, 3.2rem); margin: 0 0 .4em; }
h2.display { font-size: clamp(1.3rem, 4vw, 1.9rem); margin: 0 0 .6em; }
.stat, .ledger td.num {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: .92em;
}

/* The one primary CTA. Lime, and only ever this. */
.btn-primary {
  display: inline-block;
  background: var(--lime);
  color: #101216;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: .9em 2.2em;
  border-radius: 6px;
  border: none;
  text-decoration: none;
  font-size: 1.05rem;
  cursor: pointer;
}
.btn-secondary {
  display: inline-block;
  background: transparent;
  color: inherit;
  border: 2px solid currentColor;
  padding: .7em 1.6em;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
}

/* Rarity accents */
.rarity-foil     { border-color: var(--foil);     color: var(--foil); }
.rarity-sapphire { border-color: var(--sapphire); color: var(--sapphire); }
.rarity-copper   { border-color: var(--copper);   color: var(--copper); }
.rarity-pewter   { border-color: var(--pewter);   color: var(--pewter); }
.rule-foil { border: 0; border-top: 3px solid var(--foil); margin: 0; }

/* Ledger tables */
.ledger { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: .95em; }
.ledger th, .ledger td { padding: .5em .6em; text-align: left; border-bottom: 1px solid rgba(138,141,145,.4); }
.ledger th { text-transform: uppercase; font-size: .78em; letter-spacing: .06em; color: var(--pewter); }
.ledger tr.finish-1 td:first-child { color: var(--foil); font-weight: 800; }
.ledger tr.finish-2 td:first-child,
.ledger tr.finish-3 td:first-child { color: var(--sapphire); font-weight: 700; }
.table-scroll { overflow-x: auto; }

/* Card frames (gallery) */
.card-frame { border-radius: 10px; overflow: hidden; box-shadow: 0 4px 18px rgba(0,0,0,.25); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; }

/* Foil shimmer, guarded for reduced motion */
@media (prefers-reduced-motion: no-preference) {
  .shimmer { position: relative; }
  .shimmer::after {
    content: "";
    position: absolute; inset: 0;
    background: linear-gradient(115deg, transparent 30%, rgba(255,240,180,.35) 48%, transparent 62%);
    background-size: 260% 100%;
    animation: shimmer 3.2s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes shimmer { 0% { background-position: 120% 0; } 100% { background-position: -60% 0; } }
}
```

- [ ] **Step 5: Verify the CSS parses and pages render**

Run: `bunx lightningcss --minify site/styles.css > /dev/null && echo CSS-OK`
Expected: `CSS-OK` (if lightningcss is unavailable, open `site/404.html` via `python3 -m http.server` and confirm it renders styled; either check passes the step)

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml site/_headers site/404.html site/styles.css
git commit -m "feat(site): scaffold + rarity-ladder theme (no-build Pages layout)"
```

---

### Task 2: games.json seed

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `site/data/games.json`

**Interfaces:**
- Produces: the `GamesData` shape consumed by every generator: `{ nextGame: {date, time}, hopeCoin: {holder, since}, players: [{slug, name, aka: string[]}], games: [{date, hands, startingStack, buyIn, entries, pot, results: [{slug, handle, finish, payout, rebuys, trophies: string[]}]}] }`. Trophy strings are kebab-case: `hope-slayer`, `cain-and-abel`.

Data below is transcribed from the two canonical ledgers (`briefs/poker-2026-07-14.md`, `briefs/poker-2026-08-11.md` in The Investor Relations workspace) and the repo README. July is reconciled at 9 buy-ins / $450 pot (Mike's confirmed breakdown). August is 8 entries / $400 by chip conservation. Chris's handle appears as both `LEWD` (ledgers) and `ccml415` (README July table); Gene's as `webvee` and `Webvee`. The `aka` arrays carry all observed spellings.

- [ ] **Step 1: Write `site/data/games.json`**

```json
{
  "nextGame": { "date": "2026-09-08", "time": "7:00pm PT" },
  "hopeCoin": { "holder": "nick-m", "since": "2026-04-14" },
  "players": [
    { "slug": "kmikeym",       "name": "Mike M.",   "aka": ["kmikeym"] },
    { "slug": "chris-g",    "name": "Chris G.",     "aka": ["LEWD", "ccml415"] },
    { "slug": "nick-m",  "name": "Nick M.",   "aka": ["nickmershon"] },
    { "slug": "beau-g","name": "Beau G.", "aka": ["bg"] },
    { "slug": "amy-m",   "name": "Amy M.",    "aka": ["amaxwell"] },
    { "slug": "webvee",        "name": "Gene",           "aka": ["webvee", "Webvee"] },
    { "slug": "thomas-d", "name": "Thomas D.",  "aka": ["spladow"] },
    { "slug": "drew-a", "name": "Drew A.",  "aka": ["MoHDI_Drew"] }
  ],
  "games": [
    {
      "date": "2026-07-14",
      "hands": 201, "startingStack": 5000, "buyIn": 50,
      "entries": 9, "pot": 450,
      "results": [
        { "slug": "chris-g",     "handle": "LEWD",        "finish": 1, "payout": 315, "rebuys": 0, "trophies": ["hope-slayer"] },
        { "slug": "nick-m",   "handle": "nickmershon", "finish": 2, "payout": 135, "rebuys": 2, "trophies": [] },
        { "slug": "beau-g", "handle": "bg",          "finish": 3, "payout": 0,   "rebuys": 0, "trophies": [] },
        { "slug": "kmikeym",        "handle": "kmikeym",     "finish": 4, "payout": 0,   "rebuys": 0, "trophies": ["cain-and-abel"] },
        { "slug": "amy-m",    "handle": "amaxwell",    "finish": 5, "payout": 0,   "rebuys": 1, "trophies": [] },
        { "slug": "webvee",         "handle": "Webvee",      "finish": 6, "payout": 0,   "rebuys": 0, "trophies": [] }
      ]
    },
    {
      "date": "2026-08-11",
      "hands": 211, "startingStack": 5000, "buyIn": 50,
      "entries": 8, "pot": 400,
      "results": [
        { "slug": "thomas-d",  "handle": "spladow",     "finish": 1, "payout": 280, "rebuys": 0, "trophies": ["hope-slayer"] },
        { "slug": "beau-g", "handle": "bg",          "finish": 2, "payout": 120, "rebuys": 0, "trophies": [] },
        { "slug": "amy-m",    "handle": "amaxwell",    "finish": 3, "payout": 0,   "rebuys": 0, "trophies": [] },
        { "slug": "chris-g",     "handle": "LEWD",        "finish": 4, "payout": 0,   "rebuys": 0, "trophies": [] },
        { "slug": "drew-a",  "handle": "MoHDI_Drew",  "finish": 5, "payout": 0,   "rebuys": 0, "trophies": [] },
        { "slug": "nick-m",   "handle": "nickmershon", "finish": 6, "payout": 0,   "rebuys": 1, "trophies": [] },
        { "slug": "kmikeym",        "handle": "kmikeym",     "finish": 7, "payout": 0,   "rebuys": 0, "trophies": [] }
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON + internal consistency**

Run:
```bash
bun -e '
const d = JSON.parse(await Bun.file("site/data/games.json").text());
const slugs = new Set(d.players.map(p => p.slug));
for (const g of d.games) {
  if (g.entries * g.buyIn !== g.pot) throw new Error(`pot mismatch ${g.date}`);
  const buyins = g.results.length + g.results.reduce((n, r) => n + r.rebuys, 0);
  if (buyins !== g.entries) throw new Error(`entry mismatch ${g.date}: ${buyins} vs ${g.entries}`);
  for (const r of g.results) if (!slugs.has(r.slug)) throw new Error(`unknown slug ${r.slug}`);
  const finishes = g.results.map(r => r.finish).sort((a,b)=>a-b);
  finishes.forEach((f, i) => { if (f !== i + 1) throw new Error(`finish gap ${g.date}`); });
}
console.log("SEED-OK");
'
```
Expected: `SEED-OK`

- [ ] **Step 3: Commit**

```bash
git add site/data/games.json
git commit -m "data: seed games.json with July + August 2026 games, slug roster with aka lists"
```

---

### Task 3: PokerNow log library

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tools/lib/pokernow.ts`
- Create: `tools/fixtures/mini-log.csv`
- Test: `tools/lib/pokernow.test.ts`

**Interfaces:**
- Produces: `parseRows(csv: string): {entry: string, order: number}[]` (oldest-first), `playerName(quoted: string): string` (strips the `" @ id"` suffix), `stackSnapshots(rows: {entry: string, order: number}[]): {hand: number, stacks: Record<string, number>}[]`, `entryCount(finalStacks: Record<string, number>, startingStack: number): number` (throws `ChipConservationError` when total chips are not a whole multiple of the starting stack), `handCount(rows): number`.

The parsing logic is a public-safe port of the private co-pilot's log reader. The committed fixture is SYNTHETIC (invented players "alice"/"bob"/"carol"): real PokerNow logs are private inputs and never enter this repo.

- [ ] **Step 1: Write `package.json` and `tsconfig.json`**

```json
{
  "name": "shareholder-poker-site",
  "private": true,
  "scripts": {
    "test": "bun test tools",
    "render": "bun tools/render.ts",
    "publish-game": "bun tools/publish-game.ts"
  },
  "devDependencies": { "@types/bun": "latest" }
}
```

```json
{
  "compilerOptions": {
    "target": "esnext", "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "types": ["bun-types"], "noEmit": true
  },
  "include": ["tools"]
}
```

- [ ] **Step 2: Write the synthetic fixture `tools/fixtures/mini-log.csv`**

PokerNow exports newest-first with a header. Three hands, one late "Player stacks" progression, final stacks totalling 15000 at a 5000 stack (3 entries):

```csv
entry,at,order
"-- ending hand #3 --",2026-01-01T00:09:00.000Z,900
"Player stacks: #1 ""alice @ aaa111"" (9000) | #2 ""bob @ bbb222"" (4000) | #3 ""carol @ ccc333"" (2000)",2026-01-01T00:08:00.000Z,800
"-- starting hand #3 (id: h3) (No Limit Texas Hold'em) (dealer: ""alice @ aaa111"") --",2026-01-01T00:07:00.000Z,700
"Player stacks: #1 ""alice @ aaa111"" (8000) | #2 ""bob @ bbb222"" (4500) | #3 ""carol @ ccc333"" (2500)",2026-01-01T00:06:00.000Z,600
"-- starting hand #2 (id: h2) (No Limit Texas Hold'em) (dealer: ""carol @ ccc333"") --",2026-01-01T00:05:00.000Z,500
"Player stacks: #1 ""alice @ aaa111"" (5000) | #2 ""bob @ bbb222"" (5000) | #3 ""carol @ ccc333"" (5000)",2026-01-01T00:03:00.000Z,300
"-- starting hand #1 (id: h1) (No Limit Texas Hold'em) (dealer: ""bob @ bbb222"") --",2026-01-01T00:02:00.000Z,200
"The admin approved the player ""alice @ aaa111"" participation with a stack of 5000.",2026-01-01T00:01:00.000Z,100
```

- [ ] **Step 3: Write failing tests `tools/lib/pokernow.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { parseRows, playerName, stackSnapshots, entryCount, handCount, ChipConservationError } from "./pokernow";

const csv = await Bun.file(new URL("../fixtures/mini-log.csv", import.meta.url)).text();

describe("parseRows", () => {
  test("returns rows oldest-first and unescapes doubled quotes", () => {
    const rows = parseRows(csv);
    expect(rows[0].order).toBeLessThan(rows[rows.length - 1].order);
    expect(rows.some(r => r.entry.includes('"alice @ aaa111"'))).toBe(true);
  });
});

describe("playerName", () => {
  test("strips the id suffix", () => {
    expect(playerName('"alice @ aaa111"')).toBe("alice");
  });
});

describe("stackSnapshots", () => {
  test("associates each stacks line with the current hand number", () => {
    const snaps = stackSnapshots(parseRows(csv));
    expect(snaps.length).toBe(3);
    expect(snaps[0]).toEqual({ hand: 1, stacks: { alice: 5000, bob: 5000, carol: 5000 } });
    expect(snaps[2].stacks.alice).toBe(9000);
  });
});

describe("handCount", () => {
  test("counts starting-hand lines", () => {
    expect(handCount(parseRows(csv))).toBe(3);
  });
});

describe("entryCount", () => {
  test("derives entries from chip conservation", () => {
    expect(entryCount({ alice: 9000, bob: 4000, carol: 2000 }, 5000)).toBe(3);
  });
  test("throws when totals do not divide by the starting stack", () => {
    expect(() => entryCount({ alice: 9000, bob: 4100 }, 5000)).toThrow(ChipConservationError);
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `bun test tools/lib/pokernow.test.ts`
Expected: FAIL (module `./pokernow` not found)

- [ ] **Step 5: Implement `tools/lib/pokernow.ts`**

```ts
// Public-safe PokerNow log reader for the poker.kmikeym.com generators.
// Raw logs are private runtime inputs; only synthetic fixtures live in-repo.

export class ChipConservationError extends Error {}

export function playerName(quoted: string): string {
  const inner = quoted.replace(/^"+|"+$/g, "");
  return inner.split(" @ ")[0].trim();
}

// Each CSV line: "<entry>",<iso>,<order> with internal quotes escaped as "".
export function parseRows(csv: string): { entry: string; order: number }[] {
  const out: { entry: string; order: number }[] = [];
  for (const raw of csv.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("entry,")) continue;
    const m = line.match(/^"((?:[^"]|"")*)",([^,]+),(\d+)$/);
    if (!m) continue;
    out.push({ entry: m[1].replace(/""/g, '"'), order: Number(m[3]) });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

export function handCount(rows: { entry: string }[]): number {
  return rows.filter(r => /^-- starting hand #\d+/.test(r.entry)).length;
}

export function stackSnapshots(rows: { entry: string }[]): { hand: number; stacks: Record<string, number> }[] {
  const out: { hand: number; stacks: Record<string, number> }[] = [];
  let hand = 0;
  for (const { entry } of rows) {
    let m = entry.match(/^-- starting hand #(\d+)/);
    if (m) { hand = Number(m[1]); continue; }
    if (entry.startsWith("Player stacks:")) {
      const stacks: Record<string, number> = {};
      const re = /"([^"]+)" \((\d+)\)/g;
      let s: RegExpExecArray | null;
      while ((s = re.exec(entry))) stacks[playerName(`"${s[1]}"`)] = Number(s[2]);
      out.push({ hand, stacks });
    }
  }
  return out;
}

// Chips enter a tournament only through a buy-in, so
// total final chips / starting stack = entries. Non-integer totals mean the
// log or the starting stack is wrong; refuse rather than publish a bad pot.
export function entryCount(finalStacks: Record<string, number>, startingStack: number): number {
  const total = Object.values(finalStacks).reduce((a, b) => a + b, 0);
  if (total === 0 || total % startingStack !== 0) {
    throw new ChipConservationError(
      `total chips ${total} is not a whole multiple of starting stack ${startingStack}`
    );
  }
  return total / startingStack;
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `bun test tools/lib/pokernow.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json tools/lib/pokernow.ts tools/lib/pokernow.test.ts tools/fixtures/mini-log.csv
git commit -m "feat(tools): PokerNow log library with chip-conservation entry count"
```

---

### Task 4: Slug resolution

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `tools/lib/slugs.ts`
- Test: `tools/lib/slugs.test.ts`

**Interfaces:**
- Consumes: the `players` array shape from the seeded games data (Task 2): `{slug: string, name: string, aka: string[]}[]`.
- Produces: `resolveSlug(handle: string, players: Player[]): string` (case-insensitive match over `aka`, throws `UnknownHandleError` naming the handle), `type Player = { slug: string; name: string; aka: string[] }`.

- [ ] **Step 1: Write failing tests `tools/lib/slugs.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { resolveSlug, UnknownHandleError, type Player } from "./slugs";

const players: Player[] = [
  { slug: "chris-g", name: "Chris G.", aka: ["LEWD", "ccml415"] },
  { slug: "webvee", name: "Gene", aka: ["webvee", "Webvee"] },
];

describe("resolveSlug", () => {
  test("resolves any aka to the slug", () => {
    expect(resolveSlug("LEWD", players)).toBe("chris-g");
    expect(resolveSlug("ccml415", players)).toBe("chris-g");
  });
  test("is case-insensitive", () => {
    expect(resolveSlug("lewd", players)).toBe("chris-g");
    expect(resolveSlug("WEBVEE", players)).toBe("webvee");
  });
  test("throws UnknownHandleError naming the handle, never invents a player", () => {
    expect(() => resolveSlug("mystery99", players)).toThrow(UnknownHandleError);
    expect(() => resolveSlug("mystery99", players)).toThrow(/mystery99/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tools/lib/slugs.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `tools/lib/slugs.ts`**

```ts
export type Player = { slug: string; name: string; aka: string[] };

export class UnknownHandleError extends Error {
  constructor(handle: string) {
    super(
      `Unknown handle "${handle}". Add it to an existing player's aka list in ` +
      `site/data/games.json, or add a new player entry. Never guess.`
    );
  }
}

export function resolveSlug(handle: string, players: Player[]): string {
  const want = handle.toLowerCase();
  for (const p of players) {
    if (p.aka.some(a => a.toLowerCase() === want)) return p.slug;
  }
  throw new UnknownHandleError(handle);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tools/lib/slugs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/lib/slugs.ts tools/lib/slugs.test.ts
git commit -m "feat(tools): handle-to-slug resolution, halts on unknown handles"
```

---

### Task 5: Standings derivation

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `tools/lib/standings.ts`
- Test: `tools/lib/standings.test.ts`

**Interfaces:**
- Consumes: the `GamesData` shape from the seeded games data (Task 2).
- Produces: `deriveStandings(data: GamesData): Standings` where `Standings = { rows: StandingRow[], hopeCoin: { holder: string, since: string, skulls: Record<string, number> } }` and `StandingRow = { slug: string, name: string, games: number, wins: number, cashes: number, bestFinish: number, totalPayout: number, rebuys: number, lastPlayed: string }`, rows sorted by wins desc, then cashes desc, then bestFinish asc, then name; also exports `type GamesData` matching the seed file.

- [ ] **Step 1: Write failing tests `tools/lib/standings.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { deriveStandings, type GamesData } from "./standings";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-m", since: "2026-04-14" },
  players: [
    { slug: "a", name: "Anne", aka: ["a"] },
    { slug: "b", name: "Bert", aka: ["b"] },
    { slug: "c", name: "Cleo", aka: ["c"] },
  ],
  games: [
    { date: "2026-07-14", hands: 10, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      results: [
        { slug: "a", handle: "a", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "b", handle: "b", finish: 2, payout: 45, rebuys: 0, trophies: [] },
        { slug: "c", handle: "c", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ] },
    { date: "2026-08-11", hands: 10, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      results: [
        { slug: "c", handle: "c", finish: 1, payout: 105, rebuys: 1, trophies: ["hope-slayer"] },
        { slug: "a", handle: "a", finish: 2, payout: 45, rebuys: 0, trophies: [] },
        { slug: "b", handle: "b", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ] },
  ],
};

describe("deriveStandings", () => {
  test("aggregates per player across games", () => {
    const s = deriveStandings(data);
    const anne = s.rows.find(r => r.slug === "a")!;
    expect(anne).toEqual({
      slug: "a", name: "Anne", games: 2, wins: 1, cashes: 2,
      bestFinish: 1, totalPayout: 150, rebuys: 0, lastPlayed: "2026-08-11",
    });
  });
  test("sorts by wins, then cashes, then best finish", () => {
    const s = deriveStandings(data);
    expect(s.rows.map(r => r.slug)).toEqual(["a", "c", "b"]);
  });
  test("carries the seeded coin holder and counts skulls from trophies", () => {
    const s = deriveStandings(data);
    expect(s.hopeCoin.holder).toBe("nick-m");
    expect(s.hopeCoin.skulls).toEqual({ a: 1, c: 1 });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tools/lib/standings.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `tools/lib/standings.ts`**

```ts
export type GameResult = { slug: string; handle: string; finish: number; payout: number; rebuys: number; trophies: string[] };
export type Game = { date: string; hands: number; startingStack: number; buyIn: number; entries: number; pot: number; results: GameResult[] };
export type GamesData = {
  nextGame: { date: string; time: string };
  hopeCoin: { holder: string; since: string };
  players: { slug: string; name: string; aka: string[] }[];
  games: Game[];
};
export type StandingRow = {
  slug: string; name: string; games: number; wins: number; cashes: number;
  bestFinish: number; totalPayout: number; rebuys: number; lastPlayed: string;
};
export type Standings = {
  rows: StandingRow[];
  hopeCoin: { holder: string; since: string; skulls: Record<string, number> };
};

export function deriveStandings(data: GamesData): Standings {
  const byId = new Map<string, StandingRow>();
  const skulls: Record<string, number> = {};
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));

  for (const game of [...data.games].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const r of game.results) {
      const row = byId.get(r.slug) ?? {
        slug: r.slug, name: nameOf.get(r.slug) ?? r.slug, games: 0, wins: 0,
        cashes: 0, bestFinish: Infinity, totalPayout: 0, rebuys: 0, lastPlayed: "",
      };
      row.games++;
      if (r.finish === 1) row.wins++;
      if (r.payout > 0) row.cashes++;
      row.bestFinish = Math.min(row.bestFinish, r.finish);
      row.totalPayout += r.payout;
      row.rebuys += r.rebuys;
      row.lastPlayed = game.date;
      byId.set(r.slug, row);
      if (r.trophies.includes("hope-slayer")) skulls[r.slug] = (skulls[r.slug] ?? 0) + 1;
    }
  }

  const rows = [...byId.values()].sort((a, b) =>
    b.wins - a.wins || b.cashes - a.cashes || a.bestFinish - b.bestFinish || a.name.localeCompare(b.name)
  );
  return { rows, hopeCoin: { ...data.hopeCoin, skulls } };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tools/lib/standings.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/lib/standings.ts tools/lib/standings.test.ts
git commit -m "feat(tools): derive standings + Hope Coin skull counts from games.json"
```

---

### Task 6: Page renderers + generated standings and games index

**Type:** implementation
**Depends-on:** 1, 2, 5

**Files:**
- Create: `tools/render.ts`
- Create: `site/standings/index.html`
- Create: `site/games/index.html`
- Test: `tools/render.test.ts`

**Interfaces:**
- Consumes: `deriveStandings(data)`, `type GamesData` (from the standings derivation task); theme classes `band-light`, `band-dark`, `display`, `stat`, `ledger`, `table-scroll` (from the scaffold task).
- Produces: `renderStandings(data: GamesData): string`, `renderGamesIndex(data: GamesData): string` (both return full HTML documents); CLI `bun tools/render.ts` reads `site/data/games.json` and writes both pages.

**Parallelization rationale:** renderers consume only the standings contract and the seeded data shape, so they build against those signatures while the game pages, cards, and RSVP tasks proceed independently.

- [ ] **Step 1: Write failing tests `tools/render.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { renderStandings, renderGamesIndex } from "./render";
import type { GamesData } from "./lib/standings";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-m", since: "2026-04-14" },
  players: [
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
    { slug: "chris-g", name: "Chris G.", aka: ["LEWD"] },
  ],
  games: [
    { date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      results: [
        { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 2, trophies: [] },
      ] },
  ],
};

describe("renderStandings", () => {
  const html = renderStandings(data);
  test("is a full document using the theme", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain("ledger");
  });
  test("shows the coin holder with skull progress", () => {
    expect(html).toContain("Nick M.");
    expect(html).toContain("Hope Coin");
    expect(html).toContain("1 of 3");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
});

describe("renderGamesIndex", () => {
  const html = renderGamesIndex(data);
  test("links each game page, newest first", () => {
    expect(html).toContain('href="/games/2026-07-14/"');
  });
  test("names the winner", () => {
    expect(html).toContain("Chris G.");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tools/render.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `tools/render.ts`**

```ts
// Renders the derived pages (standings, games index) as full committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData } from "./lib/standings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
</nav>
${body}
<footer class="band-dark" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat">Generated from the game record. <a href="/">poker.kmikeym.com</a></p></div>
</footer>
</body>
</html>
`;
}

export function renderStandings(data: GamesData): string {
  const s = deriveStandings(data);
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const holderName = nameOf.get(s.hopeCoin.holder) ?? s.hopeCoin.holder;
  const skulls = Object.entries(s.hopeCoin.skulls)
    .map(([slug, n]) => `<li>${esc(nameOf.get(slug) ?? slug)}: <span class="stat">${n} of 3</span> skulls</li>`)
    .join("\n      ");
  const rows = s.rows.map((r, i) => `      <tr class="finish-${i + 1}">
        <td>${esc(r.name)}</td>
        <td class="num">${r.games}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.cashes}</td>
        <td class="num">${r.bestFinish}</td>
        <td class="num">$${r.totalPayout}</td>
        <td class="num">${r.rebuys}</td>
      </tr>`).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Standings</h1>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Won</th><th>Rebuys</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
  </div>
</section>
<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">🪙 The Hope Coin</h2>
    <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
    <ul>
      ${skulls}
    </ul>
  </div>
</section>`;
  return page("Standings", body);
}

export function renderGamesIndex(data: GamesData): string {
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const items = [...data.games].sort((a, b) => b.date.localeCompare(a.date)).map(g => {
    const winner = g.results.find(r => r.finish === 1)!;
    return `    <li>
      <a href="/games/${g.date}/">${g.date}</a>:
      <strong>${esc(nameOf.get(winner.slug) ?? winner.slug)}</strong> won
      (<span class="stat">${g.entries} entries · $${g.pot} pot · ${g.hands} hands</span>)
    </li>`;
  }).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Games</h1>
    <p>Second Tuesday of every month, 7pm PT. Next: <strong>${data.nextGame.date}</strong>.</p>
    <ul>
${items}
    </ul>
  </div>
</section>`;
  return page("Games", body);
}

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log("rendered site/standings/index.html and site/games/index.html");
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tools/render.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Generate the pages from the real seed and inspect**

Run: `bun tools/render.ts && grep -c "Thomas D." site/standings/index.html`
Expected: the render message, then a count ≥ 1 (Thomas leads standings after his August win)

- [ ] **Step 6: Commit**

```bash
git add tools/render.ts tools/render.test.ts site/standings/index.html site/games/index.html
git commit -m "feat(site): generated standings + games index (committed HTML, no build step)"
```

---

### Task 7: Chip-race generator

**Type:** implementation
**Depends-on:** 3

**Files:**
- Create: `tools/chip-race.ts`
- Test: `tools/chip-race.test.ts`

**Interfaces:**
- Consumes: `parseRows`, `stackSnapshots`, `handCount`, `entryCount` (from the log library task).
- Produces: `buildChipRace(csv: string, opts: { date: string; startingStack: number }): string` returning a self-contained HTML document (inline SVG polylines per player, no external assets); CLI `bun tools/chip-race.ts <log.csv> --date YYYY-MM-DD --start 5000 --out <file>`.

- [ ] **Step 1: Write failing tests `tools/chip-race.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { buildChipRace } from "./chip-race";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();

describe("buildChipRace", () => {
  const html = buildChipRace(csv, { date: "2026-01-01", startingStack: 5000 });
  test("is a self-contained document with one polyline per player", () => {
    expect(html).toStartWith("<!doctype html>");
    expect((html.match(/<polyline/g) || []).length).toBe(3);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });
  test("titles the game date and shows the entry count", () => {
    expect(html).toContain("2026-01-01");
    expect(html).toContain("3 entries");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tools/chip-race.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `tools/chip-race.ts`**

```ts
// Chip-race chart from a PokerNow log, as a single self-contained HTML file.
// Run: bun tools/chip-race.ts <log.csv> --date YYYY-MM-DD --start 5000 --out out.html
import { parseRows, stackSnapshots, handCount, entryCount } from "./lib/pokernow";

const PALETTE = ["#c9a227", "#2b5d9e", "#b06c3f", "#8a8d91", "#5e8c61", "#9e2b5d", "#4a4e57"];

export function buildChipRace(csv: string, opts: { date: string; startingStack: number }): string {
  const rows = parseRows(csv);
  const snaps = stackSnapshots(rows);
  const hands = handCount(rows);
  const final = snaps[snaps.length - 1].stacks;
  const entries = entryCount(final, opts.startingStack);

  const players = [...new Set(snaps.flatMap(s => Object.keys(s.stacks)))];
  const maxChips = Math.max(...snaps.flatMap(s => Object.values(s.stacks)));
  const W = 720, H = 400, PAD = 40;
  const x = (hand: number) => PAD + (hand / Math.max(hands, 1)) * (W - 2 * PAD);
  const y = (chips: number) => H - PAD - (chips / maxChips) * (H - 2 * PAD);

  const lines = players.map((p, i) => {
    const pts = snaps
      .filter(s => p in s.stacks)
      .map(s => `${x(s.hand).toFixed(1)},${y(s.stacks[p]).toFixed(1)}`)
      .join(" ");
    return `  <polyline fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="2.5" points="${pts}"><title>${p}</title></polyline>`;
  }).join("\n");

  const legend = players.map((p, i) =>
    `<span style="color:${PALETTE[i % PALETTE.length]}; margin-right:1em; font-weight:700;">${p}</span>`
  ).join(" ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chip race ${opts.date}</title>
<style>
  body { margin: 0; padding: 1rem; background: #1c1f26; color: #eceae2; font-family: -apple-system, sans-serif; }
  .wrap { overflow-x: auto; }
  svg { display: block; min-width: 560px; width: 100%; height: auto; }
  .meta { font-family: Menlo, monospace; font-size: .85em; color: #8a8d91; }
</style>
</head>
<body>
<p class="meta">Chip race: ${opts.date}. ${entries} entries, ${hands} hands.</p>
<div class="wrap">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chip counts per player over ${hands} hands">
  <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#8a8d91"/>
  <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#8a8d91"/>
${lines}
</svg>
</div>
<p>${legend}</p>
</body>
</html>
`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const csv = await Bun.file(args[0]).text();
  const html = buildChipRace(csv, { date: flag("--date") ?? "unknown", startingStack: Number(flag("--start") ?? 5000) });
  const out = flag("--out") ?? "chip-race.html";
  await Bun.write(out, html);
  console.log(`wrote ${out}`);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tools/chip-race.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/chip-race.ts tools/chip-race.test.ts
git commit -m "feat(tools): chip-race chart generator (self-contained SVG HTML)"
```

---

### Task 8: Game pages for July and August

**Type:** implementation
**Depends-on:** 1, 2, 7

**Files:**
- Create: `site/games/2026-07-14/index.html`
- Create: `site/games/2026-07-14/chip-race.html`
- Create: `site/games/2026-08-11/index.html`
- Create: `site/games/2026-08-11/chip-race.html`

**Interfaces:**
- Consumes: CLI `bun tools/chip-race.ts <log.csv> --date --start --out` (from the chip-race task); theme classes `band-light`, `band-dark`, `display`, `ledger`, `table-scroll` (from the scaffold task).

**Coordination notes (self-contained):**
- Raw PokerNow logs are PRIVATE runtime inputs. They live outside this repo at `/Users/kmikeym/Agenting/The Investor Relations/munger/data/` (filenames match `pokernow*log*.csv`; run `ls` there and pick by date). Read them to GENERATE the chip-race pages; never copy a log into this repo, never commit one.
- The public ledger pages carry: players (name + handle), finishes, payouts, rebuys, trophies, pot math, and story beats already recorded in the public README or dignity-rule-compatible. They NEVER carry the collections/owed tables from the private briefs (who owes whom money is not public content).
- Ledger narrative facts to use, July (from the canonical brief): Chris G. (LEWD) won $315 and landed the first skull on Nick; Nick took 2nd ($135) on 2 rebuys, losing the crown; Beau led big and bubbled 3rd; Mike knocked out his brother Gene for Cain and Abel; 9 buy-ins, $450 pot, 201 hands.
- August: Thomas D. (spladow) won $280 as a first-timer AND took a skull (Hope Slayer) on debut; Beau 2nd $120; Amy bubbled 3rd after a late entry at hand 23; Chris did not defend (4th); Drew A. (107 shares) debuted 5th; Nick 6th with 1 rebuy, still holding the Hope Coin; Mike out first at hand 38; 8 entries by chip conservation, $400 pot, 211 hands.
- No em dashes anywhere in these pages.

- [ ] **Step 1: Generate both chip-race pages from the real logs**

```bash
LOGS="/Users/kmikeym/Agenting/The Investor Relations/munger/data"
ls "$LOGS" | grep -i csv   # identify the July and August log filenames by date
bun tools/chip-race.ts "$LOGS/<july-log>.csv" --date 2026-07-14 --start 5000 --out site/games/2026-07-14/chip-race.html
bun tools/chip-race.ts "$LOGS/<aug-log>.csv"  --date 2026-08-11 --start 5000 --out site/games/2026-08-11/chip-race.html
```

Expected: two `wrote ...` lines. If the July log's chip totals do not divide by 5000, the generator throws ChipConservationError: try `--start` values the log's first "Player stacks" line shows; if it still fails, generate August only and leave a `site/games/2026-07-14/chip-race.html` page containing the July ledger note "Chip chart pending log reconciliation" inside the standard page shell, and report the failure in the task summary.

- [ ] **Step 2: Write `site/games/2026-08-11/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>August 11, 2026 | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
</nav>
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">August 11, 2026</h1>
    <p class="stat">211 hands · 8 entries · $400 pot · 2h 25m</p>
    <p><strong>A first-timer took the whole thing.</strong> Thomas D. (spladow) sat down at this table for the first time, won the tournament for $280, and picked up a Hope Slayer skull on the way. Two debuts in one night: Drew A. (MoHDI_Drew) also played his first game and finished 5th.</p>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Finish</th><th>Player</th><th>Handle</th><th>Payout</th><th>Rebuys</th><th>Notes</th></tr></thead>
      <tbody>
        <tr class="finish-1"><td class="num">1</td><td>Thomas D.</td><td class="stat">spladow</td><td class="num">$280</td><td class="num">0</td><td>🏆 debut win · 💀 Hope Slayer</td></tr>
        <tr class="finish-2"><td class="num">2</td><td>Beau G.</td><td class="stat">bg</td><td class="num">$120</td><td class="num">0</td><td>from bubble boy in July to the cash</td></tr>
        <tr class="finish-3"><td class="num">3</td><td>Amy M.</td><td class="stat">amaxwell</td><td class="num">$0</td><td class="num">0</td><td>bubble, after a late entry at hand 23</td></tr>
        <tr><td class="num">4</td><td>Chris G.</td><td class="stat">LEWD</td><td class="num">$0</td><td class="num">0</td><td>the July champion, title not defended</td></tr>
        <tr><td class="num">5</td><td>Drew A.</td><td class="stat">MoHDI_Drew</td><td class="num">$0</td><td class="num">0</td><td>debut game</td></tr>
        <tr><td class="num">6</td><td>Nick M.</td><td class="stat">nickmershon</td><td class="num">$0</td><td class="num">1</td><td>🪙 still holds the Hope Coin</td></tr>
        <tr><td class="num">7</td><td>Mike M.</td><td class="stat">kmikeym</td><td class="num">$0</td><td class="num">0</td><td>first out, hand 38</td></tr>
      </tbody>
    </table></div>
    <p class="stat">Pot verified by chip conservation: final stacks totalled 40,000 at a 5,000 starting stack, so 8 entries, $400.</p>
  </div>
</section>
<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">The chip race</h2>
    <p>Every stack, every hand, all 211 of them.</p>
    <p><a class="btn-secondary" href="chip-race.html">Open the full chart</a></p>
  </div>
</section>
<footer class="band-light" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat"><a href="/games/">All games</a> · <a href="/standings/">Standings</a></p></div>
</footer>
</body>
</html>
```

- [ ] **Step 3: Write `site/games/2026-07-14/index.html`**

Same page shell (nav, alternating bands, footer) with the July content:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>July 14, 2026 | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
</nav>
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">July 14, 2026</h1>
    <p class="stat">201 hands · 9 buy-ins · $450 pot</p>
    <p><strong>The crown changed hands.</strong> Chris G. (LEWD) beat reigning champion Nick M. heads-up for $315, and landed the first skull on the Hope Coin holder while he was at it. This is the game that minted the first card set, The Founder's Table.</p>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Finish</th><th>Player</th><th>Handle</th><th>Payout</th><th>Rebuys</th><th>Notes</th></tr></thead>
      <tbody>
        <tr class="finish-1"><td class="num">1</td><td>Chris G.</td><td class="stat">LEWD</td><td class="num">$315</td><td class="num">0</td><td>🏆 champion · 💀 Hope Slayer, skull 1 of 3</td></tr>
        <tr class="finish-2"><td class="num">2</td><td>Nick M.</td><td class="stat">nickmershon</td><td class="num">$135</td><td class="num">2</td><td>lost the crown, kept the 🪙 Coin</td></tr>
        <tr class="finish-3"><td class="num">3</td><td>Beau G.</td><td class="stat">bg</td><td class="num">$0</td><td class="num">0</td><td>led with 28,168 chips, then the bubble</td></tr>
        <tr><td class="num">4</td><td>Mike M.</td><td class="stat">kmikeym</td><td class="num">$0</td><td class="num">0</td><td>⚔️ Cain and Abel: knocked out his brother</td></tr>
        <tr><td class="num">5</td><td>Amy M.</td><td class="stat">amaxwell</td><td class="num">$0</td><td class="num">1</td><td></td></tr>
        <tr><td class="num">6</td><td>Gene</td><td class="stat">webvee</td><td class="num">$0</td><td class="num">0</td><td>eliminated by his own brother</td></tr>
      </tbody>
    </table></div>
  </div>
</section>
<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">The chip race</h2>
    <p><a class="btn-secondary" href="chip-race.html">Open the full chart</a></p>
  </div>
</section>
<footer class="band-light" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat"><a href="/games/">All games</a> · <a href="/cards/2026-07/">This game's card set</a></p></div>
</footer>
</body>
</html>
```

- [ ] **Step 4: Verify pages and copy rules**

Run:
```bash
grep -L "—" site/games/2026-07-14/index.html site/games/2026-08-11/index.html
grep -c "owes\|Venmo\|owed" site/games/*/index.html || echo "NO-PRIVATE-LEDGER-OK"
```
Expected: both filenames listed by the first grep (no em dashes); `NO-PRIVATE-LEDGER-OK` (no collections content)

- [ ] **Step 5: Commit**

```bash
git add site/games/2026-07-14 site/games/2026-08-11
git commit -m "feat(site): July + August 2026 game pages with chip races"
```

---

### Task 9: Cards section

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `site/cards/index.html`
- Create: `site/cards/2026-07/index.html`
- Create: `site/cards/2026-07/assets/`

**Interfaces:**
- Consumes: theme classes `band-light`, `band-dark`, `display`, `card-grid`, `card-frame`, `shimmer`, rarity classes (from the scaffold task).
- Produces: asset path `site/cards/2026-07/assets/card-1-lewd.png` (the foil champion card, referenced by the home page) and `site/cards/2026-07/assets/pack-rip.gif`.

**Coordination notes (self-contained):**
- Source assets (already-shipped, public-cleared renders) live OUTSIDE this repo:
  - `/Users/kmikeym/Agenting/The Investor Relations/munger/ccg/launch-aug-2026/cards-grid-clean.png` and `pack-rip.gif`
  - Per-card PNGs: `/Users/kmikeym/Desktop/Poker Pack 1/Assets/card-{1-lewd,2-nickmershon,3-bg,4-kmikeym,5-amaxwell,6-webvee}.png`
- Do NOT copy `set-page-preview-INTERNAL.png` (internal draft) and do NOT reproduce the held-back CTA line anywhere (Mike knows which line; it is held back pending his reveal decision). The set page describes the cards that exist; it does not announce the mechanic.
- Card copy on the set page is limited to name, handle, rarity tier, and finish. The full card art already carries the stat boxes.
- No em dashes.

- [ ] **Step 1: Copy assets into the repo**

```bash
mkdir -p site/cards/2026-07/assets
SRC="/Users/kmikeym/Agenting/The Investor Relations/munger/ccg/launch-aug-2026"
DESK="/Users/kmikeym/Desktop/Poker Pack 1/Assets"
cp "$SRC/cards-grid-clean.png" "$SRC/pack-rip.gif" site/cards/2026-07/assets/
cp "$DESK"/card-*.png site/cards/2026-07/assets/
ls site/cards/2026-07/assets/
```
Expected: 8 files (6 card PNGs, the grid, the gif). If the Desktop folder is gone, re-render per `munger/ccg/launch-aug-2026/ASSETS.md` (Playwright element screenshots of the card HTML) or fall back to shipping only `cards-grid-clean.png` and note it in the task summary.

- [ ] **Step 2: Write `site/cards/2026-07/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Founder's Table | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
</nav>
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Set 1: The Founder's Table</h1>
    <p>Six cards, minted from the July 14 game. Real players, real stats: the numbers on every card come from the 201-hand tournament record. Rarity is earned, not assigned. Winning the night takes the foil.</p>
    <p class="stat">Note on handles: the champion has appeared as both LEWD and ccml415. Same player, one card.</p>
  </div>
</section>
<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">The set</h2>
    <div class="card-grid">
      <figure class="card-frame shimmer"><img src="assets/card-1-lewd.png" alt="Foil champion card: Chris G., LEWD, 1st place"><figcaption>✨ FOIL · Chris G. (LEWD) · Champion</figcaption></figure>
      <figure class="card-frame"><img src="assets/card-2-nickmershon.png" alt="Rare card: Nick M., 2nd place, Hope Coin holder"><figcaption>⭐ RARE · Nick M. (nickmershon) · 2nd, holds the 🪙</figcaption></figure>
      <figure class="card-frame"><img src="assets/card-3-bg.png" alt="Rare card: Beau G., 3rd place"><figcaption>⭐ RARE · Beau G. (bg) · 3rd</figcaption></figure>
      <figure class="card-frame"><img src="assets/card-4-kmikeym.png" alt="Uncommon card: Mike M., The Founder, 4th place"><figcaption>◆ UNCOMMON · Mike M. (kmikeym) · The Founder</figcaption></figure>
      <figure class="card-frame"><img src="assets/card-5-amaxwell.png" alt="Common card: Amy M., 5th place"><figcaption>● COMMON · Amy M. (amaxwell) · The Patient Rock</figcaption></figure>
      <figure class="card-frame"><img src="assets/card-6-webvee.png" alt="Common card: Gene, 6th place"><figcaption>● COMMON · Gene (webvee) · Mysterious Wildcard</figcaption></figure>
    </div>
  </div>
</section>
<section class="band-light">
  <div class="band-inner">
    <h2 class="display">The pack rip</h2>
    <img src="assets/pack-rip.gif" alt="Animated booster pack ripping open to reveal the six cards" style="max-width:400px;">
    <p><a href="/games/2026-07-14/">The game these cards came from</a></p>
  </div>
</section>
<footer class="band-dark" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat"><a href="/cards/">All sets</a></p></div>
</footer>
</body>
</html>
```

- [ ] **Step 3: Write `site/cards/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card Sets | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
</nav>
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Card sets</h1>
    <p>Every month's game mints a set. The players are the cards; the stats are real.</p>
    <ul>
      <li><a href="/cards/2026-07/">Set 1: The Founder's Table</a> (July 14, 2026, six cards)</li>
      <li>Set 2: August 11, 2026. In production. Two debuts and a deposed champion are waiting on their cards.</li>
    </ul>
  </div>
</section>
<footer class="band-dark" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat"><a href="/">Home</a></p></div>
</footer>
</body>
</html>
```

- [ ] **Step 4: Verify no held-back copy and no em dashes**

Run:
```bash
grep -ri "minted\|get minted" site/cards/ && echo "HELD-BACK-LEAK" || echo "COPY-OK"
grep -rL "—" site/cards/*.html site/cards/2026-07/*.html
```
Expected: `COPY-OK` ("minted"/"mints" is allowed only in the sense already public; if grep matches the held-back CTA sentence, remove it) — final state: no earn-mechanic CTA, no em dashes. Note: `site/cards/index.html` uses "mints a set" describing the routine, which is acceptable; the forbidden string is the held-back CTA.

- [ ] **Step 5: Commit**

```bash
git add site/cards
git commit -m "feat(site): card set gallery, Set 1 The Founder's Table"
```

---

### Task 10: Home page (the sizzle)

**Type:** implementation
**Depends-on:** 1, 2, 8, 9

**Files:**
- Create: `site/index.html`
- Create: `site/rsvp.js`

**Interfaces:**
- Consumes: theme classes and `btn-primary`/`band-cta` (scaffold task); foil asset at `/cards/2026-07/assets/card-1-lewd.png` and pack-rip at `/cards/2026-07/assets/pack-rip.gif` (cards task); the August game page at `/games/2026-08-11/` (game-pages task); `nextGame` from `site/data/games.json` (seed task).
- Produces: RSVP form markup POSTing JSON `{email, displayName, game}` to `/api/rsvp` and rendering the GET `/api/rsvp?game=<date>` response `{count, names: string[]}` into `#rsvp-list` (the RSVP backend task implements the endpoint to this exact contract).

**Coordination notes (self-contained):**
- Section order (spec §7): next game + RSVP → champion's foil → last game's chip race → Legends stories → Hope Coin → RSVP again. Bands alternate; both RSVP bands use `band-cta` (dark neutral), which keeps lime off the rarity metals.
- The reigning champion is Thomas D. (won Aug 11) but his card is not yet minted; the foil shown is Chris G.'s July foil with copy noting the title changed hands. That tension is the sizzle, use it.
- All home copy is a DRAFT until Mike's publish go (the release task gates deploy).
- No em dashes, no "experiment", dignity rule throughout.

- [ ] **Step 1: Write `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>K5M Shareholder Poker</title>
<meta name="description" content="Shareholders who play poker. Second Tuesday of every month, 7pm Pacific. Real stakes, real cards, real grudges.">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<section class="band-cta">
  <div class="band-inner">
    <h1 class="display">Shareholder Poker</h1>
    <p>No-limit Hold'em, second Tuesday of every month, 7pm PT. $50 buy-in. Cards on Poker Now, faces on Zoom.</p>
    <p class="stat" id="next-game-line">Next game: September 8, 2026 · 7:00pm PT</p>
    <form id="rsvp-form">
      <input type="email" id="rsvp-email" required placeholder="you@example.com"
             style="padding:.8em 1em; border-radius:6px; border:none; width:min(260px, 100%); margin-right:.5em; margin-bottom:.5em;">
      <input type="text" id="rsvp-name" placeholder="display name (shown publicly)"
             style="padding:.8em 1em; border-radius:6px; border:none; width:min(260px, 100%); margin-right:.5em; margin-bottom:.5em;">
      <button class="btn-primary" type="submit">I'm in for Sept 8</button>
    </form>
    <p id="rsvp-list" class="stat" aria-live="polite"></p>
  </div>
</section>

<section class="band-light">
  <div class="band-inner">
    <h2 class="display">The foil is in play</h2>
    <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:center;">
      <figure class="card-frame shimmer" style="max-width:220px;">
        <img src="/cards/2026-07/assets/card-1-lewd.png" alt="Foil champion card: Chris G.">
      </figure>
      <div style="flex:1; min-width:240px;">
        <p>This is a real card. Chris G. earned the foil by winning July's game outright, heads-up against the reigning champion.</p>
        <p><strong>Then August happened.</strong> A first-timer named Thomas D. sat down, won the whole tournament, and took a bounty on the way. The next foil has his name on it.</p>
        <p><a class="btn-secondary" href="/cards/2026-07/">See the full set</a></p>
      </div>
    </div>
  </div>
</section>

<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">Last game, hand by hand</h2>
    <p>211 hands on August 11. The host went out first at hand 38. A debut player won it all. Every stack, every hand:</p>
    <p><a class="btn-secondary" href="/games/2026-08-11/">Read the August game</a></p>
  </div>
</section>

<section class="band-light">
  <div class="band-inner">
    <h2 class="display">Legends of the table</h2>
    <p><strong>⚔️ Cain and Abel.</strong> In July the Founder knocked his own brother out of the tournament. There is a standing one-share bounty for doing exactly that, and the brother now has five reasons of his own to survive the table.</p>
    <p><strong>📉 The 28,168-chip collapse.</strong> Beau led July with more than a quarter of the chips in play, then bubbled. In August he cashed. The card economy remembers both.</p>
  </div>
</section>

<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">🪙 The Hope Coin</h2>
    <p>The traveling trophy. Nick has held it since April. Take three kills on the holder and the Coin is yours: Chris has one skull, Thomas took another on debut. The math is getting uncomfortable.</p>
    <p><a class="btn-secondary" href="/standings/">Standings and trophies</a></p>
  </div>
</section>

<section class="band-cta">
  <div class="band-inner">
    <h2 class="display">The table is set</h2>
    <p>September 8, 7pm PT. New players welcome: two people played their first game in August and one of them won it.</p>
    <a class="btn-primary" href="#rsvp-form" onclick="document.getElementById('rsvp-email').focus()">RSVP for Sept 8</a>
  </div>
</section>

<footer class="band-light" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner">
    <p class="stat"><a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a> · <a href="https://pokergame.substack.com">Newsletter</a></p>
  </div>
</footer>
<script src="/rsvp.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `site/rsvp.js`**

```js
// RSVP form wiring. Endpoint contract:
//   POST /api/rsvp  {email, displayName, game} -> {ok: true} | {error}
//   GET  /api/rsvp?game=YYYY-MM-DD -> {count, names: [string]}  (never emails)
(function () {
  var GAME = "2026-09-08";
  var form = document.getElementById("rsvp-form");
  var email = document.getElementById("rsvp-email");
  var name = document.getElementById("rsvp-name");
  var list = document.getElementById("rsvp-list");

  function refresh() {
    fetch("/api/rsvp?game=" + GAME).then(function (r) { return r.json(); }).then(function (d) {
      if (d.count > 0) list.textContent = d.count + " confirmed: " + d.names.join(", ");
      else list.textContent = "Be the first name on the list.";
    }).catch(function () { list.textContent = ""; });
  }

  // Prefill display name from the email local-part; the visitor can overwrite.
  email.addEventListener("input", function () {
    if (!name.dataset.touched) name.value = (email.value.split("@")[0] || "");
  });
  name.addEventListener("input", function () { name.dataset.touched = "1"; });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, displayName: name.value || email.value.split("@")[0], game: GAME }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { form.querySelector("button").textContent = "You're in ✔"; refresh(); }
      else list.textContent = d.error || "Something went wrong. Try again.";
    });
  });

  refresh();
})();
```

- [ ] **Step 3: Verify copy rules and local render**

Run:
```bash
grep -c "—" site/index.html || echo NO-EMDASH
grep -ci "experiment" site/index.html || echo NO-EXPERIMENT
grep -c "btn-primary" site/index.html
```
Expected: `NO-EMDASH`, `NO-EXPERIMENT`, and `2` (the two CTA bands; both are the same single primary action, RSVP)

- [ ] **Step 4: Commit**

```bash
git add site/index.html site/rsvp.js
git commit -m "feat(site): home page, sizzle scroll with RSVP CTA (copy pending Mike's publish go)"
```

---

### Task 11: RSVP backend (D1 + Pages Function)

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Create: `site/schema.sql`
- Create: `functions/api/rsvp.js`
- Create: `functions/api/_lib.js`
- Create: `.gitignore`
- Modify: `wrangler.toml`
- Test: `tools/rsvp-lib.test.ts`

**Interfaces:**
- Consumes: `wrangler.toml` created by the scaffold task.
- Produces: HTTP contract `POST /api/rsvp` accepting `{email, displayName, game}` returning `{ok: true}` or `{error: string}` (status 400); `GET /api/rsvp?game=YYYY-MM-DD` returning `{count: number, names: string[]}` and NEVER an email address; pure helpers in `functions/api/_lib.js`: `validEmail(s)`, `cleanDisplayName(s)` (trims, caps at 40 chars, strips angle brackets), `resolveDisplay(email, providedName, rosterRows)`.

- [ ] **Step 1: Write `site/schema.sql`**

```sql
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
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
# Roster seeds and any RSVP export contain email addresses.
# They are Tier-2 data (spec section 3) and never enter this repo.
*seed*.sql
*.csv
.wrangler/
```

- [ ] **Step 3: Add the D1 binding to `wrangler.toml`**

Append:

```toml
# RSVP + roster rows (emails). Rows never enter git; see site/schema.sql.
[[d1_databases]]
binding = "POKER_RSVP_DB"
database_name = "poker-rsvp-db"
database_id = "PLACEHOLDER-SET-AT-DEPLOY"
```

(The real `database_id` is pasted in by the manual deploy task after `wrangler d1 create`; the placeholder string is intentional and the deploy task's checklist replaces it.)

- [ ] **Step 4: Write failing tests `tools/rsvp-lib.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import { validEmail, cleanDisplayName, resolveDisplay } from "../functions/api/_lib.js";

describe("validEmail", () => {
  test("accepts ordinary addresses", () => {
    expect(validEmail("gene@example.com")).toBe(true);
  });
  test("rejects junk", () => {
    expect(validEmail("not-an-email")).toBe(false);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("")).toBe(false);
  });
});

describe("cleanDisplayName", () => {
  test("trims and caps length", () => {
    expect(cleanDisplayName("  bg  ")).toBe("bg");
    expect(cleanDisplayName("x".repeat(60)).length).toBe(40);
  });
  test("strips angle brackets", () => {
    expect(cleanDisplayName("<script>bg</script>")).toBe("scriptbg/script");
  });
});

describe("resolveDisplay", () => {
  const roster = [{ email: "beau@example.com", handle: "bg" }];
  test("prefers the roster handle for known emails", () => {
    expect(resolveDisplay("beau@example.com", "whatever", roster)).toBe("bg");
  });
  test("falls back to the provided name", () => {
    expect(resolveDisplay("new@example.com", "The Newcomer", roster)).toBe("The Newcomer");
  });
  test("falls back to the email local-part when no name is provided", () => {
    expect(resolveDisplay("drew@example.com", "", roster)).toBe("drew");
  });
});
```

- [ ] **Step 5: Run tests, verify they fail**

Run: `bun test tools/rsvp-lib.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 6: Write `functions/api/_lib.js`**

```js
// Pure helpers for the RSVP endpoint. Kept dependency-free and runtime-agnostic
// so bun test can exercise them directly.

export function validEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export function cleanDisplayName(s) {
  return String(s || "").replace(/[<>]/g, "").trim().slice(0, 40);
}

// Known emails show their poker handle; unknown ones show what they typed,
// falling back to the email local-part. Never the full email.
export function resolveDisplay(email, providedName, rosterRows) {
  const hit = rosterRows.find(r => r.email.toLowerCase() === String(email).toLowerCase());
  if (hit) return hit.handle;
  const cleaned = cleanDisplayName(providedName);
  return cleaned || String(email).split("@")[0];
}
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `bun test tools/rsvp-lib.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 8: Write `functions/api/rsvp.js`**

```js
// RSVP endpoint. POST records an RSVP (one per email per game, upsert).
// GET returns {count, names} for a game. The GET path NEVER returns emails;
// that constraint is the privacy boundary (spec section 3), not a style choice.
import { validEmail, cleanDisplayName, resolveDisplay } from "./_lib.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const GAME_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const game = new URL(request.url).searchParams.get("game") || "";
  if (!GAME_RE.test(game)) return json({ error: "bad game" }, 400);
  const { results } = await env.POKER_RSVP_DB
    .prepare("SELECT display_name FROM rsvps WHERE game = ? ORDER BY created_at")
    .bind(game).all();
  return json({ count: results.length, names: results.map(r => r.display_name) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  const { email, displayName, game } = body || {};
  if (!validEmail(email)) return json({ error: "That email does not look right." }, 400);
  if (!GAME_RE.test(String(game || ""))) return json({ error: "bad game" }, 400);

  const { results: roster } = await env.POKER_RSVP_DB
    .prepare("SELECT email, handle FROM roster").all();
  const display = resolveDisplay(email, displayName, roster);

  await env.POKER_RSVP_DB
    .prepare(`INSERT INTO rsvps (email, display_name, game) VALUES (?, ?, ?)
              ON CONFLICT(email, game) DO UPDATE SET display_name = excluded.display_name`)
    .bind(email.toLowerCase(), cleanDisplayName(display) || "player", game).run();

  return json({ ok: true });
}
```

- [ ] **Step 9: Integration smoke test (local D1)**

Run:
```bash
bunx wrangler pages dev site --d1 POKER_RSVP_DB 2>/dev/null &
WPID=$!
sleep 6
bunx wrangler d1 execute poker-rsvp-db --local --file site/schema.sql 2>/dev/null || true
curl -s -X POST localhost:8788/api/rsvp -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","displayName":"Tester","game":"2026-09-08"}'
curl -s "localhost:8788/api/rsvp?game=2026-09-08"
kill $WPID
```
Expected: `{"ok":true}` then `{"count":1,"names":["Tester"]}`. The GET body must not contain `test@example.com`. If local wrangler D1 wiring fails in this environment, note it in the task summary; the unit tests in Step 7 remain the gate and the deploy task re-runs this smoke against real D1.

- [ ] **Step 10: Commit**

```bash
git add site/schema.sql .gitignore wrangler.toml functions/api/_lib.js functions/api/rsvp.js tools/rsvp-lib.test.ts
git commit -m "feat(api): RSVP endpoint + D1 schema; emails never leave the database"
```

---

### Task 12: publish-game CLI

**Type:** implementation
**Depends-on:** 3, 4, 5, 6, 7

**Files:**
- Create: `tools/publish-game.ts`
- Test: `tools/publish-game.test.ts`

**Interfaces:**
- Consumes: `parseRows`, `stackSnapshots`, `handCount`, `entryCount`, `ChipConservationError` (log library); `resolveSlug`, `UnknownHandleError` (slug task); `renderStandings`, `renderGamesIndex` (renderer task); `buildChipRace` (chip-race task); `type GamesData` (standings task).
- Produces: `prepareGame(csv: string, results: ResultInput[], data: GamesData, opts: {date: string, buyIn: number}): Game` (pure; throws on chip-conservation or slug failure) where `ResultInput = {handle: string, finish: number, payout: number, rebuys: number, trophies: string[]}`; CLI `bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results <results.json>` which appends to `site/data/games.json`, writes the chip race, and regenerates standings + games index.

- [ ] **Step 1: Write failing tests `tools/publish-game.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { prepareGame } from "./publish-game";
import type { GamesData } from "./lib/standings";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();

const data: GamesData = {
  nextGame: { date: "2026-02-01", time: "7:00pm PT" },
  hopeCoin: { holder: "alice", since: "2026-01-01" },
  players: [
    { slug: "alice", name: "Alice", aka: ["alice"] },
    { slug: "bob", name: "Bob", aka: ["bob"] },
    { slug: "carol", name: "Carol", aka: ["carol"] },
  ],
  games: [],
};

const results = [
  { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: [] },
  { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
  { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
];

describe("prepareGame", () => {
  test("builds a game with entries from chip conservation", () => {
    const g = prepareGame(csv, results, data, { date: "2026-01-01", buyIn: 50 });
    expect(g.entries).toBe(3);
    expect(g.pot).toBe(150);
    expect(g.hands).toBe(3);
    expect(g.results[0].slug).toBe("alice");
  });
  test("halts on an unknown handle", () => {
    const bad = [...results.slice(0, 2), { handle: "mallory", finish: 3, payout: 0, rebuys: 0, trophies: [] }];
    expect(() => prepareGame(csv, bad, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/mallory/);
  });
  test("halts when declared buy-ins disagree with chip conservation", () => {
    const withRebuy = results.map(r => r.handle === "bob" ? { ...r, rebuys: 1 } : r);
    expect(() => prepareGame(csv, withRebuy, data, { date: "2026-01-01", buyIn: 50 }))
      .toThrow(/conservation|entries/i);
  });
  test("rejects a duplicate game date", () => {
    const withGame = { ...data, games: [prepareGame(csv, results, data, { date: "2026-01-01", buyIn: 50 })] };
    expect(() => prepareGame(csv, results, withGame, { date: "2026-01-01", buyIn: 50 })).toThrow(/already/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tools/publish-game.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `tools/publish-game.ts`**

```ts
// One-command game publish (spec section 6, ratchet pass 1).
// Usage: bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json
// results.json: [{handle, finish, payout, rebuys, trophies}]  (the human-judged part)
// The log stays OUTSIDE the repo; only derived public data is written.
import { parseRows, stackSnapshots, handCount, entryCount } from "./lib/pokernow";
import { resolveSlug } from "./lib/slugs";
import { renderStandings, renderGamesIndex } from "./render";
import { buildChipRace } from "./chip-race";
import type { Game, GamesData } from "./lib/standings";

export type ResultInput = { handle: string; finish: number; payout: number; rebuys: number; trophies: string[] };

export function prepareGame(
  csv: string, results: ResultInput[], data: GamesData,
  opts: { date: string; buyIn: number; startingStack?: number }
): Game {
  if (data.games.some(g => g.date === opts.date)) {
    throw new Error(`game ${opts.date} already exists in games.json`);
  }
  const startingStack = opts.startingStack ?? 5000;
  const rows = parseRows(csv);
  const snaps = stackSnapshots(rows);
  const final = snaps[snaps.length - 1].stacks;
  const entries = entryCount(final, startingStack);           // throws ChipConservationError
  const declared = results.length + results.reduce((n, r) => n + r.rebuys, 0);
  if (declared !== entries) {
    throw new Error(
      `entries mismatch: chip conservation says ${entries}, results.json declares ${declared} ` +
      `(players ${results.length} + rebuys ${declared - results.length}). Fix results.json; do not publish.`
    );
  }
  return {
    date: opts.date,
    hands: handCount(rows),
    startingStack,
    buyIn: opts.buyIn,
    entries,
    pot: entries * opts.buyIn,
    results: results
      .map(r => ({ ...r, slug: resolveSlug(r.handle, data.players) }))  // throws UnknownHandleError
      .sort((a, b) => a.finish - b.finish),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const date = flag("--date");
  const resultsPath = flag("--results");
  if (!args[0] || !date || !resultsPath) {
    console.error("usage: bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json [--buyin 50] [--start 5000]");
    process.exit(1);
  }
  const csv = await Bun.file(args[0]).text();
  const results = JSON.parse(await Bun.file(resultsPath).text()) as ResultInput[];
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;

  const game = prepareGame(csv, results, data, {
    date, buyIn: Number(flag("--buyin") ?? 50), startingStack: Number(flag("--start") ?? 5000),
  });

  data.games.push(game);
  await Bun.write("site/data/games.json", JSON.stringify(data, null, 2) + "\n");
  await Bun.write(`site/games/${date}/chip-race.html`, buildChipRace(csv, { date, startingStack: game.startingStack }));
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log(`published ${date}: ${game.entries} entries, $${game.pot} pot, ${game.hands} hands.`);
  console.log(`NEXT (manual): write site/games/${date}/index.html narrative, update nextGame in games.json, review diff, get Mike's go, push.`);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tools/publish-game.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite**

Run: `bun test tools`
Expected: PASS (all tests across all tools)

- [ ] **Step 6: Commit**

```bash
git add tools/publish-game.ts tools/publish-game.test.ts
git commit -m "feat(tools): one-command game publish with chip-conservation + slug halts"
```

---

### Task 13: README slim + publishing runbook

**Type:** implementation
**Depends-on:** 6

**Files:**
- Modify: `README.md`
- Create: `docs/publishing.md`

**Interfaces:**
- Consumes: the generated standings page at `/standings/` (renderer task) as the scoreboard's new home.

**Coordination notes:** README keeps: title, what-this-is, rules links, the Mean Girls rule, the bounty table, and the Hope Coin summary paragraph. The "2026 Season" results table is REPLACED by a link to the site. Repo history preserves the old table; do not archive it into another file.

- [ ] **Step 1: Edit `README.md`**

Replace the "## 2026 Season" section (from that heading to the end of its tables) with:

```markdown
## 📊 Standings, games, and cards

The season record lives at **[poker.kmikeym.com](https://poker.kmikeym.com)**:
[standings](https://poker.kmikeym.com/standings/) ·
[every game](https://poker.kmikeym.com/games/) ·
[the card sets](https://poker.kmikeym.com/cards/).

This README no longer carries a results table. One scoreboard, one home; the
site's standings page is generated from the game record, so it cannot silently
go stale the way this section used to.
```

Also update the "Current Hope Coin Holder" section's skull count line to note Thomas's August skull: after the sentence about Chris being 1 of 3, append: `Thomas (`spladow`) took a skull on his August debut; two challengers now hold one skull each.`

- [ ] **Step 2: Write `docs/publishing.md`**

```markdown
# Publishing a game (the runbook)

Ratchet status: pass 1 (one command + narrative + Mike's go). Each pass
removes a named manual step; see the plan and spec section 6.

## Game night + day after

1. Export the PokerNow log CSV. It is PRIVATE; it never enters this repo.
2. Write `results.json` (the judged part): `[{handle, finish, payout, rebuys, trophies}]`.
3. Run: `bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json`
   - Halts on chip-conservation mismatch or an unknown handle. Fix the input,
     never the check.
4. Write the narrative page `site/games/<date>/index.html` (copy an existing
   game page shell). Dignity rule; no em dashes; no collections/owed content.
5. Update `nextGame` in `site/data/games.json`; update the RSVP `GAME` constant
   in `site/rsvp.js`.
6. Review the full diff. Get Mike's explicit go. Push. Cloudflare deploys.
7. Board: comment results on the month's game issue, close it, open next
   month's issue, add to project #1.

## Cards (per set, still manual by design)

Card copy is judgment; it does not automate. Render per
`munger/ccg/launch-aug-2026/ASSETS.md`, add `site/cards/<YYYY-MM>/`.

## Reminder export (emails, Tier 2)

`wrangler d1 execute poker-rsvp-db --command "SELECT email FROM rsvps WHERE game='YYYY-MM-DD'"`
prints to stdout. Never redirect into a file inside this repo.
```

- [ ] **Step 3: Verify links and commit**

Run: `grep -c "poker.kmikeym.com" README.md`
Expected: ≥ 3

```bash
git add README.md docs/publishing.md
git commit -m "docs: README points at the site scoreboard; add publishing runbook"
```

---

### Task 14: Full suite gate

**Type:** gate
**Depends-on:** 3, 4, 5, 6, 7, 11, 12

Run: `bun test tools`
Expected: all tests pass (pokernow 6, slugs 3, standings 3, render 6, chip-race 3, rsvp-lib 7, publish-game 4 = 32 tests), exit 0.

Also: `bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html`
Expected: exit 0 (committed generated pages are exactly what the renderer produces from the committed data; no drift).

---

### Task 15: Deploy (Cloudflare + DNS + roster)

**Type:** manual
**Depends-on:** 14

Owner: Mike + Charlie together (Cloudflare account access required).

1. `bunx wrangler d1 create poker-rsvp-db` → paste the returned `database_id` into `wrangler.toml` (replacing `PLACEHOLDER-SET-AT-DEPLOY`), commit.
2. `bunx wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql`
3. Create the Pages project from the GitHub repo (production branch `main`, build output `site`, no build command). Confirm the D1 binding `POKER_RSVP_DB` is attached in the Pages project settings.
4. Seed the roster from a LOCAL gitignored file (emails from Mike's records): `bunx wrangler d1 execute poker-rsvp-db --remote --file roster-seed.sql` then delete the local file.
5. DNS: `kmikeym.com` is NOT in Cloudflare; its zone is on Linode nameservers (Mike has the login). First add the custom domain `poker.kmikeym.com` in the Pages project (Custom domains tab; note the verification target it shows). Then in the Linode DNS manager add a CNAME: name `poker`, target the Pages default hostname (`<project>.pages.dev`). Wait for Pages to show the domain active; certificates are automatic.
6. Smoke test on the live URL: POST an RSVP with a test email, confirm the GET shows the display name and NOT the email, then delete the test row: `bunx wrangler d1 execute poker-rsvp-db --remote --command "DELETE FROM rsvps WHERE email='<test-email>'"`.
7. Fix the repo description: `gh repo edit Publicly-Traded-Person/shareholder-poker --description "K5M Shareholder Poker — monthly tournament. Games, standings, cards, and the 🪙 Hope Coin at poker.kmikeym.com. 2nd Tuesday, 7pm Pacific."` (also corrects the 8pm error).

---

### Task 16: Release + board hygiene + wiki pointer

**Type:** release
**Depends-on:** 15

All outward publishing on Mike's explicit go.

1. Push `poker-site`, open a PR to `main`, merge on Mike's go. Cloudflare deploys.
2. Close `shareholder-poker#5` with a results comment (link `/games/2026-08-11/`); per its perpetuation note: create the September 8 game issue, copy the note forward, `gh project item-add 1 --owner Publicly-Traded-Person --url <new-issue-url>`, set its Agent field to Charlie. Close `shareholder-poker#6` (moot).
3. Comment on `operations#25`: beat 5 is now "site publish for game N is live at /games/<date>/" (absence still detectable); README scoreboard retired.
4. File the site itself as a board issue (`agent:charlie`, `endeavor:KmikeyM`) marked shipped, so the work is discoverable; add to project #1.
5. Wiki pointer: add a short Shareholder Poker page to `kmikeym/quarterlykb` (branch `v4` = live): what it is, 2nd Tuesday 7pm PT cadence, link to poker.kmikeym.com. No standings copies. Claim the page on BBS per wiki protocol.
6. Announce in `#poker` (draft by Charlie, posted by Mike or via an available conduit on his go).

---

## Self-review notes

- Spec coverage: §1 canonical rule → Task 16.5 (wiki pointer, no copies); §2 → Tasks 1, 15; §3 tiers → Tasks 9, 11, 13, 15 (+ fixtures rule in 3/8); §4 URLs + spine → Tasks 2, 6, 8, 9, 10; §5 RSVP → Tasks 10, 11; §6 pipeline + ratchet → Tasks 12, 13; §7 visuals → Tasks 1, 9, 10; §8 testing → Tasks 3, 4, 5, 6, 7, 11, 12, 14; §9 rollout → task ordering + 15, 16; §11 fixes → Tasks 9 (handle note), 15.7 (description).
- Deviation from spec §8 ("fixtures = the real July and August logs"): real logs are Tier-3 private, so committed fixtures are synthetic; real logs are exercised at generation time (Task 8) and publish time. Deviation from §6 (tool location) declared in the header.
- Type consistency: `GamesData`/`Game`/`GameResult` defined once in the standings task and imported everywhere; `prepareGame` returns `Game`; RSVP contract identical in Tasks 10 and 11.
