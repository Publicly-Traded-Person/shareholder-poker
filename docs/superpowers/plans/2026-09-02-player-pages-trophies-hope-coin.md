# Player pages, the trophy case, and the Hope Coin page

**Grammar:** claims-v1

**Claim:** Every player on the record has a page I can reach by clicking their name in the standings, and the Hope Coin has a page of its own showing every stop it has made. (elicited)

**Goal:** Build the spec's three surfaces on top of one trophy registry: `/player/<slug>/` for every player on the spine, `/hope-coin/` for the traveling trophy, and a trophy shelf plus player links on `/standings/`. All generated from `site/data/games.json` by `tools/render.ts`, committed as HTML, drift-checked. No runtime, no Pages Function, no new service.

**Tech Stack:** Bun + TypeScript (`bun test tools`, `bunx tsc --noEmit`), static committed HTML under `site/` on Cloudflare Pages with `pages_build_output_dir = "site"` and no build step.

**Spec:** `docs/superpowers/specs/2026-09-02-player-pages-trophies-hope-coin-design.md` (reference for the reader; every fact a task needs is restated in its own Context)

## Global Constraints

- **No invented players and no invented numbers.** Every name, date, payout, card title, and coin stop in this plan's data comes from a file already in the repo or from a literal quoted in a task's Context. A value that is not there is left out; it is never guessed.
- **Privacy boundary.** Names are First plus last initial. No email, no RSVP row, no raw PokerNow log, and no private per-player read enters `site/` or git. Bios are written for the page.
- **Copy rules.** No em dashes anywhere in `site/` output. The word "experiment" never appears. Dignity rule on every player mention. Drawn SVG marks, never emoji. Exactly one lime CTA per page, and the pages this plan adds have none.
- **Visual system (`docs/brand.md`, v2).** Light page, dark objects. `band-light` alternates with `band-dark`, no two bands of the same tone touching. Near-black felt is reserved for CTA bands and card art. Metals are accents: `--foil-deep`, `--sapphire`, `--copper-deep`, `--pewter-deep` on light bands, which is the 3:1 floor the existing `.mark--empty` rule already keeps.
- **`site/data/games.json` stays in canonical `JSON.stringify(data, null, 2)` form with a trailing newline**, so a change reads as a small diff.
- **Generated pages are never hand-edited.** Anything `tools/render.ts` writes is owned by the renderer; `bun tools/render.ts && git diff --exit-code` on those paths stays clean.
- **One registry.** A trophy is one entry in `tools/lib/trophies.ts` and nothing else. No task adds a second list of trophy ids, in code, in a page, or in a test.

**Parallelization rationale:** Wave 1 is three independent tasks (Task 1 registry and types, Task 2 stylesheet, Task 3 runbook). Wave 2 is six (Tasks 4 through 9), each importing the module Task 1 creates; that chain exists because `tools/lib/trophies.ts` does not exist at BASE, so nothing can typecheck against it first. Wave 3 is one (Task 10), which needs the runtime behaviour of the three renderers, not their shape: it executes them to produce the committed HTML, and a signature could not tell it what bytes they emit. Tasks 5 and 6 both modify `site/data/games.json`, and Tasks 7, 8, and 9 all modify `tools/render.ts` and `tools/render.test.ts`; those are text edits in different regions and fold at merge, so they stay concurrent.

**Acceptance:** suite — `bun test tools` plus the render drift check is the verification, and Task 10 runs both against the integrated tree.

### Task 1: The trophy registry and the case

**Type:** implementation
**Review:** peer

**Files:**
- Create: `tools/lib/trophies.ts`
- Modify: `tools/lib/standings.ts`
- Test: `tools/lib/trophies.test.ts`

**Claim:** A trophy is one registry entry and nothing else, and one function answers what a player has earned from the record alone. (derived)
Machine: M1. `TROPHIES` is an array of 15 entries with unique kebab-case `id`s, each carrying `name`, `earn`, `kind`, and a `look` whose `shape` is one of gem, skull, coin, shield, ribbon and whose `metal` is one of foil, sapphire, copper, pewter; every `kind: "derived"` entry has a `rule` and every `kind: "judged"` entry has none.
M2. For a player slug, `trophyCase(data, slug).earned` includes every judged id that slug's results carry, with `dates` oldest first and `count` equal to the number of results carrying it.
M3. `trophyCase` includes each of the nine derived trophies exactly when its rule matches: `champion`, `hope-coin`, `podium`, `cashed`, `clean-night`, `comeback`, `regular`, `founders-table`, `the-bubble`.
M4. `earned` and `locked` partition `TROPHIES` with no id in both and none missing, each list in display order: metal foil, then sapphire, then copper, then pewter, and registry array order within a metal.

**Authorized-by:** #27; spec `docs/superpowers/specs/2026-09-02-player-pages-trophies-hope-coin-design.md` §4

**Interfaces:**
- Consumes: none
- Produces: `TROPHIES`
- Produces: `trophyCase`
- Produces: `type Trophy`
- Produces: `type Earned`
- Produces: `type CardRef`
- Produces: `type HopeCoinStop`
- Produces: `type Player`

**Context:** `tools/lib/standings.ts` already exports `type GameResult`, `type Game`, `type GamesData`, `type StandingRow`, `type Standings`, and `deriveStandings`; this task extends the types in place and adds a new pure module beside it. No clock and no I/O in `tools/lib/trophies.ts`: it is a function of its arguments so the tests can be synthetic.

The type additions to `tools/lib/standings.ts`, verbatim, because five other tasks are written against exactly this shape:

    export type CardRef = {
      metal: "foil" | "sapphire" | "copper" | "pewter";
      file: string;   // filename under site/cards/<cardSet>/assets/
      title: string;  // the caption title as it reads on the set page
    };
    export type HopeCoinStop = {
      holder: string;   // a slug in players; may be a slug with no games
      from?: string;    // absent only on the first stop, when nobody remembers
      to?: string;      // absent only on the last stop, which is current
      place?: string;   // optional; a place name, never coordinates
      how: string;      // one plain sentence
    };
    export type Player = { slug: string; name: string; aka: string[]; bio?: string };

`GameResult` gains `card?: CardRef`. `Game` gains `cardSetName?: string`. `GamesData.players` becomes `Player[]` and `GamesData.hopeCoin` becomes `{ holder: string; since: string; history?: HopeCoinStop[] }`. Every added field is optional so the committed `games.json` still typechecks before the data tasks land.

The registry array, in this order (display order is derived by sorting this array by metal, which is why the array order alone is not the display order):

judged, none of which carry a rule: `hope-slayer` Hope Slayer skull/foil; `two-seven-showdown` 2-7 Showdown shield/sapphire; `final-countdown` The Final Countdown shield/sapphire; `cain-and-abel` Cain and Abel shield/sapphire; `abel-stands` Abel Stands shield/sapphire; `kevin-deuce` Kevin Deuce shield/sapphire.

derived, each with its rule: `champion` Champion gem/foil, finish 1, count is wins; `hope-coin` The Hope Coin coin/foil, any stop in `hopeCoin.history` whose `holder` is this slug, count is stops; `podium` Podium gem/copper, finish 3 or better; `cashed` Cashed ribbon/copper, payout above zero; `clean-night` Clean Night ribbon/copper, cashed with zero rebuys; `comeback` Comeback ribbon/copper, cashed with one or more rebuys; `regular` Regular ribbon/pewter, three consecutive games on the spine in date order, earned on the third, count is the best streak; `founders-table` Founder's Table ribbon/pewter, played the game dated `2026-07-14`, pinned to that literal date so a backfilled older season cannot move it; `the-bubble` The Bubble ribbon/pewter, finished one place outside the paid spots, where paid spots are that game's results with payout above zero (`entries` counts buy-ins including rebuys and is never used here).

`earn` is one line saying how to earn the trophy, and it is what a locked tile shows, so write it as an instruction ("Win a game.") rather than a description.

The `hope-coin` rule reads `hopeCoin.history`, which is why it is derived rather than judged, and a past holder keeps the award with their own dates. A stop with no `from` still counts toward `count` but contributes no entry to `dates`, because the date is genuinely unknown and inventing one would put a false date on a page. `history` may be absent entirely at this point in the plan; treat that as an empty list.

The committed data currently carries only two judged ids, `hope-slayer` and `cain-and-abel`, both of which are in the registry above.

**Proof:**
- Test: `tools/lib/trophies.test.ts`
- Legs: (a) `TROPHIES` has 15 entries, the set of ids has 15 members, every id matches `/^[a-z]+(-[a-z]+)*$/`, and a table-driven case per entry (15 cases, named by id) asserts a non-empty `name`, a non-empty `earn`, a `look.shape` in the five known shapes, a `look.metal` in the four known metals, and `rule` present exactly when `kind === "derived"` [M1]; (b) a synthetic player whose two games carry `hope-slayer` and whose third carries `cain-and-abel` earns both, `hope-slayer` with `count: 2` and `cain-and-abel` with `count: 1`, so a collector that handles one judged id and drops the rest fails [M2]; (b2) the same player's games are passed in descending date order and `dates` still come back ascending, so a missing sort is falsified rather than accidentally satisfied by the input order [M2]; (b3) a player whose games carry no judged id earns none, in a fixture where a second player in the same games carries two judged ids, so a collector that gathers judged ids across all results rather than the queried slug's own fails [M2]; (c) `champion` on a slug with one win and one fourth, count 1, date of the win [M3]; (d) `hope-coin` on a slug holding two stops, count 2, and on a slug holding none [M3]; (e) `podium` earned on a finish of 3 and not on a finish of 4 [M3]; (f) `cashed` earned on a payout above zero and not on zero [M3]; (g) `clean-night` earned when cashed with zero rebuys and not when cashed with one [M3]; (h) `comeback` earned when cashed with one rebuy and not when cashed with zero [M3]; (i) `regular` absent on two consecutive games, earned on the third, absent for a slug whose three games are broken by a missed game, and `count` equal to the best streak when a player has a four-game streak and a later two-game streak [M3]; (j) `founders-table` earned by a player in the `2026-07-14` game and still absent for a player whose only game is an added `2020-06-09` game [M3]; (k) `the-bubble` earned by the finish-3 player on a night with two paid spots, earned by the finish-4 player on a night with three paid spots, and not earned by either payee [M3]; (l) for a player with a known set of earned ids, `earned` and `locked` have no id in common and their union is exactly the 15 registry ids [M4]; (m) for a player earning nothing, `locked` equals the full expected id sequence `hope-slayer, champion, hope-coin, two-seven-showdown, final-countdown, cain-and-abel, abel-stands, kevin-deuce, podium, cashed, clean-night, comeback, regular, founders-table, the-bubble` compared as an ordered list, so a mis-sort inside any one metal fails and not only a mis-sort across metals [M4]; (n) for a player constructed to earn at least one trophy from each of the four metals, `earned` is compared as an ordered list against the expected sequence, so an implementation that sorts `locked` but returns `earned` in match order fails [M4].

**Stale-if:**
- path-exists: `tools/lib/standings.ts`
- path-absent: `tools/lib/trophies.ts`
- issue-open: #27

### Task 2: The trophy case, the shelf, the gallery, and the route line

**Type:** implementation

**Files:**
- Modify: `site/styles.css`
- Test: `tools/styles.test.ts`

**Claim:** The stylesheet carries every rule the new pages will reach for, drawn in the site's own metals: a case of trophy tiles, a compact shelf of marks, a card gallery, and a route line for the Coin. (derived)
Machine: M1. Every class name in this task's fixed class list has a non-empty rule block in `site/styles.css`, and a name that appears only inside a CSS comment does not satisfy it.
M2. Every `fill` and `stroke` declaration in those blocks resolves to one of `--foil-deep`, `--sapphire`, `--copper-deep`, `--pewter-deep`, `--paper`, or `none`, which is the contrast floor the existing `.mark--empty` rule already keeps.
M3. None of those blocks references the lime CTA custom property.

**Authorized-by:** #27; spec §4.3 ("a new mark shape is one SVG constant and one CSS class"), §5, §7

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** This task adds only CSS; the SVG constants that carry these class names are written by Tasks 7, 8, and 9 in `tools/render.ts`. The class list below is the contract between the two halves and is fixed here, so write the names exactly:

    .trophy-case  .trophy  .trophy--locked  .shelf  .shelf-more
    .card-gallery  .route  .route-stop  .route-stop--current
    .mark--shield  .mark--ribbon

Eleven names, and the test iterates exactly this list.

`site/styles.css` already defines the metal custom properties and the mark rules: `.mark` sets `display:inline-block`, `.mark--foil` fills `var(--foil-deep)`, `.mark--sapphire` fills `var(--sapphire)`, `.mark--copper` fills `var(--copper-deep)`, `.mark--pewter` fills `var(--pewter-deep)`, `.mark--empty` strokes `var(--pewter-deep)` with no fill, and `.mark--skull` / `.mark--skull-empty` follow the same pattern. The new `.mark--shield` and `.mark--ribbon` are shape classes that take their color from a metal class on the same element, so they carry geometry and no fill of their own.

Existing furniture to match rather than reinvent: `.tiles` is a responsive grid of `.tile` cards, `.ledger` is the results table, `.card-caption` is the unboxed caption under a card frame, and `.card-frame--holo` is the holo box which must contain only the image. `.trophy-case` should read as a denser `.tiles`; `.shelf` is an inline run of marks sized for a table cell, with `.shelf-more` the "+N" text; `.card-gallery` lays out one figure per set; `.route` is a vertical line with `.route-stop` rows hanging off it and `.route-stop--current` marking the present holder.

There is no existing `tools/styles.test.ts`; the stylesheet is checked today by one block inside `tools/site.test.ts`, which stays where it is. Read the stylesheet as text with `readFileSync` and match rule blocks the way that block already does.

**Proof:**
- Test: `tools/styles.test.ts`
- Legs: (a) a table-driven case per class name, one case per entry in the class list, asserts `site/styles.css` contains a rule block whose selector list includes that class and whose body is non-empty, the case name being the class so a failure says which one is missing [M1]; (b) the same matcher applied to a string containing only `/* .trophy-case */` finds nothing, so a class named only in a comment fails rather than passing [M1]; (c) every `fill:` and `stroke:` declaration inside those blocks matches one of the six allowed values, with the assertion naming the offending declaration when it does not [M2]; (d) an added declaration of `fill: red` inside one of those blocks would fail leg (c), asserted by running the same predicate over that literal string [M2]; (e) none of those blocks contains the lime custom property name, asserted by matching each block's text [M3]; (f) the same matcher applied to a literal block containing the lime custom property reports it, so a mis-spelled property name in the matcher fails loudly instead of passing leg (e) vacuously [M3].

**Stale-if:**
- path-exists: `site/styles.css`
- path-absent: `tools/styles.test.ts`

### Task 3: The runbook and the repo guide

**Type:** implementation

**Files:**
- Modify: `docs/publishing.md`
- Modify: `CLAUDE.md`
- Test: `tools/docs.test.ts`

**Claim:** Charlie can find, in the runbook alone, what to fill at a set minting, what to append at a coin handoff, and where a new trophy goes. (derived)
Machine: M1. `docs/publishing.md` names `tools/lib/trophies.ts` as the single place a trophy is added and does not itself list the trophy ids.
M2. The runbook's card-minting step names `cardSetName` and all three `card` fields as backticked field names inside that step's own text, not as ordinary prose and not merely somewhere in the file.
M3. The runbook's coin-handoff step names `hopeCoin.history` and, as backticked field names, the new stop's `holder`, `from`, and `how` and the previous stop's `to`, and it distinguishes which stop each belongs to by carrying the literal phrases "the new stop's" and "the previous stop's"; a separate step covers editing a player `bio`.
M4. `CLAUDE.md` no longer lists the standings trophies and rarity ladder under "Known open items".

**Authorized-by:** #27; spec §4.3, §8 step 5 ("same commit as the behavior it describes")

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `docs/publishing.md` is normative in this repo: if the code's behavior changes, the runbook changes in the same commit or the change is incomplete. It is written for Charlie, who touches this once a month and did not write any of the code, so over-explain rather than compress.

The four things the runbook gains, all of which are decided and can be written now:

1. At a set minting, every result in that game gets a `card` block with `metal` (`foil`, `sapphire`, `copper`, `pewter`, which the pages name Foil, Rare, Uncommon, Common), `file` (the filename under `site/cards/<cardSet>/assets/`), and `title` (the caption title exactly as it reads on the set page). The game also gets `cardSetName`, the set's own name, for example "The Founder's Table". A game with a `cardSet` must have a `cardSetName`, and the suite fails if it does not.
2. When the Coin moves, append one stop to `hopeCoin.history` in the same commit as that game: `holder`, `from` (the date it moved), `how` (one plain sentence), and `place` when it is known. Set the previous stop's `to` to the same date, and update `hopeCoin.holder` and `hopeCoin.since` at the top of the file to match the new last stop. The suite checks the chain, so a half-done handoff fails rather than shipping.
3. A player's `bio` is one paragraph, Charlie's read, written for public reading under the dignity rule and never lifted from the vault's private notes. Absent is fine; the page then simply has no analysis block.
4. A new trophy is one entry in `tools/lib/trophies.ts`: id, name, earn line, look, plus a rule for a derived one. Then run the suite. The runbook points at that file rather than copying the list, because a copied list is a second list that goes stale.

Give each of those four its own markdown heading, because the test locates a step by its heading and asserts the required words inside that step rather than anywhere in the file; a step whose words are scattered across the document is not a step Charlie can follow at 10pm.

Write every field name in backticks (`` `holder` ``, `` `from` ``, `` `to` ``, `` `how` ``, `` `bio` ``, `` `cardSetName` ``), and in the coin-handoff step use the literal phrases "the new stop's" and "the previous stop's" when saying which stop a field belongs to. The test looks for the backticked forms and those two phrases precisely because bare words like from and to occur in ordinary English and would let a step that names no field at all pass.

In `CLAUDE.md`, the "Known open items (as of 2026-08-18)" section currently parks "trophies + rarity ladder on `/standings/` (spec §4)" and "rarity accent classes defined but barely used (§7)". Both are built by this plan, so that bullet goes; the April/June 2026 and 2020 backfill bullet stays exactly as it is, because nothing here touches it.

**Proof:**
- Test: `tools/docs.test.ts`
- Legs: (a) `docs/publishing.md` contains the string `tools/lib/trophies.ts`, and contains none of the 15 registry ids, so a copied list fails the test that a pointer passes [M1]; (b) the test slices the runbook into sections by markdown heading and locates the card-minting section by its heading; a case per field asserts `cardSetName`, `metal`, `file`, and `title` each appear inside that slice, four cases named by field [M2]; (c) the same four assertions run against the whole file minus that slice do not satisfy the test, so a field name mentioned only in an unrelated paragraph fails rather than passing [M2]; (d) the coin-handoff section, located by heading, contains each of the tokens `hopeCoin.history`, `holder`, `from`, `how`, and `to` in backticked form, one case per token, so a step written as ordinary English that never names a field fails; the same tokens outside that slice do not satisfy it [M3]; (d2) that section contains the literal phrases "the new stop's" and "the previous stop's", so a step that names the fields without saying which stop each belongs to fails [M3]; (e) a section whose heading names the bio step exists and its slice contains the backticked `bio`, so the substring occurring inside a longer word such as biography does not satisfy the clause [M3]; (f) `CLAUDE.md` contains no line mentioning both "trophies" and "rarity ladder", while its 2020 and April/June backfill bullet is still present [M4].

**Stale-if:**
- path-exists: `docs/publishing.md`
- path-exists: `CLAUDE.md`
- issue-open: #27

### Task 4: publish-game halts on a trophy id the registry does not know

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/publish-game.ts`
- Test: `tools/publish-game.test.ts`

**Claim:** A typo in a trophy id stops the publish instead of quietly awarding nothing, the same way an unknown handle already does. (derived)
Machine: M1. `prepareGame` throws when any result's `trophies` contains an id that is not in `TROPHIES`, and the message names the offending id and points at the registry file.
M2. `prepareGame` returns its Game unchanged when every id is in the registry, including the case where every result's `trophies` is empty.
M3. The halt fires before the game is returned, so no partially validated Game reaches the caller.

**Authorized-by:** #27; spec §3.2 ("`tools/publish-game.ts` halts on an id the registry does not know, the same way it halts on an unknown handle")

**Interfaces:**
- Consumes: `TROPHIES`
- Produces: none

**Context:** `tools/publish-game.ts` exports `prepareGame(csv, results, data, opts)`, which already refuses to publish on five conditions: a duplicate game date, chip conservation disagreeing with the declared entries, a duplicate finish, a gap in the dense 1..N finishes, and payouts that do not sum to the pot. It also throws `UnknownHandleError` out of `resolveSlug`. The new check belongs with those: refuse-to-publish checks are fixed by fixing the input, never by relaxing the check.

The existing tests in `tools/publish-game.test.ts` build a results array and a synthetic `GamesData` and assert both the happy path and each refusal; the unknown-handle halt is tested there and is the sibling this new test sits beside. `tools/fixtures/mini-log.csv` is the committed synthetic log, with invented players only, and stays that way.

`TROPHIES` comes from `tools/lib/trophies.ts` as an array of entries each carrying an `id`. Build the lookup from the array; do not restate any id in this file, because a second list is the thing the registry exists to prevent.

**Proof:**
- Test: `tools/publish-game.test.ts`
- Legs: (a) a results array carrying `["hope-slyer"]` makes `prepareGame` throw, and the thrown message contains both `hope-slyer` and `trophies.ts`, so a generic failure does not pass [M1]; (b) a results array carrying `["hope-slayer", "cain-and-abel"]` returns a Game whose results carry exactly those ids, byte-equal to the ids passed in, so a check that silently dropped unknown ids instead of throwing would fail here [M2]; (c) a results array whose every `trophies` is `[]` returns a Game with the same entries, pot, and finish order the existing happy-path test asserts today [M2]; (d) in the throwing case of leg (a) the call produces no return value at all, asserted by `expect(() => ...).toThrow()` around the whole call rather than around an inner step [M3].

**Stale-if:**
- path-exists: `tools/publish-game.ts`
- path-exists: `tools/publish-game.test.ts`
- path-absent: `tools/lib/trophies.ts`

### Task 5: Card blocks for Sets 1 and 2, and the cross-check

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `site/data/games.json`
- Test: `tools/site.test.ts`

**Claim:** Every card on a set page is claimed by exactly one player in the record, and the record cannot claim a card that is not there. (derived)
Machine: M1. Every file under a set's `assets/` folder is named by the `card.file` of exactly one result of the game carrying that `cardSet`, so neither an unclaimed asset nor a doubly claimed one can exist.
M2. Every `card.file` in `site/data/games.json` resolves to a file that exists under its game's set folder, and every `card.metal` is one of foil, sapphire, copper, pewter, checked over every carded result the data actually holds rather than over a list typed into the test.
M3. Every result carrying a card has its caption string `<Tier> · <player name> · <card.title>` present in the set page at `site/cards/<cardSet>/index.html`, where Tier maps foil to Foil, sapphire to Rare, copper to Uncommon, pewter to Common; a caption composed from a wrong metal or a wrong title is absent from that page; and every `card-caption` on a set page is composed from some result's card, so the page cannot carry a caption the record does not claim.
M4. Every game with a `cardSet` also has a `cardSetName`, and `2026-07-14` carries "The Founder's Table" while `2026-08-11` carries "Wire to Wire".

**Authorized-by:** #27; spec §3.1, §7 ("Card cross-check, on the real pages")

**Interfaces:**
- Consumes: `type CardRef`
- Produces: none

**Context:** This is a data fill, not an authoring task. Nothing here is invented: every metal, filename, and title below is read off the committed set pages, whose captions are already public. The cross-check test is what proves the fill, and it is the check that will catch the next set if Charlie mistypes it.

Set 1, game `2026-07-14`, `cardSet` `2026-07`, `cardSetName` `The Founder's Table`:

| slug | metal | file | title |
|---|---|---|---|
| chris-g | foil | card-1-lewd.png | Champion |
| nick-m | sapphire | card-2-nickmershon.png | 2nd, holds the Coin |
| beau-g | sapphire | card-3-bg.png | 3rd |
| kmikeym | copper | card-4-kmikeym.png | The Founder |
| amy-m | pewter | card-5-amaxwell.png | The Patient Rock |
| webvee | pewter | card-6-webvee.png | Mysterious Wildcard |

Set 2, game `2026-08-11`, `cardSet` `2026-08`, `cardSetName` `Wire to Wire`:

| slug | metal | file | title |
|---|---|---|---|
| thomas-d | foil | card-1-spladow.png | Champion |
| beau-g | sapphire | card-2-bg.png | 2nd |
| amy-m | sapphire | card-3-amaxwell.png | 3rd, the bubble |
| nick-m | sapphire | card-4-nickmershon.png | Holds the Coin |
| kmikeym | copper | card-5-kmikeym.png | The Founder |
| chris-g | pewter | card-6-lewd.png | July's champion |
| drew-a | pewter | card-7-mohdi_drew.png | 5th |

Every result in both games gets a card; there is no uncarded player in either. The `card` object is added inside each existing result object, alongside `trophies`, and `cardSetName` is added to the game beside `cardSet`. Keep the file in canonical `JSON.stringify(data, null, 2)` form with a trailing newline, which is what the existing publish path writes.

The set pages render each caption as `<figcaption class="card-caption">` containing an SVG mark followed by the text `Foil · Chris G. · Champion`, using a middle dot with a space on each side. Player names come from `players[].name`, so the test composes the caption from the data and searches the page for it rather than the other way round.

`tools/site.test.ts` runs against the real pages, not fixtures, and already exposes `siteHtmlFiles()`, `readPage()`, a `SITE` path constant, an `ORIGIN` constant, `gameDates()`, and `metaProp()`. It reads `site/data/games.json` as `GamesData`. Add one self-contained `describe` block; the file's header asks for additive blocks so concurrent edits merge cleanly.

**Proof:**
- Test: `tools/site.test.ts`
- Legs: (a) a case per set folder asserts the sorted list of filenames under `assets/` equals the sorted list of `card.file` values on that game's results, so an asset claimed by no result and an asset claimed by two both fail, and the diff names the filename [M1]; (b) the same comparison run against a copy of the data with one result's `card` removed fails, which is what proves leg (a) would catch an unclaimed asset rather than passing vacuously [M1]; (c) a table-driven case per carded result, generated by iterating every result carrying a `card` in the parsed `site/data/games.json` rather than a list typed into the test, asserts the file exists on disk via `statSync` and that `metal` is in the four-metal set, naming the offending slug and value when it is not, so a card added next month is covered without editing the test [M2]; (d) a table-driven case per carded result, generated the same way by iterating the data, asserts the set page text contains the composed `Tier · Name · Title` string, the case named by slug and set [M3]; (e) the caption composed from one result with its metal changed to `pewter` is absent from the July set page, and the caption composed from that result with its title changed is likewise absent, so leg (d) is checking both halves and not merely the name [M3]; (e2) the count of `class="card-caption"` occurrences on each set page equals the number of carded results for that game, so a caption on the page that no result claims fails [M3]; (f) for every game in the data, `cardSet` present implies `cardSetName` present and non-empty, with the failure naming the game date, and a copy of a game with `cardSetName` deleted fails that same assertion [M4]; (g) `2026-07-14` has `cardSetName` "The Founder's Table" and `2026-08-11` has "Wire to Wire" [M4].

**Stale-if:**
- path-exists: `site/cards/2026-07/index.html`
- path-exists: `site/cards/2026-08/index.html`
- path-exists: `site/data/games.json`
- path-absent: `tools/lib/trophies.ts`

### Task 6: The Hope Coin's journey in the data

**Type:** implementation
**Review:** peer

**Files:**
- Create: `tools/lib/hope-coin.ts`
- Modify: `site/data/games.json`
- Test: `tools/lib/hope-coin.test.ts`
- Test: `tools/data.test.ts`

**Claim:** The Coin's history is a chain no hand edit can break in silence: each stop hands off to the next on the same date, and the holder at the top of the file is always the last stop. (derived)
Machine: M1. `validateCoinHistory` throws on each of five broken chains: stops out of ascending date order; a stop whose `to` differs from the next stop's `from`; a non-final stop with no `to`; a non-first stop with no `from`; `hopeCoin.holder` or `hopeCoin.since` disagreeing with the last stop's `holder` or `from`.
M2. `validateCoinHistory` returns without throwing on a well-formed multi-stop history, on a history whose first stop has no `from`, and on data with no `history` field at all.
M3. `validateCoinHistory` returns without throwing on the committed `site/data/games.json`.
M4. `site/data/games.json` carries a `hopeCoin.history` of exactly one stop, holder `nick-m`, `from` `2026-04-14`, no `to`, and a `how` sentence, matching the `holder` and `since` already at the top of the file.

**Authorized-by:** #27; spec §3.3, §7 ("Hope Coin data"); Mike, 2026-09-02: ship with the one stop the record already knows and append earlier stops later

**Interfaces:**
- Consumes: `type HopeCoinStop`
- Produces: `validateCoinHistory`

**Context:** The pre-July-2026 stops are Mike's to reconstruct and are deliberately not in this plan. Seed exactly one stop, the current tenure, which the record already states: `nick-m` has held the Coin since `2026-04-14`, taken on the third skull on Matt M. Do not add a stop for any earlier holder, do not add a `players` entry for a pre-spine holder, and do not add a `place`; all three arrive later in a data-only commit, and `validateCoinHistory` is what will check that commit.

The `how` sentence for this stop is `Third skull on Matt M.` Charlie may reword that sentence later without touching the shape, so no test pins its wording.

The shape, from `tools/lib/standings.ts`, is `HopeCoinStop = { holder: string; from?: string; to?: string; place?: string; how: string }`, and `hopeCoin` becomes `{ holder, since, history?: HopeCoinStop[] }`. The seeded value is therefore:

    "hopeCoin": {
      "holder": "nick-m",
      "since": "2026-04-14",
      "history": [
        { "holder": "nick-m", "from": "2026-04-14", "how": "Third skull on Matt M." }
      ]
    }

Keep the file in canonical `JSON.stringify(data, null, 2)` form with a trailing newline.

`validateCoinHistory(data: GamesData): void` is pure, throws an `Error` whose message says which stop is broken and how, and returns nothing on success. It is the guard for Charlie's monthly append, which is the moment the chain actually gets broken, so its message matters more than its return type. A `history` that is absent or empty is valid: the site shipped before the Coin had one.

`tools/data.test.ts` already runs assertions against the real committed `site/data/games.json`; wiring the validator in there is what makes the real data subject to the rule rather than only the fixtures.

**Proof:**
- Test: `tools/lib/hope-coin.test.ts`
- Test: `tools/data.test.ts`
- Legs: (a) two stops in descending date order throw, and the message names the later date [M1]; (b) a two-stop history whose first `to` is `2026-01-01` and second `from` is `2026-02-02` throws naming the mismatch [M1]; (c) a two-stop history whose first stop has no `to` throws [M1]; (d) a two-stop history whose second stop has no `from` throws [M1]; (e) a history whose last stop is `beau-g` while `hopeCoin.holder` is `nick-m` throws, and separately a `since` that differs from the last stop's `from` throws [M1]; (f) a well-formed three-stop history does not throw [M2]; (g) a history whose first stop has no `from` but is otherwise well formed does not throw [M2]; (h) data with `hopeCoin` carrying no `history` does not throw [M2]; (i) in `tools/data.test.ts`, `validateCoinHistory` on the parsed `site/data/games.json` does not throw [M3]; (j) in `tools/data.test.ts`, the parsed file's `hopeCoin.history` has length 1 with holder `nick-m`, `from` `2026-04-14`, no `to`, and a non-empty `how` [M4].

**Stale-if:**
- path-exists: `site/data/games.json`
- path-exists: `tools/data.test.ts`
- path-absent: `tools/lib/hope-coin.ts`

### Task 7: The player page renderer

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tools/render.ts`
- Test: `tools/render.test.ts`

**Claim:** A player's page shows every card they have been given, a case of the trophies they hold with the locked ones greyed beside them, and every game they have played. (derived)
Machine: M1. `playerSlugs(data)` returns the slug of every player with at least one result on the spine, and no other slug.
M2. `renderPlayer(data, slug)` returns a full document whose heading is the player's `name` and whose stat line names their handles.
M3. The page renders one figure per set the player was carded in, newest set first, each with the image at `/cards/<cardSet>/assets/<file>` and a caption `Tier · Title · Set name`; a player with no card renders no gallery and no placeholder.
M4. The page renders a trophy tile per entry from `trophyCase`, earned tiles before locked tiles, an earned tile showing the count as `x3` only when the count is above one, and a locked tile showing the trophy's `earn` line.
M5. The page renders exactly one ledger row per game the player played and none for a game they missed, newest first, each linking `/games/<date>/`, plus a totals row.
M6. The page renders the `bio` paragraph when the player has one and no analysis block at all when they do not.
M7. The page carries `og:url` of `https://poker.kmikeym.com/player/<slug>/`, `og:type` of `website`, `og:image` of the player's newest card when they have one and the site default otherwise, marks Standings as the current nav item, contains no em dash, and contains no `btn-primary`.

**Authorized-by:** #27; spec §5.1, §6, §7 ("Render tests")

**Interfaces:**
- Consumes: `trophyCase`
- Consumes: `type CardRef`
- Produces: `renderPlayer`
- Produces: `playerSlugs`

**Context:** This task changes the renderer only. It does not write or commit any HTML under `site/`: Task 10 owns every generated file, runs `bun tools/render.ts` against the real data, and commits the result. Prove this task on the fixture in `tools/render.test.ts`, which is the right layer anyway, since the fixture can carry a bio and an uncarded player that the real data does not.

`tools/render.ts` already holds the pieces to reuse rather than duplicate: `esc()` for text and attributes, the `GEM`, `GEM_EMPTY`, `COIN`, `SKULL`, and `SKULL_EMPTY` SVG constants, `nav(current)` which marks the current link with `aria-current`, and `page(title, body, footerTone, current, description)` which wraps a body into the full document and sets `og:url` from `current`. `page()` currently hardcodes `og:image`; this task needs a per-page image, so extend `page()` with an optional image argument defaulting to today's value rather than writing a second document template.

Two new SVG mark constants are needed, `SHIELD` and `RIBBON`, following the existing constants exactly: a `viewBox="0 0 12 12"`, `width="12" height="12"`, `aria-hidden="true"`, and `class="mark mark--shield"` or `class="mark mark--ribbon"` plus the metal class for the trophy's look. Task 2 defines `.mark--shield` and `.mark--ribbon` in `site/styles.css`; a locked tile uses the `.mark--empty` treatment, which is the existing grey outline.

Tier naming on a caption is Foil, Rare, Uncommon, Common for metals foil, sapphire, copper, pewter. The caption reads `Rare · 2nd, holds the Coin · The Founder's Table`, composed from the result's `card.title` and the game's `cardSetName`.

The newest card carries the holo effect only when its metal is `foil`, by putting `class="card-frame card-frame--holo shimmer"` on the frame div and loading `/holo.js` with `defer`. The holo frame must contain only the image: a `figcaption` inside it is washed out by the glare layers and is pinned against by an existing test, so captions sit outside the frame.

Names on the page are `players[].name`, which is already First plus last initial. Handles are `players[].aka`, rendered as a stat line such as `Plays as nickmershon`. The page's footer holds one link, to Standings; there is no RSVP band and no lime, so the page has zero `btn-primary`.

Eligibility never lapses, because games are never removed from the spine, which is why `playerSlugs` derives from results rather than from a list anyone maintains.

The fixture in `tools/render.test.ts` is a small `GamesData` literal with two players and one game; extend it in place, or build a second literal beside it, so the new cases can cover a carded player, an uncarded player, a player with a bio and one without.

`tools/render.ts` and `tools/render.test.ts` are also edited by Tasks 8 and 9 in this wave. Keep additions self-contained and append new functions and new `describe` blocks rather than restructuring existing ones, so the three sets of edits fold at merge.

**Proof:**
- Test: `tools/render.test.ts`
- Legs: (a) on a fixture with three players of whom one has no result, `playerSlugs` returns exactly the two who played, and the absent slug is named in the assertion [M1]; (b) `renderPlayer` output starts with `<!doctype html>` and contains the player's name as the display heading and each of their `aka` handles [M2]; (c) for a player carded in two sets, the output contains both image paths, the newer set's figure appears at a lower string index than the older one's, and both captions read `Tier · Title · Set name` [M3]; (d) for a player with no card, the output contains no `card-gallery` and no `<img` [M3]; (e) the output contains one tile per registry entry, the last earned tile appears before the first locked tile, a count of 2 renders `x2` while a count of 1 renders no `x` marker, and a locked tile contains its trophy's `earn` string [M4]; (f) the output contains one ledger row per game played with the newest date first, each row containing `href="/games/<date>/"`, and a totals row whose payout equals the sum of the player's payouts [M5]; (f2) for a fixture player who missed one of the three fixture games, the output contains no row and no `/games/<date>/` link for that game's date [M5]; (g) a fixture player with a `bio` has that paragraph in the output while a player without one produces a page containing neither the bio text nor any "no bio" wording [M6]; (h) the output's `og:url` is `https://poker.kmikeym.com/player/<slug>/`, its `og:type` is `website`, its `og:image` ends with the newest card's file for a carded player and equals the existing default for an uncarded one, it contains `href="/standings/" aria-current="page"`, it contains no `—`, and it contains no `btn-primary` [M7].

**Stale-if:**
- path-exists: `tools/render.ts`
- path-exists: `tools/render.test.ts`
- path-absent: `tools/lib/trophies.ts`

### Task 8: The Hope Coin page

**Type:** implementation

**Files:**
- Modify: `tools/render.ts`
- Test: `tools/render.test.ts`

**Claim:** Given the Coin's history, the renderer produces the page that says what it is, who holds it now, and every stop it has made. (derived)
Machine: M1. `renderHopeCoin(data)` returns a full document that says what the Coin is and that three kills on the holder takes it.
M2. The page shows the current holder by name with their `since` date and the skull progress already derived for standings.
M3. The page renders one route stop per entry in `hopeCoin.history` in exactly the order the list holds, oldest first, each showing the holder's name from `players`, its `how` sentence, and the `place` when present and nothing when absent.
M4. A stop's dates read as a span when it has both `from` and `to`, as `since <date>` when it is the last stop, and as `before <next from>` when the first stop has no `from`.
M5. The last stop is marked as current with the `route-stop--current` class and no other stop is.
M6. The page carries `og:url` of `https://poker.kmikeym.com/hope-coin/`, `og:type` of `website`, marks Standings as the current nav item, contains no em dash, and contains no `btn-primary`.

**Authorized-by:** #27; spec §5.2, §7 ("Render tests")

**Interfaces:**
- Consumes: `type HopeCoinStop`
- Produces: `renderHopeCoin`

**Context:** This task changes the renderer only and writes no HTML under `site/`; Task 10 runs the renderer, commits `site/hope-coin/index.html`, and carries the claim that the page exists at that address. That split is deliberate: this task's exam is at the function layer because its contract is the returned document, and nothing here should be read as promising a published page. Prove it on the fixture, which can carry the multi-stop history the real data does not yet have.

The real data at this point carries exactly one stop, `nick-m` from `2026-04-14`, so the live page will show a one-stop journey. That is the intended shipping state: Mike appends the earlier stops later as a data-only change, and this renderer must already handle them, which is why the fixture carries three stops and a first stop with no `from`.

Reuse from `tools/render.ts`: `esc()`, the `COIN`, `SKULL`, and `SKULL_EMPTY` constants, `nav()`, and `page()`. Reuse `deriveStandings(data)` from `tools/lib/standings.ts` for the skull tally rather than recomputing it; it returns `hopeCoin.skulls` as a map of slug to count, and the standings page already renders that as filled skulls up to the count plus outline skulls to three.

The route markup uses the classes Task 2 defines: a `.route` wrapper, one `.route-stop` per stop with `.route-stop--current` on the last, oldest at the top. There is no map and no geography beyond the `place` string; recording places now is what makes a drawn map possible later without touching the data.

Date wording, with no em dashes anywhere: a closed stop reads `June 2025 to April 2026`, the current stop reads `since April 2026`, and a first stop with no `from` reads `before April 2026`, taking the next stop's `from`. Months are spelled out; `tools/render.ts` already holds a `MONTHS` array for this.

The two opening sentences say the Coin is the traveling trophy and that three kills on the holder takes it. The page has one lime CTA count of zero and no RSVP band.

`tools/render.ts` and `tools/render.test.ts` are also edited by Tasks 7 and 9 in this wave. Append new functions and new `describe` blocks rather than restructuring existing ones so the edits fold at merge.

**Proof:**
- Test: `tools/render.test.ts`
- Legs: (a) the output starts with `<!doctype html>` and contains both the traveling-trophy sentence and the three-kills sentence [M1]; (b) on the fixture, the output contains the current holder's `name`, their `since` date, and the same `n of 3` skull text the standings page renders for that slug [M2]; (c) on a three-stop fixture the output contains exactly three `route-stop` occurrences, and the list of holder names extracted from the rendered stops in document order equals the fixture's holder list in order, so a reversed or shuffled render fails rather than passing a single index comparison [M3]; (c2) each of the three stops' `how` sentences appears inside its own stop's markup, one case per stop, so a renderer that drops `how` fails [M3]; (c3) a stop with a `place` shows that place, and a stop without one adds no empty place element [M3]; (d) a stop with `from` and `to` renders `June 2025 to April 2026`, the last stop renders `since April 2026`, and a first stop with no `from` renders `before` followed by the next stop's month and year [M4]; (e) the output contains exactly one occurrence of `route-stop--current` and it falls inside the last stop's markup [M5]; (f) the output's `og:url` is `https://poker.kmikeym.com/hope-coin/`, its `og:type` is `website`, it contains `href="/standings/" aria-current="page"`, it contains no `—`, and it contains no `btn-primary` [M6].

**Stale-if:**
- path-exists: `tools/render.ts`
- path-exists: `tools/render.test.ts`
- path-absent: `tools/lib/hope-coin.ts`

### Task 9: The standings shelf, the player links, and the home coin button

**Type:** implementation

**Files:**
- Modify: `tools/render.ts`
- Modify: `site/index.html`
- Test: `tools/render.test.ts`
- Test: `tools/site.test.ts`

**Claim:** Standings shows each player's earned trophies as a shelf of marks and their name is the way into their own page. (derived)
Machine: M1. Every standings row's player name is an anchor to that player's own `/player/<slug>/`, never to another player's page and never left as plain text.
M2. Every row carries a Trophies cell, including a row for a player who has earned nothing, and each cell holds one mark per earned trophy in display order taken from `trophyCase`, with the Trophies column present in the table header.
M3. A player with seven or more earned trophies shows six marks and a `+N` element where N is the overflow, and a player with exactly six or fewer shows six or fewer marks and no `+N` element at all.
M4. The Hope Coin tile's text links to `/hope-coin/`, and the Foil tile is unchanged.
M5. `site/index.html`'s coin tile button points at `/hope-coin/` instead of `/standings/`, and the home page still has exactly one `btn-primary`.
M6. The standings output contains no em dash and still carries its existing record qualifier sentence and skull progress.

**Authorized-by:** #27; spec §5.3, §5.4, §7 ("Render tests")

**Interfaces:**
- Consumes: `trophyCase`
- Produces: `renderStandings`

**Context:** This task changes the renderer and one hand-written page. It does not commit `site/standings/index.html`: Task 10 runs the renderer and commits every generated file, so editing that HTML here would only be overwritten.

`renderStandings(data)` in `tools/render.ts` today derives rows via `deriveStandings`, renders a Foil tile and a Hope Coin tile inside `.tiles`, and then a `.ledger` table with the columns Player, Games, Wins, Cashes, Best, Won, Rebuys. The Player cell currently appends a foil gem for the reigning champion and the coin mark for the Coin holder; both stay. The new Trophies column goes at the end of the row, after Rebuys, so the numeric columns keep their block.

The shelf uses the `.shelf` and `.shelf-more` classes Task 2 defines, and one mark per earned trophy in `trophyCase(data, slug).earned` order, drawn with the SVG constant for that trophy's `look.shape` carrying its `look.metal` class. The cap is six marks; the seventh and beyond collapse into `+N`. The shelf is marks only, no names: the names live on the player page, which is what the row now links to.

In `site/index.html`, line 116 currently reads `<p><a class="btn-secondary" href="/standings/">The full record</a></p>` at the close of the Hope Coin section; that is the button the spec moves to `/hope-coin/`. Line 82's `Standings and trophies` button and the footer links stay pointed at `/standings/`. The home page's single lime `btn-primary` is the RSVP CTA and must stay the only one, which an existing test in `tools/site.test.ts` already pins.

`tools/render.ts` and `tools/render.test.ts` are also edited by Tasks 7 and 8 in this wave; keep edits additive so they fold at merge. `tools/site.test.ts` is also edited by Task 5, whose header asks for self-contained additive `describe` blocks for the same reason.

**Proof:**
- Test: `tools/render.test.ts`
- Test: `tools/site.test.ts`
- Legs: (a) a case per fixture slug asserts `renderStandings` output contains `href="/player/<slug>/"` inside that row's own first cell, matched by locating the row containing the player's name, so a row linking a different player's page fails [M1]; (a2) the output contains no `<td>` in the Player column whose text is a name with no enclosing anchor, asserted over every row [M1]; (b) the table header contains a `Trophies` cell, and a fixture player with a known earned set renders exactly that many marks in the shelf, in `trophyCase` display order [M2]; (b2) the count of Trophies cells equals the count of rows, asserted over a fixture that includes a player who has earned nothing, whose cell is present and empty, so a row that omits the cell fails [M2]; (c) a fixture player constructed to earn eight trophies renders six marks and a `+2`, while a player earning three renders three marks and no `+` element [M3]; (c2) the six and seven boundary is exercised directly: a player earning exactly six renders six marks and no `+` element, and a player earning exactly seven renders six marks and a `+1` [M3]; (d) the output contains `href="/hope-coin/"` within the Hope Coin tile and the Foil tile's existing champion sentence is byte-identical to what it renders today, asserted against the same literal the current test uses [M4]; (e) in `tools/site.test.ts`, `site/index.html` contains `href="/hope-coin/"` and does not contain `href="/standings/">The full record`, and its count of `btn-primary` is exactly 1 [M5]; (f) the output contains no `—`, contains the record qualifier sentence, and still contains the `1 of 3` skull text the existing test asserts [M6].

**Stale-if:**
- path-exists: `tools/render.ts`
- path-exists: `site/index.html`
- path-absent: `tools/lib/trophies.ts`

### Task 10: Regenerate and commit the site

**Type:** implementation
**Review:** peer

**Files:**
- Create: `site/player/kmikeym/index.html`
- Create: `site/player/chris-g/index.html`
- Create: `site/player/nick-m/index.html`
- Create: `site/player/beau-g/index.html`
- Create: `site/player/amy-m/index.html`
- Create: `site/player/webvee/index.html`
- Create: `site/player/thomas-d/index.html`
- Create: `site/player/drew-a/index.html`
- Create: `site/hope-coin/index.html`
- Modify: `site/standings/index.html`
- Modify: `tools/render.ts`
- Test: `tools/site.test.ts`

**Claim:** What is committed under site/ is exactly what the generator produces from the committed record, so a visitor sees the pages the data describes. (derived)
Machine: M1. Running `tools/render.ts` against the committed data actually produces one `site/player/<slug>/index.html` per slug from `playerSlugs` plus `site/hope-coin/index.html`, alongside the standings, games index, and ics files it writes today, so a committed page the generator never writes fails.
M2. Running `bun tools/render.ts` leaves `git diff --exit-code` clean on `site/standings/index.html`, `site/games/index.html`, `site/next-game.ics`, `site/player/`, and `site/hope-coin/`.
M3. `site/player/` holds exactly one committed page per player on the spine and no page for anyone else, and every one of those pages carries the site favicon link, an `og:url` equal to its own address, and an `og:type` of `website`.
M4. `site/hope-coin/index.html` exists and carries the favicon link, its own `og:url`, and `og:type` of `website`.
M5. The committed standings page links every player on the spine to their own page and leaves no player on the spine unlinked, and it contains a `/hope-coin/` link.
M6. `bun test tools` passes and `bunx tsc --noEmit` reports no error.

**Authorized-by:** #27; spec §6 ("Rendering and the drift check"), §7 ("Site invariants extend on their own")

**Interfaces:**
- Consumes: `renderPlayer`
- Consumes: `playerSlugs`
- Consumes: `renderHopeCoin`
- Consumes: `renderStandings`
- Produces: none

**Context:** This task owns every generated file. Tasks 7, 8, and 9 change the renderer and prove themselves on fixtures; none of them commits HTML, so this is the only place the real pages are written, and it is the only place a stale generated file can hide.

The main block of `tools/render.ts` today is:

    if (import.meta.main) {
      const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
      await Bun.write("site/standings/index.html", renderStandings(data));
      await Bun.write("site/games/index.html", renderGamesIndex(data));
      await Bun.write("site/next-game.ics", renderNextGameIcs(data));
      console.log("rendered site/standings/index.html, site/games/index.html, site/next-game.ics");
    }

It gains a loop over `playerSlugs(data)` writing `site/player/<slug>/index.html`, and one write for `site/hope-coin/index.html`. `Bun.write` creates parent directories, so no separate mkdir step is needed. Render never deletes a page: eligibility never lapses, because games are never removed from the spine.

The eight slugs on the spine, all of whom played at least one of the two games, are `kmikeym`, `chris-g`, `nick-m`, `beau-g`, `amy-m`, `webvee`, `thomas-d`, and `drew-a`. They are listed in the Files block so the created paths are explicit, but the generator derives them from the data rather than from any list.

Most of the site invariants extend to the new pages on their own, because the checks in `tools/site.test.ts` iterate `siteHtmlFiles()`: the site-wide copy rules, the favicon check, and the per-page `og:url` check all pick up new directories with no edit. What this task adds is the drift check over the new paths and the assertions that the new pages are actually there, so an empty `site/player/` cannot pass by having nothing to iterate.

Card images are referenced from `/cards/<cardSet>/assets/<file>` and never copied, so this task adds no binary asset.

The drift check alone cannot prove the generator is what produced these pages: a hand-written page the renderer never touches also leaves `git diff` clean. So the test renders into an empty temp directory from a copy of the data and compares the produced tree against the committed one, which fails on a committed page the generator does not write. Use a unique temp path per test run so a concurrent suite on the same machine cannot collide.

`site/_headers` and `site/_redirects` need no entry: the new pages are ordinary public pages, unlike the `/portrait/*` capability URLs which carry a noindex header.

**Proof:**
- Test: `tools/site.test.ts`
- Legs: (a) the test copies `site/data/games.json` into an empty temp directory, runs the renderer with that directory as its working root, and asserts the set of files produced there under `player/` and `hope-coin/` equals the set committed under `site/`, with each produced file byte-identical to its committed twin; because the temp tree starts empty, a page that is committed but never generated fails, which a clean `git diff` alone cannot catch [M1]; (a2) after `bun tools/render.ts` in the repo, `git status --porcelain` lists no change under `site/standings/index.html`, `site/games/index.html`, `site/next-game.ics`, `site/player/`, or `site/hope-coin/`, reported as the failing path when it is not clean [M2]; (b) the set of directory names under `site/player/` equals the set `playerSlugs` derives from the committed data, so a page for a slug with no game and a missing page for a slug with one both fail, and the diff names the slug [M3]; (c) a table-driven case per slug, one case per directory found under `site/player/`, asserts that page exists, contains `href="/favicon.svg"`, has `og:url` equal to `https://poker.kmikeym.com/player/<slug>/`, and has `og:type` of `website`, the case named by slug [M3]; (d) `site/hope-coin/index.html` exists and has the favicon link, `og:url` of `https://poker.kmikeym.com/hope-coin/`, and `og:type` of `website` [M4]; (e) a case per slug asserts `site/standings/index.html` contains `href="/player/<slug>/"`, iterating the slugs derived from the data rather than a typed list, so a player added to the record with no link fails [M5]; (f) the count of distinct `/player/` hrefs in the standings page equals the number of players on the spine, so an extra or a duplicated link fails, and the page contains `href="/hope-coin/"` [M5]; (g) `bun test tools` exits zero with every test passing, and `bunx tsc --noEmit` exits zero [M6].

**Stale-if:**
- path-exists: `tools/render.ts`
- path-exists: `site/data/games.json`
- path-absent: `site/hope-coin/index.html`
- issue-open: #27
