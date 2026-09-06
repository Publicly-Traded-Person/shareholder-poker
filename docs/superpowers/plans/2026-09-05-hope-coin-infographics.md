# The Hope Coin page: hero, odometer, route, and the share of its life

**Grammar:** claims-v1

**Claim:** I open poker.kmikeym.com/hope-coin/ and see the coin itself at the top, the miles it has traveled with each leg marked on the journey, Beau's two road trips drawn as loops, and a chart of who has held it longest. (elicited)

**Goal:** Give `/hope-coin/` a hero photograph of the coin, an odometer built from Beau's per-leg miles, a route diagram grown out of the journey list it already has, and a donut plus a tenure strip for who has held the coin for how long. Every number derives from `site/data/games.json` at render time; `tools/render.ts` emits inline SVG; the suite tests each graphic on synthetic chains; the drift check covers the page like every other generated page. No runtime, no script on the page, no external asset.

**Tech Stack:** Bun + TypeScript (`bun test tools`), static committed HTML under `site/` on Cloudflare Pages with `pages_build_output_dir = "site"` and no build step. ImageMagick (`magick`) on Mike's machine for the one-off crop.

**Spec:** `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` (reference for the reader; every fact a task needs is restated in its own Context)

## Global Constraints

- **No invented numbers.** Every mile figure, place name, and date on the page comes from `site/data/games.json`. A leg without a figure renders as "unmeasured", never as an estimate. The page never prints "about" or "roughly".
- **Miles are Beau's and say so.** Wherever a mile total appears, the words "by Beau's count" appear with it.
- **Copy rules.** No em dash anywhere in `site/` output, including SVG `<text>`. The word "experiment" never appears. Names are First plus last initial, as the chain already carries them. Drawn SVG marks, never emoji. No lime button on this page.
- **Deterministic render.** Nothing reads the clock. "As of" is the month of the latest game on the spine, `max(games[].date)`. `bun tools/render.ts` twice in a row produces byte-identical output.
- **Visual system (`docs/brand.md`, v2).** Light page, dark objects. `band-light` alternates with `band-dark`. The four metals are accents; the current holder is foil in every graphic; other holders are tints of `--ink`, never a fifth hue. Every chart also states its numbers as text (a caption, a label, or a table), so nothing depends on color alone.
- **Mobile first.** Every inline SVG carries a `viewBox` and is sized by CSS at `width: 100%; height: auto`. The page body never scrolls horizontally.
- **Privacy.** The original photograph does not enter the repo; only the circle crop and the unfurl image do. Places are names, never coordinates.
- **`site/data/games.json` stays in canonical `JSON.stringify(data, null, 2)` form with a trailing newline.**
- **Generated pages are never hand-edited.** `site/hope-coin/index.html` is written only by `tools/render.ts`, and the drift check in `tools/site.test.ts` stays green.
- **Test fixtures are synthetic.** Render and validator tests use invented slugs and invented figures; only `tools/data.test.ts` reads the real file.

**Parallelization rationale:** Wave 1 is five independent tasks: Task 1 (stop fields and validator rule), Task 2 (month and mile helpers), Task 3 (Beau's figures in the real data), Task 4 (the two image assets, manual), and Task 5 (the hero and the runbook section). Tasks 1 and 2 both modify `tools/lib/hope-coin.ts` and its test file in different regions; those are text edits and fold at merge. Wave 2 is three: Tasks 6, 7, and 8 each import helpers Task 2 creates and assert the numbers those helpers compute, which is runtime behaviour a signature cannot promise and which does not exist at BASE; Task 6 also reads the hero fragment Task 5 produces to prove the tiles sit after it, which is that fragment's runtime output, not its shape. All three modify `tools/render.ts`, `site/styles.css`, and `tools/render.test.ts` in different regions and fold. Wave 3 is one: Task 9 executes the renderer to produce the committed HTML, which needs the bytes Tasks 5 through 8 emit, not their shapes.

**Acceptance:** suite — `bun test tools` plus the render drift check is the verification, and Task 9 runs both against the integrated tree.

### Task 1: Stop fields and the validator's rule for them

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/lib/standings.ts`
- Modify: `tools/lib/hope-coin.ts`
- Test: `tools/lib/hope-coin.test.ts`

**Claim:** A stop can record Beau's miles and the places the coin passed through, and a malformed figure fails loudly before it can reach a page. (derived)
Machine: M1. A chain whose stops carry `milesIn`, `milesHeld`, and `route` values that follow the rule passes `validateCoinHistory` without throwing.
M2. `validateCoinHistory` throws an Error naming the stop by 1-based position and holder for each of: a `milesIn` that is negative; a `milesIn` that is not an integer; a `milesHeld` of zero; a `milesHeld` that is negative; a `route` present on a stop with no `milesHeld`; a `route` that is an empty array; a `route` containing an empty string; a `route` name containing an em dash.
M3. A chain with none of the three fields on any stop passes exactly as it did before this task.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §3

**Interfaces:**
- Consumes: none
- Produces: `type HopeCoinStop`

**Context:** `tools/lib/hope-coin.ts` exports `validateCoinHistory(data: GamesData): void`, which today runs rules 0 through 4 (date format, presence, order, handoff match, summary agreement) and returns early on an absent or empty history. This task appends rule 5 after rule 4 in the same refuse-and-name-the-stop voice the file already uses, and extends its header comment's numbered list to describe it. `tools/lib/standings.ts` exports `type HopeCoinStop` with `holder`, optional `from` and `to`, optional `place`, and `how`. The additions, verbatim, because Tasks 3, 6, 7, and 8 are written against exactly this shape:

    milesIn?: number;    // miles of the leg that brought the coin here; Beau's figure; absent on the first stop and wherever the figure rests on an assumption
    milesHeld?: number;  // miles the coin traveled while at this stop; only Beau's RV stints have one
    route?: string[];    // the places it passed through while held, in order, as names; present only with milesHeld

Rule 5 checks, in this order per stop: `milesIn`, when present, is an integer of zero or more (zero is a real hand-to-hand pass); `milesHeld`, when present, is an integer of one or more; `route`, when present, requires `milesHeld` on the same stop, is a non-empty array, has no empty string, and has no name containing the em dash character U+2014. The tests in `tools/lib/hope-coin.test.ts` build chains with the file's own `data(holder, since, history)` fixture helper and invented slugs.
**BASE facts:** (generated at c2d93c3)
- `validateCoinHistory` at `tools/lib/hope-coin.ts:84` blob 55b1490
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/lib/hope-coin.ts` blob 55b1490
- `tools/lib/standings.ts` blob 9a7957e
- `holder` at `tools/lib/trophies.test.ts:203` blob 6209d1c
- `tools/lib/hope-coin.test.ts` blob c8c6867

**Proof:**
- Test: `tools/lib/hope-coin.test.ts`
- Legs: (a) a three-stop chain whose middle stop carries `milesIn: 648`, `milesHeld: 4454`, and a two-name `route`, and whose other stops carry `milesIn: 0` and `milesIn: 12`, does not throw [M1]; each of the following puts the bad value on the second stop, whose holder is the invented slug `bob`, and asserts the thrown message matches a pattern requiring both "stop 2" and "bob": (b) `milesIn: -1` [M2]; (c) `milesIn: 1.5` [M2]; (d) `milesHeld: 0` [M2]; (e) `milesHeld: -5` [M2]; (f) `route: ["Seattle"]` with no `milesHeld` [M2]; (g) `route: []` with `milesHeld: 10` [M2]; (h) `route: ["Seattle", ""]` with `milesHeld: 10` [M2]; (i) a route name containing U+2014 with `milesHeld: 10` [M2]; (j) the file's existing well-formed three-stop chain, which carries none of the three fields, still does not throw, and the existing rule 0 through rule 4 cases still throw with their existing messages, so the new rule neither loosens nor tightens what came before [M3].

**Stale-if:**
- path-absent: `tools/lib/hope-coin.ts`
- issue-closed: #48

### Task 2: Month and mile helpers

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/lib/hope-coin.ts`
- Test: `tools/lib/hope-coin.test.ts`

**Claim:** The page's numbers come from one set of pure functions that count in months and sum Beau's miles, so every graphic on the page agrees with every other. (derived)
Machine: M1. `monthIndex("2023-07")` and `monthIndex("2023-07-14")` both return `2023 * 12 + 6`.
M2. `tenureMonths(history, latestGame)` returns one `TenureSegment` per stop in chain order, each with `holder`, `from` and `to` as `YYYY-MM`, and `months` equal to `monthIndex(to) - monthIndex(from)`; the last stop's `to` is the month of `latestGame`; a first stop with no `from` produces no segment; a stop whose `from` and `to` share a month has `months: 0`.
M3. `holderShares(segments)` returns one `HolderShare` per distinct holder, sorted by `months` descending with ties broken by first appearance in the segments, each with `reigns` equal to that holder's segment count, `months` equal to the sum, and integer `percent` values that sum to exactly 100 by largest-remainder rounding; when total months is zero every `percent` is 0.
M4. `odometer(history)` returns `onRecord` equal to the sum of every stop's `milesIn` plus every stop's `milesHeld`, and `unmeasuredLegs` equal to the count of stops after the first that have no `milesIn`.
M5. `formatMiles(17677)` returns `"17,677"`, `formatMiles(0)` returns `"0"`, and `formatMiles(938)` returns `"938"`.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §6, §7.1, §9

**Interfaces:**
- Consumes: none
- Produces: `monthIndex(date: string): number`
- Produces: `tenureMonths(history: HopeCoinStop[], latestGame: string): TenureSegment[]`
- Produces: `holderShares(segments: TenureSegment[]): HolderShare[]`
- Produces: `odometer(history: HopeCoinStop[]): { onRecord: number; unmeasuredLegs: number }`
- Produces: `formatMiles(n: number): string`
- Produces: `type TenureSegment`
- Produces: `type HolderShare`

**Context:** These live in `tools/lib/hope-coin.ts` beside `validateCoinHistory`, exported, pure, no clock and no I/O, with a comment on each in the file's existing voice (what it takes, what it returns, why). The types, verbatim, because Tasks 6 and 8 are written against them:

    export type TenureSegment = { holder: string; from: string; to: string; months: number };
    export type HolderShare = { holder: string; reigns: number; months: number; percent: number };

`monthIndex` reads the first seven characters of a `YYYY-MM` or `YYYY-MM-DD` string. `tenureMonths` never sorts the history; it trusts chain order, the same way `renderHopeCoin` already does. `latestGame` is a `YYYY-MM-DD` game date; the caller passes `max(games[].date)`. Largest-remainder rounding: floor each share of 100, then hand the leftover points one each to the holders with the largest fractional parts, ties by the same order as the list. `odometer` treats an absent `milesIn` or `milesHeld` as contributing nothing to `onRecord`. `formatMiles` inserts a comma every three digits from the right and never rounds. The stop fields `milesIn?: number`, `milesHeld?: number`, and `route?: string[]` are being added to `HopeCoinStop` by a sibling task in the same wave; this task's tests may construct stops carrying them as plain object literals typed through `HopeCoinStop` and, if the field is not yet on the type in this checkout, through a local `as HopeCoinStop` cast so the test compiles either way.
**BASE facts:** (generated at c2d93c3)
- `holder` at `tools/lib/trophies.test.ts:203` blob 6209d1c
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/lib/hope-coin.ts` blob 55b1490
- `validateCoinHistory` at `tools/lib/hope-coin.ts:84` blob 55b1490
- `renderHopeCoin` at `tools/render.ts:902` blob db66e29

**Proof:**
- Test: `tools/lib/hope-coin.test.ts`
- Legs: (a) `monthIndex("2023-07")` is exactly `2023 * 12 + 6` and `monthIndex("2023-07-14")` is exactly the same number, so a one-based month or a day-sensitive parse fails [M1]; (b) a four-stop synthetic chain with an undated first stop, a month-only handoff, and a same-month stop yields, compared with deep equality, exactly three segment objects whose `holder`, `from`, and `to` are the expected slugs and `YYYY-MM` strings and whose months are `[3, 0, 5]`, given a `latestGame` five months after the last stop's `from`; a full-date `from` on a stop comes back as its `YYYY-MM` form [M2]; (c) a chain whose first stop has a `from` yields one segment per stop, the first included, again by deep equality [M2]; (d) three holders with months 27, 6, 6 where the second-listed six-month holder appears first in the segments come back ordered by months then first appearance, with `reigns` counted per holder, and with percents exactly `[69, 16, 15]`: floors 69, 15, 15 leave one point, and largest remainder hands it to a six-month holder (fraction .38) rather than the 27-month holder (fraction .23), so an implementation that gives surplus to the first or the largest holder fails [M3]; (e) months `[1, 1, 1]` give percents summing to exactly 100, and months all zero give percents all 0 [M3]; (f) a chain where one stop carries both `milesIn` and `milesHeld`, a second carries only `milesIn`, and a stop after the first carries neither returns `onRecord` exactly equal to the sum of all three figures (so a per-stop `milesIn` or `milesHeld` fallback that counts one of the pair fails) and nothing else, and `unmeasuredLegs` exactly 1; a chain where every stop after the first has `milesIn` returns `unmeasuredLegs` exactly 0; a first stop with no `milesIn` is not counted as unmeasured [M4]; (g) the three `formatMiles` values [M5].

**Stale-if:**
- path-absent: `tools/lib/hope-coin.ts`
- issue-closed: #48

### Task 3: Beau's figures on the real chain

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `site/data/games.json`
- Test: `tools/data.test.ts`

**Claim:** The record carries Beau's miles leg by leg, and his two road trips name the places the coin passed through. (derived)
Machine: M1. In the committed `site/data/games.json`, the sum of `milesIn` over every stop plus `milesHeld` over every stop is 17677.
M2. Exactly two stops carry `milesHeld` and `route`; both have holder `beau-g`; the first's route is exactly `["Petaluma", "Puget Sound", "Southern California", "Pahrump", "Las Vegas", "San Diego"]` with `milesHeld` 5420, and the second's is exactly `["Seattle", "Wenatchee", "Bellingham", "Hope, British Columbia", "Cassiar Highway", "Yukon", "Fairbanks", "Denali", "Homer, Alaska"]` with `milesHeld` 4454.
M3. The first stop and the last stop carry no `milesIn`; every stop in between carries one.
M4. The file text equals `JSON.stringify(JSON.parse(text), null, 2) + "\n"`.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §3

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `site/data/games.json` carries `hopeCoin.history`, twelve stops in this order of holders: `kmikeym`, `chris-g`, `beau-g`, `josh-b`, `drew-a`, `chris-g`, `josh-b`, `chris-g`, `beau-g`, `chris-g`, `matt-w`, `nick-m`. Beau's figures, one row per stop in that order; a blank means the field is absent:

    stop  holder    milesIn  milesHeld  route
    1     kmikeym
    2     chris-g   379
    3     beau-g    0        5420       Petaluma, Puget Sound, Southern California, Pahrump, Las Vegas, San Diego
    4     josh-b    938
    5     drew-a    0
    6     chris-g   503
    7     josh-b    503
    8     chris-g   503
    9     beau-g    648      4454       Seattle, Wenatchee, Bellingham, Hope, British Columbia, Cassiar Highway, Yukon, Fairbanks, Denali, Homer, Alaska
    10    chris-g   1947
    11    matt-w    2382
    12    nick-m

The route for stop 9 has nine names; "Hope, British Columbia" and "Homer, Alaska" each contain a comma and are one name each. Stop 12 stays without `milesIn` on purpose: Beau's figure for it rests on an assumed city. Add the fields after `how` on each stop so the diff reads as an append. Nothing else in the file changes. The edit is made through JSON parse and stringify so the canonical form holds. The pins go in `tools/data.test.ts` inside the existing `describe("hope coin chain (Task 6)")` block, which already reads the real file as `data`; they are the record's own statement of Beau's figures, updated deliberately in the same commit as any future change to them.
**BASE facts:** (generated at c2d93c3)
- `site/data/games.json` blob d9fe213
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/data.test.ts` blob ede8649
- `data` at `functions/portrait/[token].js:102` blob edcccc9

**Proof:**
- Test: `tools/data.test.ts`
- Legs: (a) the sum over the real history of every `milesIn` and every `milesHeld` is exactly 17677, no more and no less [M1]; (b) filtering the real history to stops with `route` yields exactly two, both `beau-g`, with the two exact arrays and the two `milesHeld` values [M2]; (c) `history.length` is exactly 12, `history[0].milesIn` and `history[history.length - 1].milesIn` are absent, and for every index from 1 to `history.length - 2` `milesIn` is present and numeric, so a stop missing one fails by index and a chain of another length fails on the count [M3]; (d) re-stringifying the parsed file with two-space indent plus a newline reproduces the file's text byte for byte [M4].

**Stale-if:**
- path-absent: `site/data/games.json`
- issue-closed: #48

### Task 4: The two coin images

**Type:** manual

**Files:**
- Create: `site/hope-coin/assets/coin.png`
- Create: `site/hope-coin/assets/coin-og.png`

**Claim:** The coin's photograph, cropped to a circle at its rim, exists in the repo at the size the page uses and the size an unfurl uses, and the original photograph does not. (derived)
Machine: M1. `site/hope-coin/assets/coin.png` is a PNG with an alpha channel, square, 900 pixels on a side, under 250 KB, fully transparent at every pixel outside the circle of radius 450 centered at (450, 450), and fully opaque at every pixel inside the circle of radius 446 with the same center.
M2. `site/hope-coin/assets/coin-og.png` is a PNG, 1200 by 630, under 200 KB, the felt color `#101216` at the canvas edges, and the coin's bounding box is 560 pixels square within 4 pixels and centered within 2 pixels.
M3. No `.jpg` or `.jpeg` file exists anywhere under `site/`.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §4

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The source is Mike's photograph at `~/Desktop/1000088780.jpg` on his machine, 1536 by 2048, the coin held in a hand against concrete. It is not a repo input and is never copied into the tree. In source pixels the coin's rim is centered near x 801, y 938 with a radius near 700; whoever makes the crop checks those against the file (open it, find the rim) before running the commands, and adjusts them so the circle sits on the rim with no finger inside it. Made with ImageMagick 7 (`magick` on Mike's machine): first crop a 1400 by 1400 square at the rim's top-left corner (offset 101, 238), then mask it with a circle of radius 700 centered in that square by compositing a white-on-transparent circle as the alpha channel, then resize to 900 by 900 and write `coin.png`. For the unfurl, start from a 1200 by 630 canvas of `#101216`, place `coin.png` resized to 560 by 560 at the center, and write `coin-og.png`. Strip metadata from both. If either file lands over its size budget, quantize the PNG (256 colors is plenty for enamel and metal) rather than shrinking the pixel size.
**BASE facts:** (generated at c2d93c3)
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f

**Proof:**
- Run: `magick identify -format "%m %w %h %[channels] %B\n" site/hope-coin/assets/coin.png`
- Run: `magick site/hope-coin/assets/coin.png -alpha extract \( -size 900x900 xc:white -fill black -draw "circle 450,450 450,0" \) -compose multiply -composite -format "%[fx:maxima]" info:`
- Run: `magick site/hope-coin/assets/coin.png -alpha extract \( -size 900x900 xc:white -fill black -draw "circle 450,450 450,4" \) -compose screen -composite -format "%[fx:minima]" info:`
- Run: `magick identify -format "%m %w %h %B\n" site/hope-coin/assets/coin-og.png`
- Run: `magick site/hope-coin/assets/coin-og.png -format "%@" info:`
- Run: `find site -iname "*.jp*g" -print`
- Legs: (a) the first identify line reads `PNG 900 900` with an alpha channel named and a byte count under 256000; the first alpha-extract Run, which multiplies the image's alpha by a mask that is white outside the radius-450 circle and black inside it, prints a maximum of exactly 0, so any pixel with any opacity anywhere outside the circle, on a diagonal or not, fails; and the second alpha-extract Run, which screens the alpha with a mask that is white outside the radius-446 circle and black inside it so every pixel outside reads 1 and every pixel inside reads its own alpha, prints a minimum of exactly 1, so any pixel of any transparency anywhere inside the radius-446 circle fails, which rules out a smaller mask, a ring, or a mask of another shape [M1]; (b) the second identify line reads `PNG 1200 630` with a byte count under 204800; `magick site/hope-coin/assets/coin-og.png -format "%[pixel:p{20,315}] %[pixel:p{1180,315}] %[pixel:p{600,15}] %[pixel:p{600,615}]" info:` reports exactly the felt color `#101216` at all four points; and the bounding-box Run (`%@` is ImageMagick's trim box computed without trimming, so the offsets are relative to the full canvas) prints a geometry `WxH+X+Y` in which W and H are each between 556 and 564, `X + W / 2` is between 598 and 602, and `Y + H / 2` is between 313 and 317, computed from the four numbers together (a 560 square centered on 1200 by 630 sits at +320+35 with center 600, 315), so a blank canvas prints no such geometry, a box whose center is more than two pixels from the canvas center fails whatever its width, and a coin of another size prints different dimensions [M2]; (c) the find prints nothing [M3].

**Stale-if:**
- path-exists: `site/hope-coin/assets/coin.png`
- issue-closed: #48

### Task 5: The hero, the unfurl, and the runbook section

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/render.ts`
- Modify: `site/styles.css`
- Modify: `docs/publishing.md`
- Test: `tools/render.test.ts`
- Test: `tools/styles.test.ts`
- Test: `tools/docs.test.ts`

**Claim:** The coin itself is the first thing on its page, and a shared link shows the coin rather than a player's card. (derived)
Machine: M1. `renderHopeCoin(data)` opens its first `band-light` section with a `<div class="cols">` whose first child is a `<figure class="coin-figure">` containing `<div class="coin-frame"><img src="/hope-coin/assets/coin.png" ...>` with `width="900"`, `height="900"`, and a non-empty `alt`, followed by `<figcaption class="stat">` reading exactly "It's not the cards, it's the player. The coin shows 7-2, the hand with its own bounty."; the grid's second child contains the existing display heading, the intro paragraph, and the holder tile in that order.
M2. For any data, carded holder or not, the page's `og:image` is `https://poker.kmikeym.com/hope-coin/assets/coin-og.png`.
M3. `site/styles.css` defines `.coin-frame` with `border-radius: 50%` and `overflow: hidden`, and `.coin-frame img` with `width: 100%` and `height: auto`; `.coin-figure` has no margin.
M4. `docs/publishing.md` has a section whose heading contains "The Hope Coin page", and that section names `coin.png`, `coin-og.png`, the word `magick`, and states that the original photograph is not a repo input.
M5. The rendered page contains no em dash and no `btn-primary`.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §4

**Interfaces:**
- Consumes: none
- Produces: `coinHero(data: GamesData): string`

**Context:** `renderHopeCoin` in `tools/render.ts` today builds one `band-light` section holding, in order, `<h1 class="display">The Hope Coin ${COIN}</h1>`, the intro `<p>`, a `<div class="tile">` with the holder line and the skull tally, then the "The journey" heading and the `<ol class="route">`. It ends by calling the local `page(...)` helper with `{ navCurrent: "/standings/", image: newestCardImage(data, s.hopeCoin.holder) }`; `page` reads `options.image` into the `og:image` meta and falls back to `DEFAULT_OG_IMAGE`. This task wraps the heading, intro, and tile in the grid described by M1 and leaves the journey markup untouched below it, and replaces the `image` option with the literal `https://poker.kmikeym.com/hope-coin/assets/coin-og.png`; `newestCardImage` stays in the file for the player pages. `coinHero` is the exported function that returns the grid's HTML, so a test can render it alone. The `alt` text describes the object: a black and silver card guard showing the two of diamonds and the seven of clubs, ringed with the words It's not the cards, it's the player. `.cols` already exists in `site/styles.css` as a one-column grid that becomes two columns at 900px; `.card-frame` carries the dark frame look (`background`, `border`, `box-shadow`) to copy for `.coin-frame`, minus the hover lift. The runbook section goes after "If the Coin's history ever has a gap at its start again" and before "Cards (per set, still manual by design)", headed `## The Hope Coin page`, and records: the two asset paths; that they were made once from Mike's photograph with `magick` (crop to the rim, circular alpha mask, 900 square; and the 1200 by 630 felt canvas for the unfurl); that the photograph itself is not a repo input and is never committed; and that the page's miles, loops, and charts all derive from `hopeCoin.history`, so a new stop or a corrected figure is a `games.json` edit followed by `bun tools/render.ts`. `tools/docs.test.ts` has a `sectionByHeading(md, needle)` helper that returns a heading's body; `tools/styles.test.ts` reads `site/styles.css` as text.
**BASE facts:** (generated at c2d93c3)
- `site/styles.css` blob bfa33fe
- `docs/publishing.md` blob 010d239
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `renderHopeCoin` at `tools/render.ts:902` blob db66e29
- `tools/render.ts` blob db66e29
- `page` at `tools/chip-race.ts:92` blob 4ff7e59
- `DEFAULT_OG_IMAGE` at `tools/render.ts:112` blob db66e29
- `image` at `tools/render.ts:749` blob db66e29
- `newestCardImage` at `tools/render.ts:871` blob db66e29
- `tools/docs.test.ts` blob a7381d6
- `tools/styles.test.ts` blob 21edf53
- `hcData` at `tools/render.test.ts:775` blob 932f6c7

**Proof:**
- Test: `tools/render.test.ts`
- Test: `tools/styles.test.ts`
- Test: `tools/docs.test.ts`
- Legs: (a) `coinHero` on the file's `hcData` fixture returns markup matching M1's structure with the exact caption, and `renderHopeCoin(hcData)` places that markup before the "The journey" heading with the heading, intro, and tile inside the grid's second child in that order [M1]; (b) `renderHopeCoin` on `hcData` (uncarded holder) and on the file's carded fixture both carry exactly the `coin-og.png` `og:image`, and neither carries a `/cards/` image in that tag; the carded case is the one that failed before this task [M2]; (c) `site/styles.css` contains a `.coin-frame` rule with `border-radius: 50%` and `overflow: hidden`, a `.coin-frame img` rule with `width: 100%` and `height: auto`, and a `.coin-figure` rule with `margin: 0`; a stylesheet missing any one of the three declarations fails the leg that names it [M3]; (d) `sectionByHeading(docs, "the hope coin page")` does not throw, and its body contains `coin.png`, `coin-og.png`, `magick`, and the phrase "not a repo input" [M4]; (e) `renderHopeCoin(hcData)` contains no U+2014 character and no `btn-primary` substring anywhere in its output, both checked as absent [M5]; (f) in `renderHopeCoin(hcData)`, the first occurrence of `<section class="band-light">` is followed, after its `<div class="band-inner">` opener and whitespace only, by `<div class="cols">` and then `<figure class="coin-figure">` as its first child, and the string `coin-figure` occurs nowhere before that section, so a page that puts any element ahead of the grid or the coin in an earlier block fails [M1].

**Stale-if:**
- path-absent: `tools/render.ts`
- issue-closed: #48

### Task 6: The odometer tiles and the leg labels

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/render.ts`
- Modify: `site/styles.css`
- Test: `tools/render.test.ts`

**Claim:** The miles the coin has traveled sit above the journey as one number with Beau's name on it, and each leg of the journey carries its own figure or says it is unmeasured. (derived)
Machine: M1. `odometerTiles(data)` returns a `<div class="tiles tiles--4">` holding four `<div class="tile">` elements in order, each with an `<h3>`: "Miles" whose big `stat` line is `formatMiles(onRecord)` followed by " miles on record" and whose second line is "by Beau's count" when `unmeasuredLegs` is 0, "by Beau's count, plus one leg still unmeasured" when it is 1, and "by Beau's count, plus N legs still unmeasured" otherwise; "Stops" showing the stop count; "Places" showing the count of distinct names in the union of every stop's `place` that does not begin with "On the road" and every name in every `route`; "Longest leg" showing `formatMiles(max)` followed by " miles, " and the holder's display name, with ", on the road" appended when the maximum is a `milesHeld`.
M2. In `renderHopeCoin(data)`, the string `odometerTiles(data)` first occurs at or after the index where the string `coinHero(data)` ends, and before the index of the "The journey" heading.
M3. In the journey list, every stop after the first is preceded by an `<li class="route-leg"><span class="stat">…</span></li>` whose text is `formatMiles(milesIn)` followed by " miles" when that stop has `milesIn` and exactly "unmeasured" when it does not; no `route-leg` precedes the first stop; the count of `route-leg` elements equals the stop count minus one.
M4. `site/styles.css` has a `.tiles--4` rule inside a 900px media query with `grid-template-columns` of four tracks, a `.route-leg` rule with `padding-left: 2rem` and `margin: -0.75rem 0 0.75rem`, and a `.route-leg::before` rule with `display: none`.
M5. The tiles and leg labels contain no em dash and neither of the words "about" or "roughly".

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §5, §6

**Interfaces:**
- Consumes: `odometer(history: HopeCoinStop[]): { onRecord: number; unmeasuredLegs: number }`
- Consumes: `formatMiles(n: number): string`
- Consumes: `coinHero(data: GamesData): string`
- Produces: `odometerTiles(data: GamesData): string`

**Context:** `tools/lib/hope-coin.ts` exports `odometer` and `formatMiles` (a sibling task in the earlier wave); import both from `./lib/hope-coin`. `tools/render.ts` exports `coinHero(data)` (a sibling task in the earlier wave), the hero grid's complete markup ending with the grid's closing tag; the tiles go directly after that fragment in `renderHopeCoin`, and the placement test reads it to find where the hero ends. `renderHopeCoin` builds the journey as `history.map((stop, i) => …)` returning one `<li class="route-stop…">` per stop; the leg label is a separate `<li class="route-leg">` emitted before each stop with `i > 0`, inside the same `<ol class="route">`. The holder's display name comes from the `nameOf` map `renderHopeCoin` already builds from `data.players`. `.tiles` and `.tile` exist in `site/styles.css` (`.tiles` is a one-column grid, two columns at 900px; `.tile` is a white card with a pewter left rule and an uppercase `h3`); `.tiles--4` is a modifier on the same grid. The `.route` list draws its spine with `::before` at `left: 5px`, and each `.route-stop::before` draws the bead; `.route-leg` keeps `padding-left: 2rem` so its text aligns with stop text, sets `margin: -0.75rem 0 0.75rem`, and draws no bead. Miles are Beau's figures on the stops; the tiles never compute a distance. "Places" counts names, not cities: the Yukon and the Cassiar Highway are on the route and are counted like any other name. The synthetic fixtures for the tests carry invented slugs, small integers for miles, and one stop with a two-name route.
**BASE facts:** (generated at c2d93c3)
- `site/styles.css` blob bfa33fe
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/lib/hope-coin.ts` blob 55b1490
- `renderHopeCoin` at `tools/render.ts:902` blob db66e29
- `nameOf` at `tools/lib/standings.ts:141` blob 9a7957e
- `tools/render.ts` blob db66e29

**Proof:**
- Test: `tools/render.test.ts`
- Legs: (a) on a synthetic five-stop chain with `milesIn` on stops 2, 3, and 5, `milesHeld` 40 with a two-name route on stop 3, and stop 4 unmeasured, the Miles tile holds a `<p class="stat">` element whose text is exactly the formatted sum followed by " miles on record", and a second line reading "by Beau's count, plus one leg still unmeasured", so a figure rendered outside a `stat` element fails; with stop 4 given a `milesIn` the second line is exactly "by Beau's count"; with two unmeasured stops it reads "plus 2 legs still unmeasured" [M1]; (b) the markup is a `<div class="tiles tiles--4">` holding exactly four `<div class="tile">` elements whose `<h3>` texts are "Miles", "Stops", "Places", "Longest leg" in that order and no fifth; the Stops tile reads 5; on a fixture where one stop's `place` equals one of the route's two names and another stop begins "On the road", the Places tile reads the deduplicated count (the road place excluded, the shared name counted once), so a non-deduplicating or road-counting implementation fails; and the Longest leg tile reads exactly `formatMiles(max)` followed by " miles, " and the holder's display name, with ", on the road" appended when that figure is a `milesHeld` (the fixture's 40-mile route stop) and absent on a second fixture where a `milesIn` of 1200 is the largest, so a tile showing the sum, a smaller figure, or the wrong suffix fails [M1]; (c) in `renderHopeCoin` on that chain, `indexOf(odometerTiles(chain))` is at least `indexOf(coinHero(chain)) + coinHero(chain).length` and less than `indexOf("The journey")`, so tiles nested inside the hero grid or placed after the heading fail [M2]; (d) the journey has exactly four `route-leg` items, none before the first stop, each of the form `<li class="route-leg"><span class="stat">…</span></li>` with the text inside the span, and for each stop k from 2 to 5 the substring between that stop's leg item's closing `</li>` and stop k's own `<li class="route-stop` is whitespace only, with the leg's text being stop k's figure or "unmeasured", so legs emitted as a block, out of place, or without the span wrapper fail [M3]; (e) `site/styles.css` contains the `.tiles--4` rule inside a 900px media query with four `grid-template-columns` tracks, the `.route-leg` rule with both declarations M4 names, and the `.route-leg::before` rule with `display: none`, each checked by name so a stylesheet keeping the bead or the stop margin fails the check that names it [M4]; (f) the rendered tiles and legs contain no U+2014, no "about", and no "roughly" [M5].

**Stale-if:**
- path-absent: `tools/render.ts`
- issue-closed: #48

### Task 7: The stint loops and the border flag

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/render.ts`
- Modify: `site/styles.css`
- Test: `tools/render.test.ts`

**Claim:** Beau's two road trips are drawn as loops off the journey's line, with every place he took the coin named along them and the one border crossing flagged. (derived)
Machine: M1. For a stop with `route`, `routeLoop(stop)` returns an `<svg class="route-loop" viewBox="…">` containing exactly one `<path class="route-loop-path">`, exactly `route.length` `<g class="route-tick">` groups in route order each holding a `<circle>` and a `<text>` whose content is the place name, and one `<text class="route-loop-miles">` reading `formatMiles(milesHeld)` followed by " miles on the road".
M2. `routeLoop` returns an empty string for a stop with no `route`, and `renderHopeCoin` places each non-empty loop inside that stop's `<li class="route-stop">` after its `how` paragraph.
M3. A tick whose name contains "British Columbia" carries a `<path class="route-flag">` inside its group and its `<text>` ends with ", the coin's one border crossing"; no other tick carries either.
M4. `site/styles.css` has a `.route-loop` rule with `width: 100%`, `height: auto`, and a `max-width`; a `.route-loop-path` rule with `stroke: var(--pewter-deep)` and `fill: none`; a `.route-tick circle` rule with `fill: var(--pewter-deep)`; a `.route-flag` rule with `fill: var(--foil-deep)`; and a `.route-tick text` rule with a `font-family` declaration and a `font-size` of at most 11px.
M5. The loop markup contains no em dash.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §5

**Interfaces:**
- Consumes: `formatMiles(n: number): string`
- Produces: `routeLoop(stop: HopeCoinStop): string`

**Context:** `HopeCoinStop` carries `milesHeld?: number` and `route?: string[]` (added by a sibling task in the earlier wave; the shape is: `route` is a non-empty array of place names, present only with `milesHeld`). `renderHopeCoin` builds each stop as a template literal ending with `<p>${esc(stop.how)}</p>` and then `</li>`; the loop goes between those two. The loop is geometry, not a map: a rounded rectangle path leaving the stop's left edge, running right, and returning, with ticks spaced evenly along its top and bottom edges whatever the real distances, so nine names fit as well as six. Place names go through `esc`. The flag is a small triangle path on the tick, drawn, never an emoji. Beau's two routes today are six and nine names long; the SVG's `viewBox` width grows with the count so text never overlaps, at 90 units per tick with the path inset 20 units. Tests build stops with invented names; the border test uses a name containing "British Columbia" and a control name that does not.
**BASE facts:** (generated at c2d93c3)
- `renderHopeCoin` at `tools/render.ts:902` blob db66e29
- `site/styles.css` blob bfa33fe
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `esc` at `tools/render.ts:15` blob db66e29
- `tools/render.ts` blob db66e29

**Proof:**
- Test: `tools/render.test.ts`
- Legs: (a) a stop with a three-name route and `milesHeld` 1234 renders exactly one `route-loop-path`, exactly three `route-tick` groups whose texts are the three names in order and no fourth, exactly one `<circle>` inside each of the three groups, and exactly one miles text reading "1,234 miles on the road"; a `viewBox` attribute is present on the svg [M1]; (b) a stop with no route returns exactly the empty string, and `renderHopeCoin` on a five-stop chain whose second and fourth stops carry routes has exactly two `route-loop` svgs, the first inside the second stop's `li` after its `how` paragraph and the second inside the fourth stop's `li` after its `how` paragraph, and none inside the other three, so an implementation that draws only the first or only the last routed stop fails [M2]; (c) a route naming "Hope, British Columbia" among two other names renders exactly one `route-flag`, inside the British Columbia tick, whose text ends with ", the coin's one border crossing", and the other two ticks carry neither [M3]; (d) `site/styles.css` contains each of the five rules M4 names with each declaration it names, checked one declaration at a time so a missing `stroke`, `fill`, `font-family`, or an oversized `font-size` fails the check that names it [M4]; (e) both the three-name loop and the British Columbia loop from leg (c) contain no U+2014 [M5].

**Stale-if:**
- path-absent: `tools/render.ts`
- issue-closed: #48

### Task 8: Who has held it: the donut, the strip, and the legend

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/render.ts`
- Modify: `site/styles.css`
- Test: `tools/render.test.ts`

**Claim:** A chart shows who has held the coin longest, in months, with the current holder in foil, and a table beside it says the same numbers in words. (derived)
Machine: M1. `holdersSection(data)` returns a `<section class="band-dark">` headed "Who has held it" containing an `<svg class="coin-donut" viewBox="…">` with one `<path class="donut-arc">` per holder in `holderShares` order, the current holder's arc also carrying class `donut-arc--current`, and one `<text class="donut-label">` per holder reading the holder's display name, a space, and the percent followed by "%".
M2. The section contains an `<svg class="tenure-strip" viewBox="…">` with one `<rect class="strip-seg">` per `TenureSegment` in chain order whose widths are proportional to `months` and sum to the strip's drawable width, and one `<text class="strip-tick">` per January that falls strictly inside the range, reading the year.
M3. The section contains a `<table class="tenure-legend">` with one row per holder in `holderShares` order and four cells: display name, reigns, months, percent with "%"; the values equal `holderShares(tenureMonths(history, latestGame))`.
M4. The section's caption reads "Months, as of the " followed by the month name and year of `max(games[].date)` and " game."; when the first stop has no `from`, a second caption sentence reads "The coin's time in " followed by the first stop's `place` and " before " and the month name and year of the second stop's `from` and " is not counted."; when the first stop has a `from`, that sentence is absent.
M5. Every arc and segment fill is either `var(--foil-deep)` (the current holder) or `var(--ink)` with a `fill-opacity` drawn in order from the literal list `1, .8, .62, .46, .32, .2, .12` for the non-current holders in `holderShares` order; the strip uses the same fill for a holder as the donut.
M6. The section contains no em dash.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §7

**Interfaces:**
- Consumes: `tenureMonths(history: HopeCoinStop[], latestGame: string): TenureSegment[]`
- Consumes: `holderShares(segments: TenureSegment[]): HolderShare[]`
- Produces: `holdersSection(data: GamesData): string`

**Context:** `tools/lib/hope-coin.ts` exports `tenureMonths` and `holderShares` (a sibling task in the earlier wave) with these shapes: `TenureSegment = { holder, from, to, months }` with `from` and `to` as `YYYY-MM`, one per dated stop in chain order; `HolderShare = { holder, reigns, months, percent }` sorted by months descending, percents summing to 100. `latestGame` is `data.games.map(g => g.date).sort().at(-1)`. `renderHopeCoin` today returns one `band-light` section; this task appends `holdersSection(data)` after it as a second, `band-dark` section, so the tones alternate. The display name for a slug comes from `data.players` (slug to name), the same map `renderHopeCoin` builds; a slug with no player entry prints as the slug. The donut is drawn in a 200 by 200 `viewBox` as stroked arcs or filled ring segments, largest first starting at twelve o'clock, clockwise; labels sit outside the ring at each arc's midpoint angle, anchored left or right of center. The strip is a 600 by 40 `viewBox` with the drawable width 600; a segment's width is `months / totalMonths * 600`; January ticks are text at the tick's x with a 1-unit hairline. Fills are written as attributes on the SVG elements (`fill="var(--foil-deep)"` or `fill="var(--ink)" fill-opacity=".62"`), which inline SVG honors inside the page's CSS scope. `MONTHS` in `tools/render.ts` is the month-name array the page already uses. The `stat` class and `rule-label` heading class exist in `site/styles.css`; `.coin-donut` and `.tenure-strip` get `width: 100%; height: auto` and a `max-width`, and `.tenure-legend` reuses the ledger table look with numeric cells in the `stat` face. On wide screens the donut and the strip-plus-legend sit side by side in the existing `.cols` grid. Test fixtures use invented slugs and a handful of months so the percentages are easy to check by hand.
**BASE facts:** (generated at c2d93c3)
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/lib/hope-coin.ts` blob 55b1490
- `renderHopeCoin` at `tools/render.ts:902` blob db66e29
- `MONTHS` at `functions/api/_portrait.js:94` blob 9b517bf
- `tools/render.ts` blob db66e29
- `site/styles.css` blob bfa33fe
- `players` at `tools/chip-race.ts:30` blob 4ff7e59

**Proof:**
- Test: `tools/render.test.ts`
- Legs: (a) on a synthetic chain with three holders holding 3, 6, and 3 months in chain order, the current holder being the last, `holdersSection` returns a `<section class="band-dark">` whose heading text is "Who has held it", containing an `<svg class="coin-donut"` with a `viewBox` attribute, exactly three `<path class="donut-arc` elements in `holderShares` order (the 6-month holder first, then the two 3-month holders in first-appearance order, which differs from chain order, so a donut drawn in chain order fails), exactly one carrying `donut-arc--current` and it is the current holder's, and exactly three `<text class="donut-label">` elements reading the 6-month holder's name with "50%", then the first 3-month holder's name with "25%", then the current holder's name with "25%" [M1]; (b) on a separate three-stop chain where holder A holds 2024-12 to 2025-02, B holds 2025-02 to 2025-08, and A returns from 2025-08 with the latest game dated 2025-12-09 (2, 6, and 4 months: chain order A, B, A while share order is A then B, A has two reigns, and the sequence is not a palindrome), the `<svg class="tenure-strip"` element carries a `viewBox` attribute and contains exactly three `strip-seg` rects whose `width` attributes read, in document order, exactly 100, 300, and 200 (months over total months times 600), so a strip drawn per holder, in share order, in reverse chain order, or with equal widths fails; its `strip-tick` texts are exactly one, reading "2025"; rendering the same chain with the latest game dated 2026-01-13 instead still yields exactly one tick reading "2025" and none reading "2026", so a January on the range's end edge is excluded; a third render of a chain whose first dated stop starts 2025-01 and whose latest game is 2025-12-09 yields exactly zero ticks, so a January on the range's start edge is excluded too; and a fourth render of a two-stop chain running from 2023-06 to a latest game dated 2026-03-10 yields exactly three ticks reading "2024", "2025", "2026" in document order, so a renderer that emits at most one tick or only the first interior January fails [M2]; (c) on the 3, 6, 3 chain the section contains exactly one `<table class="tenure-legend">` whose body has exactly three `<tr>` rows, each with exactly four `<td>` cells reading, in order, the holder's display name from `players`, the reigns, the months, and the percent with a trailing "%": row one reads the 6-month holder, 1, 6, "50%", and rows two and three read the two 3-month holders in first-appearance order, 1, 3, "25%", so a table without the class, a row with a fifth or missing cell, or a bare number in the percent column fails; and on the A, B, A chain from leg (b) the table has exactly two rows reading A, 2, 6, "50%" then B, 1, 6, "50%" (tied months, A first by first appearance, A on two reigns), so a legend that prints a constant reigns value or ignores reigns fails [M3]; (d) on a fixture whose `games` array lists three games dated 2025-08-12, 2025-11-11, and 2025-10-14 in that order (the latest is neither first nor last), the caption contains the literal text "Months, as of the November 2025 game.", so an implementation reading the first or last array element fails; with an undated first stop it also contains the literal "The coin's time in " followed by the first stop's place, " before ", the second stop's month name and year, and " is not counted."; and with a dated first stop the string "is not counted" is absent [M4]; (e) on a second synthetic chain with eight holders in which the current holder is second in `holderShares` order (neither first nor last), the current holder's arc and segment carry `fill="var(--foil-deep)"`, the seven others carry `fill="var(--ink)"` with `fill-opacity` values of exactly `1`, `.8`, `.62`, `.46`, `.32`, `.2`, `.12` in share order skipping the current holder (so the first holder reads `1` and the third reads `.8`, and an implementation indexing opacity by absolute share position fails), no `fill` attribute in the section names any other value, and each holder's arc and segment carry the identical fill and opacity [M5]; (f) the section contains no U+2014 [M6].

**Stale-if:**
- path-absent: `tools/render.ts`
- issue-closed: #48

### Task 9: Regenerate the coin page and prove the whole page

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `site/hope-coin/index.html`
- Modify: `CLAUDE.md`
- Test: `tools/site.test.ts`

**Claim:** The committed coin page is exactly what the renderer produces from the committed data, the images it points at exist, and the whole suite is green on the integrated tree. (derived)
Machine: M1. After `bun tools/render.ts` runs against the committed data, `git status --porcelain` reports nothing under `site/standings/index.html`, `site/games/index.html`, `site/next-game.ics`, `site/player/`, and `site/hope-coin/`.
M2. `site/hope-coin/index.html` contains `/hope-coin/assets/coin.png`, an `og:image` of `https://poker.kmikeym.com/hope-coin/assets/coin-og.png`, the text " miles on record", exactly two `route-loop` SVGs, exactly one `coin-donut`, exactly one `tenure-strip`, eleven `route-leg` items, and no U+2014.
M3. Both `site/hope-coin/assets/coin.png` and `site/hope-coin/assets/coin-og.png` exist and are non-empty.
M4. `bun test tools` exits 0.
M5. The `bun test tools` comment line in `CLAUDE.md` states the number of tests the suite prints.

**Authorized-by:** #48; spec `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` §9, §10

**Interfaces:**
- Consumes: `coinHero(data: GamesData): string`
- Consumes: `odometerTiles(data: GamesData): string`
- Consumes: `routeLoop(stop: HopeCoinStop): string`
- Consumes: `holdersSection(data: GamesData): string`
- Produces: none

**Context:** This task is the single owner of the generated file: every earlier task changes the renderer or the data and commits no HTML, so the page is written once, here, from the integrated tree. `bun tools/render.ts` writes the five generated paths, `site/hope-coin/index.html` among them; only that file is expected to change in this task, and if any other generated page changes the task stops and reports it. `tools/site.test.ts` already holds the drift test (the block "running the real renderer leaves the generated paths clean") and the coin page's unfurl block ("site/hope-coin/index.html exists and carries its own unfurl tags"); the new assertions for M2 and M3 go beside that unfurl block, reading the committed page and the assets from disk. The eleven `route-leg` count is the twelve-stop chain minus one; the two loops are Beau's two stints. `CLAUDE.md`'s Commands block has a comment on the `bun test tools` line giving the suite's count and the pass it was counted at; update the number and the pass name to this one. The suite's expected count is whatever `bun test tools` prints after every earlier task has landed; the drift test refuses a dirty generated path, so the order here is render, commit, then the suite.
**BASE facts:** (generated at c2d93c3)
- `site/standings/index.html` blob 456b245
- `site/games/index.html` blob 39ec7e5
- `site/next-game.ics` blob 38241a6
- `site/hope-coin/index.html` blob ac2fff0
- `CLAUDE.md` blob c288fbf
- `docs/superpowers/specs/2026-09-05-hope-coin-infographics-design.md` blob 9f3de3f
- `tools/site.test.ts` blob 298074e

**Proof:**
- Test: `tools/site.test.ts`
- Run: `bun tools/render.ts && git status --porcelain site/standings/index.html site/games/index.html site/next-game.ics site/player/ site/hope-coin/`
- Run: `bun test tools`
- Run: `grep -n "bun test tools" CLAUDE.md`
- Legs, each reading the committed `site/hope-coin/index.html` from disk: (a) the first Run prints the render line and then nothing [M1]; (b) the page contains `/hope-coin/assets/coin.png` [M2]; (c) the page's `og:image` meta content is exactly `https://poker.kmikeym.com/hope-coin/assets/coin-og.png` [M2]; (d) the page contains the text " miles on record" [M2]; (e) the count of `class="route-loop"` occurrences is exactly 2 [M2]; (f) the count of `class="coin-donut"` occurrences is exactly 1 [M2]; (g) the count of `class="tenure-strip"` occurrences is exactly 1 [M2]; (h) the count of `class="route-leg"` occurrences is exactly 11 [M2]; (i) the count of U+2014 characters in the page is exactly 0 [M2]; (j) both asset paths exist with a byte size above zero [M3]; (k) the second Run ends with `0 fail` and exit 0 [M4]; (l) the grep line's comment carries the same number the second Run printed as its pass count [M5].

**Stale-if:**
- path-absent: `site/hope-coin/assets/coin.png`
- path-absent: `site/hope-coin/assets/coin-og.png`
- issue-closed: #48
