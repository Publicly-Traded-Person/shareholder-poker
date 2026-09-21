# What Would You Have Done? Implementation Plan

**Grammar:** claims-v1
**Claim:** I open the week's puzzle, sit in the seat, play the hand out against the table, and see how many chips I finished with, what really happened, what everyone else in that seat chose, and where my first go sits on the leaderboard. (elicited)
**Summary:** A weekly puzzle on poker.kmikeym.com: one real hand from the last game, and you play it from one player's seat against the rest of the table. It exists to keep the poker list in the game between the monthly nights and to teach people to play by letting them try a real spot. Everyone gets the same deal, your first go is the one that counts, and the reveal shows what really happened and what the room did.

**Goal:** Ship the hand puzzle end to end on a branch: a deterministic no-limit hold'em engine and hand evaluator that run unchanged in the browser, in the Pages Function and under `bun test`; an opponent rule table driven by profile numbers; a hand-file loader and check tool that refuse a file the log does not support; one Pages Function that records every attempt in D1, ranks only the first, and never returns an email; generated puzzle pages in the one-job-per-page style; and the weekly runbook. Decisions from the 2026-09-20 review with Mike (first attempt ranks, disclosure on every page, roster names, named constants, lifetime profiles, static asset fetch) are binding.
**Closes:** #70

**Tech Stack:** Plain ES-module JavaScript under `site/` (no build step, no npm runtime dependency), Cloudflare Pages Functions + D1 (`poker-rsvp-db`), Bun + TypeScript tools and `bun:test`.
**Exam command:** bun test {paths}

**Spec:** `docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md` at `8396fd8` (Charlie's spec, amended after the review with Mike). Prior art: `functions/api/rsvp.js` and `tools/rsvp-lib.test.ts` (the Function pattern), `site/portrait-dither.js` and `tools/portrait-dither.test.ts` (a browser module tested under bun), `tools/render.ts` and the drift check in `tools/site.test.ts` (generated pages).

**Parallelization rationale:** Four waves. Wave 1 is two wide: the evaluator (Task 1) and the runbook (Task 2) share nothing. Wave 2 is two wide: the engine (Task 3) and the rule table (Task 4) each consume the evaluator's runtime behaviour, because side-pot settlement and hand-strength bands are wrong unless a real evaluator ranks the cards, and no contract can promise a ranking. Wave 3 is two wide: the hand-file check (Task 5) consumes the engine's `replay` because its whole job is comparing the engine's settled stacks to the log's; the Function (Task 6) consumes `playSeat` and `decide` because the server's chip count must come from the same code the browser ran. Wave 4 is the pages (Task 7), which consume Task 5's loader so the renderer refuses exactly the files the check tool refuses. Task 8 is manual and waves nowhere.

## Global Constraints

- Privacy (spec §3, repo CLAUDE.md): no email in any GET response, any generated page, any hand file or any fixture. Test fixtures are synthetic: invented handles only (`alice`, `bob`, `carol`, `dave` in this plan), never a real player's handle.
- Check: ! grep -rliE 'kmikeym|lewd|joshb|mohdi|spladow|webvee|nickmershon|amaxwell|gamzie|mawttm|u_perfection|exis0008|chrishiggins' tools --include='wwyhd-*'
- Determinism: nothing under `site/wwyhd-*.js` reads a clock or a random source; the same hand file and the same choices give the same chips on every machine.
- Check: ! cat site/wwyhd-*.js | grep -v '^[[:space:]]*//' | grep -E 'Math\.random|Date\.now|new Date'
- Every `site/wwyhd-*.js` file is a plain ES module that loads in a browser and under bun: no `require`, no Node or Bun API, no DOM access at module top level (the controller guards its DOM work behind a `typeof document` check).
- Card notation everywhere: two characters, rank in `23456789TJQKA`, suit in `shdc` (`Ah`, `Td`, `7d`). Amounts are integers in chips. A bet or raise carries `amount` as the TOTAL the player's street contribution becomes (PokerNow's "raises to N"); fold, check and call carry `amount` 0.
- Copy rules on every generated puzzle page (docs/brand.md): no em dash, the word "experiment" never, real players named First + last initial from `games.json` beside their handle, `band-light` and `band-dark` alternate, no `btn-primary` (lime is the RSVP CTA's), and the disclosure sentence verbatim: "This is a simulation. The cards shown at showdown are the real ones. Everything else was filled in with what we judged likely."
- `site/data/games.json` is not touched by this plan.
- Check: git diff --quiet $ULTRA_BASE -- site/data/games.json
- Every new file opens with a header comment (what it is, where it sits in the publish flow, how to run it or where it is served) and every exported function carries a comment saying what it takes, returns and throws, with the why of each invariant (repo CLAUDE.md, Mike 2026-08-18).
- The whole suite stays green on every folded tree.
- Check: bun test tools
- Never push to `main`: every push deploys the live site.

---

### Task 1: The hand evaluator

**Type:** implementation
**Review:** peer

**Files:**
- Create: `site/wwyhd-eval.js`
- Test: `tools/wwyhd-eval.test.ts`

**Claim:** At showdown the best five of a player's seven cards decide the pot, and two hands of the same strength split it. (derived)
Machine: M1. `evaluate(cards)` on 5, 6 or 7 cards returns an integer, and for each adjacent pair in the order high card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, straight flush, a hand of the higher category scores above a hand of the lower. M2. Within a category the kickers decide in standard order: `evaluate(["Ah","Ad","Kc","7s","2d","9h","3c"])` is greater than `evaluate(["Ah","Ad","Qc","7s","2d","9h","3c"])`. M3. Two hands whose best five cards have the same ranks score equal whatever their suits; the wheel (`A 2 3 4 5`) is the lowest straight and `T J Q K A` the highest. M4. `handCategory(score)` returns the category name, one of exactly those nine strings. M5. `evaluate` throws on fewer than 5 cards, on more than 7, on a duplicate card, and on a card outside the notation.

**Authorized-by:** #70; spec §4.2 ("Showdown: seven-card hand evaluation")

**Interfaces:**
- Consumes: nothing
- Produces: `evaluate(cards: string[]): number`
- Produces: `handCategory(score: number): string`

**Context:** Written from scratch, not vendored: the site has no build step and no runtime npm, and a licence-free hundred lines with its own tests is easier for Charlie to read than a minified third-party file. Score encoding is the implementer's choice as long as M1 to M3 hold; a category index times a large base plus the five ranking ranks in order is the usual shape. Card notation is the plan's global literal (rank `23456789TJQKA`, suit `shdc`). The nine category names, exactly: `high card`, `pair`, `two pair`, `three of a kind`, `straight`, `flush`, `full house`, `four of a kind`, `straight flush`. The file is imported by the engine (Task 3) and the rules (Task 4) with `import { evaluate } from "./wwyhd-eval.js"`, by tests with `// @ts-ignore` above the import as `tools/portrait-dither.test.ts` does, and by the Pages Function through a relative path into `site/` (a `wrangler pages dev` probe on 2026-09-20 confirmed a Function may import `../../site/<file>.js`).
**BASE facts:** (generated at 8396fd8)
- `tools/portrait-dither.test.ts` blob 2f7a002

**Proof:**
- Test: `tools/wwyhd-eval.test.ts`
- Legs: (a) a pair beats high card on concrete seven-card hands [M1]; (b) two pair beats a pair [M1]; (c) three of a kind beats two pair [M1]; (d) a straight beats three of a kind [M1]; (e) a flush beats a straight [M1]; (f) a full house beats a flush [M1]; (g) four of a kind beats a full house [M1]; (h) a straight flush beats four of a kind [M1]; (i) the two aces-with-king versus aces-with-queen hands from M2 compare as stated [M2]; (j) `["Ah","2d","3c","4s","5h","9d","Tc"]` and `["Ac","2h","3d","4d","5c","9s","Th"]` score equal, and both score below `["6h","7d","8c","9s","Th","2d","3c"]`, and `["Th","Jd","Qc","Ks","Ah","2d","3c"]` scores above the two straights just named and above `["6h","7d","8c","9s","Th","2d","3c"]` [M3]; (k) the five-card hand `["Ah","Ad","Kc","9h","7s"]` and the six-card hand `["Ah","Ad","Kc","9h","7s","2d"]` both return an integer and both score equal to the seven-card `["Ah","Ad","Kc","7s","2d","9h","3c"]` (the same best five, A A K 9 7), and the five-card `["Kh","Kd","Qc","7s","2d"]` scores below all three [M1]; (l) `handCategory` of each of the nine hands in legs (a) to (h) returns its name, and the set of names returned across them is exactly the nine strings [M4]; (m) `evaluate` throws on the four-card `["Ah","Ad","Kc","7s"]`, on the eight-card `["Ah","Ad","Kc","7s","2d","9h","3c","4c"]`, on the seven-card `["Ah","Ah","Kc","7s","2d","9h","3c"]` (a duplicate), and on the seven-card `["1h","Kc","7s","2d","9h","3c","4c"]` (a card outside the notation), while each of those hands with the offending card corrected or the count made seven returns an integer [M5].

**Stale-if:**
- path-exists: `site/wwyhd-eval.js`

### Task 2: The weekly runbook, the commands block and the spec in step

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `docs/publishing.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md`

**Claim:** Charlie can run the weekly puzzle from the runbook alone: which file to write, which check to run, how the pages get made, and the one schema step, in the order they happen. (derived)
Machine: M1. `docs/publishing.md` gains a section headed `## The weekly puzzle` whose body names, in this order, the hand-file directory `site/data/wwyhd/`, the check `bun tools/wwyhd-check.ts`, the renderer `bun tools/render.ts`, the suite `bun test tools`, and Mike's go before merge. M2. That section names the one-time schema apply, `npx wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql`, and says it is idempotent. M3. That section carries the disclosure sentence and says it appears on every puzzle page, and states that the first attempt ranks and that replays do not rank. M4. The `Commands` block of `CLAUDE.md` lists `bun tools/wwyhd-check.ts`. M5. The spec's §4.1 names `endStacks` under `real`, its §4.5 DDL names the `decisions` and `ranked` columns, its §4.2 names `site/wwyhd-eval.js` and `site/wwyhd-engine.js`, its §4.3 names `site/wwyhd-rules.js`, its §4.4 names the controller `site/wwyhd.js`, its §4.3 says the rule fixtures are four archetype profiles with real numbers arriving inline in each hand file, and its §4.5 names the routes as `/api/wwyhd?hand=<hand_id>`.

**Authorized-by:** #70; spec §5 (the weekly runbook), repo CLAUDE.md ("Process lives in docs/publishing.md and it is normative")

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** The runbook section follows the shape of the existing "The monthly publish" sections: numbered steps, each command on its own line, the reason for each gate inline. The steps, from the spec as amended: pick a showdown hand from the last game's log; write `site/data/wwyhd/<YYYY-MM-DD>-<n>.json` copying every log number and adding `real.endStacks` (each player's stack at the start of the next hand, from the log's `Player stacks:` line); run the check (exit 0 prints `ok <id>` per file, exit 1 names the first failure, and a failure means the file is wrong, not the engine); run the renderer, which writes `site/wwyhd/index.html` and `site/wwyhd/<id>/index.html`; commit the generated pages; run the suite; PR; Mike reads title, setup and result; merge on his go; email the poker list (one line, the table image, the link; Mike sends). The schema apply is a one-time step before the first puzzle merges, the same command already in the runbook for the consent tables. Hidden holdings and an authored runout are labelled on the page; the seat player's cards are real because they showed down. `CLAUDE.md`'s `Commands` block currently says the suite is "827 tests as of the route-lines redraw, 2026-09-07"; drop the count and keep the rule, since the number moves every PR. The spec amendments are small and marked *build*: `endStacks` (§4.1), the `decisions TEXT NOT NULL` and `ranked INTEGER NOT NULL` columns (§4.5, the reasons: the histogram is served from stored decision keys, and ranked-ness is decided at submit time against `closes`), the route `/api/wwyhd?hand=<hand_id>` (§4.5; one Function file, the RSVP shape, because Pages dynamic segments add nothing a query parameter does not), the four module paths (§4.2, §4.3; one file per concern, all at `site/` root so `site/wwyhd/` holds only generated pages and the drift check stays clean), and the archetype fixtures (§4.3; test fixtures in this repo are synthetic by the privacy tier, so real numbers reach the rules only through the hand files Charlie writes). The spec's §4.2 heading at BASE reads "The engine (browser, `site/wwyhd.js`)"; reword it to `site/wwyhd-engine.js` so the spec does not name one path as two things, and put the controller path under §4.4 where the page is described. No task in this plan adds the puzzle to the site's shared nav; the runbook says the link travels by email and from `/wwyhd/`.
**BASE facts:** (generated at 8396fd8)
- `docs/publishing.md` blob a6d4991
- `CLAUDE.md` blob 9119c8c

**Proof:**
- Run: sed -n '/^## The weekly puzzle/,/^## /p' docs/publishing.md | tr '\n' ' ' | grep -q 'site/data/wwyhd/.*wwyhd-check.*render.ts.*bun test tools.*Mike.s go'
- Run: sed -n '/^## The weekly puzzle/,/^## /p' docs/publishing.md | tr '\n' ' ' | grep -q 'wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql.*idempotent'
- Run: sed -n '/^## The weekly puzzle/,/^## /p' docs/publishing.md | tr '\n' ' ' | grep -q 'This is a simulation. The cards shown at showdown are the real ones. Everything else was filled in with what we judged likely.*every puzzle page'
- Run: sed -n '/^## The weekly puzzle/,/^## /p' docs/publishing.md | tr '\n' ' ' | grep -qi 'first attempt.*rank.*replay.*not rank'
- Run: sed -n '/^## Commands/,/^## /p' CLAUDE.md | grep -q 'bun tools/wwyhd-check.ts'
- Run: sed -n '/^### 4.1/,/^### 4.2/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | tr '\n' ' ' | grep -q '"real".*endStacks'
- Run: sed -n '/^### 4.5/,/^### 4.6/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'decisions *TEXT'
- Run: sed -n '/^### 4.5/,/^### 4.6/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'ranked *INTEGER'
- Run: sed -n '/^### 4.2/,/^### 4.3/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'site/wwyhd-eval.js'
- Run: sed -n '/^### 4.2/,/^### 4.3/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'site/wwyhd-engine.js'
- Run: sed -n '/^### 4.3/,/^### 4.4/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'site/wwyhd-rules.js'
- Run: sed -n '/^### 4.4/,/^### 4.5/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'site/wwyhd.js'
- Run: sed -n '/^### 4.3/,/^### 4.4/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | tr '\n' ' ' | grep -qi 'four archetype.*inline in each hand file'
- Run: sed -n '/^### 4.5/,/^### 4.6/p' docs/superpowers/specs/2026-09-20-what-would-you-have-done-design.md | grep -q 'api/wwyhd?hand='
- Legs: (a) the first `Run:` pins the five names in order inside the section, the last being the phrase Mike's go [M1]; (b) the second pins the apply command and the word idempotent [M2]; (c) the third pins the disclosure sentence followed by the words every puzzle page, and the fourth pins first attempt, rank, and that replays do not rank, in order [M3]; (d) the fifth pins the command in the `Commands` block [M4]; (e) the sixth through fourteenth each run inside the spec section the clause names: `endStacks` under `real` in §4.1, the two columns in §4.5, the eval and engine paths in §4.2, the rules path in §4.3, the controller path in §4.4, the archetype sentence in §4.3, and the query-parameter route in §4.5 [M5].

**Stale-if:**
- issue-closed: #70

### Task 3: The hand engine

**Type:** implementation
**Review:** peer

**Files:**
- Create: `site/wwyhd-engine.js`
- Test: `tools/wwyhd-engine.test.ts`

**Claim:** The visitor plays a real no-limit hand out to the end: blinds, minimum raises, all-ins and side pots come out the way a dealer would rule them, and the same choices always end with the same chips. (derived)
Machine: M1. `startHand(hand)` posts any ante from every player, then the small and big blinds from the two players clockwise after `dealer` in `players` order (heads-up the dealer posts the small blind), and puts the first player left of the big blind to act preflop (heads-up, the dealer). M2. `legalActions(state)` for the player to act returns `{fold, check, call, minRaiseTo, maxRaiseTo}`: `check` only when nothing is owed, `call` the amount owed capped at the stack, `minRaiseTo` the current bet plus the last raise size (never less than the big blind) and `maxRaiseTo` the player's stack plus their street contribution; when the stack cannot reach `minRaiseTo`, both are the all-in total. M3. An all-in for less than a full raise does not reopen the action: a player who already acted this street then gets `minRaiseTo` and `maxRaiseTo` null and may only fold or call. M4. `settle(state)` returns an uncalled bet to its bettor, builds one pot per all-in level with only the players who covered it eligible, awards each pot to the best `evaluate` score among its eligible players, splits a tie equally with the odd chip to the first eligible player clockwise from the dealer, and the returned stacks sum to the starting stacks. M5. `replay(hand, actions)` applies the file's `real.actions` in order and returns the settled state with `stacks`; it throws, naming the handle, on an action by a player who is not to act or on an illegal action. M6. `playSeat(hand, seatLine, decide)` consumes the seat's actions in order, calls `decide(view)` for every other player's turn, and returns `{chips, line, decisions}` where `decisions` has one `{key, type}` entry per decision the SEAT made, `key` being the street, a colon, and the comma-joined `handle:type:amount` prefix of every action before that decision, blind and ante postings included as `handle:sb:amount`, `handle:bb:amount` and `handle:ante:amount`; it throws when the line runs out while the seat must still act and when actions remain after the hand ends. M7. Two calls of `playSeat` with equal inputs return deep-equal results, and a state passed to `applyAction` is not mutated.

**Authorized-by:** #70; spec §4.2 (the engine) and §6 (engine tests)

**Interfaces:**
- Consumes: `evaluate(cards: string[]): number`
- Produces: `startHand(hand: HandFile): State`
- Produces: `legalActions(state: State): {fold: boolean, check: boolean, call: number, minRaiseTo: number|null, maxRaiseTo: number|null}`
- Produces: `applyAction(state: State, action: {type: string, amount: number}): State`
- Produces: `isHandOver(state: State): boolean`
- Produces: `settle(state: State): {stacks: Record<string, number>, pots: {amount: number, eligible: string[], winners: string[]}[]}`
- Produces: `replay(hand: HandFile, actions: {street: string, handle: string, type: string, amount: number}[]): State`
- Produces: `playSeat(hand: HandFile, seatLine: {street: string, type: string, amount: number}[], decide: (view: View) => {type: string, amount: number}): {chips: number, line: object[], decisions: {key: string, type: string}[]}`
- Produces: `seatView(state: State, handle: string): View`

**Context:** The hand file shape this engine reads (the plan's shared literal; Task 5 validates it, Task 6 fetches it, Task 7 embeds it): `{ id, game, handNo, title, setup, seat, blinds: {sb, bb, ante}, dealer, players: [{handle, stack, cards: [c, c], shown, profile}], board: [c, c, c, c, c], real: {actions, result, seatChips, endStacks: {handle: chips}}, startChips, profileThrough, opens, closes }`. `players` is seat order clockwise. Streets are `PRE`, `FLOP`, `TURN`, `RIVER`; the flop is `board[0..2]`, the turn `board[3]`, the river `board[4]`; when everyone left is all-in the remaining board runs out and the hand settles. Action types are `fold`, `check`, `call`, `bet`, `raise`; `amount` is the street total for bet and raise and 0 otherwise (global literal). `View` is `{handle, cards, board, street, pot, toCall, stack, playersIn, position, legal}` with `position` one of `blinds`, `early`, `late` (dealer and the seat before it are `late`). Import the evaluator as `import { evaluate } from "./wwyhd-eval.js"`; the Function will import this file through `../../site/wwyhd-engine.js`, which a `wrangler pages dev` probe confirmed on 2026-09-20. Pure functions over a plain state object, returning new objects, so `bun test` needs no DOM and the Worker can run the same code. Worked side-pot case, computed by hand for the exam: players in order A (dealer, 1000), B (3000), C (6000), blinds 100/200, no ante; preflop A raises to 1000 (all-in), B raises to 3000 (all-in), C calls 3000; main pot 3000 (A, B, C), side pot 4000 (B, C); cards A `Ah Ad`, B `Kh Kd`, C `2c 7d`, board `3s 8h 9c Jd Qs`; A wins the main, B the side; final stacks A 3000, B 4000, C 3000, sum 10000. Worked odd-chip case: A (dealer, 1000), B (1000), C (999), blinds 100/200; A raises to 1000 (all-in), B calls (all-in), C calls (all-in, 999); main pot 2997 (A, B, C), side pot 2 (A, B); A `Th 9d`, B `Tc 9s`, C `Ah Kd`, board `8h 7c 6d 2s 3c`; A and B tie with a ten-high straight, C has ace high; B is first clockwise from the dealer so B takes 1499 of the main and A 1498, the side splits 1 and 1; final A 1499, B 1500, C 0, sum 2999. Worked no-reopen case: A (dealer, 5000), B (5000), C (650), blinds 100/200; A raises to 600, B calls 600, C goes all-in to 650; A and B then see `minRaiseTo` null and `call` 50. Worked min-raise case: after A raises to 600 over the 200 blind, B's `minRaiseTo` is 1000.
**BASE facts:** (generated at 8396fd8)
- `players` at `tools/chip-race.ts:67` blob 5b73331
- `stacks` at `tools/chip-race.test.ts:93` blob 7df82c8
- `key` at `tools/lib/portraits.ts:401` blob 79df55d
- `line` at `tools/lib/pokernow.ts:26` blob 2e39a68

**Proof:**
- Test: `tools/wwyhd-engine.test.ts`
- Legs: (a) with A, B, C at blinds 100/200 and dealer A, `startHand` leaves B at 2900 with 100 in, C at 5800 with 200 in, and A to act; with an ante of 25 added, every player has 25 more in and the pot before any action is 375; heads-up with dealer A and one other, A has posted 100 and acts first [M1]; (b) before any action on that table A's `legalActions` has `minRaiseTo` 400 (the big blind floor) and `maxRaiseTo` 1000; after A raises to 600, B (who posted the 100 small blind) has `check` false, `call` 500, `minRaiseTo` 1000 and `maxRaiseTo` 3000; a player owed nothing has `check` true and `call` 0, and `applyAction` with `check` throws for B while chips are owed; a player with 400 behind facing 600 owed gets `call` 400 and `minRaiseTo` equal to `maxRaiseTo` [M2]; (c) on the no-reopen table (A dealer 5000, B 5000, C 650, blinds 100/200; A raises to 600, B calls, C goes all-in to 650) A's and B's `legalActions` have `check` false, `fold` true, `call` 50, `minRaiseTo` null and `maxRaiseTo` null, `applyAction` with a raise throws for each of them, and `applyAction` with `check` throws for each of them [M3]; (d) heads-up A bets 500 on the flop and B folds: A's stack shows the 500 back; the worked side-pot case settles to A 3000, B 4000, C 3000 with two pots whose `eligible` lists are `[A,B,C]` and `[B,C]`; the odd-chip case (dealer A, seats A 1000, B 1000, C 999, blinds 100/200, all three all-in preflop) settles to A 1499, B 1500, C 0; in each case the stacks sum to the starting sum [M4]; (e) `replay` on a scripted full-table line returns `stacks` equal to the hand-computed values, and a line whose second action names the wrong handle throws with that handle in the message, as does a raise below `minRaiseTo` [M5]; (f) `playSeat` on the side-pot table with the seat A and the line raise to 1000, against a scripted `decide` that calls whatever is owed and checks otherwise, returns `chips` 3000 (A's aces take the 3000 pot A, B and C each put 1000 into), a `line` equal to the seat actions given, and `decisions` of length one whose key is exactly `PRE:B:sb:100,C:bb:200` and whose type is `raise`; a seat line one action short throws, and one action long throws [M6]; (g) two `playSeat` calls on the same inputs are deep-equal, and the state object passed to `applyAction` is deep-equal to a copy taken before the call [M7].

**Stale-if:**
- path-exists: `site/wwyhd-engine.js`

### Task 4: The opponent rule table

**Type:** implementation
**Review:** peer

**Files:**
- Create: `site/wwyhd-rules.js`
- Test: `tools/wwyhd-rules.test.ts`

**Claim:** the other players driven by deterministic rules from their profiles (quoted from #70)
Machine: M1. `strengthBand(cards, board)` returns 0 to 4. With an empty board: a pocket pair of jacks or better, or ace-king, is 4; any other pocket pair, ace-queen, ace-jack or king-queen is 3; any other two cards ten or higher, or a suited ace, is 2; a suited pair of consecutive ranks is 1; anything else is 0. With a board: 4 is three of a kind or better; 3 is two pair, a pair with the top board card, or a pocket pair above every board card; 2 is a pair with a board card that is not the top one; 1 is a pocket pair that pairs no board card and is below the top board card, or, before the river, an open-ended straight draw or a four-card flush draw; 0 is anything else. So preflop `Ah Ad` is 4 and `7d 2c` is 0; on the river board `Ah 7d 2c Ks 9h` the holding `7h 7s` is 4, `Ac Qd` is 3, `9c 3d` is 2, `6c 6d` is 1, `5c 4d` is 0 (no draw exists on a river board); on the flop `9h 8d 2c` the holding `Jc Tc` is 1 and `Qs 3s` is 0; on the flop `Ah 7h 2c` the holding `Kh 9h` is 1. M2. `preflopPercentile(cards)` returns a number greater than 0 and at most 100 where `Ah Ad` is the smallest value of any holding, `7d 2c` the largest, and a suited holding never returns more than its offsuit twin. M3. `decide(view, profile)` follows this table: unopened preflop, enter when `preflopPercentile(cards) <= profile.vpip`, raising to `legal.minRaiseTo` when `profile.af >= RAISE_AF` and calling otherwise, and fold when not entering; facing a bet or raise before the river, fold when the band is below the bar `foldToRaise` sets (bar 3 when `foldToRaise >= 75`, bar 2 when `foldToRaise >= 50`, bar 1 otherwise), raise with band 3 or 4 when `profile.af >= RAISE_AF`, and call otherwise; facing a river bet, call with band 2 or better when `profile.callDown >= CALL_DOWN` and with band 3 or better otherwise, else fold. Therefore, for a holding whose `preflopPercentile` lies strictly between 20 and 50 (the exam uses `Js Td` and asserts this first), with `RAISE_AF` 1.5 and `CALL_DOWN` 50: unopened preflop, tight-passive (vpip 15) folds, loose-passive (vpip 55, af 0.7) calls, tight-aggressive (vpip 20) folds, loose-aggressive (vpip 50, af 2.5) raises to `minRaiseTo`; facing a flop raise with band 2, tight-passive (foldToRaise 80) folds, loose-passive (30) calls, tight-aggressive (60) calls, loose-aggressive (25) calls; facing a river bet with band 2, tight-passive (callDown 30) folds, loose-passive (70) calls, tight-aggressive (40) folds, loose-aggressive (65) calls; and every returned action is allowed by `view.legal`. M4. Invariants across every fixture in the file: a band-4 holding is never folded; a band-0 holding never returns `amount` equal to `view.legal.maxRaiseTo` and never bets or raises when `check` is available. M5. `THRESHOLDS` exports exactly the keys `RAISE_AF`, `CALL_DOWN`, `ALL_IN_STRONG`, `CHEAP_CALL_SHARE` and `MIN_SHARED`, each a finite number, and `decide(view, profile, thresholds)` reads them from its third argument (defaulting to `THRESHOLDS`): with a copy whose `RAISE_AF` is 3.0, the loose-aggressive unopened action from M3 becomes call. M6. Two calls of `decide` with equal inputs return deep-equal actions.

**Authorized-by:** #70; spec §4.3 (the opponent rules, as amended: rule 5 keyed on a named constant)

**Interfaces:**
- Consumes: `evaluate(cards: string[]): number`
- Produces: `THRESHOLDS: Record<string, number>`
- Produces: `strengthBand(cards: string[], board: string[]): number`
- Produces: `preflopPercentile(cards: string[]): number`
- Produces: `decide(view: View, profile: Profile, thresholds?: Record<string, number>): {type: string, amount: number}`

**Context:** The profile is `{vpip, af, allInRate, foldToRaise, callDown}`: `vpip`, `foldToRaise`, `callDown` are percentages 0 to 100; `af` is bets plus raises over calls; `allInRate` is all-ins per hand, 0 to 1. `View` is the engine's (Task 3's Context): `{handle, cards, board, street, pot, toCall, stack, playersIn, position, legal}` with `legal` the engine's `legalActions` shape `{fold, check, call, minRaiseTo, maxRaiseTo}`. The v1 table from the spec, in order: rank the holding into a band; preflop unopened, enter when `preflopPercentile(cards) <= vpip`, raising to `minRaiseTo` when `af >= RAISE_AF` else calling; facing a bet or raise, fold below the band `foldToRaise` implies (higher `foldToRaise`, higher the bar), call in the middle bands, raise with band 3 or 4 when `af >= RAISE_AF` else call; on the river facing a bet, call with band 2 or better when `callDown >= CALL_DOWN`, otherwise band 3 or better; go all-in with band 4 always, with band 3 when `allInRate > ALL_IN_STRONG`, and otherwise only when the call is under `CHEAP_CALL_SHARE` of the stack. The bar `foldToRaise` sets: 3 at 75 or more, 2 at 50 or more, 1 below. `decide` takes the thresholds as an optional third argument defaulting to `THRESHOLDS`, so the exam can prove the table reads them rather than inlined copies. Named constants at the top of the file with the number's source in a comment: `RAISE_AF = 1.5`, `CALL_DOWN = 50`, `ALL_IN_STRONG = 0.25`, `CHEAP_CALL_SHARE = 0.2`, and `MIN_SHARED = 5` (the histogram floor the Function and the page both read from here). The preflop chart can be a ranking of the 169 starting-hand classes; any published ordering is fine as long as M2 holds. Archetype profiles for the exam (synthetic, the repo's privacy tier): tight-passive `{vpip: 15, af: 0.6, allInRate: 0.01, foldToRaise: 80, callDown: 30}`, loose-passive `{vpip: 55, af: 0.7, allInRate: 0.02, foldToRaise: 30, callDown: 70}`, tight-aggressive `{vpip: 20, af: 3.0, allInRate: 0.05, foldToRaise: 60, callDown: 40}`, loose-aggressive `{vpip: 50, af: 2.5, allInRate: 0.3, foldToRaise: 25, callDown: 65}`. Leg (b) already sweeps the 169 classes; assert the suited-not-above-offsuit rule across all 78 twins inside that sweep rather than only the two named pairs, since it costs nothing. The action `decide` returns must be legal for the `view.legal` it was handed: when a raise is called for and `minRaiseTo` is null, it calls. Import the evaluator as `import { evaluate } from "./wwyhd-eval.js"`.
**BASE facts:** (generated at 8396fd8)

**Proof:**
- Test: `tools/wwyhd-rules.test.ts`
- Legs: (a) each of the ten holding-and-board pairs named in M1 returns the band named there [M1]; (b) `preflopPercentile` of `Ah Ad` is the minimum over a sweep of the 169 classes, of `7d 2c` the maximum, every value is greater than 0 and at most 100, and for each of `Ks Qs` versus `Ks Qd`, `9h 8h` versus `9h 8c`, the suited value is not more than the offsuit [M2]; (c) `preflopPercentile(["Js","Td"])` is greater than 20 and less than 50 [M3]; (d) tight-passive: folds `Js Td` unopened, folds the flop raise with band 2, folds the river bet with band 2 [M3]; (e) loose-passive: calls `Js Td` unopened, calls the flop raise, calls the river bet [M3]; (f) tight-aggressive: folds `Js Td` unopened, calls the flop raise with band 2, folds the river bet [M3]; (g) loose-aggressive: raises `Js Td` unopened to `minRaiseTo`, calls the flop raise with band 2, calls the river bet [M3]; (h) each action returned in legs (d) to (g) is checked against the `legal` object handed in [M3]; (i) across all four archetypes facing an all-in with `Ah Ad` on `Ac 7d 2c Ks 9h` no action is `fold`; with `5c 4d` on that board and a check available no action is `bet` or `raise`, and facing a bet none returns `amount` equal to `maxRaiseTo` [M4]; (j) `Object.keys(THRESHOLDS)` sorted equals the five names sorted, every value is a finite number, and `decide` for the loose-aggressive unopened spot with a thresholds copy whose `RAISE_AF` is 3.0 returns `call` where the default returns `raise` [M5]; (k) two `decide` calls on equal inputs are deep-equal [M6].

**Stale-if:**
- path-exists: `site/wwyhd-rules.js`

### Task 5: Hand files: the loader, the check tool and the suite sweep

**Type:** implementation
**Review:** peer

**Files:**
- Create: `tools/lib/wwyhd.ts`
- Create: `tools/wwyhd-check.ts`
- Create: `tools/fixtures/wwyhd-mini.json`
- Test: `tools/wwyhd-files.test.ts`

**Claim:** fixed cards (hidden holdings authored weekly by Charlie) (quoted from #70)
Machine: M1. `validateHandFile(hand, data)` returns the typed hand for the fixture, and throws with the field name in the message for each of: a card outside the notation (field `cards`), a card appearing twice across holdings and board (field `board`), a `players[]` handle absent from `data.players[].aka` (field `handle`), a seat whose `profile` is not null, an opponent whose profile lacks one of `vpip af allInRate foldToRaise callDown`, `startChips` unequal to the seat's `stack`, a board not of exactly five cards, and `closes` earlier than `opens`. M2. `checkHandFile(hand)` replays `real.actions` through the engine and returns without error for the fixture; when one `real.endStacks` value is changed by 1 it throws naming that handle and both numbers. M3. `loadHandFiles(dir, data)` returns `[]` for an absent directory and otherwise every `*.json` under it, validated, ordered by `opens` newest first. M4. `bun tools/wwyhd-check.ts <file...>` exits 0 and prints one `ok <id>` line per file; exits 1 and prints the reason for the first failing file, having printed `ok` for each file before it; exits 2 with a usage line when given no files. M5. The suite runs `checkHandFile` over every file under `site/data/wwyhd/` and its test name states how many it swept, so zero files at BASE passes and says so.

**Authorized-by:** #70; spec §4.1 (the hand file) and §5 step 3 (the check)

**Interfaces:**
- Consumes: `replay(hand: HandFile, actions: {street: string, handle: string, type: string, amount: number}[]): State`
- Produces: `HandFile` (type)
- Produces: `validateHandFile(hand: unknown, data: GamesData): HandFile`
- Produces: `checkHandFile(hand: HandFile): void`
- Produces: `loadHandFiles(dir: string, data: GamesData): HandFile[]`

**Context:** The hand file shape is the plan's shared literal (Task 3's Context lists it); `real.endStacks` is a map from handle to that player's stack after the hand, copied from the log's next `Player stacks:` line. The loader takes `GamesData` from `tools/lib/standings.ts` (players carry `slug`, `name`, `aka: string[]`), because a handle the record does not know must halt, the same rule `publish-game` applies to an unknown handle. The CLI reads `site/data/games.json` relative to its working directory, exactly as `tools/render.ts` does, so the exam can spawn it with `process.execPath` inside a temp directory holding a synthetic `site/data/games.json` (the pattern of the drift check in `tools/site.test.ts`); flags and positionals come from `tools/lib/args.ts`. The fixture `tools/fixtures/wwyhd-mini.json` is synthetic: handles `alice`, `bob`, `carol`, a three-handed hand at blinds 100/200 that reaches showdown, the seat `bob` with `profile: null`, the other two with the archetype-style profiles, every card in the plan's notation, and `endStacks` that the engine reproduces (compute them by hand and let the check confirm; chips conserved). Import the engine as `import { replay } from "../../site/wwyhd-engine.js"` with `// @ts-ignore`. For leg (k), give the later-`opens` copy a filename that sorts BEFORE the fixture's (`0-later.json` beside `wwyhd-mini.json`), so a loader that merely returns directory order would fail the ordering check. For leg (f), a second copy missing `foldToRaise` instead of `callDown` costs one line and covers a second of the five fields. The sweep in M5 is the test that stops a wrong hand file merging (spec §6); the directory does not exist at BASE, so `loadHandFiles` must treat an absent directory as zero files.
**BASE facts:** (generated at 8396fd8)
- `tools/lib/standings.ts` blob cfc5814
- `name` at `functions/portrait/[token].js:150` blob d460280
- `site/data/games.json` blob e8411ec
- `tools/render.ts` blob 04d500a
- `tools/site.test.ts` blob 339f664
- `tools/lib/args.ts` blob caa24d5
- `cards` at `tools/render.test.ts:2439` blob 7badd6f

**Proof:**
- Test: `tools/wwyhd-files.test.ts`
- Legs: (a) `validateHandFile` returns for the fixture with a synthetic `GamesData` whose `aka` lists cover its handles [M1]; (b) a copy with `"Ah"` replaced by `"1h"` throws naming `cards` [M1]; (c) a copy with the board's first card equal to a holding throws naming `board` and the duplicate card [M1]; (d) a copy whose second player is `"dave"` (absent from `aka`) throws naming `handle` and `dave` [M1]; (e) a copy with a profile on the seat throws naming `profile` [M1]; (f) a copy missing `callDown` on an opponent throws naming `callDown` [M1]; (g) a copy with `startChips` one off throws naming `startChips` [M1]; (h) a copy with a four-card board throws naming `board` [M1]; (i) a copy with `closes` before `opens` throws naming `closes` [M1]; (j) `checkHandFile` returns for the fixture, and a copy with `endStacks.alice` plus 1 throws with `alice` and both numbers in the message [M2]; (k) `loadHandFiles` on a path under a fresh temp directory that does not exist returns `[]`; on a temp directory holding the fixture and a copy with `id` changed and a later `opens`, it returns two entries with the later one first; with a third file whose board has four cards added to that directory, it throws naming `board` [M3]; (l) the CLI spawned in a temp cwd with a synthetic `site/data/games.json` exits 0 with `ok wwyhd-mini` on the fixture; given the fixture and then the broken `endStacks` copy it exits 1 with `alice` in stderr and `ok wwyhd-mini` in stdout; and it exits 2 with `usage` in stderr on no arguments [M4]; (m) a test named with the count of files found under `site/data/wwyhd/` runs `checkHandFile` on each and passes [M5].

**Stale-if:**
- path-exists: `tools/lib/wwyhd.ts`

### Task 6: The Function and the table

**Type:** implementation
**Review:** peer

**Files:**
- Create: `functions/api/wwyhd.js`
- Modify: `site/schema.sql`
- Test: `tools/wwyhd-api.test.ts`

**Claim:** One Pages Function records results in D1 and re-runs the engine server-side on the submitted line. (quoted from #70)
Machine: M1. `POST /api/wwyhd?hand=<hand_id>` with `{email, displayName, line}` inserts one row with `attempt` 1 on a first submit and 2 on the same email's second, `chips` from the server's own `playSeat` replay (a `chips` field in the body changes nothing), and responds `{ok: true, attempt, chips}`. M2. POST responds 404 when the `env.ASSETS` fetch of `/data/wwyhd/<hand_id>.json` is not ok, 400 on a bad email, and 400 with the engine's message in `error` on a line that does not replay. M3. `ranked` is 1 only when `attempt` is 1 and the submit's UTC date is on or before the file's `closes`; a first attempt after `closes` stores `ranked` 0. M4. `GET /api/wwyhd?hand=<hand_id>` returns `{count, leaderboard, choices}` from `ranked = 1` rows only: `count` their number, `leaderboard` the top ten by `chips` descending then `created_at` ascending as `{name, chips}`, and `choices` a map from decision key to per-type counts for every key reached by at least `MIN_SHARED` ranked rows, with a key reached by fewer absent. M5. No GET or POST response body contains an email: with rows whose emails all contain `@`, the GET body contains no `@`. M6. A roster email's display name is its handle, and a stranger's is what they typed, cleaned. M7. `site/schema.sql` carries `CREATE TABLE IF NOT EXISTS wwyhd_results` with columns `hand_id`, `email`, `attempt`, `display_name`, `line`, `decisions`, `chips`, `ranked`, `created_at` and `PRIMARY KEY (hand_id, email, attempt)`, and the exam builds its database from that file.

**Authorized-by:** #70; spec §4.5 (the Function and the table, as amended: first attempt ranks, `env.ASSETS`)

**Interfaces:**
- Consumes: `playSeat(hand: HandFile, seatLine: {street: string, type: string, amount: number}[], decide: (view: View) => {type: string, amount: number}): {chips: number, line: object[], decisions: {key: string, type: string}[]}`
- Consumes: `decide(view: View, profile: Profile): {type: string, amount: number}`
- Consumes: `THRESHOLDS: Record<string, number>`
- Consumes: `validEmail(s: unknown): boolean`
- Consumes: `cleanDisplayName(s: unknown): string`
- Consumes: `resolveDisplay(email: string, providedName: string, rosterRows: {email: string, handle: string}[]): string`
- Produces: `onRequestGet(ctx): Promise<Response>`
- Produces: `onRequestPost(ctx): Promise<Response>`

**Context:** Cloned from `functions/api/rsvp.js`, including its route shape (the hand id rides in the `hand` query parameter on both verbs, as `game` does for RSVP; a single file `functions/api/wwyhd.js`, no bracketed dynamic segment): the same `json()` helper shape, the same roster read and `resolveDisplay`, emails lowercased before storage. Imports: `./_lib.js` for the helpers, `../../site/wwyhd-engine.js` and `../../site/wwyhd-rules.js` for the engine and the table (a `wrangler pages dev` probe on 2026-09-20 returned a computed value from a Function importing `../../site/engine.js`, so the relative import into `site/` bundles). The hand file comes from `env.ASSETS.fetch(new URL("/data/wwyhd/" + handId + ".json", request.url))` as `functions/portrait/[token].js` already reads `games.json`; a non-ok response is the 404, and a `hand` parameter that fails `^\d{4}-\d{2}-\d{2}-\d+$` (absent included) is a 404 before any fetch. Opponents decide with `decide(view, profileOf(view.handle))` where the profile is the player's from the hand file. `decisions` is stored as JSON from `playSeat`; the GET aggregates it over ranked rows in JavaScript after one `SELECT decisions FROM wwyhd_results WHERE hand_id = ? AND ranked = 1`, keeping keys with at least `THRESHOLDS.MIN_SHARED` rows. The DDL to add to `site/schema.sql`, with the file's annotation style (every column's reason inline): hand_id TEXT NOT NULL, email TEXT NOT NULL, attempt INTEGER NOT NULL, display_name TEXT NOT NULL, line TEXT NOT NULL, decisions TEXT NOT NULL, chips INTEGER NOT NULL, ranked INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (hand_id, email, attempt); the rows hold emails and never enter git, the same note the file already carries for `rsvps`. The attempt number is `1 + COALESCE(MAX(attempt), 0)` for that hand and email. The exam builds a real database with `bun:sqlite` by executing `site/schema.sql`, wraps it in a D1-shaped adapter (`prepare(sql).bind(...).all()` returning `{results}`, `.first()`, `.run()`), and stubs `env.ASSETS.fetch` to serve the synthetic fixture from Task 5's shape (the exam carries its own copy of a synthetic hand inline so it does not depend on Task 5's file); `now` for the `closes` test is injected through an optional `ctx.env.WWYHD_NOW` string the Function reads only when present, so production ignores it. The visible fact for M5 is the GET body: rows are inserted with emails, the body is asserted to contain no `@`.
**BASE facts:** (generated at 8396fd8)
- `site/schema.sql` blob 2af4c2a
- `line` at `tools/lib/pokernow.ts:26` blob 2e39a68
- `functions/api/rsvp.js` blob f940b8b
- `hand` at `tools/lib/pokernow.ts:48` blob 2e39a68
- `game` at `functions/api/rsvp.js:12` blob f940b8b
- `resolveDisplay` at `functions/api/_lib.js:14` blob 8b9c855
- `functions/portrait/[token].js` blob d460280
- `name` at `functions/portrait/[token].js:150` blob d460280

**Proof:**
- Test: `tools/wwyhd-api.test.ts`
- Legs: (a) a first POST returns 200 `{ok: true, attempt: 1, chips}` with `chips` equal to `playSeat`'s own result for that line, and a second POST from the same email returns `attempt` 2; a body carrying `chips: 999999` still stores the server's number [M1]; (b) a POST for a hand id whose ASSETS stub returns 404 responds 404; `email: "nope"` responds 400; a line one action short responds 400 with `error` containing the engine's message [M2]; (c) with `WWYHD_NOW` on the `closes` date the first attempt's row has `ranked` 1; with `WWYHD_NOW` the day after, `ranked` 0; a second attempt on the closes date has `ranked` 0 [M3]; (d) after eleven ranked rows with distinct chips GET returns `count` 11 and a `leaderboard` of ten in chips-descending order with a tie between two rows broken by earlier `created_at`; unranked rows change neither; with five ranked rows sharing a decision key and four sharing another, `choices` has the first key with the right per-type counts and lacks the second [M4]; (e) the GET body after those inserts contains no `@`, and the POST response body contains no `@` [M5]; (f) a roster email's leaderboard `name` is its handle and a stranger's is the cleaned display name [M6]; (g) executing `site/schema.sql` in `bun:sqlite` creates `wwyhd_results` with exactly the nine columns in M7 (read from `PRAGMA table_info`) and a primary key over `hand_id`, `email`, `attempt` [M7].

**Stale-if:**
- path-exists: `functions/api/wwyhd.js`

### Task 7: The puzzle pages and the browser controller

**Type:** implementation
**Review:** peer

**Files:**
- Create: `site/wwyhd.js`
- Create: `tools/lib/render-inputs.ts`
- Modify: `tools/render.ts`
- Modify: `tools/site.test.ts`
- Modify: `site/styles.css`
- Test: `tools/wwyhd-pages.test.ts`

**Claim:** I open the week's puzzle, see the table and my cards, deal, play, and then see my chips, what really happened, and the leaderboard. (derived)
Machine: M1. `renderWwyhdHand(data, hand)` returns a page whose sit-down state carries the hand's `title` and `setup`, every player's handle beside their First + last initial name from `data.players`, every stack, the seat's two cards face up and no other player's cards, exactly one `Deal` button, an email field and a display name field, and the hand file embedded as `<script type="application/json" id="hand">`. M2. The page carries the disclosure sentence verbatim and a sentence saying the first go is the one that counts. M3. The page has no em dash, no "experiment", no `btn-primary`, bands whose classes alternate `band-light` and `band-dark`, the favicon link, and a `<script type="module" src="/wwyhd.js">`. M4. `renderWwyhdIndex(data, hands)` lists every hand newest first with its title and its `game` date, each linking `/wwyhd/<id>/`, and the newest is marked as this week's; the page obeys M3's copy rules. M5. `bun tools/render.ts` writes `site/wwyhd/index.html` and one `site/wwyhd/<id>/index.html` per file under `site/data/wwyhd/`, and writes nothing under `site/wwyhd/` when that directory is absent; `seedRenderInputs(tempRoot, siteDir)` copies `siteDir/data/games.json`, `siteDir/data/archive.json` and, when it exists, every file under `siteDir/data/wwyhd/` into `tempRoot/site/data/`, and creates no `wwyhd` directory when the source has none; the drift check in `tools/site.test.ts` seeds its empty temp tree by calling `seedRenderInputs` and its compared-roots list includes `wwyhd`, so a committed puzzle page the generator would not produce fails the suite while a published puzzle's pages pass it. M6. `site/wwyhd.js` imports under bun without a DOM and exports `lineVsReal(line, realActions, seat)`, which pairs the visitor's actions with the seat's real actions street by street, marks `differs` true on a street where they differ and false where they match.

**Authorized-by:** #70; spec §4.4 (the page), repo CLAUDE.md ("Player-facing pages have one job each")

**Interfaces:**
- Consumes: `loadHandFiles(dir: string, data: GamesData): HandFile[]`
- Consumes: `HandFile` (type)
- Produces: `renderWwyhdHand(data: GamesData, hand: HandFile): string`
- Produces: `renderWwyhdIndex(data: GamesData, hands: HandFile[]): string`
- Produces: `lineVsReal(line: object[], realActions: object[], seat: string): {street: string, mine: string, real: string, differs: boolean}[]`
- Produces: `seedRenderInputs(tempRoot: string, siteDir: string): void`

**Context:** Three states on one page, one job each (the portrait pages are the model): sit down (title, setup, the table, Deal, the two fields, prefilled from `localStorage` keys `wwyhd.email` and `wwyhd.name` when present), play (the action to you, the pot, the board as it comes, fold / check or call / a raise sizer with min, half pot, pot, all-in and a free entry; opponents act after a short pause; no advice), and the reveal (chips finished with; `real.result`; the visitor's line against the real line via `lineVsReal`; the room's choices at shared spots from GET `choices`; the hidden holdings labelled "for this puzzle"; the leaderboard, top ten plus the visitor's own row). The controller imports `./wwyhd-engine.js` and `./wwyhd-rules.js`, reads the embedded hand JSON, POSTs to `/api/wwyhd?hand=<id>` then GETs the same URL, and writes the two `localStorage` keys after a successful POST inside try/catch. All DOM work sits behind `if (typeof document !== "undefined")` so bun can import the module for M6. The renderer follows `tools/render.ts` conventions: the shared `page()` helper (title, body, footer tone, path, description, options), `esc()` on every interpolated string, `navCurrent` the empty string as the archive page does since the puzzle is not in the nav, and the reveal names real players as `First L.` from `data.players[].name` looked up through `aka`, beside the handle. Pages under `site/wwyhd/` are generated only, which is why the controller lives at `site/wwyhd.js` and the modules at `site/wwyhd-*.js`: the drift check compares whole directory trees. The renderer's main block reads `site/data/wwyhd/` through Task 5's `loadHandFiles("site/data/wwyhd", data)` and skips both writes when it returns `[]`; at BASE the directory does not exist, so the committed and generated `site/wwyhd/` sets are both empty and the drift check passes by comparing nothing. In `tools/site.test.ts`'s drift block (the describe headed "the generator, run into an empty directory"), add `"wwyhd"` to the `for (const sub of ["player", "hope-coin", "archive"] as const)` list AND replace its two `copyFileSync` seeding lines in `beforeAll` with one call to `seedRenderInputs(tempRoot, SITE)` from the new `tools/lib/render-inputs.ts`, which copies the two data files and, when `site/data/wwyhd/` exists, its files too (`cpSync` with `recursive: true`); without that, the first published puzzle's committed pages would fail an empty-tree compare that never received the hand files. The helper lives in `tools/lib/` rather than in the test file so the exam can import and exercise it without registering `site.test.ts`'s own tests a second time. The test title at line 95 says "the six generated paths"; make it seven. The exam renders from a synthetic `GamesData` (as `tools/render.test.ts` does) and a synthetic hand; nothing in it reads the real data. The index is static in v1: no winner name, no dates compared to today, because the renderer must be deterministic for the drift check. The disclosure sentence and the first-go sentence are the global literal and "Your first go is the one that counts. Play again as often as you like."
**BASE facts:** (generated at 8396fd8)
- `title` at `tools/render.ts:1421` blob 04d500a
- `tools/site.test.ts` blob 339f664
- `tools/render.ts` blob 04d500a
- `tools/render.test.ts` blob 7badd6f
- `input` at `functions/portrait/[token].js:216` blob d460280

**Proof:**
- Test: `tools/wwyhd-pages.test.ts`
- Run: sed -n '/run into an empty directory/,/^});/p' tools/site.test.ts | grep -q 'hope-coin", "archive", "wwyhd"'
- Run: sed -n '/run into an empty directory/,/^});/p' tools/site.test.ts | grep -q 'seedRenderInputs(tempRoot'
- Run: sed -n '/run into an empty directory/,/^});/p' tools/site.test.ts | grep -c 'copyFileSync' | grep -qx 0
- Legs: (a) the rendered hand page contains the title, the setup, each of three synthetic handles beside its `First L.` name, each stack, the seat's two cards as text and neither opponent's cards, exactly one occurrence of `>Deal<`, an `input` with `type="email"`, a display name input, and a `<script type="application/json" id="hand">` whose content parses back to the hand [M1]; (b) the page contains the disclosure sentence and the first-go sentence verbatim [M2]; (c) the page contains no em dash character, no `experiment` in any case, no `btn-primary`, its `band-light`/`band-dark` sequence alternates, it links `/favicon.svg`, and it carries `<script type="module" src="/wwyhd.js">` [M3]; (d) the index for two synthetic hands lists the later `opens` first, each title linking `/wwyhd/<id>/`, carries each hand's `game` date, marks the first as this week's, and passes the same copy checks as (c) [M4]; (e) `tools/render.ts` spawned with `process.execPath` in a temp cwd holding a synthetic `games.json`, `archive.json` and no `site/data/wwyhd/` writes no `site/wwyhd/` directory; spawned again with the synthetic hand at `site/data/wwyhd/2026-01-01-1.json` it writes `site/wwyhd/index.html` and `site/wwyhd/2026-01-01-1/index.html`; `seedRenderInputs` from a synthetic site directory holding the two data files and a `data/wwyhd/2026-01-01-1.json` produces a temp root with all three at their paths, and from one without a `data/wwyhd/` directory produces no `site/data/wwyhd` in the temp root; and the three `Run:` lines above pin that the drift block seeds through `seedRenderInputs`, no longer copies by hand, and compares the `wwyhd` root [M5]; (f) `await import("../site/wwyhd.js")` resolves without a DOM; `lineVsReal` on a line that calls preflop against a real line that raised preflop returns a first row with `differs` true and `street` `PRE`; and on a line equal to the seat's real actions every row has `differs` false [M6].

**Stale-if:**
- path-exists: `site/wwyhd.js`

### Task 8: Apply the schema to the live database

**Type:** manual

**Files:**
- Modify: nothing

**Claim:** Before the first puzzle merges, the live database has the results table, so the first visitor's submit lands. (derived)
Machine: M1. `npx wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql` has been run once from the merged branch, and `npx wrangler d1 execute poker-rsvp-db --remote --command "SELECT name FROM sqlite_master WHERE name = 'wwyhd_results'"` returns one row.

**Authorized-by:** #70; spec §4.5; the runbook step Task 2 writes

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** Charlie's or Mike's hands, on the laptop with wrangler auth, after Task 6 is merged and before the first hand file lands. The command is idempotent (`IF NOT EXISTS`), the same step the runbook already carries for the consent tables. Rehearse with the `--local` twin first. The rows this table will hold carry emails and never enter git.
**BASE facts:** (generated at 8396fd8)

**Proof:**
- Run: echo manual
- Legs: (a) the operator pastes the SELECT's one-row output into the PR that ships the first hand file [M1].

**Stale-if:**
- issue-closed: #70
