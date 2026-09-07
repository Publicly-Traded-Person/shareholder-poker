# The archive page: every game before the record

**Date:** 2026-09-05
**Status:** Approved direction (Mike, 2026-09-05, brainstorm with Nova: podium plus entrants plus bounties per game; one committed JSON file typed from the vault; 2020 from the README table with a format note; README table replaced by a link)
**Author:** Nova, from a design pass with Mike
**Builder:** Nova. Nova also types the first data file from the vault notes and the README. Mike checks every name in the PR.
**Tracking issue:** `Publicly-Traded-Person/shareholder-poker#39` (absorbs #3, closed 2026-09-05)
**Prior specs:** `2026-08-17-poker-quarterly-systems-design.md` (site spec: §3 privacy boundary, §7 palette), `2026-09-02-player-pages-trophies-hope-coin-design.md` (trophies derive from `games.json` alone; this page feeds none of it)

## 1. What this is

One page at `/archive/` that presents every game played before the data spine began in July 2026: the 2020 season, the 2025 season, and the 2026 games before the cards. Each game shows its date, who finished on the podium, which bounties were recorded, and how many played.

`tools/render.ts` generates the page from a new file, `site/data/archive.json`, commits it as HTML under `site/archive/`, and the suite drift-checks it like the five paths the renderer already owns. No runtime, no Pages Function, no new service.

The archive gets its own file because the spine's consumers assume things these games lack. `publish-game.ts` derives entries from a PokerNow log; every spine result carries a card; every derived trophy rule reads every game on the spine. A pre-spine game in `games.json` would need a guard in each of those places, and one missed guard awards a trophy nobody earned. A file nothing else reads cannot do that.

## 2. What stays out

- **Payouts, hands, rebuys, chip counts.** The notes hold them for two games out of forty-odd, and the site never invents a number. The page shows what every season has: podium, bounties, turnout.
- **Trophies, standings, player pages.** Nothing on the archive page feeds `trophyCase()`, the standings ledger, or a player's record. A player who appears only in the archive gets no page. A player on the spine gets a link from their archive appearances to their page, and nothing more.
- **A nav item.** The nav stays Home, Games, Cards, Standings. The page is reached from the "This record starts with July 2026" line on standings and the games index (§5).
- **The lime button.** Standings, the Hope Coin page, and the player pages carry no RSVP button; the archive matches them. The home page and the games index keep the one lime action each.
- **Bounty marks.** The bounties render as words, not as the trophy registry's drawn marks. A skull beside "Hope Slayer" on this page would read as a trophy, and nothing here is one.
- **Everything before 2020.** There is nothing before 2020.

## 3. Data: `site/data/archive.json`

The file stays in canonical form, `JSON.stringify(data, null, 2)` plus a trailing newline, for the same reason `games.json` does: an added game must read as a small diff.

```json
{
  "seasons": [
    {
      "id": "2026-pre",
      "title": "2026, before the cards",
      "note": "No result was recorded for January. May was a cash game, not a tournament.",
      "games": [
        {
          "date": "2026-04-14",
          "entrants": 9,
          "podium": [
            { "place": 1, "name": "Beau G.", "handle": "bg", "slug": "beau-g" },
            { "place": 2, "name": "Drew A.", "handle": "MoHDI_Drew", "slug": "drew-a" },
            { "place": 3, "name": "Mike M.", "handle": "kmikeym", "slug": "kmikeym" }
          ],
          "bounties": [
            { "kind": "bubble", "name": "Michael Z.", "handle": "pokermichi" },
            { "kind": "hope-slayer", "name": "Nick M.", "handle": "nickmershon", "slug": "nick-m" }
          ]
        }
      ]
    }
  ]
}
```

A chop is the same shape with two podium entries at `place: 1` and a `note` that says who chopped: for March 10, 2026, Beau G. and Matt W. (Mike, 2026-09-05: `mawgators` is Matt W.). The example stops at one game on purpose; the March entrant count is still open (§10), and an example must not show a guess as data.

### 3.1 Shape

- **`seasons`**: a non-empty list. The renderer orders seasons by the date of their first game, newest first, whatever order the file lists them in. A season has a unique `id`, a `title`, an optional one-line `note`, and a non-empty `games` list.
- **A game** has:
  - `date`, `YYYY-MM-DD`, unique across the whole file, earlier than the earliest game in `games.json`. The renderer orders games within a season by date, oldest first, the same direction as the games index.
  - `entrants`, an integer of at least one, **optional**. Absent means the notes do not say. The page then prints "Entrants not recorded", never a guess.
  - `podium`, a list of up to three entries, possibly empty (2020-11-17 has five players and no recorded result). An entry has `place` (1, 2, or 3), `name`, and optionally `handle` and `slug`. Places are listed in non-decreasing order. Two entries at place 1 is a chop; the game's `note` says so in words.
  - `bounties`, a list, possibly empty. An entry has `kind`, `name`, and optionally `handle` and `slug`. One player may hold several bounties in one game (two entries).
  - `note`, optional, one line.
- **`kind`** is one of exactly five strings: `hope-slayer`, `cain`, `seven-deuce`, `bubble`, `kevin-deuce`. The vocabulary lives in `tools/lib/archive.ts` beside its display names (§4.2) and nowhere else.

### 3.2 Rules the suite enforces

- Every `name` matches the First L. rule from `docs/brand.md`, using the same expression `tools/data.test.ts` applies to `games.json`. The two exceptions the brand rule already allows stand here too: a handle-only name for a player who asked for one, and a handle-derived name with no surname. "K5M Guy", the bot that finished second on 2026-02-10, is a handle.
- Every `slug` names a player who has a page: a slug `playerSlugs(games)` returns. A slug for a player who never played on the spine would link to a page that does not exist.
- `entrants`, when present, is at least the number of distinct podium names.
- No em dash anywhere in the file, and the word "experiment" nowhere in it. Notes are site copy.
- The file round-trips through canonical stringification unchanged.

Unknown is absent. The file never carries a placeholder, a zero standing in for "not recorded", or a name with a question mark.

## 4. The page

### 4.1 Structure

`page()` wraps it like every other generated page: the masthead rule, the four-item nav with nothing current, the footer. Title "Archive". Description for unfurls: "Every K5M Shareholder Poker game before the record began: 2020, 2025, and early 2026." `og:url` is the page's own address.

The body opens with a `band-light` section: the display heading "Before the record", one paragraph, and a link back to `/games/`.

Draft copy for that paragraph: "Every game before the data spine, from the notes that survive. Podiums, bounties, and who showed up: no chips, no hands. The record proper picks up where this page leaves off." (The last sentence was changed from "The record proper starts with July 2026." in review on 2026-09-06: a month typed into a generated page goes stale the moment a game earlier than the spine's first is published, so no month is typed on a generated page at all.)

Each season is its own band, alternating `band-dark` and `band-light` in order, so no two adjacent bands share a tone. A season band holds an `h2` in the display voice with the season's `title`, the `note` as a `stat` line when there is one, and an ordered list with the games index's own classes: `season`, `season-card`, `eyebrow`, `season-date`, `podium`, `stat`. Nothing new in `site/styles.css`.

One game card, top to bottom:

- The eyebrow: the month name.
- The date, plain text, not a link. There is no game page to link to.
- The podium list. Each row is the place in the `stat` font, then the name, then the handle in the `stat` font when there is one and it differs from the name. A handle-only entry, where `handle` equals `name`, prints the name once and no handle span; printing both would put the same word on the card twice. Place 1 carries the foil gem, the same `GEM("foil")` the games index draws, so a champion reads as a champion here too. A chop shows two rows that both read 1.
- The bounties line, when any: the display name of each kind and its holder, joined with the site's middle dot. "Hope Slayer: Nick M. · The Bubble: Michael Z."
- The turnout line in the `stat` font: "9 entrants", or "Entrants not recorded".
- The note, when there is one.

A name with a `slug` links to `/player/<slug>/`. A name without one is plain text.

### 4.2 Bounty display names

| `kind` | Reads as |
|---|---|
| `hope-slayer` | Hope Slayer |
| `cain` | Cain and Abel |
| `seven-deuce` | 2-7 Showdown |
| `bubble` | The Bubble |
| `kevin-deuce` | Kevin Deuce |

These match the trophy registry's names on purpose, so a visitor who meets "The Bubble" on a player page and on the archive reads one thing. They are a separate table in `tools/lib/archive.ts`, with a comment saying so, because the archive must not import the registry: the registry is the list of things that can be earned, and nothing here is earned.

### 4.3 Copy rules

Everything in `docs/brand.md` applies: no em dash, the word "experiment" never, the dignity rule on every name and note, First L. names, handles as the players wrote them. The season notes and game notes are the only prose on the page and Charlie owns them.

## 5. Links and retirements

**The record line.** `recordQualifier()` keeps its first sentence, derived from the earliest spine game. Its second sentence stops depending on a pending list and becomes, always, "Earlier games are in the archive." with "the archive" linking to `/archive/`. Standings and the games index print it as they do today.

**`backfillPending` retires.** The list at the top of `games.json`, its optional field on `GamesData`, the branch in `recordQualifier()`, the tests for that branch, runbook step 5's instruction to trim the list, the runbook's "Known open items" reference, and the CLAUDE.md "Known open items" block all describe a backfill that Mike ruled out on 2026-09-02. They go in the same PR as the page. Nothing about the record's span is typed by hand afterwards either: the start month still derives from the data, and the link is unconditional because the page always exists once this ships.

**The README.** Its "Archive" section, the 2020 table, becomes two lines: the season's one-sentence description and a link to `poker.kmikeym.com/archive/`. One list, one home, the same reasoning the README already gives for dropping its standings table.

## 6. Rendering and the drift check

- `tools/lib/archive.ts`: the `ArchiveData` types, the bounty table, and `validateArchive(archive, games)`, which throws a named error for the first rule in §3.2 it finds broken. Pure module, no I/O.
- `tools/render.ts`: `renderArchive(archive: ArchiveData): string`. The `import.meta.main` block reads `site/data/archive.json`, calls `validateArchive` before writing anything, and writes `site/archive/index.html`. The console line names the sixth path.
- `tools/site.test.ts`: the drift test's watched list gains `site/archive/`; the empty-directory render test copies `archive.json` beside `games.json`; a block mirroring the Hope Coin page's checks that `site/archive/index.html` exists and carries its own unfurl tags.
- `docs/publishing.md`: a section "Adding an archived game" that names `archive.json`, the rules in §3.2 in plain words, and the two commands (render, then the suite). `tools/docs.test.ts` checks the heading exists and names the file.

## 7. Testing

Every test on synthetic data uses invented players, per the privacy tiers.

- **`tools/archive.test.ts`**: `validateArchive` accepts the committed file; one failing case per rule in §3.2 (bad name, unknown slug, entrants below podium size, duplicate date, a date on or after the spine's first game, unknown bounty kind, places out of order, em dash in a note, non-canonical form).
- **`tools/render.test.ts`, `renderArchive`**: seasons come out newest first whatever the file order; games within a season oldest first; a chop renders two rows reading 1; the bounties line reads with the display names; an absent `entrants` prints "Entrants not recorded"; a name links exactly when it carries a slug; no `btn-primary`; no em dash; the unfurl tags name `/archive/`.
- **`tools/render.test.ts`, `recordQualifier`**: the new second sentence and its link; the `backfillPending` cases deleted.
- **`tools/site.test.ts`**: the drift and unfurl blocks above.
- **`tools/docs.test.ts`**: the runbook heading.

## 8. The first file

Nova types it from these sources. Mike checks every name in the PR. Nothing enters the file that a source does not state.

| Season | Source | What each game gets | Gaps that stay gaps |
|---|---|---|---|
| 2020 | `README.md`, "Archive" table (30 games, 2020-04-21 to 2020-11-17) | date, entrants, podium | Buy-ins and payouts were never shown. 2020-11-04 has no third place. 2020-11-17 has no result. Names are first names only; last initials come from the roster note in the vault, which stays out of the repo. |
| 2025 | vault, `Shareholder Poker 2025 (Airtable Archive).md` | date, entrants (rows in the table), podium, bounties from the result column | November unrecorded. December's result never reached the note. |
| 2026, before the cards | same note (2026-02-10); `2026-03-10` daily note; `Shareholder Poker 2026 (Airtable Archive).md` (2026-04-14); `Charlie/ch-poker-room-tracker.md` (2026-06-09) | date, entrants, podium, bounties | March: six buy-ins reported by Beau, a chop between Beau G. and Matt W. (`mawgators`, resolved by Mike 2026-09-05), no entrant count. April and June: bounty shares marked pending in the notes. January: no result. May: a cash game. |

Season notes, first draft, Charlie's to edit:

- **2020**: "PokerStars, twenty-dollar buy-ins, points seasons. These are the games the record holds."
- **2025**: "November was not recorded. December's result never reached the notes."
- **2026, before the cards**: "No result was recorded for January. May was a cash game, not a tournament."

Handles the sources resolved on 2026-06-09: the player the handle `jfe` belongs to has only an initial for a first name, so that entry stays handle-only; `MawTTM` is Matt W., `Spladow` is Thomas D., `pokermichi` is Michael Z. Slugs for players on the spine today: `kmikeym`, `beau-g`, `nick-m`, `chris-g`, `thomas-d`, `amy-m`, `drew-a`, `webvee`.

## 9. Rollout order

1. `tools/lib/archive.ts` and `tools/archive.test.ts`: types, vocabulary, `validateArchive`, one test per rule.
2. `renderArchive` and its render tests.
3. `render.ts` main, the drift and unfurl tests, the runbook section.
4. `recordQualifier` rewrite and the `backfillPending` retirement across data, type, tests, runbook, and CLAUDE.md.
5. `archive.json` typed from §8, validated, rendered; README section replaced.
6. One PR. Mike checks the names and the notes. Merge on his go.

Steps 1 through 4 need no real data and can be built and reviewed on synthetic fixtures. Step 5 is data entry and review.

## 10. Open questions for Mike

None block the build; all block the first file being complete.

1. **March 10, 2026.** `mawgators` is Matt W. (answered 2026-09-05). Still open: did six buy-ins mean six players? The game ships with its podium and chop note either way; `entrants` stays absent until answered.
2. **Bounty shares for April 14 and June 9, 2026.** Both notes mark them pending. The games ship with the bounties the notes do state (April: the bubble and Nick's Hope Slayer) and gain the rest when answered.
3. **December 2025.** If the result is remembered, it joins the season; otherwise the season note stands.
4. **2020 last initials.** Taken from the roster note; confirmed in the PR by reading the file.
