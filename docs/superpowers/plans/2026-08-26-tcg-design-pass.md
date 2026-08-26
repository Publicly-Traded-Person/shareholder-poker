# TCG Design Pass Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make poker.kmikeym.com look like the trading-card economy it is, on phone and desktop, before The Drip promotes it the week of 9/01.

**Architecture:** A CSS contract task defines every new class and SVG mark up front; five page tasks (home, cards index, set page, generated pages, game pages) then build against it in parallel. Static pages are committed HTML edited in place; standings and games index change only through `tools/render.ts`. A new `tools/site.test.ts` codifies per-page invariants so static HTML gets a real test cycle.

**Tech Stack:** Committed HTML/CSS under `site/` (no build step), Bun + TypeScript under `tools/`, `bun test tools` as the suite.

**Spec:** `docs/superpowers/specs/2026-08-26-tcg-design-pass-design.md`

**Acceptance:** suite — the committed Bun suite (extended by Tasks 1 to 8) plus per-task review verifies this work; Mike reads the PR diff before merge, so no sealed exam is needed.

## Global Constraints

- No em dashes anywhere in `site/` copy or output (brand rule; `tools/render.test.ts` and the pre-merge grep enforce it).
- The word "experiment" never appears in `site/`.
- Player names render as first name + last initial ("Chris G."), never a full surname, anywhere in this public repo.
- Every game-derived number comes from `site/data/games.json`, never typed by hand.
- Exactly one lime `.btn-primary` per page, only on a felt `band-cta` band; the RSVP action may repeat, the lime may not (spec §11.1).
- No build step: `site/` is served as committed; nothing may require a bundler or preprocessor.
- `site/standings/index.html` and `site/games/index.html` are generated only by `bun tools/render.ts`; never hand-edit them.
- `site/data/games.json` stays in canonical `JSON.stringify(data, null, 2)` form.
- No emails, RSVP rows, or PokerNow logs enter the repo. No new binary assets (the new `favicon.svg` is text; `pack-rip.gif` is deleted).
- Bands alternate tones; never two of the same tone adjacent; near-black felt only on `band-cta` bands and card art.
- All motion (shimmer, holo) runs only under `prefers-reduced-motion: no-preference`.
- The masthead rarity gradient (`--rarity-rule`) is not reused decoratively elsewhere.
- Every file opens with a header comment; every exported function gets a purpose comment (repo Charlie-maintainability rule, `CLAUDE.md`).
- New microcopy (captions, labels, meta descriptions) reuses existing page copy where possible and gets Charlie's content pass at the PR (flagged in the PR body by Task 10).

---

### Task 1: CSS contract + site invariants test harness

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `site/styles.css`
- Create: `tools/site.test.ts`

**Interfaces:**
- Consumes: existing tokens in `site/styles.css` (`--foil`, `--sapphire`, `--copper`, `--pewter`, `--line`, `--radius`, `--felt`, `--felt-ink`, `--muted-ink`, `--parchment`).
- Produces: CSS classes `.band-inner--wide`, `.cols`, `.rule-label`, `.stat-strip`, `.pills`, `.card-caption`, `.tiles`, `.tile`, `.tile--foil`, `.game-rows`, `.game-row` (with `.date`, `.winner`, `.links` children), `.set-rows`, `.set-row`, `.thumb-strip`, `.card-back`, `.ledger--notes`, `.mark`, `.mark--foil`, `.mark--sapphire`, `.mark--copper`, `.mark--pewter`, `.mark--empty`, `.coin-ring`, `.coin-core`, and the nav rule `nav.band-dark a[aria-current="page"]`. Also produces `tools/site.test.ts` with in-file helpers `siteHtmlFiles(): string[]` and `readPage(p: string): string` that Tasks 2, 4, 5, 6, 8 append `describe` blocks to.

**Parallelization rationale:** contract-first: five page tasks build against these class names and the shared test file in parallel instead of queueing behind a shared stylesheet; a design system's CSS layer preceding page work is what a good engineer does regardless of parallelism.

- [ ] **Step 1: Create `tools/site.test.ts` codifying the two pre-merge greps as permanent tests**

These invariants are already true of the committed site, so they are green on creation (characterization, not red-first TDD; there is no behavior change to drive). The `—` escape keeps this file itself clean under any future repo-wide em-dash grep.

```ts
// Invariants over the committed HTML in site/. These run against the REAL
// pages (not fixtures) so a bad edit fails the suite before it deploys.
// Sits beside the publish flow as a standing guard; run: bun test tools.
// Tasks add per-page describe blocks below the site-wide rules; keep new
// blocks additive and self-contained so they merge cleanly.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Recursively lists every committed .html file under site/.
export function siteHtmlFiles(
  dir = new URL("../site", import.meta.url).pathname
): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...siteHtmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Reads one page as text; every page block below goes through this.
export const readPage = (p: string) => readFileSync(p, "utf8");

describe("site-wide copy rules (the pre-merge greps, now permanent)", () => {
  const pages = siteHtmlFiles();
  test("no em dash in any committed page", () => {
    for (const p of pages) expect(readPage(p)).not.toContain("\u2014");
  });
  test("the banned word never appears", () => {
    for (const p of pages)
      expect(readPage(p).toLowerCase()).not.toContain("experiment");
  });
});
```

- [ ] **Step 2: Run the new test file, expect green**

Run: `bun test tools/site.test.ts`
Expected: PASS (2 tests). If either fails, a committed page already violates a brand rule; stop and report rather than weakening the test.

- [ ] **Step 3: Append the layout and chrome classes to `site/styles.css`**

Append after the existing reduced-motion block, keeping the file's comment density (a header comment per section stating where it is used):

```css
/* Wide container + column split (design pass 2026-08-26). band-inner stays
   720px for prose; galleries and tables opt into the wide variant. .cols is
   the site's one desktop layout split; 900px is the only breakpoint. */
.band-inner--wide { max-width: 1080px; margin: 0 auto; }
.cols { display: grid; grid-template-columns: 1fr; gap: 2rem; align-items: center; }
@media (min-width: 900px) { .cols { grid-template-columns: 1fr 1fr; } }

/* Section header as a labeled hairline (Scryfall pattern). Plain --line
   hairlines on purpose: the rarity gradient is masthead-only (brand rule). */
.rule-label {
  display: flex; align-items: center; gap: 1rem; margin: 0 0 1.5rem;
  text-transform: uppercase; font-size: .78rem; letter-spacing: .09em;
  color: var(--pewter-deep); font-weight: 700;
}
.rule-label::before, .rule-label::after { content: ""; flex: 1; height: 1px; background: var(--line); }

/* Stat strip: the game/set fact line as a quiet bordered chip. */
.stat-strip { display: inline-block; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: .5em 1em; }

/* Lens pills: the related-views row on game pages (Limitless tab pattern). */
.pills { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; padding: 0; list-style: none; }
.pills a {
  display: inline-block; background: #fff; border: 1px solid var(--line);
  border-radius: 999px; padding: .35em 1em; font-size: .88rem; font-weight: 600;
  text-decoration: none; color: var(--ink);
}
.pills a:hover { border-color: var(--sapphire); color: var(--sapphire); }

/* Unboxed card caption: one muted line under a card, outside the frame.
   Replaces the white figcaption boxes that fought the dark card art. */
.card-caption { margin: .5em 0 0; text-align: center; font-size: .82em; color: var(--muted-ink); }

/* Trophy tiles on /standings/ (spec 2026-08-17 §4, closed by this pass). */
.tiles { display: grid; grid-template-columns: 1fr; gap: 1.25rem; margin: 1.25em 0; }
@media (min-width: 900px) { .tiles { grid-template-columns: 1fr 1fr; } }
.tile {
  background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--pewter);
  border-radius: var(--radius); padding: 1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(26, 28, 32, .06);
}
.tile--foil { border-left-color: var(--foil); }
.tile h3 { margin: 0 0 .3em; text-transform: uppercase; font-size: .72em; letter-spacing: .07em; color: var(--pewter-deep); }

/* Game rows on /games/: one bordered card per game instead of a bullet. */
.game-rows { list-style: none; margin: 1.25em 0; padding: 0; display: grid; gap: 1rem; }
.game-row {
  background: #fff; border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 1px 3px rgba(26, 28, 32, .06); padding: 1rem 1.25rem;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem 1.5rem;
}
.game-row .date { font-weight: 800; letter-spacing: -.02em; font-size: 1.15rem; }
.game-row .winner { color: var(--foil-deep); font-weight: 700; }
.game-row .links { margin-left: auto; display: flex; gap: 1rem; }
@media (max-width: 899px) { .game-row .links { margin-left: 0; width: 100%; } }

/* Set rows on /cards/: name left, six thumbnails right. */
.set-rows { list-style: none; margin: 1.25em 0; padding: 0; display: grid; gap: 1.5rem; }
.set-row {
  background: #fff; border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 1px 3px rgba(26, 28, 32, .06); padding: 1.25rem; display: grid; gap: 1rem;
}
@media (min-width: 900px) { .set-row { grid-template-columns: 1fr auto; align-items: center; } }
.thumb-strip { display: flex; flex-wrap: wrap; gap: .5rem; }
.thumb-strip img { width: 72px; border-radius: 4px; border: 1px solid var(--line); }
/* Card back for an unshipped set: felt with a single gold top strip (a
   background strip, not border-image, which breaks on one edge; and not the
   full rarity gradient, which is masthead-only). */
.card-back {
  display: grid; place-items: center; width: 72px; aspect-ratio: 5 / 7;
  border-radius: 4px; padding: .25rem; text-align: center;
  background: linear-gradient(var(--foil), var(--foil)) left top / 100% 3px no-repeat, var(--felt);
  color: var(--felt-ink); font-size: .6rem; text-transform: uppercase; letter-spacing: .05em;
}

/* Game-page results tables: the Notes column wraps, everything else stays
   on one line. Without this the off-screen Notes cell inflates every row's
   height on mobile. Opt-in variant; the standings table has no prose column. */
.ledger--notes td:not(:last-child) { white-space: nowrap; }
.ledger--notes td:last-child { min-width: 18em; }

/* Drawn marks: rarity gems, the Hope Coin. Chrome is drawn, never emoji. */
.mark { display: inline-block; vertical-align: -1px; }
.mark--foil { fill: var(--foil); }
.mark--sapphire { fill: var(--sapphire); }
.mark--copper { fill: var(--copper); }
.mark--pewter { fill: var(--pewter); }
.mark--empty { fill: none; stroke: var(--pewter); stroke-width: 1.2; }
.coin-ring { fill: none; stroke: var(--foil); stroke-width: 1.5; }
.coin-core { fill: var(--foil); }

/* Current page in the masthead. Pages set aria-current="page" on their own
   nav link (generators emit it; committed pages carry it by hand). */
nav.band-dark a[aria-current="page"] { color: var(--sapphire); border-bottom: 2px solid var(--sapphire); }
```

- [ ] **Step 4: Widen the card grid minimum in the existing `.card-grid` rule**

In the existing `.card-grid` declaration, change `minmax(160px, 1fr)` to `minmax(min(240px, 40vw), 1fr)`. Update the neighboring comment: 240px keeps desktop cards readable; the `40vw` floor keeps mobile at 2-up. Delete the `.card-frame figcaption` rule (captions now live outside the frame as `.card-caption`; Task 5 restructures the markup).

- [ ] **Step 5: Sanity-check locally**

Run: `python3 -m http.server -d site 8901` and load `http://localhost:8901/` and `/cards/2026-07/` at 390px and 1440px widths. Expected: no visual regressions beyond slightly larger set-page cards and captionless frames on the set page (its markup still has old figcaptions until Task 5; they now render as plain text lines, acceptable mid-flight on a branch). Stop the server.

- [ ] **Step 6: Run the suite and commit**

Run: `bun test tools`
Expected: PASS (all existing tests plus the 2 new ones).

```bash
git add site/styles.css tools/site.test.ts
git commit -m "feat: CSS contract for the TCG design pass + site invariant tests"
```

---

### Task 2: Favicon + chrome for the utility pages

**Type:** implementation
**Depends-on:** 1
**Commutes:** `tools/site.test.ts`

**Files:**
- Create: `site/favicon.svg`
- Modify: `site/404.html`
- Modify: `site/games/2026-07-14/chip-race.html`
- Modify: `site/games/2026-08-11/chip-race.html`
- Modify: `tools/site.test.ts`

**Interfaces:**
- Consumes: `readPage` helper in `tools/site.test.ts` (from Task 1).
- Produces: `site/favicon.svg` at the URL `/favicon.svg`, referenced by every page via `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` (Tasks 4, 5, 6, 7, 8 emit the same tag on their own pages independently).

- [ ] **Step 1: Append the failing invariant block to `tools/site.test.ts`**

```ts
describe("utility pages carry the favicon", () => {
  for (const rel of [
    "../site/404.html",
    "../site/games/2026-07-14/chip-race.html",
    "../site/games/2026-08-11/chip-race.html",
  ]) {
    test(rel, () =>
      expect(readPage(new URL(rel, import.meta.url).pathname)).toContain(
        'href="/favicon.svg"'
      ));
  }
});
```

- [ ] **Step 2: Run it, expect three failures**

Run: `bun test tools/site.test.ts`
Expected: FAIL, 3 tests (no favicon link on any of the three pages).

- [ ] **Step 3: Create `site/favicon.svg`**

A gold spade on felt, matching the card art's palette. Text asset, no binary:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- Favicon for poker.kmikeym.com: gold spade on table felt. Served at
       /favicon.svg; every page links it. Palette = --felt / --foil. -->
  <rect width="32" height="32" rx="6" fill="#101216"/>
  <path d="M16 5c3.5 5 9 7.5 9 12.5a5 5 0 0 1-8 4c.3 2.5 1.2 4 2.5 5h-7c1.3-1 2.2-2.5 2.5-5a5 5 0 0 1-8-4C7 12.5 12.5 10 16 5Z" fill="#c9a227"/>
</svg>
```

- [ ] **Step 4: Link it from the three pages**

In each `<head>`, after the `<title>` line, add:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
```

Also add to each chip-race page, after the viewport meta, a description that reuses the page's own `.meta` line text (no new copy voice), for example on the August page:

```html
<meta name="description" content="Chip race: 2026-08-11. 8 entries, 211 hands.">
```

and on 404: `<meta name="description" content="That hand does not exist.">`

- [ ] **Step 5: Run tests, expect pass, and verify the icon renders**

Run: `bun test tools/site.test.ts`
Expected: PASS. Then `python3 -m http.server -d site 8902`, load `http://localhost:8902/404.html`, confirm the tab shows the spade, stop the server.

- [ ] **Step 6: Commit**

```bash
git add site/favicon.svg site/404.html site/games/2026-07-14/chip-race.html site/games/2026-08-11/chip-race.html tools/site.test.ts
git commit -m "feat: favicon + head chrome on 404 and chip-race pages"
```

---

### Task 3: The foil holo effect

**Type:** implementation
**Depends-on:** none
**Commutes:** `site/styles.css`

**Files:**
- Create: `site/holo.js`
- Modify: `site/styles.css`

**Interfaces:**
- Consumes: existing `.card-frame` and `.shimmer` rules in `site/styles.css`.
- Produces: class `card-frame--holo` (added to a `.card-frame` element to opt in) and script `site/holo.js` loaded as `<script src="/holo.js" defer></script>`. Tasks 4 and 5 attach both to the foil card.

**Parallelization rationale:** the effect is a self-contained progressive enhancement over classes that already exist; naming its contract here lets the home and set pages wire it up in parallel. A good engineer isolates an optional effect in its own file regardless.

- [ ] **Step 1: Create `site/holo.js`**

Written from scratch: the simeydotme repository publishes no license, so we implement the standard technique (pointer position drives CSS custom properties), not their code.

```js
/* holo.js: pointer-driven foil effect for the champion card.
   Served at /holo.js; loaded with `defer` by pages that show the foil
   (home, the set page). Progressive enhancement in three layers:
     no JS                -> the CSS .shimmer animation (styles.css)
     touch-only device    -> shimmer (no pointer to track)
     reduced motion       -> nothing moves (CSS guards + the bail below)
   The script only writes two custom properties (--hx, --hy, both 0..1) and
   toggles .is-holo; every visual is CSS in styles.css ("Holo effect"). */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (reduced.matches || !finePointer.matches) return;
  document.querySelectorAll(".card-frame--holo").forEach(function (card) {
    var raf = 0;
    card.addEventListener("pointerenter", function () {
      card.classList.add("is-holo");
    });
    card.addEventListener("pointermove", function (e) {
      if (raf) return; /* one write per frame, not per event */
      raf = requestAnimationFrame(function () {
        raf = 0;
        var r = card.getBoundingClientRect();
        card.style.setProperty("--hx", (e.clientX - r.left) / r.width);
        card.style.setProperty("--hy", (e.clientY - r.top) / r.height);
      });
    });
    card.addEventListener("pointerleave", function () {
      card.classList.remove("is-holo");
      card.style.setProperty("--hx", 0.5);
      card.style.setProperty("--hy", 0.5);
    });
  });
})();
```

- [ ] **Step 2: Append the holo CSS to `site/styles.css`**

Append at the end of the file (inside a fresh reduced-motion guard, separate from Task 1's additions):

```css
/* Holo effect (driven by /holo.js writing --hx/--hy). Foil card only:
   scarcity of the effect is what makes the foil mean something. Guarded
   like the shimmer; without JS or with reduced motion nothing here fires. */
@media (prefers-reduced-motion: no-preference) {
  .card-frame--holo { --hx: .5; --hy: .5; position: relative; }
  .card-frame--holo.is-holo {
    will-change: transform;
    transition: none;
    transform: perspective(700px)
      rotateY(calc((var(--hx) - .5) * 16deg))
      rotateX(calc((.5 - var(--hy)) * 16deg));
  }
  .card-frame--holo::before {
    content: ""; position: absolute; inset: 0; z-index: 1;
    pointer-events: none; opacity: 0;
    background: radial-gradient(circle at calc(var(--hx) * 100%) calc(var(--hy) * 100%),
      rgba(255, 255, 255, .45), transparent 55%);
    mix-blend-mode: screen;
  }
  .card-frame--holo.is-holo::before { opacity: 1; }
  .card-frame--holo.is-holo::after {
    animation: none;
    background: linear-gradient(115deg, transparent 20%,
      rgba(201, 162, 39, .25) calc(var(--hx) * 100% - 15%),
      rgba(43, 93, 158, .25) calc(var(--hx) * 100%),
      rgba(176, 108, 63, .25) calc(var(--hx) * 100% + 15%),
      transparent 80%);
    mix-blend-mode: color-dodge;
  }
}
```

- [ ] **Step 3: Verify by hand against a scratch page**

There is no DOM test rig in this repo (the suite is Bun over `tools/`), so this task verifies manually and the gate re-verifies. Create a scratch file OUTSIDE the repo (`/tmp` or the session scratchpad), for example `scratch-holo.html`, containing a `.card-frame.card-frame--holo.shimmer` div with one of the committed card PNGs, `<link rel="stylesheet" href="/styles.css">`, and `<script src="/holo.js" defer></script>`; serve `site/` with `python3 -m http.server -d site 8903` and open the scratch markup pasted into the browser via a data URL or by temporarily serving it, then confirm: tilt and glare follow the pointer; leaving the card resets it; with OS reduced-motion on, nothing moves. Do not commit any scratch file.

- [ ] **Step 4: Commit**

```bash
git add site/holo.js site/styles.css
git commit -m "feat: pointer-driven holo effect for the foil card (from-scratch, guarded)"
```

---

### Task 4: Home page

**Type:** implementation
**Depends-on:** 1, 3
**Commutes:** `tools/site.test.ts`

**Files:**
- Modify: `site/index.html`
- Modify: `tools/site.test.ts`

**Interfaces:**
- Consumes: `.band-inner--wide`, `.cols` (Task 1); `card-frame--holo` + `/holo.js` (Task 3); `readPage` (Task 1).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Append the failing home invariants to `tools/site.test.ts`**

```ts
describe("home page invariants", () => {
  const html = readPage(new URL("../site/index.html", import.meta.url).pathname);
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("exactly one lime button (brand: one lime action per page)", () =>
    expect(html.split("btn-primary").length - 1).toBe(1));
  test("marks Home current in the nav", () =>
    expect(html).toContain('<a href="/" aria-current="page">'));
  test("carries link-unfurl tags", () =>
    expect(html).toContain('property="og:image"'));
  test("loads the holo script", () =>
    expect(html).toContain('src="/holo.js"'));
});
```

Note: this block reads the file at test-collection time, so it sees the state on disk when `bun test` runs.

- [ ] **Step 2: Run it, expect five failures**

Run: `bun test tools/site.test.ts`
Expected: FAIL on all five new tests (the footer button is currently `btn-primary`, so the count is 2, and none of the new chrome exists).

- [ ] **Step 3: Edit `site/index.html`**

All edits, in order:

1. Head, after `<title>`: favicon link (same tag as Task 2) plus the unfurl block. The description reuses the existing meta description verbatim:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="K5M Shareholder Poker">
<meta property="og:description" content="Shareholders who play poker. Second Tuesday of every month, 7pm Pacific. Real stakes, real cards, real grudges.">
<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png">
<meta property="og:url" content="https://poker.kmikeym.com/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
```

2. Nav: change `<a href="/">Home</a>` to `<a href="/" aria-current="page">Home</a>`.
3. "The foil is in play" band: change its `band-inner` to `band-inner band-inner--wide`; replace the inline `style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:center;"` div with `<div class="cols">`; on the figure, replace `style="max-width:220px;"` with `style="max-width:300px; margin:0 auto;"` and add `card-frame--holo` to its class list (keeping `card-frame shimmer`). Remove the inner `style="flex:1; min-width:240px;"` (a plain `<div>` in the grid needs none).
4. Footer CTA: on the `#rsvp-jump` anchor, change `class="btn-primary"` to `class="btn-secondary"` (spec §11.1: the action repeats, the lime does not; `rsvp.js` only sets its text, never queries the class).
5. Before `</body>`, next to the existing rsvp script: `<script src="/holo.js" defer></script>`.

- [ ] **Step 4: Run tests, then look at it**

Run: `bun test tools/site.test.ts`
Expected: PASS. Then serve (`python3 -m http.server -d site 8904`) and check 390px and 1440px: desktop shows card beside copy; mobile stacks card above copy, centered; hovering the card on desktop tilts it; the footer CTA is a white outline on felt.

- [ ] **Step 5: Commit**

```bash
git add site/index.html tools/site.test.ts
git commit -m "feat: home page: wide foil band, holo card, one lime, unfurl tags"
```

---

### Task 5: Set page (The Founder's Table)

**Type:** implementation
**Depends-on:** 1, 3
**Commutes:** `tools/site.test.ts`

**Files:**
- Modify: `site/cards/2026-07/index.html`
- Modify: `site/cards/2026-07/assets/pack-rip.gif`
- Modify: `tools/site.test.ts`

**Interfaces:**
- Consumes: `.band-inner--wide`, `.rule-label`, `.card-caption`, `.stat-strip`, `.mark` classes and the gem SVG shape (Task 1); `card-frame--holo` + `/holo.js` (Task 3); `readPage` (Task 1).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Append the failing set-page invariants to `tools/site.test.ts`**

```ts
describe("set page invariants (2026-07)", () => {
  const html = readPage(
    new URL("../site/cards/2026-07/index.html", import.meta.url).pathname
  );
  test("no emoji chrome", () => {
    for (const e of ["✨", "⭐", "◆", "●", "\u{1FA99}"])
      expect(html).not.toContain(e);
  });
  test("captions are unboxed card-caption lines", () =>
    expect(html).toContain('class="card-caption"'));
  test("the pack rip gif is gone", () =>
    expect(html).not.toContain("pack-rip.gif"));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
});
```

(The escapes are the sparkle, star, diamond, circle, and coin emoji currently in the captions.)

- [ ] **Step 2: Run it, expect five failures**

Run: `bun test tools/site.test.ts`
Expected: FAIL on all five new tests.

- [ ] **Step 3: Rework `site/cards/2026-07/index.html`**

1. Head: favicon link plus unfurl tags; description reuses the intro copy:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="description" content="Six cards, minted from the July 14 game. Real players, real stats.">
<meta property="og:title" content="Set 1: The Founder's Table">
<meta property="og:description" content="Six cards, minted from the July 14 game. Real players, real stats.">
<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png">
<meta property="og:url" content="https://poker.kmikeym.com/cards/2026-07/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
```

2. Nav: `aria-current="page"` on the `/cards/` link.
3. Intro band: after the h1's paragraph, add the set plate line
   `<p class="stat stat-strip">6 cards · minted July 14, 2026 · 201 hands</p>`
   (all three figures already appear in this page's committed copy; no new
   hand-typed numbers).
4. "The set" band: `band-inner` becomes `band-inner band-inner--wide`; the
   `<h2 class="display">The set</h2>` becomes
   `<h2 class="rule-label">The set · 6 cards</h2>`.
5. Restructure all six figures: frame wraps only the image, caption moves
   outside and loses its emoji. The gem SVG is the Task 1 shape. Card 1
   (exact markup; cards 2 to 6 follow the same shape with their own image,
   alt text, gem metal, and caption):

```html
<figure>
  <div class="card-frame card-frame--holo shimmer"><img src="assets/card-1-lewd.png" alt="Foil champion card: Chris G., LEWD, 1st place"></div>
  <figcaption class="card-caption"><svg class="mark mark--foil" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg> Foil · Chris G. · Champion</figcaption>
</figure>
```

Captions and gem metals for the rest (alt text unchanged from the current
page; only card 1 gets `card-frame--holo`):
- card 2, `mark--sapphire`: `Rare · Nick M. · 2nd, holds the Coin`
- card 3, `mark--sapphire`: `Rare · Beau G. · 3rd`
- card 4, `mark--copper`: `Uncommon · Mike M. · The Founder`
- card 5, `mark--pewter`: `Common · Amy M. · The Patient Rock`
- card 6, `mark--pewter`: `Common · Gene · Mysterious Wildcard`

6. Delete the whole "The pack rip" section (spec §11.2) and delete
   `site/cards/2026-07/assets/pack-rip.gif` (`git rm`).
7. The footer: because the page now ends on the dark "set" band, flip the
   footer to `band-light` (tone alternation) and give it both closing links:

```html
<footer class="band-light" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat"><a href="/games/2026-07-14/">The game these cards came from</a> · <a href="/cards/">All sets</a></p></div>
</footer>
```

8. Before `</body>`: `<script src="/holo.js" defer></script>`.

- [ ] **Step 4: Run tests, then look at it**

Run: `bun test tools/site.test.ts`
Expected: PASS. Serve and check 390px and 1440px: desktop shows the six cards at readable size (about 4-up), mobile 2-up; captions are quiet lines, not boxes; the foil card tilts on hover.

- [ ] **Step 5: Commit**

```bash
git add site/cards/2026-07/index.html tools/site.test.ts
git rm site/cards/2026-07/assets/pack-rip.gif
git commit -m "feat: set page: decaptioned wide gallery, holo foil, pack rip cut"
```

---

### Task 6: Cards index gallery

**Type:** implementation
**Depends-on:** 1
**Commutes:** `tools/site.test.ts`

**Files:**
- Modify: `site/cards/index.html`
- Modify: `tools/site.test.ts`

**Interfaces:**
- Consumes: `.band-inner--wide`, `.set-rows`, `.set-row`, `.thumb-strip`, `.card-back` (Task 1); `readPage` (Task 1).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Append the failing invariants to `tools/site.test.ts`**

```ts
describe("cards index gallery", () => {
  const html = readPage(
    new URL("../site/cards/index.html", import.meta.url).pathname
  );
  test("shows all six Set 1 thumbnails", () =>
    expect(html.split("/cards/2026-07/assets/").length - 1).toBe(6));
  test("teases Set 2 with a drawn card back", () =>
    expect(html).toContain('class="card-back"'));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
});
```

- [ ] **Step 2: Run it, expect four failures**

Run: `bun test tools/site.test.ts`
Expected: FAIL on all four.

- [ ] **Step 3: Rework `site/cards/index.html`**

Head gains the favicon link and `<meta name="description" content="Every month's game mints a set. The players are the cards; the stats are real.">` (reuses the page's own line). Nav marks `/cards/` current. The list becomes set rows in a wide band; existing copy carries over verbatim:

```html
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Card sets</h1>
    <p>Every month's game mints a set. The players are the cards; the stats are real.</p>
    <ul class="set-rows">
      <li class="set-row">
        <div>
          <h2 class="display"><a href="/cards/2026-07/">Set 1: The Founder's Table</a></h2>
          <p class="stat">July 14, 2026 · six cards</p>
        </div>
        <a class="thumb-strip" href="/cards/2026-07/" aria-hidden="true" tabindex="-1">
          <img src="/cards/2026-07/assets/card-1-lewd.png" alt="" loading="lazy">
          <img src="/cards/2026-07/assets/card-2-nickmershon.png" alt="" loading="lazy">
          <img src="/cards/2026-07/assets/card-3-bg.png" alt="" loading="lazy">
          <img src="/cards/2026-07/assets/card-4-kmikeym.png" alt="" loading="lazy">
          <img src="/cards/2026-07/assets/card-5-amaxwell.png" alt="" loading="lazy">
          <img src="/cards/2026-07/assets/card-6-webvee.png" alt="" loading="lazy">
        </a>
      </li>
      <li class="set-row">
        <div>
          <h2 class="display">Set 2</h2>
          <p>August 11, 2026. In production. A second-game winner and a deposed champion are waiting on their cards.</p>
        </div>
        <div class="thumb-strip"><span class="card-back">In production</span></div>
      </li>
    </ul>
  </div>
</section>
```

The thumbnails are decorative (`alt=""`, `aria-hidden`, `tabindex="-1"`) because the adjacent heading is the accessible link. Footer stays `band-dark` (the page still ends on a light band).

- [ ] **Step 4: Run tests, then look at it**

Run: `bun test tools/site.test.ts`
Expected: PASS. Serve and check both widths: desktop puts thumbnails beside the set name; mobile wraps them below it.

- [ ] **Step 5: Commit**

```bash
git add site/cards/index.html tools/site.test.ts
git commit -m "feat: cards index becomes a set gallery with thumbnails"
```

---

### Task 7: Generated pages (render.ts): chrome, trophies, game rows, cardSet

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `tools/render.ts`
- Modify: `tools/lib/standings.ts`
- Modify: `tools/render.test.ts`
- Modify: `tools/data.test.ts`
- Modify: `site/data/games.json`
- Modify: `site/standings/index.html`
- Modify: `site/games/index.html`
- Modify: `docs/publishing.md`

**Interfaces:**
- Consumes: CSS classes `.band-inner--wide`, `.tiles`, `.tile`, `.tile--foil`, `.game-rows`, `.game-row`, `.mark*`, `.coin-ring`, `.coin-core`, nav `aria-current` styling (Task 1).
- Produces: `Game.cardSet?: string` on the shared type in `tools/lib/standings.ts`; `page(title, body, footerTone, current, description)` internal to render.ts; regenerated standings and games pages.

The two `site/*/index.html` paths above are generated outputs: never hand-edit them; they change only via `bun tools/render.ts` in Step 8.

This task is `**Review:** adversarial` because it edits the data spine (`games.json` canonical form) and the public standings numbers; every step keeps exact code.

- [ ] **Step 1: Add the failing render tests**

In `tools/render.test.ts`, add `cardSet: "2026-07",` to the fixture's game object (between `pot: 150,` and `results:`), then append inside the existing `describe("renderStandings", ...)`:

```ts
  test("marks the current page in the nav and links the favicon", () => {
    expect(html).toContain('<a href="/standings/" aria-current="page">');
    expect(html).toContain('href="/favicon.svg"');
  });
  test("shows the trophy tiles", () => {
    expect(html).toContain("The Foil");
    expect(html).toContain('class="tiles"');
    expect(html).toContain("Chris G.");
  });
  test("draws marks as svg, never emoji", () => {
    expect(html).not.toContain("\u{1FA99}");
    expect(html).toContain('class="mark');
  });
```

and inside `describe("renderGamesIndex", ...)`:

```ts
  test("renders each game as a game-row card", () => {
    expect(html).toContain('class="game-row"');
    expect(html).toContain("3 entries · $150 pot · 201 hands");
  });
  test("links the month's card set when the game has one", () => {
    expect(html).toContain('href="/cards/2026-07/"');
  });
  test("marks the current page in the nav", () => {
    expect(html).toContain('<a href="/games/" aria-current="page">');
  });
```

- [ ] **Step 2: Run them, expect failures**

Run: `bun test tools/render.test.ts`
Expected: FAIL on all six new tests (and a TypeScript complaint about `cardSet` until Step 3).

- [ ] **Step 3: Add `cardSet` to the `Game` type**

In `tools/lib/standings.ts`, inside `export type Game`, between `pot: number;` and `results: GameResult[];`:

```ts
  // "YYYY-MM": that month's set page at /cards/<cardSet>/, once it exists.
  // Optional; games whose sets are still in production omit it.
  cardSet?: string;
```

- [ ] **Step 4: Rewrite `tools/render.ts`**

The complete new file (header comment and RECORD_QUALIFIER unchanged from today):

```ts
// Renders the derived pages (standings, games index) as full committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData } from "./lib/standings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The generated record starts with July 2026, the first game on the games.json
// data spine. Earlier seasons (2020, and April and June 2026) are real games,
// documented in README.md, that predate the spine and are being backfilled.
// Standings and the games index must say so, not read as an all-time claim.
const RECORD_QUALIFIER =
  "This record starts with July 2026. Earlier seasons (2020, and April and June 2026) predate the data spine and are being backfilled.";

// Inline SVG marks: rarity gems and the Hope Coin. Chrome is drawn, never
// emoji (design spec 2026-08-26 §7.3). Class names are the contract with
// site/styles.css (.mark rules); change both together or neither.
const GEM = (metal: "foil" | "sapphire" | "copper" | "pewter") =>
  `<svg class="mark mark--${metal}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg>`;
const GEM_EMPTY =
  `<svg class="mark mark--empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z"/></svg>`;
const COIN =
  `<svg class="mark" viewBox="0 0 12 12" width="12" height="12" role="img" aria-label="Hope Coin"><circle class="coin-ring" cx="6" cy="6" r="5"/><circle class="coin-core" cx="6" cy="6" r="2.2"/></svg>`;

// nav(current) renders the masthead links, marking the page's own link with
// aria-current so visitors can see where they are (styled in styles.css).
const nav = (current: string) =>
  ([["/", "Home"], ["/games/", "Games"], ["/cards/", "Cards"], ["/standings/", "Standings"]] as const)
    .map(([href, label]) =>
      `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join(" · ");

// footerTone is the background class for the closing footer band. Bands must
// alternate light/dark with no two of the same tone touching (brand rule), so
// the caller passes whichever tone opposes its own last section. `current` is
// the page's own nav href; `description` fills the meta/og description.
function page(
  title: string,
  body: string,
  footerTone: "band-light" | "band-dark",
  current: string,
  description: string
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | K5M Shareholder Poker</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="${esc(title)} | K5M Shareholder Poker">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner">${nav(current)}</div>
</nav>
${body}
<footer class="${footerTone}" style="padding:1.5rem 1.25rem; text-align:center;">
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
  // The reigning champion is the winner of the most recent game on the spine.
  const latest = [...data.games].sort((a, b) => b.date.localeCompare(a.date))[0];
  const champ = latest.results.find(r => r.finish === 1)!;
  const champName = nameOf.get(champ.slug) ?? champ.slug;
  const skulls = Object.entries(s.hopeCoin.skulls)
    .map(([slug, n]) =>
      `<li>${esc(nameOf.get(slug) ?? slug)}: ${GEM("copper").repeat(n)}${GEM_EMPTY.repeat(3 - n)} <span class="stat">${n} of 3</span> skulls</li>`)
    .join("\n          ");
  const rows = s.rows.map((r, i) => `      <tr class="finish-${i + 1}">
        <td>${esc(r.name)}${r.slug === champ.slug ? " " + GEM("foil") : ""}${r.slug === s.hopeCoin.holder ? " " + COIN : ""}</td>
        <td class="num">${r.games}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.cashes}</td>
        <td class="num">${r.bestFinish}</td>
        <td class="num">$${r.totalPayout}</td>
        <td class="num">${r.rebuys}</td>
      </tr>`).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Standings</h1>
    <p class="stat">${RECORD_QUALIFIER}</p>
    <div class="tiles">
      <div class="tile tile--foil">
        <h3>The Foil</h3>
        <p><strong>${esc(champName)}</strong> ${GEM("foil")} holds the foil: won ${latest.date}.${latest.cardSet ? ` <a href="/cards/${latest.cardSet}/">The card set</a>.` : ""}</p>
      </div>
      <div class="tile">
        <h3>The Hope Coin ${COIN}</h3>
        <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
        <ul>
          ${skulls}
        </ul>
      </div>
    </div>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Won</th><th>Rebuys</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
  </div>
</section>`;
  return page(
    "Standings", body, "band-dark", "/standings/",
    "Wins, cashes, payouts, and the Hope Coin race for every K5M Shareholder Poker game."
  );
}

export function renderGamesIndex(data: GamesData): string {
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const items = [...data.games].sort((a, b) => b.date.localeCompare(a.date)).map(g => {
    const winner = g.results.find(r => r.finish === 1)!;
    const cards = g.cardSet ? ` · <a href="/cards/${g.cardSet}/">The cards</a>` : "";
    return `    <li class="game-row">
      <span class="date"><a href="/games/${g.date}/">${g.date}</a></span>
      <span class="winner">${esc(nameOf.get(winner.slug) ?? winner.slug)} ${GEM("foil")} won</span>
      <span class="stat">${g.entries} entries · $${g.pot} pot · ${g.hands} hands</span>
      <span class="links"><a href="/games/${g.date}/">The game</a>${cards}</span>
    </li>`;
  }).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Games</h1>
    <p>Second Tuesday of every month, 7pm PT. Next: <strong>${data.nextGame.date}</strong>.</p>
    <p class="stat">${RECORD_QUALIFIER}</p>
    <ul class="game-rows">
${items}
    </ul>
  </div>
</section>`;
  return page(
    "Games", body, "band-dark", "/games/",
    "Every K5M Shareholder Poker game, newest first: winners, pots, and hand counts."
  );
}

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log("rendered site/standings/index.html and site/games/index.html");
}
```

- [ ] **Step 5: Run the render tests, expect pass**

Run: `bun test tools/render.test.ts`
Expected: PASS (all old and new tests; the old "shows the coin holder with skull progress" test still passes because the tile keeps "Nick M.", "Hope Coin", and "1 of 3").

- [ ] **Step 6: Add the failing data test for `cardSet`**

Append to `tools/data.test.ts` (add `import { existsSync } from "node:fs";` at the top, below the bun:test import):

```ts
describe("card set references", () => {
  test("cardSet names that month's set page, and the page exists", () => {
    for (const g of data.games) {
      if (g.cardSet === undefined) continue;
      expect(g.cardSet).toBe(g.date.slice(0, 7));
      expect(
        existsSync(new URL(`../site/cards/${g.cardSet}/index.html`, import.meta.url).pathname)
      ).toBe(true);
    }
  });
});
```

Run: `bun test tools/data.test.ts`
Expected: PASS but vacuously (no game has `cardSet` yet); the next step makes it bite.

- [ ] **Step 7: Add `cardSet` to the July game in `site/data/games.json`**

In the July game object, insert one line between `"pot": 450,` and `"results": [`:

```json
      "cardSet": "2026-07",
```

The August game gets no `cardSet` (its set is in production). Two-space indentation exactly as shown keeps the canonical `JSON.stringify(data, null, 2)` form; verify with:

Run: `bun -e 'const d=await Bun.file("site/data/games.json").json(); const c=JSON.stringify(d,null,2)+"\n"; if(await Bun.file("site/data/games.json").text()!==c) throw new Error("games.json is not canonical");'`
Expected: no output (exit 0).

Run: `bun test tools/data.test.ts`
Expected: PASS with the new test now exercising the July entry.

- [ ] **Step 8: Regenerate the committed pages**

Run: `bun tools/render.ts && git diff --stat site/standings/index.html site/games/index.html`
Expected: both files change (new chrome, tiles, game rows). Eyeball the diff: names stay "First L." form, numbers match `games.json`, no emoji anywhere in either file.

- [ ] **Step 9: Update the runbook's Cards section**

In `docs/publishing.md`, extend the "Cards (per set, still manual by design)" section with one sentence at the end:

```markdown
When the set page ships, add `"cardSet": "YYYY-MM"` to that game's object in
`site/data/games.json` (after `"pot"`), add the set to the gallery rows in
`site/cards/index.html`, and re-run `bun tools/render.ts` so the games index
links it. The data suite checks the referenced page exists.
```

- [ ] **Step 10: Run the whole suite and commit**

Run: `bun test tools`
Expected: PASS.

```bash
git add tools/render.ts tools/lib/standings.ts tools/render.test.ts tools/data.test.ts site/data/games.json site/standings/index.html site/games/index.html docs/publishing.md
git commit -m "feat: generated pages: trophy tiles, game rows, drawn marks, cardSet links"
```

---

### Task 8: Game pages + runbook shell update

**Type:** implementation
**Depends-on:** 1
**Commutes:** `tools/site.test.ts`

**Files:**
- Modify: `site/games/2026-07-14/index.html`
- Modify: `site/games/2026-08-11/index.html`
- Modify: `docs/publishing.md`
- Modify: `tools/site.test.ts`

**Interfaces:**
- Consumes: `.pills`, `.stat-strip`, `.ledger--notes` (Task 1); `readPage` (Task 1).
- Produces: the game-page shell (pills + stat strip + notes-table variant) that `docs/publishing.md` step 4 tells Charlie to copy for future games.

- [ ] **Step 1: Append the failing game-page invariants to `tools/site.test.ts`**

```ts
describe("game page shells", () => {
  for (const rel of [
    "../site/games/2026-07-14/index.html",
    "../site/games/2026-08-11/index.html",
  ]) {
    const html = readPage(new URL(rel, import.meta.url).pathname);
    test(`${rel} has the lens pills`, () =>
      expect(html).toContain('class="pills"'));
    test(`${rel} uses the notes table variant`, () =>
      expect(html).toContain("ledger ledger--notes"));
    test(`${rel} has the stat strip`, () =>
      expect(html).toContain("stat-strip"));
    test(`${rel} links the favicon`, () =>
      expect(html).toContain('href="/favicon.svg"'));
  }
});
```

- [ ] **Step 2: Run it, expect eight failures**

Run: `bun test tools/site.test.ts`
Expected: FAIL, 8 tests (4 per page).

- [ ] **Step 3: Edit both game pages**

Read `site/games/2026-07-14/index.html` first; it shares the August shell. On each page:

1. Head: the favicon link, plus a meta description reusing the page's own
   stat line, for example on the August page
   `<meta name="description" content="August 11, 2026: 211 hands, 8 entries, $400 pot.">`
   (July mirrors its own committed figures from its stat line).
2. Nav: `aria-current="page"` on the `/games/` link (these pages live under
   Games).
3. After the `<h1>`, the lens pills. August (no set page yet, so no cards
   pill):

```html
<ul class="pills">
  <li><a href="#story">Story</a></li>
  <li><a href="#results">Results</a></li>
  <li><a href="chip-race.html">Chip race</a></li>
  <li><a href="/standings/">Standings</a></li>
</ul>
```

July adds `<li><a href="/cards/2026-07/">The cards</a></li>` before the Standings pill.
4. The stat line under the h1 gains the chip treatment: `class="stat"` becomes `class="stat stat-strip"`.
5. Anchors: add `id="story"` to the narrative paragraph (the `<p><strong>` one) and `id="results"` to the `table-scroll` div.
6. The results table: `class="ledger"` becomes `class="ledger ledger--notes"`.

Leave the Notes-cell copy untouched, including its emoji: those cells are Charlie's narrative voice, not chrome (spec §7.3 scope).

- [ ] **Step 4: Update the runbook shell instruction**

In `docs/publishing.md`, step 4 of "Game night + day after" currently reads "(copy an existing game page shell)". Extend that step with:

```markdown
   The shell includes the head chrome (favicon link, meta description from
   the stat line), the lens pills under the h1 (Story · Results · Chip race
   · Standings, plus "The cards" once the month's set page exists), the
   `stat stat-strip` fact line, `id="story"`/`id="results"` anchors, and
   `ledger ledger--notes` on the results table. Copy the newest game page
   to get all of it.
```

- [ ] **Step 5: Run tests, then look at both pages**

Run: `bun test tools/site.test.ts`
Expected: PASS. Serve and check the August page at 390px: table rows are now compact (the Notes column wraps; the rest stays on one line) and the table scrolls sideways inside its container.

- [ ] **Step 6: Commit**

```bash
git add site/games/2026-07-14/index.html site/games/2026-08-11/index.html docs/publishing.md tools/site.test.ts
git commit -m "feat: game pages: lens pills, stat strip, compact notes tables"
```

---

### Task 9: Full verification gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8

**Files:**
- Test: `bun test tools`

Expectations, all of which must hold on the integrated tree:

- `bun test tools` green (the 65 pre-existing tests plus every test added by Tasks 1 to 8).
- Drift check clean: `bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html`.
- Brand greps empty: `grep -rl "—" site/` and `grep -ril "experiment" site/` both return nothing.
- games.json canonical: the Task 7 Step 7 one-liner exits 0.
- `pack-rip.gif` no longer exists anywhere under `site/`.
- Serve `site/` and confirm: `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT/favicon.svg` returns 200.

---

### Task 10: Branch, PR, and follow-up issues

**Type:** release
**Depends-on:** 9

**Files:**
- Test: `git push` / `gh pr create` / `gh issue create` (no repo file changes)

Steps, run after the gate is green:

1. Push the integration branch and open a PR to `main` with `gh pr create`. The PR body must state: what the pass changes (link the spec), that **new microcopy needs Charlie's content pass** (set-page captions, tile labels, meta descriptions, runbook wording), and that merge waits on **Mike's explicit go** because `main` deploys the live site.
2. File the two follow-up issues Mike approved in spec §11:
   - "Pack rip v2: deal the set" (the tap-through reveal from spec §6b, plus a composed 1200x630 OG image from §11.3), referencing the spec path.
   - Use `gh issue create` on this repo; add both to the project board per house convention.
3. Do not merge. Merging is Task 11 (Mike).

---

### Task 11: Mike's go, merge, live verification

**Type:** manual
**Depends-on:** 10

**Files:**
- Test: live-site checks below (no repo file changes)

1. Mike (with Charlie's content pass) reviews the PR and merges on his explicit go. Merge to `main` deploys to poker.kmikeym.com automatically.
2. After deploy, verify live: favicon returns 200 at `https://poker.kmikeym.com/favicon.svg`; home, `/cards/`, `/cards/2026-07/`, `/games/`, `/games/2026-08-11/`, `/standings/` all load with the new chrome at phone and desktop widths; the RSVP GET still answers (`curl "https://poker.kmikeym.com/api/rsvp?game=2026-09-08"` returns a count and names, never an email).
3. Board hygiene: comment on and close the design-pass issue if one exists; note completion on the BBS thread so Thalberg knows the promo dependency is clear (Sid routed it, Charlie owns the surface).

---

## Operator smoke

- do: open https://poker.kmikeym.com/ on your phone, then on a desktop browser.
  see: the phone stacks one column; the desktop shows the foil card sitting beside its story, with real margins, not a stretched phone page.
- do: on desktop, move your mouse slowly across the foil card on the home page.
  see: the card tilts toward the pointer with a moving shine; the other cards on the set page do not.
- do: paste https://poker.kmikeym.com/ into a Discord message (or the Slack/Substack composer).
  see: the unfurl shows a title, description, and the champion card image.
- do: open /standings/ and find the current champion in the table.
  see: a small gold gem after their name, a gold-edged "The Foil" tile above the table, and a drawn coin (not an emoji) on the Hope Coin tile.
- do: open /games/2026-08-11/ on your phone and swipe the results table.
  see: compact rows that fit several to a screen, with the Notes column wrapping instead of stretching every row.
