# The Hope Coin page: hero, odometer, route, and the share of its life

**Date:** 2026-09-05
**Status:** Approved direction (Mike, 2026-09-05, brainstorm with Nova: crop the coin photo to a circle; the journey list becomes the schematic route; miles come back as Beau's figures; a donut plus a tenure strip for holders over time)
**Author:** Nova, from a design pass with Mike
**Builder:** Nova. Mike supplies the photo (done) and Nick's city for the last leg.
**Prior specs:** `2026-09-02-player-pages-trophies-hope-coin-design.md` (the coin page, §5.2, and `hopeCoin.history`), `2026-08-17-poker-quarterly-systems-design.md` (site spec: §3 privacy, §7 palette)
**Data this builds on:** the twelve-stop chain merged 2026-09-05 (PR #47), from Beau's own chain of custody

## 1. What this is

`/hope-coin/` gets a hero photograph of the coin, an odometer, a route diagram grown out of the journey list it already has, and a picture of who has held the coin for how long. Everything draws from `site/data/games.json` at render time: `tools/render.ts` emits inline SVG, the suite tests it on synthetic chains, and the drift check covers it like every other generated page. No runtime, no script on the page, no external asset.

The page is the one place on the site where a visitor meets the coin itself rather than a standings number, so it can afford to be the most graphic page on the site. It stays inside the brand: a light page, dark objects, drawn marks, the four metals for accents, the coin's own photo as the one photograph.

## 2. What stays out

- **A geographic map.** Mike chose the schematic. No coastline asset, no coordinates anywhere, no gazetteer. Places stay names.
- **"How it moved" as a field or a graphic.** Beau's document states the method for five of eleven legs. The `how` sentences already carry it where it is known.
- **The era split as a number.** "Mid-2024" is Beau's phrase, not a date. The intro sentence covers the rule change; nothing counts handoffs per era.
- **Any figure not in the data.** Miles are Beau's and say so on the page. Nick's arriving leg stays unmeasured until Nick confirms his city. The undated first stop is left out of the tenure math and the caption says so.
- **The original photograph.** It shows a hand and a parking lot. Only the circle crop and the unfurl image enter the repo.

## 3. Data: three optional fields on a stop

`HopeCoinStop` (`tools/lib/standings.ts`) gains:

```json
{
  "holder": "beau-g",
  "from": "2023-04-04",
  "to": "2023-07",
  "place": "On the road by RV, Seattle to Homer, Alaska, by way of Hope, British Columbia",
  "how": "Mailed to Seattle.",
  "milesIn": 648,
  "milesHeld": 4454,
  "route": ["Seattle", "Wenatchee", "Bellingham", "Hope, British Columbia", "Cassiar Highway", "Yukon", "Fairbanks", "Denali", "Homer, Alaska"]
}
```

- **`milesIn`**: the leg that brought the coin to this stop, in miles, a non-negative integer. Zero is a real value (a hand-to-hand pass in the same town). Absent on the first stop, which has no arriving leg, and absent wherever Beau's figure rests on an assumption (Nick's leg today).
- **`milesHeld`**: miles the coin traveled while at this stop, a positive integer. Only Beau's two RV stints have one.
- **`route`**: the places the coin passed through while held, in order, as place names. Present only with `milesHeld`; a stop that did not travel has no route. The stop's own `place` stays the one-line summary the journey prints; `route` feeds the loop in §5.

Beau's figures, leg by leg, for the first file:

| Stop | `milesIn` | `milesHeld` | Beau's row |
|---|---:|---:|---|
| Mike M. | absent | | the coin's first home |
| Chris G. | 379 | | Los Angeles to Petaluma, mailed |
| Beau G. | 0 | 5420 | picked up in Petaluma; RV to Puget Sound, Southern California, Pahrump and Las Vegas, San Diego |
| Josh B. | 938 | | San Diego to Portland, couriered |
| Drew A. | 0 | | Portland to Portland |
| Chris G. | 503 | | Portland to Petaluma |
| Josh B. | 503 | | Petaluma to Portland |
| Chris G. | 503 | | Portland to Petaluma |
| Beau G. | 648 | 4454 | Petaluma to Seattle, mailed; RV to Wenatchee, Bellingham, Hope, the Cassiar Highway, the Yukon, Fairbanks, Denali, Homer |
| Chris G. | 1947 | | Homer to Petaluma, mailed |
| Matt W. | 2382 | | Petaluma to Jacksonville |
| Nick M. | absent until Nick confirms | | Beau assumed Miami, 328 |

On record: 17,677 miles. With Nick's leg as Beau assumed it: 18,005.

`validateCoinHistory` gains rule 5: `milesIn` is a non-negative integer when present; `milesHeld` is a positive integer when present; `route` is a non-empty list of non-empty strings, present only when `milesHeld` is; and `route` names never contain an em dash. Same refuse-and-name-the-stop voice as the other rules.

## 4. The hero

The page's first band, `band-light`, becomes a two-column `cols` grid on wide screens and a stack on a phone: the coin on the left, the copy on the right.

- **The coin.** `site/hope-coin/assets/coin.png`, the coin cropped to a circle at its rim, about 900 pixels across, transparent outside the circle, inside a round dark frame (the `card-frame` treatment with a circular radius, a new `coin-frame` class in `site/styles.css`). No dither: the red enamel and silver lettering are the point, and the circle removes everything that needed hiding.
- **The caption**, in the `stat` font under the coin: "It's not the cards, it's the player. The coin shows 7-2, the hand with its own bounty."
- **The copy** is what the page has today, unchanged in order: the display heading with the coin mark, the intro paragraph, the holder tile with the skull tally.
- **The unfurl.** `site/hope-coin/assets/coin-og.png`, 1200 by 630, the coin centered on felt. `renderHopeCoin` passes it as the page's image instead of the holder's newest card. The holder's card still appears on their player page; the coin's own page should unfurl as the coin.

Both files are made once from Mike's original with ImageMagick (`magick`, present on Mike's machine), by a documented one-off command in the runbook's new "The Hope Coin page" section, never by a tool in the repo: the original is not a repo input. Byte size budget for both: under 400 KB together.

## 5. The journey as the route

The journey list already draws a vertical line with a dot per stop (`.route`, `.route-stop`). It becomes the schematic:

- **Leg labels.** Between two stops, a small `stat` line on the spine: "379 miles" when the arriving stop has `milesIn`; "unmeasured" when it does not and it is not the first stop. The label belongs to the leg, drawn between the dots, not inside either stop's text.
- **The stint loops.** A stop with `route` draws an inline SVG loop off the spine: a rounded path leaving the stop's dot and returning to it, with one tick per waypoint and the name beside each tick, and the `milesHeld` figure at the loop's far end ("5,420 miles on the road"). Two loops on the page today. The loop is decorative geometry, not a map: ticks are evenly spaced along the path whatever the real distances.
  > **Superseded 2026-09-07 (Beau's review of the live page, via Mike).** The loop is now a straight line: one horizontal stroke with a tick per waypoint, left to right in route order, the names alternating above and below the line so neighbours never share a row, the border name on a row of its own, and the `milesHeld` figure under the line at its right end. Still evenly spaced, still not a map. The function and classes are named for what they draw (`routeLine`, `.route-line`, `.route-line-path`, `.route-line-miles`); nothing on the page answers to "loop" any more. Beau's words: "the loop graphics are kinda weird, should just be linear".
- **The border flag.** A waypoint whose name contains "British Columbia" gets a small flag mark and the words "the coin's one border crossing" as its tick label suffix. Derived from the name, so a future crossing needs no new field.
- **The current stop** keeps its foil dot and gains the coin at small size (the same `coin.png`, 48 pixels) beside the holder's name.
- **Everything else** in a stop stays as it renders today: name, date phrase, place, how.

## 6. The odometer

Above the journey heading, a stat tile row (`tile` styling, three or four tiles):

1. **Miles.** "17,677 miles on record" with a second line "by Beau's count, plus one leg still unmeasured" while any non-first stop lacks `milesIn`; when every leg is measured, the second line becomes "by Beau's count". The sum is `milesIn` over all stops plus `milesHeld` over all stops.
2. **Stops.** The count of stops.
3. **Places.** The count of distinct `place` values that are not RV stints (a place that begins "On the road" is a route, not a place) plus the distinct `route` names, each counted once. Not "cities": the Yukon and the Cassiar Highway are on the route and are not cities.
4. **Longest leg.** The largest single `milesIn` or `milesHeld` and whose it was: "5,420 miles, Beau G., on the road".

Numbers print with thousands separators through one helper, the same one every graphic on the page uses.

## 7. The share of the coin's life

A section "Who has held it" below the journey, `band-dark`, two parts side by side on wide screens, stacked on a phone.

### 7.1 Month math, defined once

Every date on the chain is reduced to its month (`YYYY-MM`), because seven of them are only that precise. A stop's tenure is the count of months from its `from` month up to but not including its `to` month. The current stop's `to` is the month of the latest game on the spine (`max(games[].date)`), never the clock, so the render is deterministic and the caption can say "as of the September game". A stop whose `from` and `to` fall in the same month counts zero. The first stop, with no `from`, is excluded and the caption says "The coin's time in Los Angeles before July 2021 is not counted."

Today's tenure, in months: Chris G. 27, Matt W. 15, Beau G. 6, Josh B. 6, Nick M. 4, Drew A. 3. Total 61, as of August 2026.

### 7.2 The donut

One inline SVG donut, one arc per holder, largest first, the current holder's arc in foil and the rest in graduated tints of the page ink (the four metals cannot name seven people, and a champion's gold must keep meaning something). Every arc carries its label and percentage on or beside it; the chart never relies on color alone. Percentages are integer, computed from months, and sum to 100 after the largest-remainder rounding the helper applies.

### 7.3 The tenure strip

One horizontal bar, July 2021 to the latest game month, one segment per stop in chain order, each segment's width its months, colored per holder exactly as the donut, with the holder's initials inside when the segment is wide enough and a tick with the year at each January. The strip is the sequence the donut cannot show: the two-quarter rhythm of the champion era, then the long holds.

### 7.4 The legend, which is the leaderboard

A table beside both: holder, reigns, months, share. Sorted by months, ties by chain order. This is the only place the numbers appear in text, so a screen reader gets the whole chart from the table.

## 8. Copy rules

Everything in `docs/brand.md`. No em dash anywhere, including SVG text. The word "experiment" never. First L. names, as the chain already carries them. Miles are always attributed to Beau in the same words: "by Beau's count". Nothing on the page says "about" or "roughly": a number is on record or it is unmeasured.

## 9. Rendering and tests

- `tools/lib/hope-coin.ts`: rule 5 (§3), plus pure helpers the renderer and the tests share: `monthIndex`, `tenureMonths(history, latestGame)`, `odometer(history)`, `formatMiles`.
- `tools/render.ts`: the hero, the leg labels, the loops, the tiles, the donut, the strip, the legend. Each graphic is its own function taking data and returning SVG or HTML, so a test can render one in isolation.
- `site/styles.css`: `coin-frame`, the loop and leg-label styles, the donut and strip sizing (`svg { width: 100%; height: auto }`, like the chip race), and `prefers-reduced-motion` guards if anything moves. Nothing moves in this build.
- **Validator tests**: one failing case per clause of rule 5.
- **Render tests on synthetic chains** (invented slugs): the odometer sum and both second-line wordings; leg labels between the right dots and "unmeasured" where a leg lacks miles; a loop only on a stop with `route`, ticks equal to the route's length, the flag only on a British Columbia name; tenure months for a chain with a month-only handoff and a same-month stop; the donut's percentages summing to 100 and its arcs matching the legend order; the strip's segment count equal to the dated stops; the current holder in foil in both; no em dash; the unfurl pointing at `coin-og.png`.
- **Data pins** in `tools/data.test.ts`: the real chain's miles on record total 17,677 and the two stints carry routes.
- **Site tests**: both assets exist under `site/hope-coin/assets/`, and the rendered page references them at those paths.

## 10. Rollout order

1. Data fields, rule 5, the month and odometer helpers, and their tests.
2. The two assets, the hero, the unfurl, and the runbook section that records the one-off crop command.
3. The odometer tiles and the journey's leg labels.
4. The stint loops and the border flag.
5. The donut, the strip, and the legend, after the dataviz pass settles the ink tints.
6. Regenerate, full suite, one PR. Mike reads the page; Beau sees his two loops.

Nick's city can land any time as a data-only commit: set `milesIn` on the last stop, and the odometer's second line changes by itself.

## 11. Open for Mike

1. **Nick's city.** Beau assumed Miami. Ask Nick; then the last leg is on record.
2. **The stat tiles in §6.** Four is the proposal. Say which to drop if the row feels busy.
