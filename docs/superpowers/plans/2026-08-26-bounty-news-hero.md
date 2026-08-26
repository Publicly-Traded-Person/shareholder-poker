# Bounty Board, News Band, Hero Fan Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the home page the official-TCG-site grammar: a bounty board (the signature), a 3-up news band, and card art in the hero, all runtime-honest via a small facts script.

**Architecture:** One contract task adds the CSS and the `site/home-facts.js` runtime filler; one page task restructures `site/index.html` against that contract, extends the home invariants in `tools/site.test.ts`, and updates the runbook. The home page stays hand-authored; numeric facts fill at runtime from `/data/games.json` per the `rsvp.js` precedent.

**Tech Stack:** Committed HTML/CSS/JS under `site/` (no build step), Bun suite under `tools/`.

**Spec:** `docs/superpowers/specs/2026-08-26-bounty-news-hero-design.md`

**Acceptance:** suite — the committed Bun suite plus per-task review verifies this work; the diff is one page, one script, and CSS, and Mike gives the go at the PR.

## Global Constraints

- No em dashes anywhere in `site/` copy or output; the word "experiment" never appears in `site/`.
- Player names render as first name + last initial ("Chris G."), never a full surname; the brother in the Cain and Abel copy stays unnamed, exactly as published.
- Exactly one lime `.btn-primary` on the home page (the hero submit), only on a felt band; the new bands carry no lime.
- Per `docs/brand.md` "Held-back copy": no new card-economy CTA line anywhere in this pass.
- Every game-derived number comes from `site/data/games.json`; the new bands' numbers arrive at runtime via `home-facts.js`, never hand-typed; static copy reads complete without them.
- No build step; no new binary assets (the fan reuses committed PNGs).
- Bands alternate tones with no two alike adjacent; the home order becomes: cta hero, light foil, dark news, light legends, dark bounty board, light how-the-night-runs, cta, light footer.
- Nothing on the new bands animates; static rotation transforms are permitted (they are not motion).
- `site/standings/index.html`, `site/games/index.html`, and `site/data/games.json` are untouched; the drift check stays clean.
- Every file opens with a header comment; every function gets a purpose comment (Charlie-maintainability rule).
- New microcopy (tile one-liners, board intro, reward lines, eyebrows) gets Charlie's content pass at the PR, flagged in the PR body.

---

### Task 1: CSS contract + home-facts runtime filler

**Type:** implementation
**Depends-on:** none
**Commutes:** `site/styles.css`

**Files:**
- Modify: `site/styles.css`
- Create: `site/home-facts.js`

**Interfaces:**
- Consumes: existing tokens and classes in `site/styles.css` (`--foil`, `--copper`, `--pewter-deep`, `--line`, `--radius`, `.tiles`, `.tile`, `.mark` family, `.coin-ring`/`.coin-core`, `.cols`, `.band-inner--wide`).
- Produces: CSS classes `.card-fan`, `.tiles--3`, `.eyebrow`, `.notices`, `.notice`, `.notice--copper`, `.notice--foil`, `.notice--tilt-l`, `.notice--tilt-r`, `.reward`, `.fact`; and `site/home-facts.js`, which fills elements with ids `fact-last-game`, `fact-last-game-link`, `fact-coin`, `fact-skulls` and clones gem SVGs from `<template id="gem-full">` / `<template id="gem-empty">` (Task 2 places those ids and templates; every lookup null-checks, so the script is safe on any page).

**Parallelization rationale:** contract-first: the page task builds against these class names and element ids; defining the visual system before the page is what a good engineer does regardless of parallelism.

- [ ] **Step 1: Append the new classes to `site/styles.css`**

Append after the holo block, in the file's comment voice:

```css
/* Hero card fan (design pass 2, 2026-08-26). Committed card PNGs fanned in
   the felt hero: compact strip above the heading on mobile, full fan beside
   the copy on desktop (the .cols split reorders it right). Static art on
   purpose: the foil band below keeps the shimmer and holo exclusively. */
.card-fan { display: flex; justify-content: center; align-items: center; margin: 0 0 1rem; }
.card-fan img {
  position: relative; max-height: 96px; width: auto; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, .08);
  box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
}
.card-fan img:nth-child(1) { transform: rotate(-8deg) translateX(12px); }
.card-fan img:nth-child(2) { z-index: 1; }
.card-fan img:nth-child(3) { transform: rotate(8deg) translateX(-12px); }
@media (min-width: 900px) {
  .card-fan { order: 2; margin: 0; }
  .card-fan img { max-height: 340px; }
}

/* News tiles: the standings tile grammar at three-up on desktop. */
@media (min-width: 900px) { .tiles--3 { grid-template-columns: 1fr 1fr 1fr; } }

/* Eyebrow label, shared voice with .tile h3 and the table headers. */
.eyebrow {
  margin: 0 0 .4em; text-transform: uppercase; font-size: .72em;
  letter-spacing: .07em; color: var(--pewter-deep); font-weight: 700;
}

/* The bounty board (the pass's signature, spec §2): typed notices pinned
   to the parchment band. The rotations are the site's first tilted
   objects; they are static transforms, not motion, so they stay outside
   the reduced-motion guards on purpose. */
.notices { display: grid; grid-template-columns: 1fr; gap: 1.75rem; margin: 1.5em 0; }
@media (min-width: 900px) { .notices { grid-template-columns: 1fr 1fr; } }
.notice {
  position: relative; background: #fff; border: 1px solid var(--line);
  border-radius: 4px; padding: 2rem 1.5rem 1.25rem;
  box-shadow: 0 8px 24px rgba(26, 28, 32, .14);
}
/* The pushpin: a drawn dot on the top edge (drawn chrome, never emoji). */
.notice::before {
  content: ""; position: absolute; top: -9px; left: 50%; margin-left: -9px;
  width: 18px; height: 18px; border-radius: 50%;
  box-shadow: inset 0 -2px 3px rgba(0, 0, 0, .25), 0 2px 3px rgba(26, 28, 32, .3);
}
.notice--copper::before { background: var(--copper); }
.notice--foil::before { background: var(--foil); }
.notice--tilt-l { transform: rotate(-1.2deg); }
.notice--tilt-r { transform: rotate(1deg); }
.notice .eyebrow {
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: .12em;
}
.notice h3 { margin: 0 0 .5em; font-weight: 800; letter-spacing: -.02em; font-size: 1.3rem; }
/* Reward line: label voice (uppercase is reserved for eyebrows and table
   headers; a reward line is a label, set in the mono stat face). */
.reward {
  margin: 1.2em 0 0; padding-top: .8em; border-top: 1px dashed var(--line);
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  text-transform: uppercase; font-size: .8rem; letter-spacing: .08em;
}
.notice ul.fact { list-style: none; margin: .5em 0 0; padding: 0; }

/* Runtime fact slots (filled by /home-facts.js): invisible until filled so
   the no-JS page never shows an empty-looking hole. */
.fact:empty { display: none; }
```

- [ ] **Step 2: Create `site/home-facts.js`**

```js
/* home-facts.js: fills the home page's data slots from /data/games.json.
   Served at /home-facts.js; loaded with `defer` by site/index.html only.
   Doctrine (same as rsvp.js): game-derived numbers are never hand-typed
   into the page. The static copy around every slot reads complete on its
   own; this script only adds the numbers, and on any failure it does
   nothing at all.
   Slots (all optional, all invisible while empty via .fact:empty):
     #fact-last-game       latest game stat line
     #fact-last-game-link  href to the latest game page
     #fact-coin            Hope Coin holder + held-since
     #fact-skulls          <li> per hunter with skull gems */
(function () {
  function el(id) { return document.getElementById(id); }
  /* The gem marks live as <template> elements in the page markup (ids
     gem-full / gem-empty, beside the other drawn marks); this script only
     clones nodes and writes text, so no string ever reaches an HTML sink. */
  function gem(kind) {
    var t = el(kind);
    return t && t.content.firstElementChild
      ? t.content.firstElementChild.cloneNode(true)
      : null;
  }

  fetch("/data/games.json")
    .then(function (r) {
      if (!r.ok) throw new Error("games.json " + r.status);
      return r.json();
    })
    .then(function (data) {
      var nameOf = {};
      data.players.forEach(function (p) { nameOf[p.slug] = p.name; });

      /* Latest game: max date wins; ISO strings compare correctly as text. */
      var latest = data.games.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      })[0];
      if (latest) {
        var winner = null;
        latest.results.forEach(function (r) { if (r.finish === 1) winner = r; });
        var line = el("fact-last-game");
        if (line && winner) {
          line.textContent = latest.date + " · " + (nameOf[winner.slug] || winner.slug) +
            " won · " + latest.entries + " entries · $" + latest.pot + " pot · " +
            latest.hands + " hands";
        }
        var link = el("fact-last-game-link");
        if (link) link.href = "/games/" + latest.date + "/";
      }

      var coin = el("fact-coin");
      if (coin && data.hopeCoin) {
        coin.textContent = (nameOf[data.hopeCoin.holder] || data.hopeCoin.holder) +
          " holds it, since " + data.hopeCoin.since + ".";
      }

      /* Skull tallies: count "hope-slayer" trophies per player across all
         games. This restates six lines of tools/lib/standings.ts because
         tools/ is Bun TypeScript and site/ is no-build browser JS; the two
         must agree on the trophy string. */
      var skulls = {};
      data.games.forEach(function (g) {
        g.results.forEach(function (r) {
          r.trophies.forEach(function (t) {
            if (t === "hope-slayer") skulls[r.slug] = (skulls[r.slug] || 0) + 1;
          });
        });
      });
      var listEl = el("fact-skulls");
      if (listEl) {
        Object.keys(skulls).forEach(function (slug) {
          var n = Math.min(skulls[slug], 3);
          var li = document.createElement("li");
          li.textContent = (nameOf[slug] || slug) + ": ";
          for (var i = 0; i < 3; i++) {
            var g = gem(i < n ? "gem-full" : "gem-empty");
            if (g) li.appendChild(g);
          }
          listEl.appendChild(li);
        });
      }
    })
    .catch(function () { /* the static page stands on its own */ });
})();
```

- [ ] **Step 3: Sanity-check the additions**

Run: `bun test tools` (expected: PASS, unchanged; nothing consumes the new classes yet). Serve `python3 -m http.server -d site 8951`, load the home page, and confirm no visual change and no console error beyond the known local RSVP 404. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add site/styles.css site/home-facts.js
git commit -m "feat: bounty/news/fan CSS contract + home-facts runtime filler"
```

---

### Task 2: Home page restructure + invariants + runbook

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `site/index.html`
- Modify: `tools/site.test.ts`
- Modify: `docs/publishing.md`

**Interfaces:**
- Consumes: every class and element id Task 1 produces; the existing `readPage` helper in `tools/site.test.ts`; existing `.tiles`, `.tile`, `.cols`, `.band-inner--wide`, `.btn-secondary`, `.mark` classes.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Append the failing home invariants to `tools/site.test.ts`**

Inside the existing `describe("home page invariants", ...)` block, noting that `html` is read at collection time so these run against the edited file:

```ts
  test("loads the home facts script", () =>
    expect(html).toContain('src="/home-facts.js"'));
  test("posts exactly two bounty notices", () =>
    expect(html.split('class="notice ').length - 1).toBe(2));
  test("news band is the three-up tile band", () =>
    expect(html).toContain('tiles tiles--3'));
  test("hero carries the card fan", () =>
    expect(html).toContain('class="card-fan"'));
```

Run: `bun test tools/site.test.ts` and expect FAIL on all four new tests; the pre-existing "exactly one lime button" test must still pass before and after this task.

- [ ] **Step 2: Restructure `site/index.html`**

Five edits, keeping every line of untouched copy byte-identical:

1. **Hero fan.** The hero section's `band-inner` becomes `band-inner band-inner--wide`; wrap the existing hero content in the `.cols` split with the fan first (mobile puts it above the heading; desktop's `order: 2` moves it right):

```html
<section class="band-cta">
  <div class="band-inner band-inner--wide">
    <div class="cols">
      <div class="card-fan" aria-hidden="true">
        <img src="/cards/2026-07/assets/card-2-nickmershon.png" alt="">
        <img src="/cards/2026-07/assets/card-1-lewd.png" alt="">
        <img src="/cards/2026-07/assets/card-3-bg.png" alt="">
      </div>
      <div>
        ... the existing h1, intro p, #next-game-line, form, #rsvp-list,
        #rsvp-status, unchanged ...
      </div>
    </div>
  </div>
</section>
```

The foil card (`card-1-lewd`) sits center-front; the fan is decorative (`aria-hidden`, empty alts) because the set page carries the full descriptions.

2. **News band.** Replace the two sections "Last game, hand by hand" (band-dark) and "The Hope Coin" (band-dark) with ONE band-dark news band placed directly after the foil band:

```html
<section class="band-dark">
  <div class="band-inner band-inner--wide">
    <h2 class="display">Latest from the table</h2>
    <div class="tiles tiles--3">
      <div class="tile">
        <h3>Last game</h3>
        <p>A first title, and a skull to go with it. Every stack, every hand.</p>
        <p class="stat fact" id="fact-last-game"></p>
        <p><a class="btn-secondary" id="fact-last-game-link" href="/games/">Read the game</a></p>
      </div>
      <div class="tile">
        <h3>The cards</h3>
        <p>Set 2 is in production. A second-game winner and a deposed champion are waiting on their cards.</p>
        <p><a class="btn-secondary" href="/cards/">See the sets</a></p>
      </div>
      <div class="tile">
        <h3>The coin</h3>
        <p>The traveling trophy. Take three kills on the holder and the Coin is yours.</p>
        <p class="stat fact" id="fact-coin"></p>
        <p><a class="btn-secondary" href="/standings/">Standings and trophies</a></p>
      </div>
    </div>
  </div>
</section>
```

3. **Legends band.** Keep the section and its heading; remove the "Cain and Abel" paragraph (it moves to the board); the 29,968-chip collapse paragraph stays verbatim.

4. **The bounty board.** Insert a new band-dark section after the Legends band (order check: cta, light foil, dark news, light legends, dark board, light how-the-night-runs, cta, light footer; alternation holds):

```html
<section class="band-dark">
  <div class="band-inner band-inner--wide">
    <h2 class="display">The bounty board</h2>
    <p>Standing offers, posted by the table. Settle one and the record remembers it.</p>
    <div class="notices">
      <article class="notice notice--copper notice--tilt-l">
        <p class="eyebrow">Bounty · Open</p>
        <h3>Cain and Abel</h3>
        <p>In July, KmikeyM founder Mike M. knocked his own brother out of the tournament. There is a standing one-share bounty for doing exactly that, and the brother now has five reasons of his own to survive the table.</p>
        <p class="reward">Reward: one share <svg class="mark mark--foil" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg></p>
      </article>
      <article class="notice notice--foil notice--tilt-r">
        <p class="eyebrow">Bounty · Open</p>
        <h3>The Hope Slayer hunt</h3>
        <p>Knock out the Hope Coin holder and take a skull. Three skulls takes the Coin itself.</p>
        <ul class="fact" id="fact-skulls"></ul>
        <template id="gem-full"><svg class="mark mark--copper" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg></template>
        <template id="gem-empty"><svg class="mark mark--empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z"/></svg></template>
        <p class="reward">Reward: the Hope Coin <svg class="mark" viewBox="0 0 12 12" width="12" height="12" role="img" aria-label="Hope Coin"><circle class="coin-ring" cx="6" cy="6" r="5"/><circle class="coin-core" cx="6" cy="6" r="2.2"/></svg></p>
      </article>
    </div>
    <p><a class="btn-secondary" href="/standings/">The full record</a></p>
  </div>
</section>
```

The Cain and Abel body is the Legends paragraph verbatim (the brother stays unnamed). No lime, no new card-economy CTA line (brand.md "Held-back copy").

5. **Script tag.** Next to the rsvp script before `</body>`:
`<script src="/home-facts.js" defer></script>`

- [ ] **Step 3: Run the tests**

Run: `bun test tools`
Expected: PASS, including the four new tests, the one-lime test, and the site-wide brand/favicon guards.

- [ ] **Step 4: Update `docs/publishing.md`**

In "Game night + day after", insert after the narrative-page step:

```markdown
   Home page: refresh the two news one-liners ("Last game", "The coin"),
   and the bounty notices if a bounty was settled or the Coin moved. The
   numbers under them fill themselves from games.json at runtime
   (site/home-facts.js); never type numbers into the home page.
```

- [ ] **Step 5: Look at it, both widths, plus the no-JS check**

Serve on a fresh port (`python3 -m http.server -d site 8952`): at 1440px the fan sits right of the RSVP copy, tiles run 3-up, notices sit side by side, tilted, with pins; at 390px the fan is a compact strip above the heading with the form high on the page, tiles and notices stack. Disable JS (or just note the `.fact:empty` slots): the page reads as complete prose with no holes. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add site/index.html tools/site.test.ts docs/publishing.md
git commit -m "feat: home page: bounty board, news band, hero card fan"
```

---

### Task 3: Verification gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `bun test tools`

Expectations on the integrated tree: suite green; `grep -rl "—" site/` and `grep -ril "experiment" site/` empty; drift check clean (`bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html`); exactly one `btn-primary` in `site/index.html`; `games.json` untouched; no new binary assets; dual-width visual pass per Task 2 Step 5.

---

### Task 4: Branch and PR

**Type:** release
**Depends-on:** 3

**Files:**
- Test: `git push` / `gh pr create` (no repo file changes)

Push the work branch, open a PR to `main` titled for the three features, body flagging: Charlie's content pass on the new microcopy (tile one-liners, board intro and headlines, reward lines, the runbook step), the copy MOVES (Cain and Abel from Legends to the board; the two replaced bands), and that merge deploys. Do not merge.

---

### Task 5: Mike's go, merge, live check

**Type:** manual
**Depends-on:** 4

**Files:**
- Test: live checks below (no repo file changes)

Mike reviews and merges on his go. After deploy: home loads at both widths; `/home-facts.js` returns 200; the stat line under "Last game" shows the August figures (runtime fill working against live data); the skull tally lists two hunters; RSVP still answers with names, never an email.

---

## Operator smoke

- do: open https://poker.kmikeym.com/ on your phone.
  see: a small fan of three cards above the headline, and the RSVP form right below it without hunting.
- do: open the same page on desktop.
  see: the card fan beside the RSVP block, three news tiles in a row, and two tilted notices pinned to the bounty board.
- do: read the "Last game" tile.
  see: a typed stat line with the August date, winner, entries, pot, and hands (that line comes from live data, not the page).
- do: on the bounty board, find the Hope Slayer notice.
  see: each hunter listed with filled and empty gems out of three, and "Reward: the Hope Coin" with a drawn coin.
- do: turn JavaScript off (or use Reader mode) and reload the home page.
  see: every sentence still reads complete; nothing looks like a missing box.
