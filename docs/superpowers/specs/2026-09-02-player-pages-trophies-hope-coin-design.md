# Player pages, the trophy case, and the Hope Coin page

**Date:** 2026-09-02
**Status:** Approved direction (Mike, 2026-09-02, brainstorm with Nova: "go with A")
**Author:** Nova, from a design pass with Mike
**Builder:** Nova. Charlie fills the data at each set minting and coin handoff.
**Tracking issue:** `Publicly-Traded-Person/shareholder-poker#27` (absorbs the standings half; player pages and the coin page are new scope)
**Prior specs:** `2026-08-17-poker-quarterly-systems-design.md` (site spec: §3 privacy boundary, §4 reserved `/player/<slug>`, §7 rarity palette), `2026-08-26-portrait-consent-pages-design.md` (how cards get faces; unchanged here)
**Related, deliberately separate:** the pre-spine history page (2020, 2025, early 2026), tracked on #3. It feeds nothing in this spec.

## 1. What this is

Every player on the record gets a page: every version of their card, a trophy case in the Apple Health style, their game history, and a paragraph from Charlie. The Hope Coin gets a page of its own: what it is, who holds it, and every physical stop it has made. Standings rows gain a trophy shelf and link to the player pages.

All of it is generated from `site/data/games.json` by `tools/render.ts`, committed as HTML, and drift-checked, the same way `/standings/` is today. No runtime, no Pages Function, no new service.

The spec's one design rule: **a trophy is one registry entry and nothing else.** Adding one touches a single list. The publish tool, the shelf, the case, the locked list, and the tests all read that list.

## 2. What stays out

- **Pre-spine history.** The data spine starts with July 2026, the first carded game. Older seasons are thinner (no logs, partial finish orders, a different format in 2020) and get one archive page later from their own file (#3). They never feed standings, trophies, or player pages. The one exception is Hope Coin stops, which are a list of places rather than game results (§3.3).
- **Chip trajectories.** Logs never enter git; per-player chip history is not data.
- **Analysis by code.** The generator writes no opinions. The only prose about a person is Charlie's bio.
- **Anything about a person beyond handle, name, bio, card, and results.** The privacy boundary (site spec §3) holds. Charlie's private per-player reads in the vault never surface; a bio is written fresh for the page.
- **Player index page.** Standings is the index.
- **Geography on the coin page.** Stops name a place; there is no map. Recording places now makes a drawn map possible later without touching the data.

## 3. Data

Everything lives in `site/data/games.json`, which stays public-safe and in canonical `JSON.stringify(data, null, 2)` form.

### 3.1 Cards on results

Each result may carry a `card`:

```json
{ "slug": "nick-m", "handle": "nickmershon", "finish": 2, "payout": 135, "rebuys": 0,
  "trophies": [],
  "card": { "metal": "sapphire", "file": "card-2-nickmershon.png", "title": "2nd, holds the Coin" } }
```

- `metal` is one of `foil`, `sapphire`, `copper`, `pewter`. The page names the tier the way the set pages do: Foil, Rare, Uncommon, Common.
- `file` is the asset's filename under `site/cards/<cardSet>/assets/`.
- `title` is the caption title as it reads on the set page.

Charlie fills every `card` for a set in the same commit that ships the set page. A site test cross-checks both directions (§7). The game also gains `cardSetName` (`"The Founder's Table"`, `"Wire to Wire"`) so a player page can name the set. A game with a `cardSet` must have a `cardSetName`.

Sets 1 and 2 are filled from the committed set pages in the first PR. Their captions and assets are public already, so nothing is invented; the cross-check proves the fill.

### 3.2 Trophy ids on results

`results[].trophies` exists today and carries judged ids from `results.json`. Nothing in the publish path checks them. From this spec on, `tools/publish-game.ts` halts on an id the registry (§4) does not know, the same way it halts on an unknown handle. The runbook lists the ids by pointing at the registry, not by copying it.

### 3.3 Hope Coin history

`hopeCoin` grows a `history` list, one stop per tenure:

```json
"hopeCoin": {
  "holder": "nick-m", "since": "2026-04-14",
  "history": [
    { "holder": "matt-m", "to": "2026-04-14",
      "how": "Held through the 2025 season." },
    { "holder": "nick-m", "from": "2026-04-14",
      "how": "Third skull on Matt M." }
  ]
}
```

The first stop above shows the shape only; its real `from` and `place` come from Mike (§9). The second is the current holder as the README records it.

- Stops are in date order. Each stop's `to` equals the next stop's `from`; only the last stop has no `to`. The first stop may have no `from` when nobody remembers it; the page then says "before" the next date rather than inventing one.
- `holder` and `since` at the top stay as the fast path and must equal the last stop.
- `place` is optional, as it should read on the page. `how` is one plain sentence.
- Stops before July 2026 are welcome here. This is the only pre-spine history in the data, because a stop is a place and a date, not a game result.
- A stop's holder may be a slug that has no game on the spine (a pre-spine holder). The coin page shows the name from `players`; add such a player to `players` with no games rather than inventing a result.

Charlie appends a stop when the Coin moves, in the same commit as that game. Mike supplies the stops before the spine from memory; a stop can ship without a `place` and gain one later.

### 3.4 Bio on players

`players[].bio`, optional, one paragraph, Charlie's read of the player for public reading. Dignity rule on every edit. Written for the page, never lifted from the vault's private reads. Absent means the page has no analysis block and says nothing about its absence.

### 3.5 The example row, complete

```json
{ "slug": "beau-g", "name": "Beau G.", "aka": ["bg"],
  "bio": "Led July with two thirds of the chips in play, then bubbled. Cashed in August." }
```

## 4. The trophy model

One pure module, `tools/lib/trophies.ts`. No clock, no I/O.

### 4.1 The registry

```ts
type Look = { shape: "gem" | "skull" | "coin" | "shield" | "ribbon";
              metal: "foil" | "sapphire" | "copper" | "pewter" };
type Trophy = {
  id: string;            // kebab-case, the id results.json carries for judged ones
  name: string;
  earn: string;          // one line, how to earn it; the locked-state caption
  kind: "judged" | "derived";
  look: Look;
  rule?: DerivedRule;    // present on every derived entry, absent on judged
};
type DerivedRule = (games: Game[], slug: string) => Earned | null;
type Earned = { id: string; dates: string[]; count: number };  // dates oldest first
```

The registry is a single exported array. Display order is the array order after sorting by metal (foil, sapphire, copper, pewter); within a metal, array order.

**Judged entries** (recorded by a human in `results.json` at publish):

| id | name | look |
|---|---|---|
| `hope-slayer` | Hope Slayer | skull, foil |
| `two-seven-showdown` | 2-7 Showdown | shield, sapphire |
| `final-countdown` | The Final Countdown | shield, sapphire |
| `cain-and-abel` | Cain and Abel | shield, sapphire |
| `abel-stands` | Abel Stands | shield, sapphire |
| `kevin-deuce` | Kevin Deuce | shield, sapphire |

**Derived entries** (computed over the spine; each has a rule beside it):

| id | name | look | rule |
|---|---|---|---|
| `champion` | Champion | gem, foil | finish 1; count is wins |
| `hope-coin` | The Hope Coin | coin, foil | any stop in `hopeCoin.history` with this holder; dates are the `from` dates; count is stops |
| `podium` | Podium | gem, copper | finish 3 or better |
| `cashed` | Cashed | ribbon, copper | payout above zero |
| `clean-night` | Clean Night | ribbon, copper | cashed with zero rebuys |
| `comeback` | Comeback | ribbon, copper | cashed with one or more rebuys |
| `regular` | Regular | ribbon, pewter | played three consecutive games on the spine; earned on the third; count is the best streak |
| `founders-table` | Founder's Table | ribbon, pewter | played the 2026-07-14 game, pinned to that date so nothing older moves it |
| `the-bubble` | The Bubble | ribbon, pewter | finished one place outside the paid spots, where paid spots are the results with payout above zero in that game (`entries` counts buy-ins including rebuys and is never used here) |

The Hope Coin entry is listed as derived because its rule reads `hopeCoin.history`, not `results.json`. A past holder keeps the award with their own dates.

### 4.2 The one function

```ts
export function trophyCase(data: GamesData, slug: string): { earned: Earned[]; locked: Trophy[] }
```

Earned is every judged id this player's results carry (dates from those games, count from occurrences) plus every derived rule that returns a value, in display order. Locked is the registry minus earned, in display order. Standings and the player page both call this, so the shelf and the case cannot disagree.

### 4.3 Adding a trophy

One registry entry. For a judged trophy: id, name, earn line, look. For a derived trophy: the same plus its rule. Then run the suite. The registry test (§7) rejects a malformed entry; nothing else changes. A new mark shape is one SVG constant in `tools/render.ts` and one CSS class in `site/styles.css`. The runbook says this in one sentence and points here.

## 5. The pages

All generated by `tools/render.ts`, committed, drift-checked. Visual system per `docs/brand.md`: light page, dark objects, drawn marks only, rarity metals as accents, no lime.

### 5.1 `/player/<slug>/`

One page for every player with at least one game on the spine. Top to bottom:

1. **Heading.** Name as the display heading, handles as a stat line ("Plays as nickmershon"). Names are First plus last initial, per the privacy rule.
2. **Cards.** One card per set the player was carded in, newest first: the image, then a caption line "Tier · Title · Set name" ("Rare · 2nd, holds the Coin · The Founder's Table"). The newest card carries the holo effect when its metal is foil, reusing the shipped effect and its reduced-motion guards. A player with no card yet shows no gallery and no placeholder.
3. **Trophy case.** A tile grid from `trophyCase`. Earned tiles: the mark in its metal, name, count as "x3" when above one, and the most recent date. Locked tiles: the outline mark in grey (the `.mark--empty` treatment), name, and the earn line. Earned before locked, each in display order.
4. **The record.** A `ledger` of every game on the spine, newest first: date linking `/games/<date>/`, finish, payout, rebuys. Totals in the last row.
5. **Charlie's paragraph**, when `bio` exists.
6. **Foot.** One link: Standings. No RSVP band, no lime.

The nav marks Standings current. The page's `og:url` is its own address and `og:image` is its newest card, falling back to the site default when there is none.

### 5.2 `/hope-coin/`

One page:

1. **What it is**, two sentences: the traveling trophy; three kills on the holder takes it.
2. **The holder now**, the standings tile as it exists: name, since, skull progress.
3. **The journey.** Each stop as a row on a drawn route line, oldest at the top: holder name, place when known, dates ("June 2025 to April 2026", "since April 2026"), and the `how` sentence. The current stop is marked as current.

The nav marks Standings current. Nothing else on the page.

### 5.3 Standings

Each row's name links to the player page. A new Trophies column shows the shelf: the player's earned marks in display order, one mark per earned trophy, capped at six with "+N". The Hope Coin tile's text links to `/hope-coin/`. The Foil tile stays.

### 5.4 Home

The coin tile's button goes to `/hope-coin/` instead of `/standings/`. No other change.

### 5.5 Copy rules

No em dashes, no "experiment", dignity rule on every line, drawn marks never emoji, exactly one lime CTA per page (these pages have none).

## 6. Rendering and the drift check

`bun tools/render.ts` writes `site/player/<slug>/index.html` for every eligible player, `site/hope-coin/index.html`, and the existing pages. Eligibility never lapses, because games are never removed, so render never deletes a page. The drift check (`bun tools/render.ts && git diff --exit-code` on generated files) covers the new files.

Card images are referenced from `/cards/<cardSet>/assets/<file>`, never copied.

## 7. Testing

- **Registry test.** Unique kebab-case ids; every entry has a name, an earn line, and a look whose shape and metal are in the known sets; every derived entry has a rule and no judged entry does.
- **Rule tests**, one per derived trophy, on synthetic games: Champion count and dates; Podium; Cashed; Clean Night; Comeback; The Bubble on a two-spot night and a three-spot night; Regular with a broken streak and the best-streak count; Founder's Table unmoved when a 2020 game is added. Then `trophyCase` ordering, and locked equals the registry minus earned.
- **Judged path.** A result carrying an id earns it with that game's date. An unknown id in `results.json` halts `publish-game`, tested beside the unknown-handle halt.
- **Hope Coin data.** Stops in date order, each `to` equals the next `from`, only the last has no `to`, only the first may lack `from`, `holder` and `since` equal the last stop. Each past holder earns the coin trophy with their own dates.
- **Card cross-check, on the real pages** (`tools/site.test.ts`): every asset under a set's folder is claimed by exactly one result; every claimed file exists; every metal is on the ladder; the set page contains the caption composed from the data; a game with `cardSet` has `cardSetName`.
- **Render tests** from a fixture: player page heading, one card per carded set, earned and locked tile counts, ledger rows with links, bio present and absent; coin page stops in order with the current one marked; standings shelf, "+N" cap, links. No em dash on any of them.
- **Site invariants extend on their own.** New pages get favicon, unfurl, and og:url checks from the existing directory-driven tests. Generated pages carry `og:type`.

## 8. Rollout order

1. Data types, the registry, `trophyCase`, and every test in §7 that needs no page. `publish-game` halts on unknown ids.
2. Card blocks for Sets 1 and 2 filled from the committed set pages; `cardSetName` on both games; the cross-check test green.
3. Coin history from Mike; `place` optional so a stop ships before its place is known. Data tests green.
4. Renderer: player pages, coin page, standings shelf and links, home button. Render tests and drift check green.
5. `docs/publishing.md` and `CLAUDE.md`: the card block at minting, a stop at each handoff, bio edits, and "a new trophy is one registry entry". Same commit as the behavior it describes.

Each step is a PR on a branch, merged on Mike's go. Steps 1 through 3 change nothing a visitor sees.

## 9. Open questions for Mike

- The list of Hope Coin stops before July 2026, with places where remembered. The pages ship either way.
- Bios: Charlie writes them after the pages exist; the page reads fine without one.
