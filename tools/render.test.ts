import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  esc, recordQualifier, renderStandings, renderGamesIndex, renderNextGameIcs, secondTuesday,
  playerSlugs, renderPlayer, renderHopeCoin, coinHero, odometerTiles, routeLine, holdersSection,
  renderArchive,
} from "./render";
import { deriveStandings, type GamesData, type HopeCoinStop } from "./lib/standings";
import { TROPHIES, displayOrder, visibleTrophies } from "./lib/trophies";
import type { ArchiveData, ArchiveGame } from "./lib/archive";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-m", since: "2026-04-14" },
  players: [
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
    { slug: "chris-g", name: "Chris G.", aka: ["LEWD"] },
  ],
  games: [
    { date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      cardSet: "2026-07",
      results: [
        { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 2, trophies: [] },
      ] },
  ],
};

// Pulls out each standings row `<tr class="finish-N">...</tr>` block whole,
// in document order - the same non-greedy whole-block extraction pattern
// routeStopBlocks (below, for the Hope Coin journey) uses, so a test can
// check what lands INSIDE one row's own markup without a stray match
// bleeding in from a neighboring row.
function standingsRowBlocks(html: string): string[] {
  return [...html.matchAll(/<tr class="finish-\d+">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}

// The two "bare" <td>...</td> cells in a standings row - no class attribute
// - are the Player cell (first) and the Trophies cell (last); every other
// cell carries class="num". Takes one row block; returns [player, trophies]
// cell content. Reading the LAST bare cell for Trophies (rather than
// assuming there are exactly two and indexing [1]) means a test that only
// cares about the shelf never has to know how many bare cells came before
// it.
function bareCells(rowBlock: string): string[] {
  return [...rowBlock.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
}

// Locates one player's own row by their rendered name. The name always sits
// immediately before the anchor's closing tag (`>${esc(name)}</a>`, see
// renderStandings), so this is exact even when a champion gem or Coin mark
// follows in the same cell. Throws when no row matches - a test asking for
// a name that was never rendered is a broken fixture, not a passing
// assertion about absence.
function rowFor(html: string, name: string): string {
  const row = standingsRowBlocks(html).find((r) => r.includes(`>${name}</a>`));
  if (!row) throw new Error(`rowFor: no standings row rendered for "${name}"`);
  return row;
}

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
  test("states the record starts with its earliest game and links the archive", () => {
    expect(html).toContain(
      'This record starts with July 2026. Earlier games are in <a href="/archive/">the archive</a>.'
    );
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
  test("marks the current page in the nav and links the favicon", () => {
    expect(html).toContain('<a href="/standings/" aria-current="page">');
    expect(html).toContain('href="/favicon.svg"');
  });
  test("shows the trophy tiles", () => {
    expect(html).toContain("The Foil");
    expect(html).toContain('class="tiles"');
    expect(html).toContain("Chris G.");
  });
  test("skull tallies use drawn skulls, filled plus outline to three", () => {
    expect(html).toContain('class="mark mark--skull"');
    expect(html).toContain('class="mark mark--skull-empty"');
  });
  test("draws marks as svg, never emoji", () => {
    expect(html).not.toContain("\u{1FA99}");
    expect(html).toContain('class="mark');
  });
  test("declares its own canonical url for link unfurls", () => {
    expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/standings/">');
  });

  // Task 9 (spec §5.3): every row's name is the way into that player's own
  // page, and only that player's page.
  test("each row's name links to that player's own page, never a neighbor's (M1)", () => {
    const chrisRow = rowFor(html, "Chris G.");
    const nickRow = rowFor(html, "Nick M.");
    expect(chrisRow).toContain('<a href="/player/chris-g/">Chris G.</a>');
    expect(chrisRow).not.toContain("/player/nick-m/");
    expect(nickRow).toContain('<a href="/player/nick-m/">Nick M.</a>');
    expect(nickRow).not.toContain("/player/chris-g/");
    // The champion gem (Chris won 2026-07-14) and the Coin mark (Nick holds
    // it) still sit outside the anchor, exactly as they did before this
    // task - only the name itself moved inside a link.
    expect(chrisRow).toContain('</a> <svg class="mark mark--foil"');
    expect(nickRow).toContain('</a> <svg class="mark" viewBox="0 0 12 12" width="12" height="12" role="img" aria-label="Hope Coin">');
  });

  test("the Player cell is never a bare name with no enclosing anchor (M1)", () => {
    const rows = standingsRowBlocks(html);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [playerCell] = bareCells(row);
      expect(playerCell).toStartWith('<a href="/player/');
    }
  });

  test("Won is the second column, next to the name, because it is the first sort key (Mike, 2026-09-09)", () => {
    expect(html).toContain("<thead><tr><th>Player</th><th>Won</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Rebuys</th><th>Trophies</th></tr></thead>");
    for (const row of standingsRowBlocks(html)) {
      // The first classed cell after the Player anchor is the dollar figure.
      const firstNum = row.match(/<td class="num">([^<]*)<\/td>/)![1];
      expect(firstNum).toStartWith("$");
    }
  });

  test("the header carries a Trophies column, and every row carries exactly one Trophies cell (M2)", () => {
    expect(html).toContain("<th>Trophies</th>");
    const rows = standingsRowBlocks(html);
    for (const row of rows) {
      // Exactly two bare (unclassed) <td> cells per row: Player, then
      // Trophies. A row that dropped the Trophies cell would have only one
      // and silently shift every later column left - this catches that.
      expect(bareCells(row).length).toBe(2);
    }
  });

  test("the Hope Coin tile's heading links to /hope-coin/, and the Foil tile's champion sentence is byte-identical to what it rendered before this task (M4)", () => {
    // Pins the exact heading markup, not just "a link exists somewhere in
    // the tile" - deliberately strict. Moving the link into the paragraph
    // (to mirror the Foil tile's "The card set" sentence-link pattern,
    // say) or dropping it entirely both fail this line. That is the point:
    // whoever makes that change is expected to update this assertion in
    // the same commit, not discover afterward that nothing was guarding it.
    expect(html).toContain('<h3><a href="/hope-coin/">The Hope Coin</a>');
    // Pinned literal: this is the exact paragraph renderStandings produced
    // for the Foil tile before Task 9 touched this file, reproduced here
    // (GEM("foil")'s own markup, inlined, since GEM is not exported) so a
    // later edit to the shelf or the Hope Coin link cannot also quietly
    // reword or re-mark the champion sentence.
    expect(html).toContain(
      '<p><strong>Chris G.</strong> <svg class="mark mark--foil" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg> holds the foil: won 2026-07-14. <a href="/cards/2026-07/">The card set</a>.</p>'
    );
  });
});

// Task 9 (spec §5.3): the standings shelf itself - one mark per earned
// trophy in trophyCase's own display order, capped at six with a "+N"
// overflow marker. A fixture of its own because the shelf needs players
// spanning the exact boundary (six vs seven) and the two extremes (zero,
// eight) the main `data` fixture above was never built to reach.
//
// Every result below carries payout: 0 so no result accidentally earns
// cashed/clean-night/comeback (all three require payout > 0) - the point of
// each row is to earn EXACTLY the trophies this comment says it earns, not
// whatever a more realistic-looking game would also throw in.
// Five, not six: the sixth judged id, abels-triumph, is shown to Gene's
// slug alone (tools/lib/trophies.ts, `only`), so on any fixture player it
// would neither earn nor lock. And since 2026-09-05 every player who has a
// result at all earns chip-and-a-chair, so every fixture row below carries
// one more earned trophy than its judged ids alone would give.
const FIVE_JUDGED_IDS = [
  "hope-slayer", "two-seven-showdown", "final-countdown", "cain-and-abel", "kevin-deuce",
];
const shelfData: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "shelf-zero", since: "2026-06-01" },
  players: [
    { slug: "shelf-zero", name: "Zero Z.", aka: ["zero"] },
    { slug: "shelf-three", name: "Three T.", aka: ["three"] },
    { slug: "shelf-six", name: "Six S.", aka: ["six"] },
    { slug: "shelf-seven", name: "Seven S.", aka: ["seven"] },
    { slug: "shelf-eight", name: "Eight E.", aka: ["eight"] },
  ],
  games: [
    { date: "2026-07-14", hands: 100, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        // 2 judged ids + chip-and-a-chair (played) = 3 earned.
        { slug: "shelf-three", handle: "three", finish: 4, payout: 0, rebuys: 0,
          trophies: ["hope-slayer", "two-seven-showdown"] },
        // 5 judged ids + podium (finish 3) + chip-and-a-chair = 7 earned.
        { slug: "shelf-seven", handle: "seven", finish: 3, payout: 0, rebuys: 0, trophies: FIVE_JUDGED_IDS },
      ] },
    // shelf-zero: no judged ids, finish outside the podium/champion/bubble
    // thresholds, no rebuy, no payout - earns chip-and-a-chair and nothing
    // else, the least any player with a standings row can hold.
    { date: "2026-07-21", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-zero", handle: "zero", finish: 4, payout: 0, rebuys: 0, trophies: [] },
      ] },
    // 5 judged ids + chip-and-a-chair, no champion/podium (finish 5) =
    // exactly 6 earned - the cap's own boundary from below.
    { date: "2026-07-28", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-six", handle: "six", finish: 5, payout: 0, rebuys: 0, trophies: FIVE_JUDGED_IDS },
      ] },
    // The spine's latest game, so this is also where renderStandings finds
    // its reigning champion. finish 1 earns BOTH champion and podium, so
    // 5 judged ids + champion + podium + chip-and-a-chair = exactly 8
    // earned - two past the cap.
    { date: "2026-08-04", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-eight", handle: "eight", finish: 1, payout: 0, rebuys: 0, trophies: FIVE_JUDGED_IDS },
      ] },
  ],
};

describe("renderStandings trophy shelf (Task 9, spec §5.3)", () => {
  const html = renderStandings(shelfData);

  test("a fixture player with a known earned set renders exactly that many marks, in trophyCase display order (M2)", () => {
    const row = rowFor(html, "Three T.");
    const [, shelf] = bareCells(row);
    expect((shelf!.match(/<svg class="mark/g) ?? []).length).toBe(3);
    // Display order (metal foil, sapphire, copper, pewter; registry order
    // within a metal): hope-slayer (skull/foil), two-seven-showdown
    // (shield/sapphire), chip-and-a-chair (ribbon/pewter).
    const iSkull = shelf!.indexOf('mark--skull"');
    const iShield = shelf!.indexOf("mark--shield mark--sapphire");
    const iRibbon = shelf!.indexOf("mark--ribbon mark--pewter");
    expect(iSkull).toBeGreaterThan(-1);
    expect(iShield).toBeGreaterThan(iSkull);
    expect(iRibbon).toBeGreaterThan(iShield);
  });

  // Since 2026-09-05 no standings row can be empty: a row exists only for a
  // player with a result, and every result earns Chip and a Chair. The
  // floor is one pewter ribbon, and the cell is still always present.
  test("a player who earned nothing but Chip and a Chair gets a present cell with exactly that one mark (M2)", () => {
    const rows = standingsRowBlocks(html);
    expect(rows.length).toBe(5); // one per player on this fixture's roster
    for (const row of rows) expect(bareCells(row).length).toBe(2);
    const zeroRow = rowFor(html, "Zero Z.");
    const [, shelf] = bareCells(zeroRow);
    expect((shelf!.match(/<svg class="mark/g) ?? []).length).toBe(1);
    expect(shelf).toContain("mark--ribbon mark--pewter");
    expect(shelf).toContain('aria-label="Chip and a Chair"');
  });

  test("eight earned trophies renders six marks and a +2, three renders three marks and no + at all (M3)", () => {
    const eightShelf = bareCells(rowFor(html, "Eight E."))[1]!;
    expect((eightShelf.match(/<svg class="mark/g) ?? []).length).toBe(6);
    expect(eightShelf).toContain('<span class="shelf-more">+2</span>');

    const threeShelf = bareCells(rowFor(html, "Three T."))[1]!;
    expect((threeShelf.match(/<svg class="mark/g) ?? []).length).toBe(3);
    expect(threeShelf).not.toContain("shelf-more");
  });

  test("exactly six earned renders six marks and no +, exactly seven renders six marks and a +1 (M3, the boundary)", () => {
    const sixShelf = bareCells(rowFor(html, "Six S."))[1]!;
    expect((sixShelf.match(/<svg class="mark/g) ?? []).length).toBe(6);
    expect(sixShelf).not.toContain("shelf-more");

    const sevenShelf = bareCells(rowFor(html, "Seven S."))[1]!;
    expect((sevenShelf.match(/<svg class="mark/g) ?? []).length).toBe(6);
    expect(sevenShelf).toContain('<span class="shelf-more">+1</span>');
  });

  test("every shelf is wrapped in .shelf, and no em dash anywhere on the page (M6)", () => {
    expect(bareCells(rowFor(html, "Six S."))[1]).toStartWith('<span class="shelf">');
    expect(html).not.toContain("—");
  });

  // Final fix wave, item 5: every shelf mark used to be aria-hidden, so a
  // screen reader landed on the Trophies column and heard an empty cell
  // under a header that plainly is not empty. Three T.'s shelf (hope-slayer,
  // two-seven-showdown, chip-and-a-chair) exercises three different registry
  // names in one cell.
  test("each shelf mark carries an accessible name from the registry, and a matching title", () => {
    const shelf = bareCells(rowFor(html, "Three T."))[1]!;
    expect(shelf).not.toContain("aria-hidden");
    for (const name of ["Hope Slayer", "2-7 Showdown", "Chip and a Chair"]) {
      expect(shelf).toContain(`role="img" aria-label="${name}" title="${name}"`);
    }
    // The prefix Task 9's own mark-counting and mark-ordering tests above
    // match against (`<svg class="mark`, then the class names right after
    // it) must survive this fix untouched - it is what those tests actually
    // check, and this fix has no business moving it.
    expect((shelf.match(/<svg class="mark/g) ?? []).length).toBe(3);
    expect(shelf.indexOf("mark--shield mark--sapphire")).toBeGreaterThan(shelf.indexOf('mark--skull"'));
  });

  // The Coin is the one shape trophyMarkEarned already draws with its own
  // accessible name (role="img" aria-label="Hope Coin"), so its shelf mark
  // must gain a matching title without that label being overwritten by the
  // registry's longer "The Hope Coin" - a screen reader and a mouse hover
  // disagreeing about one mark's name would be its own small bug. A fixture
  // of its own: shelfData's players never hold the Coin, so this is the only
  // case that puts the hope-coin trophy inside a shelf cell at all.
  test("the Hope Coin's own shelf mark keeps its existing aria-label and only gains a title", () => {
    const coinData: GamesData = {
      nextGame: { date: "2026-09-08", time: "7:00pm PT" },
      hopeCoin: {
        holder: "coin-holder",
        since: "2026-07-14",
        history: [{ holder: "coin-holder", from: "2026-07-14", how: "Took it at the table." }],
      },
      players: [
        { slug: "coin-holder", name: "Coin H.", aka: ["coinh"] },
        // renderStandings needs a finish-1 result in the spine's latest game
        // to find its own reigning champion; giving that finish to a second
        // player, rather than coin-holder, is what keeps coin-holder's own
        // earned set down to exactly the Hope Coin (finish 4 of 4 earns
        // neither champion nor podium, and payout: 0 on both results means
        // no paid spot exists at all, so the-bubble's own rule - one finish
        // past the last paid spot - has no bubble to find either).
        { slug: "other", name: "Other O.", aka: ["other"] },
      ],
      games: [
        { date: "2026-07-14", hands: 100, startingStack: 5000, buyIn: 50, entries: 4, pot: 0,
          results: [
            { slug: "other", handle: "other", finish: 1, payout: 0, rebuys: 0, trophies: [] },
            { slug: "coin-holder", handle: "coinh", finish: 4, payout: 0, rebuys: 0, trophies: [] },
          ] },
      ],
    };
    const shelf = bareCells(rowFor(renderStandings(coinData), "Coin H."))[1]!;
    expect(shelf).toContain('role="img" aria-label="Hope Coin" title="Hope Coin"');
    expect(shelf).not.toContain("The Hope Coin");
  });
});

// The standings trophy legend (spec follow-up 2026-09-03, task 11): reads
// TROPHIES directly through displayOrder(), never a second list, so a
// sixteenth registry entry needs no edit to this file or to
// tools/render.ts's own trophyLegend(). `data` (top of this file) is a
// generic two-player fixture with nothing to do with trophies - deliberately
// reused here rather than a trophy-shaped fixture like shelfData above,
// because the legend's whole point is that it never varies with who earned
// what; it is one fixed key for the whole registry, not a per-player view.
describe("renderStandings trophy legend (spec follow-up 2026-09-03, task 11)", () => {
  const html = renderStandings(data);
  const tableEnd = html.indexOf("</table>");
  const legendMatch = /<ul class="trophy-legend">([\s\S]*?)<\/ul>/.exec(html);

  test("the legend exists, once, after the ledger table closes", () => {
    expect(tableEnd).toBeGreaterThan(-1);
    expect(legendMatch).not.toBeNull();
    expect(html.indexOf('<ul class="trophy-legend">')).toBeGreaterThan(tableEnd);
    // Exactly one legend on the page - two would mean this got called twice.
    expect(html.match(/<ul class="trophy-legend">/g)?.length).toBe(1);
  });

  // The central rule this task exists to enforce: the count comes from the
  // registry itself, not a number written into this test or the renderer.
  // Changing TROPHIES.length (adding or removing a trophy) must change this
  // test's own expectation without anyone editing the literal below.
  test("the legend has exactly one entry per registry trophy - the count tracks TROPHIES.length, never a hardcoded number", () => {
    const items = legendMatch![1]!.match(/<li>/g) ?? [];
    expect(items.length).toBe(TROPHIES.length);
    expect(TROPHIES.length).toBeGreaterThan(0); // sanity: a passing count of 0 would prove nothing
  });

  test("the legend names every trophy exactly once, in displayOrder()'s own order", () => {
    const names = [...legendMatch![1]!.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(names).toEqual(displayOrder().map((t) => t.name));
  });

  // Draws with the same helper the shelf and the trophy case use (never a
  // second SVG switch): every entry's mark is a real <svg class="mark ...">,
  // and it is drawn EARNED (never trophyMarkLocked's grey .mark--empty
  // outline) - the legend explains what a shape/metal means, not whether
  // anyone in particular has earned it.
  test("each entry pairs a real drawn mark with its name, drawn earned (not the locked/empty outline)", () => {
    const items = [...legendMatch![1]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
    expect(items.length).toBe(TROPHIES.length);
    for (const item of items) {
      expect(item).toContain('<svg class="mark');
      expect(item).not.toContain("mark--empty");
    }
  });

  test("no em dash, no btn-primary, inside the legend", () => {
    const body = legendMatch![1]!;
    expect(body).not.toContain("—");
    expect(body).not.toContain("btn-primary");
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
  test("states the record starts with its earliest game and links the archive", () => {
    expect(html).toContain(
      'This record starts with July 2026. Earlier games are in <a href="/archive/">the archive</a>.'
    );
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
  test("renders each played game as a season card with its stat line", () => {
    expect(html).toContain('class="season-card"');
    expect(html).toContain("3 entries · $150 pot · 201 hands");
  });
  test("links the month's card set when the game has one", () => {
    expect(html).toContain('href="/cards/2026-07/"');
  });
  test("marks the current page in the nav", () => {
    expect(html).toContain('<a href="/games/" aria-current="page">');
  });
  test("declares its own canonical url for link unfurls", () => {
    expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/games/">');
  });
});

describe("secondTuesday", () => {
  test("computes the standing schedule's dates", () => {
    expect(secondTuesday(2026, 9)).toBe("2026-09-08");
    expect(secondTuesday(2026, 10)).toBe("2026-10-13");
    expect(secondTuesday(2026, 11)).toBe("2026-11-10");
    expect(secondTuesday(2027, 1)).toBe("2027-01-12");
  });
});

describe("season page (renderGamesIndex)", () => {
  const html = renderGamesIndex(data);
  test("orders the season chronologically with played, next, upcoming", () => {
    const played = html.indexOf("2026-07-14");
    const next = html.indexOf("season-card--next");
    const upcoming = html.indexOf("season-card--upcoming");
    expect(played).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(played);
    expect(upcoming).toBeGreaterThan(next);
  });
  test("the next-game card is the page's only lime, on felt, with the date", () => {
    expect(html.split("btn-primary").length - 1).toBe(1);
    expect(html).toContain("season-card--next");
    expect(html).toContain("2026-09-08");
    expect(html).toContain("RSVP for Sept 8");
  });
  test("played cards carry the podium from the record", () => {
    expect(html).toContain('class="podium"');
    expect(html).toContain("Chris G.");
    expect(html).toContain("$105");
    expect(html).toContain("Nick M.");
  });
  test("upcoming cards derive from the standing rule and say so", () => {
    expect(html).toContain("2026-10-13");
    expect(html).toContain("2026-11-10");
    expect(html).toContain("Second Tuesday, per the standing schedule");
  });
  test("links the calendar file", () => {
    expect(html).toContain('href="/next-game.ics"');
  });
});

describe("renderNextGameIcs", () => {
  const ics = renderNextGameIcs(data);
  test("is a deterministic VEVENT for the next game at 7pm Pacific", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20260908T190000");
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20260908T220000");
    expect(ics).toContain("UID:poker-kmikeym-2026-09-08");
    expect(ics).toContain("DTSTAMP:20260908T000000Z");
    expect(ics).toContain("URL:https://poker.kmikeym.com/");
  });
});

// Issue #12: esc() feeds double-quoted attributes (description, og:title) in
// page(), so a double quote in a value must come out as &quot; or it would
// end the attribute early. Every current caller passes a literal, which is
// why nothing broke; this makes the function safe for the first non-literal.
describe("esc", () => {
  test("escapes the double quote along with the three angle-bracket characters", () => {
    expect(esc('Dee "Ace" O\'B & <co>')).toBe("Dee &quot;Ace&quot; O'B &amp; &lt;co&gt;");
  });
});

// Issue #3 / issue #39: the "record starts with" line used to be a hardcoded
// string, so adding an earlier game to the spine would have left the
// standings page claiming the record starts later than it actually does. The
// month comes from the earliest game on the spine, whatever order games.json
// lists them in. It used to also carry a second sentence naming seasons a
// pending-seasons list said were still missing, trimmed by hand in the same
// commit as each such season's game; that list is retired in favor of a
// permanent link to the archive page, so the sentence never goes stale.
describe("recordQualifier", () => {
  // Three games in date order 2026-08-11, 2026-04-14, 2026-07-14 - the
  // earliest is neither first nor last in the array - so a reader of
  // games[0] or games[games.length - 1] fails this.
  const shuffled: GamesData = {
    ...data,
    games: [
      { date: "2026-08-11", hands: 150, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
        results: [
          { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
        ] },
      { date: "2026-04-14", hands: 150, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
        results: [
          { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
        ] },
      { date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
        cardSet: "2026-07",
        results: [
          { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
          { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 2, trophies: [] },
        ] },
    ],
  };

  test("takes the start month from the earliest game, whatever order games.json lists them in", () => {
    expect(recordQualifier(shuffled)).toBe(
      'This record starts with April 2026. Earlier games are in <a href="/archive/">the archive</a>.'
    );
  });
  test("a single game on the spine names its own month", () => {
    expect(recordQualifier(data)).toBe(
      'This record starts with July 2026. Earlier games are in <a href="/archive/">the archive</a>.'
    );
  });
  test("throws when the spine has no games", () => {
    expect(() => recordQualifier({ ...data, games: [] })).toThrow();
  });
  test("never says backfilled and links the archive exactly once", () => {
    const q = recordQualifier(shuffled);
    expect(q).not.toContain("backfilled");
    expect(q.split('<a href="/archive/">').length - 1).toBe(1);
  });
});

// Player pages (task 7 of the 2026-09-02 player-pages-trophies-hope-coin
// plan). A fixture kept separate from `data` above rather than extended in
// place, per the task brief, so this describe block can carry things the
// shared standings/games fixture does not need: a player carded across two
// sets, an uncarded player, a player who missed a game, a roster member
// with zero games, a bio on one player and not the other, and a Hope Coin
// stop with no `from` (the count-without-a-date edge case trophies.ts calls
// out by name).
//
// Trophy math worked by hand against tools/lib/trophies.ts's registry and
// rules (15 entries total):
//   nick-m played all three games (07-14, 08-11, 09-08): earns champion
//   (won 08-11, count 1), hope-coin (holds it from 08-11, count 1), podium
//   (finished top 3 all three times, count 3), cashed (07-14 and 08-11,
//   count 2), clean-night (07-14, no rebuy, count 1), comeback (08-11, one
//   rebuy, count 1), regular (played all three spine games back to back,
//   count 3), chip-and-a-chair (played all three, count 3) - 8 earned, 6
//   locked (hope-slayer and the four judged shield trophies he can see,
//   plus the-bubble, since neither game he cashed in had a bubble seat and
//   09-08 has zero paid spots). 14 tiles, not 15: abels-triumph is Gene's
//   alone and never appears on another player's page.
//   chris-g played 07-14 and 08-11 only (missed 09-08): earns hope-slayer
//   (judged, on his 07-14 result), champion (won 07-14, count 1), hope-coin
//   (his one stop has no `from`, so count 1 with an EMPTY dates array),
//   podium (top 3 both games, count 2), cashed (07-14 only, count 1),
//   clean-night (07-14, count 1), chip-and-a-chair (both games, count 2) -
//   7 earned, 7 locked (the four judged shield trophies he can see,
//   comeback since he never rebought into a cash, regular since his run is
//   only two games, and the-bubble since neither game put him one out).
const pdata: GamesData = {
  nextGame: { date: "2026-10-13", time: "7:00pm PT" },
  hopeCoin: {
    holder: "nick-m",
    since: "2026-08-11",
    history: [
      // No `from`: nobody recorded exactly when Chris's tenure started, so
      // this stop earns him the trophy (count 1) with nothing in `dates`.
      { holder: "chris-g", to: "2026-08-11", how: "Held since before anyone tracked it." },
      { holder: "nick-m", from: "2026-08-11", how: "Third skull on Chris G." },
    ],
  },
  players: [
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
    {
      slug: "chris-g", name: "Chris G.", aka: ["LEWD"],
      bio: "Runs deep most nights and cashed twice this season.",
    },
    // On the roster, never on the spine: proves playerSlugs excludes a
    // player with zero results even though they exist in `players`.
    { slug: "beau-g", name: "Beau G.", aka: ["bg"] },
  ],
  games: [
    {
      date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      cardSet: "2026-07", cardSetName: "The Founder's Table",
      results: [
        { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 0, trophies: [],
          card: { metal: "sapphire", file: "card-2-nick.png", title: "2nd, holds the Coin" } },
      ],
    },
    {
      date: "2026-08-11", hands: 180, startingStack: 5000, buyIn: 50, entries: 3, pot: 200,
      cardSet: "2026-08", cardSetName: "Wire to Wire",
      results: [
        { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 150, rebuys: 1, trophies: [],
          card: { metal: "foil", file: "card-1-nick.png", title: "Champion" } },
        { slug: "chris-g", handle: "LEWD", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
    {
      // No cardSet yet (a set still in production); chris-g sat this one
      // out, which is the fixture's "missed a game" case.
      date: "2026-09-08", hands: 150, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        { slug: "nick-m", handle: "nickmershon", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
  ],
};

describe("playerSlugs", () => {
  test("returns exactly the players with a result on the spine, and no other slug", () => {
    const slugs = playerSlugs(pdata);
    expect(slugs).toContain("nick-m");
    expect(slugs).toContain("chris-g");
    expect(slugs).not.toContain("beau-g"); // on the roster, zero games
    expect(slugs.length).toBe(2);
  });
});

describe("renderPlayer", () => {
  const nick = renderPlayer(pdata, "nick-m");
  const chris = renderPlayer(pdata, "chris-g");

  test("is a full document whose heading is the player's name and whose stat line names their handles", () => {
    expect(nick).toStartWith("<!doctype html>");
    expect(nick).toContain('<h1 class="display">Nick M.</h1>');
    expect(nick).toContain("nickmershon");
    expect(chris).toContain('<h1 class="display">Chris G.</h1>');
    expect(chris).toContain("LEWD");
  });

  test("renders one figure per carded set, newest first, at the real asset path, with a Tier . Title . Set caption", () => {
    const newer = nick.indexOf("/cards/2026-08/assets/card-1-nick.png");
    const older = nick.indexOf("/cards/2026-07/assets/card-2-nick.png");
    expect(newer).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(-1);
    expect(newer).toBeLessThan(older);
    expect(nick).toContain("Foil · Champion · Wire to Wire");
    expect(nick).toContain("Rare · 2nd, holds the Coin · The Founder's Table");
  });

  test("the newest card carries the holo frame when it is foil", () => {
    expect(nick).toContain('class="card-frame card-frame--holo shimmer"');
  });

  test("a player with no card renders no gallery and no placeholder", () => {
    expect(chris).not.toContain("card-gallery");
    expect(chris).not.toContain("<img");
  });

  // 2026-09-04 (Mike): a card on the player page can be selected for a
  // bigger view. The enlarge behaviour lives in site/card-zoom.js, the same
  // script the set pages load; the renderer only has to include it whenever
  // a gallery is on the page, and pay nothing for it when there is none.
  test("a carded player page loads the card zoom script", () => {
    expect(nick).toContain('<script src="/card-zoom.js" defer></script>');
  });
  test("an uncarded player page does not load the card zoom script", () => {
    expect(chris).not.toContain("card-zoom.js");
  });

  test("renders one tile per registry entry this player can see, every earned tile before every locked tile", () => {
    const tiles = nick.match(/<div class="trophy( trophy--locked)?">/g) ?? [];
    expect(tiles.length).toBe(visibleTrophies("nick-m").length);
    expect(tiles.length).toBe(TROPHIES.length - 1); // abels-triumph is Gene's alone
    expect(nick).not.toContain("Abel's Triumph");
    expect(nick).toContain("<h3>Cain and Abel</h3>");
    const lastEarned = nick.lastIndexOf('<div class="trophy">');
    const firstLocked = nick.indexOf('<div class="trophy trophy--locked">');
    expect(lastEarned).toBeGreaterThan(-1);
    expect(firstLocked).toBeGreaterThan(-1);
    expect(lastEarned).toBeLessThan(firstLocked);
  });

  test("an earned count above one renders xN; a count of one renders no x marker", () => {
    expect(nick).toContain("<h3>Cashed</h3>"); // cashed twice (07-14, 08-11)
    expect(nick).toContain("x2 · 2026-08-11");
    expect(nick).toContain("<h3>Chip and a Chair</h3>"); // played all three nights
    expect(nick).toContain("x3 · 2026-09-08");
    expect(nick).toContain("<h3>Champion</h3>"); // won once
    expect(nick).not.toContain("x1"); // never renders for a count of one, anywhere on the page
  });

  test("a locked tile shows the trophy's earn line", () => {
    expect(nick).toContain("Reach showdown holding 7-2 with five or more players at the table.");
  });

  // 2026-09-05 bug (a visitor, via Mike): an earned tile showed only its
  // count and date, so nobody could tell what a trophy they HAD was for. The
  // earn line now appears on every tile, earned or locked, exactly once.
  test("an earned tile shows the trophy's earn line as well as its date", () => {
    // Nick won 2026-08-11 in the fixture, so Champion is an earned tile:
    // class="trophy" with no --locked modifier.
    const champion = nick.match(/<div class="trophy">\s*<svg[\s\S]*?<h3>Champion<\/h3>[\s\S]*?<\/div>/);
    expect(champion).not.toBeNull();
    expect(champion![0]).toContain("Win a game.");
    expect(champion![0]).toContain("2026-08-11");
  });
  test("a locked tile carries its earn line once, not twice", () => {
    const line = "Reach showdown holding 7-2 with five or more players at the table.";
    expect(nick.split(line).length - 1).toBe(1);
  });

  test("the Hope Coin can be earned with a count and an empty dates array, and renders no placeholder date", () => {
    // Chris's one stop has no `from`, so trophyCase gives him count 1 with
    // dates: []. The tile must not crash, must not print "x1" (count is
    // exactly one), and must not invent a date to fill the empty list.
    const idx = chris.indexOf("<h3>The Hope Coin</h3>");
    expect(idx).toBeGreaterThan(-1);
    const tileEnd = chris.indexOf("</div>", idx);
    const tile = chris.slice(idx, tileEnd).trim();
    // Since 2026-09-05 every tile carries its earn line, so the text block
    // is name + earn line and, with no count above one and no date, NO
    // meta line at all (not an empty one, not a placeholder).
    expect(tile).toBe('<h3>The Hope Coin</h3>\n          <p class="trophy-earn">Take the Hope Coin.</p>');
    expect(tile).not.toContain("x1");
    expect(tile).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("renders one ledger row per game played, newest first, each linking its game, plus a totals row", () => {
    expect(nick).toContain('href="/games/2026-09-08/"');
    expect(nick).toContain('href="/games/2026-08-11/"');
    expect(nick).toContain('href="/games/2026-07-14/"');
    const d3 = nick.indexOf("2026-09-08/");
    const d2 = nick.indexOf("2026-08-11/");
    const d1 = nick.indexOf("2026-07-14/");
    expect(d3).toBeLessThan(d2);
    expect(d2).toBeLessThan(d1);
    // Total payout: 45 (07-14) + 150 (08-11) + 0 (09-08) = 195.
    expect(nick).toContain('<td>Total</td>');
    expect(nick).toContain('<td class="num">$195</td>');
  });

  test("renders no row and no link for a game the player missed", () => {
    expect(chris).not.toContain('href="/games/2026-09-08/"');
    expect(chris).not.toContain("2026-09-08");
  });

  test("renders the bio paragraph when the player has one and no analysis block at all when they do not", () => {
    expect(chris).toContain("Runs deep most nights and cashed twice this season.");
    expect(nick).not.toContain("Runs deep most nights");
    expect(nick).not.toContain("No bio");
    expect(nick).not.toContain("no bio");
  });

  test("carries og:url, og:type, og:image, marks Standings current, no em dash, no btn-primary", () => {
    expect(nick).toContain('<meta property="og:url" content="https://poker.kmikeym.com/player/nick-m/">');
    expect(nick).toContain('<meta property="og:type" content="website">');
    // Carded: og:image is the newest card (08-11's foil card), not the site default.
    expect(nick).toContain('<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-08/assets/card-1-nick.png">');
    // Uncarded: og:image falls back to the existing site default, unchanged.
    expect(chris).toContain('<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png">');
    expect(nick).toContain('href="/standings/" aria-current="page"');
    expect(chris).toContain('href="/standings/" aria-current="page"');
    expect(nick).not.toContain("—");
    expect(nick).not.toContain("btn-primary");
  });
});

// The Hope Coin page (task 8 of the 2026-09-02 player-pages-trophies-hope-
// coin plan). A fixture of its own, per the task brief, because the real
// data's hopeCoin.history holds exactly one stop and this renderer has to
// already handle the multi-stop history that arrives later:
//
//   gene    - no `from` (nobody remembers when his tenure began), `to`
//             2025-06-01, no `place`. Exercises the "first stop with no
//             from" wording, which borrows chris-g's `from` below rather
//             than inventing a date of its own.
//   chris-g - a closed stop, 2025-06-01 to 2026-04-14, WITH a `place`.
//             Exercises the "closed stop" span wording and the "place
//             present" case.
//   nick-m  - the current stop, from 2026-04-14, no `to`, no `place`.
//             Exercises the "since" wording and the "no place" case, and
//             matches the real data's holder and since date so this
//             fixture's current stop reads the same as the live one will.
//
// nick-m also carries three "hope-slayer" trophies on the games below -
// the three kills on chris-g that the spec's mechanic says takes the coin -
// so deriveStandings computes a real, non-zero skull tally for the CURRENT
// holder's own slug, not just some other challenger's. That is what lets
// the M2 test below check the coin page's holder-tile skull text against
// the identical text renderStandings computes for that same slug, rather
// than two numbers that merely happen to both be zero.
const hcData: GamesData = {
  nextGame: { date: "2026-10-13", time: "7:00pm PT" },
  hopeCoin: {
    holder: "nick-m",
    since: "2026-04-14",
    history: [
      { holder: "gene", to: "2025-06-01", how: "Held it since before anyone kept records." },
      {
        holder: "chris-g", from: "2025-06-01", to: "2026-04-14", place: "The Felt Room",
        how: "Lost the third skull to Nick.",
      },
      { holder: "nick-m", from: "2026-04-14", how: "Took the coin on the third skull." },
    ],
  },
  players: [
    { slug: "gene", name: "Gene V.", aka: ["gene"] },
    { slug: "chris-g", name: "Chris G.", aka: ["LEWD"] },
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
  ],
  games: [
    { date: "2026-01-13", hands: 150, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
      ] },
    { date: "2026-02-10", hands: 160, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
      ] },
    { date: "2026-03-10", hands: 170, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
      ] },
  ],
};

// Pulls out each `.route-stop` `<li>...</li>` block whole, in document
// order, so tests below can check what lands INSIDE one stop's own markup
// (its `how` sentence, its place-or-not) without a stray match from a
// neighboring stop - the blocks never nest, so a non-greedy match to the
// next `</li>` is exact, not an approximation.
function routeStopBlocks(html: string): string[] {
  return [...html.matchAll(/<li class="route-stop(?: route-stop--current)?">[\s\S]*?<\/li>/g)].map((m) => m[0]);
}

describe("renderHopeCoin", () => {
  const html = renderHopeCoin(hcData);
  const standingsHtml = renderStandings(hcData);

  test("M1: is a full document that says what the Coin is and that three kills on the holder takes it", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("The Hope Coin is the game's traveling trophy");
    // Beau's chain of custody (2026-09-05): the coin went to each season's
    // champion until mid-2024 and has moved on the third skull since. The
    // intro says so, because the journey below it shows both eras.
    expect(html).toContain("went to each season's champion until mid-2024");
    expect(html).toContain("third skull");
    expect(html).toContain("Three kills on the holder takes it.");
  });

  test("M2: shows the current holder, their since date, and the identical skull text standings renders for that slug", () => {
    const s = deriveStandings(hcData);
    expect(s.hopeCoin.holder).toBe("nick-m");
    const n = s.hopeCoin.skulls["nick-m"];
    // Sanity on the fixture itself: this leg is only meaningful if the
    // CURRENT holder is the slug carrying a non-zero tally, not some
    // unrelated challenger who merely happens to also read "0 of 3".
    expect(n).toBeGreaterThan(0);
    const skullText = `<span class="stat">${n} of 3</span> skulls`;
    expect(html).toContain("Nick M.");
    expect(html).toContain(hcData.hopeCoin.since);
    expect(html).toContain(skullText);
    expect(standingsHtml).toContain(skullText);
  });

  test("M3: one route-stop per history entry, oldest first, in document order", () => {
    const tags = html.match(/<li class="route-stop(?: route-stop--current)?">/g) ?? [];
    expect(tags.length).toBe(3);
    const names = [...html.matchAll(/<li class="route-stop(?: route-stop--current)?">\s*<p><strong>([^<]+)<\/strong>/g)]
      .map((m) => m[1]);
    expect(names).toEqual(["Gene V.", "Chris G.", "Nick M."]);
  });

  test("M3: each stop's own how sentence lands inside its own stop's markup, not a neighbor's", () => {
    const blocks = routeStopBlocks(html);
    expect(blocks.length).toBe(3);
    expect(blocks[0]).toContain("Held it since before anyone kept records.");
    expect(blocks[1]).toContain("Lost the third skull to Nick.");
    expect(blocks[2]).toContain("Took the coin on the third skull.");
  });

  test("M3: a stop with a place shows it, and a stop without one adds no place element at all", () => {
    const blocks = routeStopBlocks(html);
    expect(blocks[1]).toContain("The Felt Room");
    // gene and nick-m carry no `place`; their blocks must carry no <p
    // class="stat"> at all (their date phrase is a <span>, not a <p>), so
    // this also rules out an empty placeholder paragraph standing in for
    // the missing place.
    expect(blocks[0]).not.toContain('<p class="stat">');
    expect(blocks[2]).not.toContain('<p class="stat">');
  });

  test("M4: a closed stop reads a month-to-month span, the current stop reads since, and a from-less first stop reads before the next stop's month", () => {
    const blocks = routeStopBlocks(html);
    expect(blocks[0]).toContain("before June 2025"); // gene: no from; chris-g's from is 2025-06-01
    expect(blocks[1]).toContain("June 2025 to April 2026"); // chris-g: 2025-06-01 to 2026-04-14
    expect(blocks[2]).toContain("since April 2026"); // nick-m: from 2026-04-14, current
  });

  // A month-only stop date (YYYY-MM, allowed since 2026-09-05 for handoffs
  // the record knows only to the month) prints exactly as a full date does:
  // month and year. Pins the date helper's behaviour on the shorter string
  // so a future "parse the day" change cannot start printing "undefined".
  test("a month-only closed stop prints month and year on both ends", () => {
    const monthOnly = renderHopeCoin({
      ...hcData,
      hopeCoin: {
        holder: "nick-m", since: "2026-04-14",
        history: [
          { holder: "chris-g", to: "2022-04", how: "Where it started." },
          { holder: "beau-g", from: "2022-04", to: "2022-07", how: "Season champion." },
          { holder: "nick-m", from: "2022-07", to: "2026-04-14", how: "Season champion." },
          { holder: "nick-m", from: "2026-04-14", how: "Third skull." },
        ],
      },
    });
    expect(monthOnly).toContain("April 2022 to July 2022");
    expect(monthOnly).toContain("before April 2022");
    expect(monthOnly).not.toContain("undefined");
    expect(monthOnly).not.toContain("NaN");
  });

  // Round 1 review: this branch is not hypothetical. validateCoinHistory
  // (tools/lib/hope-coin.ts, rule 4) explicitly permits a history whose
  // only stop is simultaneously first and last with no `from` at all
  // ("nobody remembers when this reign began, and there is no later stop
  // to compare `since` against either"). It is exactly the shape the first
  // remembered-from-memory stop will arrive in once Mike appends one whose
  // start date he cannot pin down - the explicit next step for this page.
  // "Never invent a date" is the whole point of this task, so the one
  // branch that guards the least-constrained case (no `from`, and no next
  // stop to borrow one from either) gets its own fixture rather than
  // riding along on hcData, where every stop already has a real date.
  test("M4: a solo stop with no from and no next stop to borrow from renders no date phrase at all", () => {
    const soloData: GamesData = {
      nextGame: { date: "2026-10-13", time: "7:00pm PT" },
      hopeCoin: {
        holder: "nick-m",
        since: "2026-04-14",
        history: [
          { holder: "nick-m", how: "Held it since before anyone kept records." },
        ],
      },
      players: [{ slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] }],
      games: [],
    };
    const solo = renderHopeCoin(soloData);
    const blocks = routeStopBlocks(solo);
    expect(blocks.length).toBe(1);
    // Still marked current (it is the last, and only, stop) even though it
    // has no date phrase to show.
    expect(blocks[0]).toContain("route-stop--current");
    // No <span class="stat"> at all - not an empty one, not a guessed date.
    expect(blocks[0]).not.toContain('<span class="stat">');
    expect(blocks[0]).toContain("Held it since before anyone kept records.");
  });

  test("M5: exactly one stop is marked current, and it is the last one", () => {
    expect(html.split("route-stop--current").length - 1).toBe(1);
    const blocks = routeStopBlocks(html);
    expect(blocks[2]).toContain("route-stop--current");
    expect(blocks[0]).not.toContain("route-stop--current");
    expect(blocks[1]).not.toContain("route-stop--current");
  });

  test("M6: carries og:url, og:type, marks Standings current, no em dash, no btn-primary", () => {
    expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/hope-coin/">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('href="/standings/" aria-current="page"');
    expect(html).not.toContain("—");
    expect(html).not.toContain("btn-primary");
  });

  // Task 5 (#48), M1, leg (f): the page's first band-light section opens
  // straight into the coin grid - nothing (not even whitespace-adjacent
  // markup) gets to stand ahead of the coin photo, and "coin-figure" itself
  // must not appear anywhere earlier in the document (the masthead, an
  // og:image URL, a stray comment). A page that puts any element ahead of
  // the grid or the coin in an earlier block - the old heading-first layout,
  // say - fails this exact test.
  test("M1 leg (f): the first band-light section opens directly into the coin grid, coin-figure appears nowhere before it", () => {
    const sectionIdx = html.indexOf('<section class="band-light">');
    expect(sectionIdx).toBeGreaterThan(-1);
    const afterSection = html.slice(sectionIdx);
    const opener = /^<section class="band-light">\s*<div class="band-inner">\s*<div class="cols">\s*<figure class="coin-figure">/;
    expect(opener.test(afterSection)).toBe(true);
    expect(html.indexOf("coin-figure")).toBeGreaterThan(sectionIdx);
  });

  // Task 5 (#48), M1, leg (a) second half: the grid coinHero() returns is
  // what actually lands in the page, ahead of "The journey" - not a second,
  // divergent copy of the same markup.
  test("M1 leg (a): renderHopeCoin places coinHero's own markup before The journey heading", () => {
    const hero = coinHero(hcData);
    const heroIdx = html.indexOf(hero);
    const journeyIdx = html.indexOf('<h2 class="rule-label">The journey</h2>');
    expect(heroIdx).toBeGreaterThan(-1);
    expect(journeyIdx).toBeGreaterThan(heroIdx);
  });

  // Task 5 (#48), M2: the coin's own hero photo now unfurls every share of
  // /hope-coin/, replacing the "current holder's newest card" og:image the
  // two tests below used to pin (that was the final fix wave's own fix for
  // "every unfurl showed page()'s DEFAULT_OG_IMAGE no matter who held the
  // Coin" - a real improvement over the site default, but still a card, on
  // a page about a coin). newestCardImage() stays in tools/render.ts for the
  // player pages, which still want a player's own newest card - it is simply
  // no longer this page's `image` option. The carded-holder fixture below is
  // the same shape the old M7 test built, reused here as the case that
  // failed before this task landed: it used to carry a `/cards/` og:image,
  // and after this task it must not.
  test("M2: og:image is the coin's own unfurl image for an uncarded holder, never a /cards/ URL", () => {
    expect(html).toContain(
      '<meta property="og:image" content="https://poker.kmikeym.com/hope-coin/assets/coin-og.png">'
    );
    expect(html).not.toMatch(/og:image" content="https:\/\/poker\.kmikeym\.com\/cards\//);
  });

  test("M2: og:image stays the coin's own unfurl image even when the current holder HAS a card", () => {
    // nick-m carries no card anywhere in hcData, so this fixture (identical
    // to the old M7 test's) is what actually exercises the "holder has a
    // card" branch of newestCardImage() - proving this page's og:image no
    // longer reaches for it, not merely that hcData never triggered it.
    const cardedData: GamesData = {
      ...hcData,
      games: [
        ...hcData.games,
        {
          date: "2026-04-14", hands: 190, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
          cardSet: "2026-04", cardSetName: "Spring Table",
          results: [
            { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: [],
              card: { metal: "foil", file: "card-1-nick-m.png", title: "Champion" } },
            { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
          ],
        },
      ],
    };
    const cardedHtml = renderHopeCoin(cardedData);
    expect(cardedHtml).toContain(
      '<meta property="og:image" content="https://poker.kmikeym.com/hope-coin/assets/coin-og.png">'
    );
    expect(cardedHtml).not.toMatch(/og:image" content="https:\/\/poker\.kmikeym\.com\/cards\//);
  });

  // M8 (spec follow-up 2026-09-03, task 11): hopeCoin.historyPending. The
  // real hopeCoin.history's earliest stop is the only one the record can
  // currently date, but the Coin is older than that - Mike is reconstructing
  // its earlier stops from memory. This flag is the ONLY thing that puts a
  // sentence saying so on the page, mirroring recordQualifier's own derived
  // sentence (top of this file) so a hardcoded line can never survive on the
  // page after the data underneath it changes.
  // hcData itself carries no historyPending, so `html` (already built above,
  // from hcData) is this test's "flag absent" case; only the "flag true"
  // case below needs its own variant.
  const SENTENCE =
    "The journey starts with the stop the record can date. The Coin is older than that, and its earlier stops are being reconstructed.";

  test('M8: with historyPending true, the owner\'s sentence appears verbatim under "The journey" heading, above the route', () => {
    const pendingHtml = renderHopeCoin({
      ...hcData,
      hopeCoin: { ...hcData.hopeCoin, historyPending: true },
    });
    expect(pendingHtml).toContain(SENTENCE);
    const headingIdx = pendingHtml.indexOf('<h2 class="rule-label">The journey</h2>');
    const sentenceIdx = pendingHtml.indexOf(SENTENCE);
    const routeIdx = pendingHtml.indexOf('<ol class="route">');
    expect(headingIdx).toBeGreaterThan(-1);
    expect(sentenceIdx).toBeGreaterThan(headingIdx);
    expect(routeIdx).toBeGreaterThan(sentenceIdx);
  });

  // The test that actually matters (task 11's own framing): a line that
  // cannot disappear is the bug this design exists to prevent. hcData
  // carries no historyPending at all - the state the flag is in BOTH before
  // it is ever set and after Charlie deletes it once the history is
  // finished - so this is the one case standing between "derived" and "a
  // sentence someone forgot to delete."
  test("M8: with historyPending absent, the sentence never appears at all", () => {
    expect(html).not.toContain(SENTENCE);
    expect(html).not.toContain("being reconstructed");
  });

  // Same absence, checked explicitly for `historyPending: false` too - the
  // type allows it even though docs/publishing.md's own convention is
  // "delete the field, never flip it to false" (so a reader never has to
  // guess what a lingering `false` means); this proves the renderer treats
  // that value the same as absent rather than only ever having been tested
  // against `undefined`.
  test("M8: with historyPending explicitly false, the sentence still never appears", () => {
    const falseHtml = renderHopeCoin({
      ...hcData,
      hopeCoin: { ...hcData.hopeCoin, historyPending: false },
    });
    expect(falseHtml).not.toContain(SENTENCE);
  });
});

// Task 5 (#48): coinHero(data) is the grid that opens the Hope Coin page -
// the coin's own photo beside the copy that used to open the page on its
// own (the display heading, the "what is the Coin" paragraph, the holder
// tile). Exported on its own (the task's Interface) so these tests can
// check the grid's shape directly, without also parsing the rest of the
// document renderHopeCoin returns.
describe("coinHero (Task 5, #48)", () => {
  const hero = coinHero(hcData);

  test("M1: opens with the cols grid, whose first child is the coin figure holding the framed, captioned coin image", () => {
    expect(hero).toStartWith('<div class="cols">');
    const figureIdx = hero.indexOf('<figure class="coin-figure">');
    expect(figureIdx).toBeGreaterThan(-1);
    // Nothing but the grid opener and whitespace stands ahead of the figure.
    expect(hero.slice(0, figureIdx).replace(/\s/g, "")).toBe('<divclass="cols">');

    // The framed image: the right source, both dimensions, and a real alt
    // (non-empty, so a screen reader gets something other than a blank).
    const img = /<div class="coin-frame"><img src="\/hope-coin\/assets\/coin\.png" width="900" height="900" alt="([^"]+)">/
      .exec(hero);
    expect(img).not.toBeNull();
    expect(img![1].trim().length).toBeGreaterThan(0);

    // The caption, verbatim - Beau's own words for what the coin's engraving
    // says about itself, quoted exactly rather than paraphrased.
    expect(hero).toContain(
      '<figcaption class="stat">It\'s not the cards, it\'s the player. The coin shows 7-2, the hand with its own bounty.</figcaption>'
    );
  });

  test("M1: the grid's second child carries the display heading, then the intro paragraph, then the holder tile, in that order", () => {
    const figureCloseIdx = hero.indexOf("</figure>");
    const headingIdx = hero.indexOf('<h1 class="display">The Hope Coin');
    const introIdx = hero.indexOf("The Hope Coin is the game's traveling trophy");
    const tileIdx = hero.indexOf('<div class="tile">');
    expect(figureCloseIdx).toBeGreaterThan(-1);
    // All three land after the coin figure closes - inside the grid's
    // SECOND child, not stuffed into the figure itself.
    expect(headingIdx).toBeGreaterThan(figureCloseIdx);
    expect(introIdx).toBeGreaterThan(headingIdx);
    expect(tileIdx).toBeGreaterThan(introIdx);
  });

  test("M1: still shows the current holder, their since date, and a real skull tally - the tile this grid carries forward unchanged", () => {
    const s = deriveStandings(hcData);
    expect(hero).toContain("Nick M.");
    expect(hero).toContain(hcData.hopeCoin.since);
    expect(hero).toContain(`<span class="stat">${s.hopeCoin.skulls["nick-m"]} of 3</span> skulls`);
  });

  test("M5: the grid's own markup carries no em dash and no btn-primary", () => {
    expect(hero).not.toContain("—");
    expect(hero).not.toContain("btn-primary");
  });
});

// Task 6 (#48): odometerTiles(data) and the leg labels in the journey list.
// A synthetic five-stop chain of its own, per the task brief (invented
// slugs, small integers for miles, one stop with a two-name route), rather
// than reusing hcData above - these tests need small, exact numbers whose
// sums and maxima are easy to hand-check, and a route/place overlap hcData
// does not carry.
//
//   ada-w - first stop, no milesIn (nobody remembers what leg brought the
//           Coin here in the first place - see the HopeCoinStop comment in
//           lib/standings.ts), place "Anchorage".
//   bly-r - milesIn 12, place "Yukon" - the SAME name as one of cly-d's
//           route waypoints below, on purpose: the Places tile must count
//           it once, not twice.
//   cly-d - milesIn 8, milesHeld 40 with a two-name route ["Yukon",
//           "Cassiar Highway"] - the RV stint, and (with every milesIn kept
//           small) the fixture's single longest leg.
//   dre-k - no milesIn at all: the fixture's one unmeasured leg. Its own
//           place, "On the road to Reno", begins "On the road" and must
//           not count toward the Places tile.
//   eli-n - milesIn 25, place "Fresno", the current stop.
const odoChain: HopeCoinStop[] = [
  { holder: "ada-w", to: "2024-01-01", place: "Anchorage",
    how: "Held it since before anyone kept records." },
  { holder: "bly-r", from: "2024-01-01", to: "2024-03-01", place: "Yukon", milesIn: 12,
    how: "Handed it off on the road north." },
  { holder: "cly-d", from: "2024-03-01", to: "2024-06-01", milesIn: 8, milesHeld: 40,
    route: ["Yukon", "Cassiar Highway"], how: "Drove it the whole way in the RV." },
  { holder: "dre-k", from: "2024-06-01", to: "2024-09-01", place: "On the road to Reno",
    how: "Passed it at a rest stop." },
  { holder: "eli-n", from: "2024-09-01", milesIn: 25,
    how: "Took the coin at the final table.", place: "Fresno" },
];

const odoPlayers = [
  { slug: "ada-w", name: "Ada W.", aka: ["adaw"] },
  { slug: "bly-r", name: "Bly R.", aka: ["blyr"] },
  { slug: "cly-d", name: "Cly D.", aka: ["clyd"] },
  { slug: "dre-k", name: "Dre K.", aka: ["drek"] },
  { slug: "eli-n", name: "Eli N.", aka: ["elin"] },
];

// Wraps one history array in the rest of the GamesData shape odometerTiles
// and renderHopeCoin both need. A function, not a single constant, because
// several legs below build a small variant of odoChain (one field on one
// stop changed) and need a fresh GamesData around it each time.
function odoData(history: HopeCoinStop[]): GamesData {
  const last = history[history.length - 1];
  return {
    nextGame: { date: "2026-10-13", time: "7:00pm PT" },
    hopeCoin: { holder: last.holder, since: last.from ?? "2024-09-01", history },
    players: odoPlayers,
    games: [],
  };
}

// Pulls one tile's whole `<div class="tile">...</div>` block out by its
// `<h3>` text, so a test can check what lands INSIDE that one tile without
// a stray match from a neighboring tile - safe because no tile's own body
// ever nests a further `<div>` for this fixture's markup.
function tileFor(html: string, heading: string): string {
  const re = new RegExp(`<div class="tile">\\s*<h3>${heading}</h3>[\\s\\S]*?</div>`);
  return re.exec(html)?.[0] ?? "";
}

describe("odometerTiles and the leg labels (Task 6, #48)", () => {
  const html = odometerTiles(odoData(odoChain));

  // M1 leg (a): the shared five-stop chain has milesIn on stops 2 (12), 3
  // (8), and 5 (25), milesHeld 40 with a two-name route on stop 3, and
  // stop 4 unmeasured. onRecord = 12 + (8 + 40) + 25 = 85; the one
  // unmeasured leg (stop 4 - stop 1 is never counted, see odometer()'s own
  // comment) reads "plus one leg still unmeasured."
  test('M1 leg (a): the Miles tile\'s <p class="stat"> is the formatted sum plus " miles on record", second line names the one unmeasured leg', () => {
    const tile = tileFor(html, "Miles");
    expect(tile).toContain('<p class="stat">85 miles on record</p>');
    expect(tile).toContain("<p>by Beau's count, plus one leg still unmeasured</p>");
  });

  test('M1 leg (a): giving stop 4 a milesIn leaves every leg measured, so the second line reads "by Beau\'s count" alone', () => {
    const measured = odoChain.map((s, i) => (i === 3 ? { ...s, milesIn: 5 } : s));
    const tile = tileFor(odometerTiles(odoData(measured)), "Miles");
    expect(tile).toContain("<p>by Beau's count</p>");
    expect(tile).not.toContain("unmeasured");
  });

  test('M1 leg (a): a second unmeasured leg (stop 5, alongside stop 4) reads "plus 2 legs still unmeasured"', () => {
    const twoUnmeasured = odoChain.map((s, i) => (i === 4 ? { ...s, milesIn: undefined } : s));
    const tile = tileFor(odometerTiles(odoData(twoUnmeasured)), "Miles");
    expect(tile).toContain("<p>by Beau's count, plus 2 legs still unmeasured</p>");
  });

  test("M1 leg (b): the markup is exactly four tiles, Miles/Stops/Places/Longest leg in that order, no fifth", () => {
    expect(html).toStartWith('<div class="tiles tiles--4">');
    const headings = [...html.matchAll(/<div class="tile">\s*<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(headings).toEqual(["Miles", "Stops", "Places", "Longest leg"]);
  });

  test("M1 leg (b): the Stops tile reads the plain stop count", () => {
    expect(tileFor(html, "Stops")).toContain('<p class="stat">5</p>');
  });

  // Places: {Anchorage, Yukon, Cassiar Highway, Fresno} = 4 distinct names.
  // bly-r's place "Yukon" duplicates cly-d's route waypoint "Yukon" (must
  // collapse to one), and dre-k's "On the road to Reno" must not count at
  // all. A non-deduplicating implementation would read 5 (3 places outside
  // "On the road" + 2 route names, not collapsed); a road-counting
  // implementation would also read 5 (4 correctly-deduplicated names plus
  // the road entry). Only the correct implementation reads 4.
  test("M1 leg (b): the Places tile reads the deduplicated, road-excluded count", () => {
    expect(tileFor(html, "Places")).toContain('<p class="stat">4</p>');
  });

  test("M1 leg (b): the Longest leg tile shows the fixture's 40-mile route stop, its holder, and the on-the-road suffix", () => {
    expect(tileFor(html, "Longest leg")).toContain('<p class="stat">40 miles, Cly D., on the road</p>');
  });

  test("M1 leg (b): the on-the-road suffix is absent when a milesIn figure (1,200) is the largest instead", () => {
    const bigLeg = odoChain.map((s, i) => (i === 1 ? { ...s, milesIn: 1200 } : s));
    const tile = tileFor(odometerTiles(odoData(bigLeg)), "Longest leg");
    expect(tile).toContain('<p class="stat">1,200 miles, Bly R.</p>');
    expect(tile).not.toContain("on the road");
  });

  test("M2 leg (c): in renderHopeCoin, odometerTiles lands at or after coinHero's own markup ends, and before The journey heading", () => {
    const data = odoData(odoChain);
    const full = renderHopeCoin(data);
    const hero = coinHero(data);
    const heroIdx = full.indexOf(hero);
    expect(heroIdx).toBeGreaterThan(-1);
    const tilesIdx = full.indexOf(odometerTiles(data));
    const journeyIdx = full.indexOf("The journey");
    expect(tilesIdx).toBeGreaterThanOrEqual(heroIdx + hero.length);
    expect(tilesIdx).toBeLessThan(journeyIdx);
  });

  test("M3 leg (d): exactly stopCount-1 route-leg items, none before the first stop, each a bare stat span", () => {
    const full = renderHopeCoin(odoData(odoChain));
    const legOpenTags = full.match(/<li class="route-leg">/g) ?? [];
    expect(legOpenTags.length).toBe(4);

    const legMatches = [...full.matchAll(/<li class="route-leg"><span class="stat">([^<]*)<\/span><\/li>/g)];
    expect(legMatches.length).toBe(4);
    // Stop 2 through 5's own figures, in order: 12, 8, unmeasured, 25.
    expect(legMatches.map((m) => m[1])).toEqual(["12 miles", "8 miles", "unmeasured", "25 miles"]);

    // The very first <li> inside the <ol> is a route-stop, not a leg: no
    // leg precedes the first stop.
    const olIdx = full.indexOf('<ol class="route">');
    const firstLiIdx = full.indexOf("<li", olIdx);
    expect(full.startsWith('<li class="route-stop', firstLiIdx)).toBe(true);

    // For stops 2 through 5, the gap between that stop's own leg's closing
    // </li> and the stop's opening <li class="route-stop is whitespace
    // only - the leg sits immediately ahead of its own stop, not batched
    // as a block elsewhere in the list.
    const stopOpenTags = [...full.matchAll(/<li class="route-stop[^"]*">/g)];
    expect(stopOpenTags.length).toBe(5);
    for (let i = 0; i < legMatches.length; i++) {
      const legEnd = legMatches[i].index! + legMatches[i][0].length;
      const stopStart = stopOpenTags[i + 1].index!;
      expect(full.slice(legEnd, stopStart).trim()).toBe("");
    }
  });

  test("M5 leg (f): the tiles and the leg labels carry no em dash, \"about,\" or \"roughly\"", () => {
    const full = renderHopeCoin(odoData(odoChain));
    const legsHtml = (full.match(/<li class="route-leg">[\s\S]*?<\/li>/g) ?? []).join("\n");
    for (const forbidden of ["—", "about", "roughly"]) {
      expect(html).not.toContain(forbidden);
      expect(legsHtml).not.toContain(forbidden);
    }
  });
});

// Task 7 (#48): the stint lines. A stop whose holder drove the Coin around
// carries a `route` (the places it rode through) and `milesHeld`, and that
// trip is drawn as one straight line inside that stop's own <li>: a tick
// per place, left to right in the order the Coin passed through them. It
// shipped on 2026-09-05 as a loop (out along the top edge, back along the
// bottom) and was redrawn as a line on 2026-09-07 after Beau, who drove
// both routes, read the live page: "the loop graphics are kinda weird,
// should just be linear" (relayed by Mike). The chain below invents its
// places, as every fixture in this file does, EXCEPT the border tests
// further down: the flag is keyed on a name containing "British
// Columbia", so those legs have to spell a real crossing or they would
// not be testing the rule the site actually ships.
//
// Two routed stops (2 and 4) with three plain stops around and between
// them, so a renderer that drew only the first routed stop, only the last,
// or a line on every stop all fail the placement leg below.
const stintChain: HopeCoinStop[] = [
  { holder: "ada-w", to: "2024-01-01", place: "Tumbleweed Flat",
    how: "Held it since before anyone kept records." },
  { holder: "bly-r", from: "2024-01-01", to: "2024-03-01", milesIn: 12, milesHeld: 1234,
    route: ["Cinder Bend", "Marrow Gap", "Ochre Ridge"],
    how: "Drove it the whole way in the RV." },
  { holder: "cly-d", from: "2024-03-01", to: "2024-06-01", milesIn: 8, place: "Salt Pan",
    how: "Kept it on the shelf all spring." },
  { holder: "dre-k", from: "2024-06-01", to: "2024-09-01", milesIn: 30, milesHeld: 640,
    route: ["Quarry Row", "Lantern Creek"],
    how: "Took it out on the second trip." },
  { holder: "eli-n", from: "2024-09-01", milesIn: 25, place: "Fresno",
    how: "Took the coin at the final table." },
];

// The three-name stint the M1 legs measure, pulled out by name so a leg
// reads as "this stop" rather than "index 1 of the chain".
const threeNameStop = stintChain[1]!;

// Pulls each `<g class="route-tick">...</g>` group out whole, in document
// order - the same non-greedy whole-block extraction routeStopBlocks uses
// above, and exact for the same reason: tick groups never nest, so a match
// to the next `</g>` cannot bleed into the neighboring tick.
function tickGroups(svg: string): string[] {
  return [...svg.matchAll(/<g class="route-tick">[\s\S]*?<\/g>/g)].map((m) => m[0]);
}

// The text content of one tick group's own `<text>` element (the place
// name, plus the border sentence on the one crossing). Returns "" when the
// group carries no text at all, so a leg asserting on the name fails on the
// name rather than on a thrown match error.
function tickText(group: string): string {
  return /<text[^>]*>([\s\S]*?)<\/text>/.exec(group)?.[1] ?? "";
}

// The frame's width and height, read off the viewBox. NaN for a drawing
// with no viewBox, so a leg reading them fails on the number rather than
// on a thrown match.
function frame(svg: string): { width: number; height: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return {
    width: m ? Number.parseFloat(m[1]!) : Number.NaN,
    height: m ? Number.parseFloat(m[2]!) : Number.NaN,
  };
}

// The type size the drawing emits on its texts, read off the first one.
// NaN when no text carries the attribute.
function typeSize(svg: string): number {
  const m = /font-size="([\d.]+)"/.exec(svg);
  return m ? Number.parseFloat(m[1]!) : Number.NaN;
}

// The height of the line itself in the frame, read off the drawing's one
// path. The path is "M <x> <y> H <x2>" (the linearity leg below pins that
// shape), so its second number is the line's y. NaN when the path is not
// that shape, so a leg reading it fails on the number, not on a throw.
function lineY(svg: string): number {
  const m = /<path class="route-line-path" d="M [\d.]+ ([\d.]+) H [\d.]+"\/>/.exec(svg);
  return m ? Number.parseFloat(m[1]!) : Number.NaN;
}

// Where one tick group draws its bead and its name: the circle's center,
// the text's baseline, and whether this is the tick that carries the
// border flag. NaN for whichever attribute is missing.
function tickGeometry(group: string): { cx: number; cy: number; textY: number; border: boolean } {
  const c = /<circle cx="([\d.]+)" cy="([\d.]+)"/.exec(group);
  const t = /<text[^>]*\by="([\d.]+)"/.exec(group);
  return {
    cx: c ? Number.parseFloat(c[1]!) : Number.NaN,
    cy: c ? Number.parseFloat(c[2]!) : Number.NaN,
    textY: t ? Number.parseFloat(t[1]!) : Number.NaN,
    border: group.includes("route-flag"),
  };
}

describe("routeLine and the stint lines (Task 7, #48; a line since 2026-09-07)", () => {
  const line = routeLine(threeNameStop);

  test("M1 leg (a): the drawing is an <svg class=\"route-line\"> carrying a viewBox and exactly one route-line-path", () => {
    expect(line).toStartWith('<svg class="route-line" viewBox="');
    expect(line).toMatch(/^<svg class="route-line" viewBox="[\d .]+"/);
    expect(line.match(/class="route-line-path"/g)?.length).toBe(1);
  });

  // Beau's feedback (2026-09-07), pinned: the whole drawing hangs off one
  // straight horizontal stroke. A path that curves, arcs, closes, or runs
  // a second segment is the loop coming back.
  test("the path is one straight horizontal segment: a move and a horizontal line, no arc, no curve, no return", () => {
    const d = /<path class="route-line-path" d="([^"]+)"/.exec(line)?.[1];
    expect(d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+$/);
  });

  test("every tick sits on the line, left to right in route order, evenly spaced", () => {
    const y = lineY(line);
    expect(y).not.toBeNaN();
    const beads = tickGroups(line).map(tickGeometry);
    expect(beads.length).toBe(3);
    for (const bead of beads) expect(bead.cy).toBe(y);
    const xs = beads.map((b) => b.cx);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // Even spacing, to within rounding: the record carries one figure for
    // the whole stint and no per-leg distances, so the ticks may not
    // pretend to know them.
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const gap of gaps) expect(Math.abs(gap - gaps[0]!)).toBeLessThanOrEqual(0.2);
  });

  test("names alternate above and below the line, the first name above, so two neighbours never share a row", () => {
    const y = lineY(line);
    const [first, second, third] = tickGroups(line).map(tickGeometry);
    expect(first!.textY).toBeLessThan(y);
    expect(second!.textY).toBeGreaterThan(y);
    expect(third!.textY).toBeLessThan(y);
  });

  test("the mileage sits under the line at its right end, below every place name", () => {
    const miles = /<text class="route-line-miles" x="([\d.]+)" y="([\d.]+)" text-anchor="end"/.exec(line);
    expect(miles).not.toBeNull();
    const x = Number.parseFloat(miles![1]!);
    const y = Number.parseFloat(miles![2]!);
    // Anchored at the line's own right end: the path's H value.
    const lineEnd = Number.parseFloat(/ H ([\d.]+)"/.exec(line)![1]!);
    expect(x).toBe(lineEnd);
    expect(y).toBeGreaterThan(lineY(line));
    for (const bead of tickGroups(line).map(tickGeometry)) expect(bead.textY).toBeLessThan(y);
  });

  test("M1 leg (a): exactly three tick groups, their texts the three place names in route order, no fourth", () => {
    const groups = tickGroups(line);
    expect(groups.length).toBe(3);
    expect(groups.map(tickText)).toEqual(["Cinder Bend", "Marrow Gap", "Ochre Ridge"]);
  });

  test("M1 leg (a): each tick group holds exactly one <circle>", () => {
    for (const group of tickGroups(line)) {
      expect(group.match(/<circle\b/g)?.length).toBe(1);
    }
  });

  test('M1 leg (a): exactly one miles text, reading the formatted milesHeld plus " miles on the road"', () => {
    const miles = [...line.matchAll(/<text class="route-line-miles"[^>]*>([\s\S]*?)<\/text>/g)];
    expect(miles.length).toBe(1);
    expect(miles[0]![1]).toBe("1,234 miles on the road");
  });

  test("M2 leg (b): a stop with no route renders exactly the empty string", () => {
    const parked: HopeCoinStop = {
      holder: "cly-d", from: "2024-03-01", to: "2024-06-01", place: "Salt Pan",
      how: "Kept it on the shelf all spring.",
    };
    expect(routeLine(parked)).toBe("");
  });

  test("M2 leg (b): renderHopeCoin draws a line inside each routed stop's own <li>, after its how paragraph, and nowhere else", () => {
    const full = renderHopeCoin(odoData(stintChain));
    expect(full.match(/<svg class="route-line"/g)?.length).toBe(2);

    const blocks = routeStopBlocks(full);
    expect(blocks.length).toBe(5);
    for (const [i, how] of [[1, "Drove it the whole way in the RV."], [3, "Took it out on the second trip."]] as const) {
      const block = blocks[i]!;
      const howHtml = `<p>${how}</p>`;
      expect(block).toContain(howHtml);
      // The drawing lands AFTER the how sentence, inside the same stop's <li>.
      expect(block.indexOf('<svg class="route-line"')).toBeGreaterThan(block.indexOf(howHtml));
    }
    for (const i of [0, 2, 4]) {
      expect(blocks[i]!).not.toContain("route-line");
    }
  });

  const borderStop: HopeCoinStop = {
    holder: "bly-r", from: "2024-01-01", to: "2024-03-01", milesIn: 12, milesHeld: 2400,
    route: ["Cinder Bend", "Hope, British Columbia", "Marrow Gap"],
    how: "Drove it north and back.",
  };
  const borderLine = routeLine(borderStop);

  test("M3 leg (c): exactly one route-flag, inside the British Columbia tick, whose text names the crossing", () => {
    expect(borderLine.match(/class="route-flag"/g)?.length).toBe(1);
    const groups = tickGroups(borderLine);
    expect(groups.length).toBe(3);
    const flagged = groups.filter((g) => g.includes("route-flag"));
    expect(flagged.length).toBe(1);
    expect(tickText(flagged[0]!)).toBe("Hope, British Columbia, the coin's one border crossing");
  });

  test("M3 leg (c): the other two ticks carry neither the flag nor the border sentence", () => {
    const plain = tickGroups(borderLine).filter((g) => !g.includes("British Columbia"));
    expect(plain.length).toBe(2);
    for (const group of plain) {
      expect(group).not.toContain("route-flag");
      expect(group).not.toContain("border crossing");
    }
  });

  // The border name is a whole sentence, wider than the room between two
  // ticks, so it takes a row of its own on whichever side of the line its
  // slot falls. Two fixtures, so both sides' far rows are exercised: the
  // border second (an odd slot, below the line) with a fourth plain name
  // below it to compare against, and the border first (an even slot,
  // above) with a plain third name above.
  const borderBelow = routeLine({ ...borderStop, route: ["Cinder Bend", "Hope, British Columbia", "Marrow Gap", "Ochre Ridge"] });
  const borderAbove = routeLine({ ...borderStop, route: ["Hope, British Columbia", "Cinder Bend", "Marrow Gap"] });

  test("the border name takes a row of its own, further from the line than the plain names on its side", () => {
    for (const svg of [borderBelow, borderAbove]) {
      const y = lineY(svg);
      const beads = tickGroups(svg).map(tickGeometry);
      const border = beads.find((b) => b.border);
      expect(border).toBeDefined();
      const side = Math.sign(border!.textY - y);
      const sameSide = beads.filter((b) => !b.border && Math.sign(b.textY - y) === side);
      // A plain name shares the border's side in both fixtures, so the
      // comparison below is never vacuous.
      expect(sameSide.length).toBeGreaterThan(0);
      for (const bead of sameSide) {
        expect(Math.abs(border!.textY - y)).toBeGreaterThan(Math.abs(bead.textY - y));
      }
    }
  });

  // The far row leaves the near row empty at the border tick, and that gap
  // is where the flag flies: between the bead and its own name, never on
  // the other side of the line where the next name over could reach it
  // (the first cut hung it there and its tip came within a pixel of
  // "Cassiar Highway" on Beau's Alaska route).
  test("the flag flies between the bead and the border name, on the name's own side of the line", () => {
    for (const svg of [borderBelow, borderAbove]) {
      const y = lineY(svg);
      const group = tickGroups(svg).find((g) => g.includes("route-flag"));
      expect(group).toBeDefined();
      const nameY = tickGeometry(group!).textY;
      const d = /class="route-flag" d="([^"]+)"/.exec(group!)![1]!;
      const ys = [...d.matchAll(/[\d.]+ ([\d.]+)/g)].map((m) => Number.parseFloat(m[1]!));
      // A triangle: three corners, or the regex stopped reading the path.
      expect(ys.length).toBe(3);
      for (const fy of ys) {
        expect(Math.sign(fy - y)).toBe(Math.sign(nameY - y));
        expect(Math.abs(fy - y)).toBeLessThan(Math.abs(nameY - y));
      }
    }
  });

  test("rows exist only where a name lands on them: a route with no border name is shorter, in type sizes, than one with", () => {
    const rows = (svg: string) => frame(svg).height / typeSize(svg);
    expect(rows(line)).toBeLessThan(rows(borderLine));
  });

  // Review finding (2026-09-05): the first cut re-anchored an overflowing
  // label to the frame's edge, which for a short route with a long name
  // traded a right-edge overflow for a left-edge one - the three-name
  // British Columbia fixture above rendered its 53-character label running
  // off the left side, clipped by the svg's own viewBox. This leg pins the
  // numeric bound rather than the anchor, using the same 0.6-of-the-type-
  // size character estimate routeLine() measures with, so any future
  // placement scheme has to keep every label on the drawing to pass.
  //
  // Five drawings: the plain three, the border in every slot the fixtures
  // above put it in, and a one-place route, the shortest frame that ever
  // has to hold the long border label.
  const onePlace = routeLine({ ...borderStop, route: ["Hope, British Columbia"] });
  const drawings = [line, borderLine, borderBelow, borderAbove, onePlace];

  test("every text stays inside the viewBox side to side, down to a one-place route carrying the long border label", () => {
    for (const svg of drawings) {
      const { width } = frame(svg);
      expect(width).not.toBeNaN();
      const charWidth = typeSize(svg) * 0.6;

      const texts = [...svg.matchAll(/<text[^>]*\bx="([\d.-]+)"[^>]*text-anchor="(\w+)"[^>]*>([\s\S]*?)<\/text>/g)];
      // Every tick name plus the mileage: if this count ever drops, the
      // regex stopped matching and the bounds below stopped being checked.
      expect(texts.length).toBe(tickGroups(svg).length + 1);
      for (const [, xAttr, anchor, content] of texts) {
        const x = Number.parseFloat(xAttr!);
        const w = content!.length * charWidth;
        const start = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + w).toBeLessThanOrEqual(width);
      }
    }
  });

  test("every text stays inside the viewBox top to bottom, whichever side the border row lands on", () => {
    for (const svg of drawings) {
      const { height } = frame(svg);
      const size = typeSize(svg);
      const ys = [...svg.matchAll(/<text[^>]*\by="([\d.]+)"/g)].map((m) => Number.parseFloat(m[1]!));
      expect(ys.length).toBe(tickGroups(svg).length + 1);
      for (const y of ys) {
        // Ascent above the baseline and descent below it, as fractions of
        // the type size: generous on purpose, so a row that only just
        // fits the frame fails here before it clips on a screen.
        expect(y - size * 0.8).toBeGreaterThanOrEqual(0);
        expect(y + size * 0.25).toBeLessThanOrEqual(height);
      }
    }
  });

  test("M5 leg (e): no drawing carries an em dash", () => {
    for (const svg of drawings) expect(svg).not.toContain("—");
  });
});

// The final fix wave (2026-09-05, whole-branch review finding 1). The
// drawings were legible on a desktop and about four pixels tall on a
// phone, and nine of the eighteen places the Coin has been existed nowhere
// on the page except inside an SVG. Three changes answer that, and these
// legs pin all three: the places are printed as text beside the drawing;
// the type size is emitted in user units so it scales with the frame
// instead of with the frame's own width; and the drawing sits in a scroll
// container so a narrow screen pans it rather than shrinking it.
describe("the stint lines read on a phone (final fix wave, #48)", () => {
  // The drawings this block measures, rebuilt here rather than reached
  // for across the describe above: the three-name stint and the two-name
  // stint from the chain (two frame widths), and the border stint, whose
  // long label is the one most likely to be left at the CSS size.
  const line = routeLine(stintChain[1]!);
  const twoName = routeLine(stintChain[3]!);
  const borderLine = routeLine({
    holder: "bly-r", from: "2024-01-01", to: "2024-03-01", milesIn: 12, milesHeld: 2400,
    route: ["Cinder Bend", "Hope, British Columbia", "Marrow Gap"],
    how: "Drove it north and back.",
  });

  // The type size routeLine must emit for a frame of `width` user units:
  // 11px at the 540-unit reference frame `.route-line`'s max-width sets,
  // scaled so every drawing on the page renders its names at the same size.
  const expectedFontSize = (width: number) => Number(((11 * width) / 540).toFixed(1));

  test("finding 1a: each routed stop prints its places as text, after the how sentence and before the drawing", () => {
    const full = renderHopeCoin(odoData(stintChain));
    const blocks = routeStopBlocks(full);
    for (const [i, how, places] of [
      [1, "Drove it the whole way in the RV.", "Cinder Bend · Marrow Gap · Ochre Ridge"],
      [3, "Took it out on the second trip.", "Quarry Row · Lantern Creek"],
    ] as const) {
      const block = blocks[i]!;
      const line = `<p class="stat">${places}</p>`;
      expect(block).toContain(line);
      expect(block.indexOf(line)).toBeGreaterThan(block.indexOf(`<p>${how}</p>`));
      expect(block.indexOf(line)).toBeLessThan(block.indexOf('<svg class="route-line"'));
    }
    // A stop with no route prints no such line: the places line exists only
    // where there are places, never as an empty paragraph. Checked on the
    // separator, not on a place name - one of these three stops carries a
    // `place`, which is a different line with the same class.
    for (const i of [0, 2, 4]) {
      expect(blocks[i]!).not.toContain("·");
    }
  });

  test("finding 1b: every text on a drawing carries a font-size in user units, scaled to that drawing's frame", () => {
    for (const svg of [line, twoName, borderLine]) {
      const width = Number.parseFloat(/viewBox="0 0 ([\d.]+) /.exec(svg)![1]!);
      const size = String(expectedFontSize(width));
      const texts = [...svg.matchAll(/<text[^>]*>/g)].map((m) => m[0]);
      // Every tick name plus the mileage: a drawing that emitted the
      // attribute on only some of its text would leave those names at the
      // CSS size.
      expect(texts.length).toBe(tickGroups(svg).length + 1);
      for (const text of texts) {
        expect(text).toContain(`font-size="${size}"`);
      }
    }
  });

  test("finding 1b: the two frames differ in width, so the scaling above is actually exercised", () => {
    const w1 = Number.parseFloat(/viewBox="0 0 ([\d.]+) /.exec(line)![1]!);
    const w2 = Number.parseFloat(/viewBox="0 0 ([\d.]+) /.exec(twoName)![1]!);
    expect(w1).not.toBe(w2);
    expect(expectedFontSize(w1)).not.toBe(expectedFontSize(w2));
  });

  test("finding 1c: each drawing sits inside the repo's own .table-scroll container", () => {
    const full = renderHopeCoin(odoData(stintChain));
    const wrapped = [...full.matchAll(/<div class="table-scroll route-scroll"><svg class="route-line"[\s\S]*?<\/svg><\/div>/g)];
    expect(wrapped.length).toBe(2);
    // No drawing escapes the container: every route-line svg on the page
    // is one of the two matched above.
    expect(full.match(/<svg class="route-line"/g)?.length).toBe(2);
  });

  test("finding 1c: .route-line carries a min-width so a narrow screen pans instead of shrinking the names", () => {
    const css = stripCssComments(readFileSync(CSS_PATH, "utf8"));
    const rule = cssRules(css).find((r) => r.selector === ".route-line");
    expect(rule).toBeDefined();
    const min = declValue(rule!.body, "min-width");
    expect(min).toMatch(/^\d+px$/);
    expect(Number.parseFloat(min!)).toBeGreaterThanOrEqual(400);
    // The scroll container is what absorbs that overflow, so the page body
    // itself still never scrolls sideways.
    const scroll = cssRules(css).find((r) => r.selector === ".table-scroll");
    expect(declValue(scroll!.body, "overflow-x")).toBe("auto");
  });

  test("finding 7: each drawing opens with a <title> naming the holder and the ends of the route", () => {
    const named = routeLine(threeNameStop, "Bly R.");
    expect(named).toContain("<title>Bly R.'s route: Cinder Bend to Ochre Ridge</title>");
    // The title is the svg's FIRST child: a screen reader announces it as
    // the drawing's name, which only holds if nothing is drawn ahead of it.
    expect(named.indexOf("<title>")).toBeLessThan(named.indexOf("<path"));
    expect(named).not.toContain("—");

    // With no name to hand (the fallback the journey list never takes, kept
    // so a caller without a display name still gets a titled drawing rather
    // than a slug printed on the page).
    expect(line).toContain("<title>Route: Cinder Bend to Ochre Ridge</title>");
  });

  test("finding 7: renderHopeCoin gives each drawing the holder's display name, never their slug", () => {
    const full = renderHopeCoin(odoData(stintChain));
    expect(full).toContain("<title>Bly R.'s route: Cinder Bend to Ochre Ridge</title>");
    expect(full).toContain("<title>Dre K.'s route: Quarry Row to Lantern Creek</title>");
    expect(full).not.toContain("bly-r's route");
  });
});

// Task 6 (#48), M4: site/styles.css guards for .tiles--4 and the two
// .route-leg rules. tools/styles.test.ts already owns a general rule finder
// for the eleven trophy-era classes, but this task's own Files list names
// only this file, so a second, small copy lives here rather than reaching
// into that sibling file's unexported internals.
const CSS_PATH = new URL("../site/styles.css", import.meta.url).pathname;

// Strips /* ... */ comments before any rule extraction runs, matching
// tools/styles.test.ts's own stripComments - a class or declaration spelled
// only inside a comment must never read as a real rule.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Splits (already comment-free) CSS text into its leaf-level rules --
// {selector, body} pairs whose body holds no nested braces. Because the
// regex only matches an innermost `{...}`, a rule nested inside an @media
// wrapper comes out with the exact same selector and body a top-level rule
// would - which is why the 900px check below extracts each @media block's
// own text FIRST and only then runs this over that inner text alone.
function cssRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2].trim() });
  return out;
}

// Every `@media (min-width: 900px) { ... }` block's own inner text, brace-
// balanced by hand (a plain regex cannot count nested braces, and a 900px
// block always holds at least one nested rule). Takes comment-free CSS;
// returns one string per matching block, in file order.
function mediaBlocks900(css: string): string[] {
  const out: string[] = [];
  const re = /@media \(min-width: 900px\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

// The trimmed value of one declaration inside a rule body (matched right
// after the body's start or a preceding `;`, so searching for "left" can
// never match inside "padding-left"). Returns null when the body carries
// no such declaration at all.
function declValue(body: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
  return re.exec(body)?.[1]?.trim() ?? null;
}

describe("site/styles.css: .tiles--4 and .route-leg (Task 6, #48, M4)", () => {
  const css = stripCssComments(readFileSync(CSS_PATH, "utf8"));

  test(".tiles--4 sits inside a 900px media query, with four grid-template-columns tracks", () => {
    const rule = mediaBlocks900(css).flatMap(cssRules).find((r) => r.selector === ".tiles--4");
    expect(rule).toBeDefined();
    const value = declValue(rule!.body, "grid-template-columns");
    expect(value).not.toBeNull();
    expect(value!.split(/\s+/).filter(Boolean).length).toBe(4);
  });

  test(".route-leg carries padding-left: 2rem and margin: -0.75rem 0 0.75rem", () => {
    const rule = cssRules(css).find((r) => r.selector === ".route-leg");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "padding-left")).toBe("2rem");
    expect(declValue(rule!.body, "margin")).toBe("-0.75rem 0 0.75rem");
  });

  test(".route-leg::before draws no bead: display: none", () => {
    const rule = cssRules(css).find((r) => r.selector === ".route-leg::before");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "display")).toBe("none");
  });
});

// Task 7 (#48), M4: site/styles.css guards for the five stint-line rules.
// Each declaration gets its own check, by name, so a drawing that lost its
// stroke, its fill, or its small monospace face fails on the declaration
// that went missing rather than on a vague "the rule changed."
describe("site/styles.css: the stint line (Task 7, #48, M4)", () => {
  const css = stripCssComments(readFileSync(CSS_PATH, "utf8"));
  const ruleFor = (selector: string) => cssRules(css).find((r) => r.selector === selector);

  test(".route-line is sized by CSS: width 100%, height auto, and a max-width", () => {
    const rule = ruleFor(".route-line");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "width")).toBe("100%");
    expect(declValue(rule!.body, "height")).toBe("auto");
    expect(declValue(rule!.body, "max-width")).not.toBeNull();
  });

  test(".route-line-path is a drawn pewter stroke, never a filled shape", () => {
    const rule = ruleFor(".route-line-path");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "stroke")).toBe("var(--pewter-deep)");
    expect(declValue(rule!.body, "fill")).toBe("none");
  });

  test(".route-tick circle is filled pewter", () => {
    const rule = ruleFor(".route-tick circle");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "fill")).toBe("var(--pewter-deep)");
  });

  test(".route-flag is filled foil, the one accent on the line", () => {
    const rule = ruleFor(".route-flag");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "fill")).toBe("var(--foil-deep)");
  });

  // A stylesheet rule beats an SVG presentation attribute, whatever the
  // attribute says: an 11px font-size here would pin every name to 11
  // user units and silently undo the per-drawing size the renderer emits
  // (which is exactly what happened to the loops between 2026-09-05 and
  // 2026-09-07 - the attribute was there, the CSS overrode it, and Beau's
  // Alaska names printed at seven pixels while the test that checked for
  // the attribute passed). So these two rules carry the face and the ink
  // and NO size; the size is the renderer's alone.
  test(".route-tick text and .route-line-miles carry a font-family and no font-size, so the renderer's own size wins", () => {
    for (const selector of [".route-tick text", ".route-line-miles"]) {
      const rule = ruleFor(selector);
      expect(rule).toBeDefined();
      expect(declValue(rule!.body, "font-family")).not.toBeNull();
      expect(declValue(rule!.body, "fill")).not.toBeNull();
      expect(declValue(rule!.body, "font-size")).toBeNull();
    }
  });

  // No rule may still answer to the old loop names: a stylesheet that kept
  // them would style nothing on the page and mislead the next reader.
  test("no .route-loop rule survives the redraw", () => {
    expect(cssRules(css).some((r) => r.selector.includes("route-loop"))).toBe(false);
  });
});

// Task 8 (#48): "Who has held it" - the donut, the tenure strip, and the
// legend table holdersSection(data) draws beneath the journey.
//
// Every fixture below is invented: made-up slugs, and month spans chosen so
// the arithmetic is checkable by hand (a 3, 6, 3 chain is 25%, 50%, 25% and
// nothing else). The real chain is twelve stops of Beau's chain of custody
// and would make every number here a puzzle rather than an assertion.

// Wraps one history array plus a list of game dates in the rest of the
// GamesData shape holdersSection needs. Takes the dates in whatever order
// the caller wants them - the caption leg below passes them deliberately
// out of order, because "the latest game" is max(date), never the first or
// last entry of the array.
function heldData(history: HopeCoinStop[], gameDates: string[]): GamesData {
  const last = history[history.length - 1]!;
  return {
    nextGame: { date: "2026-10-13", time: "7:00pm PT" },
    hopeCoin: { holder: last.holder, since: last.from ?? "2020-01", history },
    players: [
      { slug: "fen-o", name: "Fen O.", aka: ["feno"] },
      { slug: "gil-p", name: "Gil P.", aka: ["gilp"] },
      { slug: "hax-q", name: "Hax Q.", aka: ["haxq"] },
      { slug: "ash-r", name: "Ash R.", aka: ["ashr"] },
      { slug: "bru-s", name: "Bru S.", aka: ["brus"] },
      { slug: "cyd-t", name: "Cyd T.", aka: ["cydt"] },
      { slug: "dov-u", name: "Dov U.", aka: ["dovu"] },
      { slug: "eve-v", name: "Eve V.", aka: ["evev"] },
      { slug: "fyn-w", name: "Fyn W.", aka: ["fynw"] },
      { slug: "gus-x", name: "Gus X.", aka: ["gusx"] },
      { slug: "ivy-y", name: "Ivy Y.", aka: ["ivyy"] },
      { slug: "jem-z", name: "Jem Z.", aka: ["jemz"] },
    ],
    games: gameDates.map((date) => ({
      date, hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 50,
      results: [{ slug: "fen-o", handle: "feno", finish: 1, payout: 50, rebuys: 0, trophies: [] }],
    })),
  };
}

// The 3, 6, 3 chain of leg (a) and leg (c): fen-o holds three months, gil-p
// six, hax-q three and still holds it. Share order (gil-p, fen-o, hax-q) is
// deliberately NOT chain order, so a donut or a legend drawn straight down
// the history array fails rather than passing by coincidence.
const chain363: HopeCoinStop[] = [
  { holder: "fen-o", from: "2025-01", to: "2025-04", place: "Cinder Bend", how: "Won the season." },
  { holder: "gil-p", from: "2025-04", to: "2025-10", place: "Marrow Gap", how: "Won the season." },
  { holder: "hax-q", from: "2025-10", place: "Ochre Ridge", how: "Took it on the third skull." },
];
const held363 = holdersSection(heldData(chain363, ["2026-01-13"]));

// The A, B, A chain of leg (b) and the second half of leg (c): ash-r holds
// 2024-12 to 2025-02 (2 months), bru-s to 2025-08 (6), ash-r again to the
// latest game (4). Chain order is ash-r, bru-s, ash-r while share order is
// ash-r then bru-s (tied on 6 months, ash-r first by first appearance), and
// the widths 2, 6, 4 are not a palindrome, so a strip drawn per holder, in
// share order, reversed, or with equal widths all fail.
const chainABA: HopeCoinStop[] = [
  { holder: "ash-r", from: "2024-12", to: "2025-02", place: "Cinder Bend", how: "Won the season." },
  { holder: "bru-s", from: "2025-02", to: "2025-08", place: "Marrow Gap", how: "Won the season." },
  { holder: "ash-r", from: "2025-08", place: "Cinder Bend", how: "Took it back." },
];
const heldABA = holdersSection(heldData(chainABA, ["2025-12-09"]));

// Every `<path class="donut-arc...">` element, whole, in document order.
function donutArcs(html: string): string[] {
  return [...html.matchAll(/<path class="donut-arc[^"]*"[^>]*\/>/g)].map((m) => m[0]);
}

// Every donut label's text, in document order.
function donutLabels(html: string): string[] {
  return [...html.matchAll(/<text class="donut-label"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!);
}

// Every `<rect class="strip-seg">` element, whole, in document order.
function stripSegs(html: string): string[] {
  return [...html.matchAll(/<rect class="strip-seg"[^>]*\/>/g)].map((m) => m[0]);
}

// One attribute's value off a single SVG element, or "" when it carries
// none - so a leg asserting on a fill fails on the fill, not on a throw.
function attr(el: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1] ?? "";
}

// Every strip tick's text, in document order.
function stripTicks(html: string): string[] {
  return [...html.matchAll(/<text class="strip-tick"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!);
}

// The legend's body rows, each as its list of `<td>` texts, in document
// order. Reads inside `<tbody>` on purpose: the header row is `<th>`, and a
// leg counting four cells per row must not be satisfied by the header.
function legendRows(html: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]!));
}

// The final fix wave (2026-09-05, whole-branch review finding 2). The strip
// renders around 340px wide on a desktop and on a phone alike, so its year
// ticks at 11 viewBox units came out near six pixels: a number nobody can
// read. The type is raised to 19 units and the box given the four extra
// units of height that type needs to sit under the bar.
describe("the tenure strip's year ticks are legible (final fix wave, #48)", () => {
  test("finding 2: the strip's viewBox is 48 units tall, the room the bigger year type needs", () => {
    expect(heldABA).toContain('<svg class="tenure-strip" viewBox="0 0 600 48">');
  });

  test("finding 2: every year sits inside that box, below the bar", () => {
    const texts = [...heldABA.matchAll(/<text class="strip-tick"[^>]*\by="([\d.]+)"/g)];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      const y = Number.parseFloat(t[1]!);
      // Below the bar (top 2, height 20) and on the drawing.
      expect(y).toBeGreaterThan(22);
      expect(y).toBeLessThanOrEqual(48);
    }
  });

  test("finding 2: .strip-tick sets a font-size of at least 19px, in the strip's own viewBox units", () => {
    const css = stripCssComments(readFileSync(CSS_PATH, "utf8"));
    const rule = cssRules(css).find((r) => r.selector === ".strip-tick");
    expect(rule).toBeDefined();
    const size = declValue(rule!.body, "font-size");
    expect(size).toMatch(/^\d+(\.\d+)?px$/);
    expect(Number.parseFloat(size!)).toBeGreaterThanOrEqual(19);
  });
});

describe("holdersSection: who has held it (Task 8, #48)", () => {
  test("M1 leg (a): a band-dark section headed Who has held it, with one donut arc per holder in share order and one marked current", () => {
    expect(held363).toStartWith('<section class="band-dark">');
    expect(held363).toContain("Who has held it");
    expect(held363).toMatch(/<svg class="coin-donut" viewBox="[\d .]+"/);

    const arcs = donutArcs(held363);
    expect(arcs.length).toBe(3);
    // Exactly one arc is the current holder's, and it is hax-q's: the third
    // arc in share order, which is neither first nor last in chain order.
    const currentFlags = arcs.map((a) => a.includes("donut-arc--current"));
    expect(currentFlags).toEqual([false, false, true]);
  });

  test("M1 leg (a): one donut label per holder, name then percent, in share order not chain order", () => {
    expect(donutLabels(held363)).toEqual(["Gil P. 50%", "Fen O. 25%", "Hax Q. 25%"]);
  });

  test("M2 leg (b): the tenure strip carries a viewBox and one rect per segment, in chain order, widths proportional to months", () => {
    expect(heldABA).toMatch(/<svg class="tenure-strip" viewBox="[\d .]+"/);
    const segs = stripSegs(heldABA);
    expect(segs.length).toBe(3);
    expect(segs.map((s) => attr(s, "width"))).toEqual(["100", "300", "200"]);
  });

  test("M2 leg (b): exactly one January tick, reading 2025, and none on either edge of the range", () => {
    // 2024-12 to 2025-12: January 2025 is the only January strictly inside.
    expect(stripTicks(heldABA)).toEqual(["2025"]);

    // Same chain, latest game 2026-01-13: January 2026 sits ON the range's
    // end edge, so it is not a tick.
    const endEdge = holdersSection(heldData(chainABA, ["2026-01-13"]));
    expect(stripTicks(endEdge)).toEqual(["2025"]);

    // A chain whose first dated stop starts in January: the range's start
    // edge is not a tick either.
    const startEdge = holdersSection(heldData([
      { holder: "cyd-t", from: "2025-01", to: "2025-06", place: "Cinder Bend", how: "Won the season." },
      { holder: "dov-u", from: "2025-06", place: "Marrow Gap", how: "Took it on the third skull." },
    ], ["2025-12-09"]));
    expect(stripTicks(startEdge)).toEqual([]);

    // A long chain crosses three Januaries and must draw all three, in
    // order: a renderer that stops after the first fails here.
    const threeYears = holdersSection(heldData([
      { holder: "cyd-t", from: "2023-06", to: "2024-09", place: "Cinder Bend", how: "Won the season." },
      { holder: "dov-u", from: "2024-09", place: "Marrow Gap", how: "Took it on the third skull." },
    ], ["2026-03-10"]));
    expect(stripTicks(threeYears)).toEqual(["2024", "2025", "2026"]);
  });

  test("M3 leg (c): the legend is one tenure-legend table, one four-cell row per holder in share order", () => {
    expect(held363.match(/<table class="tenure-legend">/g)?.length).toBe(1);
    expect(legendRows(held363)).toEqual([
      ["Gil P.", "1", "6", "50%"],
      ["Fen O.", "1", "3", "25%"],
      ["Hax Q.", "1", "3", "25%"],
    ]);
  });

  test("M3 leg (c): a holder with two reigns is one row counting both, ahead of the holder it ties on months", () => {
    expect(legendRows(heldABA)).toEqual([
      ["Ash R.", "2", "6", "50%"],
      ["Bru S.", "1", "6", "50%"],
    ]);
  });

  test("M4 leg (d): the caption names the month of the latest game, which is neither the first nor the last game in the array", () => {
    const outOfOrder = holdersSection(heldData(chain363, ["2025-08-12", "2025-11-11", "2025-10-14"]));
    expect(outOfOrder).toContain("Months, as of the November 2025 game.");
  });

  test("M4 leg (d): an undated first stop's time is called out as uncounted, and a dated one says nothing of the kind", () => {
    const undatedFirst = holdersSection(heldData([
      { holder: "fen-o", to: "2025-02", place: "Marrow Gap", how: "Held it since before anyone kept records." },
      { holder: "gil-p", from: "2025-02", to: "2025-08", place: "Cinder Bend", how: "Won the season." },
      { holder: "hax-q", from: "2025-08", place: "Ochre Ridge", how: "Took it on the third skull." },
    ], ["2025-11-11"]));
    expect(undatedFirst).toContain("The coin's time in Marrow Gap before February 2025 is not counted.");
    expect(held363).not.toContain("is not counted");
  });

  // Leg (e): eight holders, the current one SECOND in share order, so the
  // opacity list is walked by "share order skipping the current holder" and
  // an implementation indexing it by absolute share position fails on the
  // very first two rows.
  const chain8: HopeCoinStop[] = [
    { holder: "fen-o", from: "2020-01", to: "2021-09", place: "Cinder Bend", how: "Won the season." },
    { holder: "gil-p", from: "2021-09", to: "2022-06", place: "Marrow Gap", how: "Won the season." },
    { holder: "hax-q", from: "2022-06", to: "2023-02", place: "Ochre Ridge", how: "Won the season." },
    { holder: "ash-r", from: "2023-02", to: "2023-09", place: "Salt Pan", how: "Won the season." },
    { holder: "bru-s", from: "2023-09", to: "2024-03", place: "Cinder Bend", how: "Won the season." },
    { holder: "cyd-t", from: "2024-03", to: "2024-08", place: "Marrow Gap", how: "Won the season." },
    { holder: "dov-u", from: "2024-08", to: "2024-12", place: "Ochre Ridge", how: "Won the season." },
    { holder: "eve-v", from: "2024-12", place: "Salt Pan", how: "Took it on the third skull." },
  ];
  // Months: 20, 9, 8, 7, 6, 5, 4 and the current holder's 10, so share order
  // runs fen-o (20), eve-v (10, current), gil-p (9), hax-q (8), ash-r (7),
  // bru-s (6), cyd-t (5), dov-u (4).
  const held8 = holdersSection(heldData(chain8, ["2025-10-14"]));

  test("M5 leg (e): the current holder is drawn in foil and every other holder in a tint of the ink, in share order skipping the current one", () => {
    const arcs = donutArcs(held8);
    const segs = stripSegs(held8);
    expect(arcs.length).toBe(8);
    expect(segs.length).toBe(8);

    // The donut is in share order; the strip is in chain order. Keying each
    // one by the label/holder it belongs to is what lets the last leg below
    // compare the two without assuming they are drawn in the same order.
    const arcFills = arcs.map((a) => [attr(a, "fill"), attr(a, "fill-opacity")]);
    expect(arcFills).toEqual([
      ["var(--ink)", "1"],
      ["var(--foil-deep)", ""],
      ["var(--ink)", ".8"],
      ["var(--ink)", ".62"],
      ["var(--ink)", ".46"],
      ["var(--ink)", ".32"],
      ["var(--ink)", ".2"],
      ["var(--ink)", ".12"],
    ]);
  });

  test("M5 leg (e): no fill in the section names any value but the foil and the ink, and each holder's strip segment matches their own arc", () => {
    for (const value of [...held8.matchAll(/\bfill="([^"]*)"/g)].map((m) => m[1]!)) {
      expect(["var(--foil-deep)", "var(--ink)"]).toContain(value);
    }

    // Chain order for this fixture is fen-o, gil-p, hax-q, ash-r, bru-s,
    // cyd-t, dov-u, eve-v, and every holder appears exactly once, so the
    // strip's segments line up with those holders by position. Share order
    // (the donut's order) is fen-o, eve-v, gil-p, hax-q, ash-r, bru-s,
    // cyd-t, dov-u - a different order, which is the point.
    const chainOrder = ["fen-o", "gil-p", "hax-q", "ash-r", "bru-s", "cyd-t", "dov-u", "eve-v"];
    const shareOrder = ["fen-o", "eve-v", "gil-p", "hax-q", "ash-r", "bru-s", "cyd-t", "dov-u"];
    const arcs = donutArcs(held8);
    const segs = stripSegs(held8);
    for (let i = 0; i < chainOrder.length; i++) {
      const arc = arcs[shareOrder.indexOf(chainOrder[i]!)]!;
      const seg = segs[i]!;
      expect(attr(seg, "fill")).toBe(attr(arc, "fill"));
      expect(attr(seg, "fill-opacity")).toBe(attr(arc, "fill-opacity"));
    }
  });

  // Round 1 review (2026-09-05): the donut's box used to be a 200 by 200
  // square, which left a right-anchored label only 42 units before the edge
  // - about eight characters at the per-character estimate the renderer
  // itself measures with. Every real label is 11 to 13 characters, so the
  // edge clamp dragged them back ON TOP of the ring, and the longest one
  // ("Chris G. 44%") printed its first characters in ink over its own
  // full-opacity ink arc: invisible. The fixture below is shaped like the
  // real chain - six holders, shares near 44/25/10/10/6/5, display names
  // that make 11 to 13 character labels - and the leg checks the two things
  // that were broken: every label's estimated span stays inside the box,
  // and none of it crosses the ring's outer radius at its own baseline.
  const realShaped: HopeCoinStop[] = [
    // 10 + 44 + 10 + 6 + 25 + 5 = 100 months, in a chain order that is not
    // share order, with the current holder (jem-z) holding the smallest.
    { holder: "fen-o", from: "2017-01", to: "2017-11", place: "Cinder Bend", how: "Won the season." },
    { holder: "gil-p", from: "2017-11", to: "2021-07", place: "Marrow Gap", how: "Won the season." },
    { holder: "hax-q", from: "2021-07", to: "2022-05", place: "Ochre Ridge", how: "Won the season." },
    { holder: "ivy-y", from: "2022-05", to: "2022-11", place: "Salt Pan", how: "Won the season." },
    { holder: "ash-r", from: "2022-11", to: "2024-12", place: "Cinder Bend", how: "Won the season." },
    { holder: "jem-z", from: "2024-12", place: "Marrow Gap", how: "Took it on the third skull." },
  ];

  test("no donut label crosses the ring or runs off the box, at the label lengths the real chain produces", () => {
    // The shares come out 44%, 25%, 10%, 10%, 6%, 5% - the real chain's own
    // shape - and these display names make labels 11 to 13 characters long,
    // the length that used to be clamped back over the ring.
    const base = heldData(realShaped, ["2025-05-12"]);
    const html = holdersSection({
      ...base,
      players: [
        { slug: "gil-p", name: "Vesper G.", aka: ["vesperg"] },
        { slug: "ash-r", name: "Corwin R.", aka: ["corwinr"] },
        { slug: "fen-o", name: "Isolde O.", aka: ["isoldeo"] },
        { slug: "hax-q", name: "Bram Q.", aka: ["bramq"] },
        { slug: "ivy-y", name: "Perrin Y.", aka: ["perriny"] },
        { slug: "jem-z", name: "Odile Z.", aka: ["odilez"] },
      ],
    });
    expect(legendRows(html).map((r) => r[3])).toEqual(["44%", "25%", "10%", "10%", "6%", "5%"]);

    const box = /<svg class="coin-donut" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
    expect(box).not.toBeNull();
    const boxW = Number.parseFloat(box![1]!);
    const boxH = Number.parseFloat(box![2]!);
    const cx = boxW / 2;
    const cy = boxH / 2;
    // The same estimate tools/render.ts measures its own labels with, and
    // the ring's own outer radius. Both are duplicated here on purpose: a
    // test that imported the renderer's constants could not catch the
    // renderer changing them out from under the drawing.
    const CHAR = 4.8;
    const R_OUT = 52;

    const labels = [...html.matchAll(/<text class="donut-label" x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)">([^<]*)<\/text>/g)];
    expect(labels.length).toBe(6);
    for (const [, xAttr, yAttr, anchor, text] of labels) {
      const x = Number.parseFloat(xAttr!);
      const y = Number.parseFloat(yAttr!);
      const w = text!.length * CHAR;
      expect(text!.length).toBeGreaterThanOrEqual(11);
      const start = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
      const end = start + w;
      // Inside the drawing.
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(boxW);
      // Clear of the ring. At this baseline the ring covers the horizontal
      // span cx +/- half its own chord; the label must not reach into it,
      // or it prints ink on ink and disappears.
      const dy = y - cy;
      const half = Math.abs(dy) >= R_OUT ? 0 : Math.sqrt(R_OUT * R_OUT - dy * dy);
      const clearsRight = start >= cx + half;
      const clearsLeft = end <= cx - half;
      expect(clearsRight || clearsLeft).toBe(true);
    }
  });

  test("M6 leg (f): the section carries no em dash", () => {
    expect(held363).not.toContain("—");
    expect(heldABA).not.toContain("—");
    expect(held8).not.toContain("—");
  });

  test("renderHopeCoin appends the section after the journey, and its footer band alternates away from it", () => {
    const data = heldData(chain363, ["2026-01-13"]);
    const full = renderHopeCoin(data);
    const section = holdersSection(data);
    const sectionIdx = full.indexOf(section);
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeGreaterThan(full.indexOf('<h2 class="rule-label">The journey</h2>'));
    // Two adjacent bands never share a tone (docs/brand.md), and the new
    // section is the last thing above the footer.
    expect(full).toContain('<footer class="band-light"');
  });
});

// ---------------------------------------------------------------------------
// renderArchive (#39, task 2 of the 2026-09-06 archive-page plan). Every
// fixture below is synthetic - invented names, invented slugs, invented
// dates - and none of it reads site/data/archive.json or games.json: the
// brief is explicit that renderArchive itself never reads the spine (the
// validator, a sibling task, is what checks a slug against it before
// tools/render.ts ever calls this function). Names mostly follow the site's
// "First L." pattern the same way tools/lib/archive.test.ts's own fixtures
// do (Ada W. / ada-w, Bly R. / bly-r, Cy T. / cyt); the one fixture built to
// exercise esc() necessarily breaks that pattern on purpose, since testing
// escaping requires characters the pattern forbids.

// A minimal ArchiveGame: podium and bounties default to empty so a test
// only has to spell out the field it cares about, matching the same
// game() helper tools/lib/archive.test.ts already uses for the same reason.
function archiveGame(overrides: Partial<ArchiveGame> & { date: string }): ArchiveGame {
  return { podium: [], bounties: [], ...overrides };
}

// Pulls out every top-level <section class="band-light|band-dark">...
// </section> block whole, in document order, the same non-greedy
// whole-block extraction pattern standingsRowBlocks and routeStopBlocks
// above use. The intro section renderArchive always writes first is
// element 0; every season section follows in render order.
function sectionBlocks(html: string): string[] {
  return [...html.matchAll(/<section class="band-(?:light|dark)">[\s\S]*?<\/section>/g)].map((m) => m[0]);
}

// Pulls out every <li class="season-card">...</li> block whole, in
// document order, across the whole document (a test that wants only one
// season's cards filters the result itself, the same way rowFor above
// searches standingsRowBlocks by content rather than this helper knowing
// about seasons at all). The closing tag must match "\n    </li>" - four
// spaces, on its own line - rather than a bare "</li>", because a card's
// own podium is itself a list of plain <li> elements nested inside it
// (renderArchiveGame writes those inline, same-line open-and-close, at
// eight spaces of indent); a bare "</li>" would stop this match at the
// FIRST podium row's own closing tag instead of the card's.
function seasonCardBlocks(html: string): string[] {
  return [...html.matchAll(/<li class="season-card">[\s\S]*?\n    <\/li>/g)].map((m) => m[0]);
}

// The <li> rows inside one season-card's own <ol class="podium">, whole,
// in document order. Takes one season-card block (from seasonCardBlocks
// above); throws if that block has no podium list, which would mean the
// fixture or the renderer is broken in a way no assertion further down
// could meaningfully explain.
function podiumItems(cardHtml: string): string[] {
  const ol = /<ol class="podium">([\s\S]*?)<\/ol>/.exec(cardHtml);
  if (!ol) throw new Error("podiumItems: no <ol class=\"podium\"> found in this season-card");
  return [...ol[1]!.matchAll(/<li>[\s\S]*?<\/li>/g)].map((m) => m[0]);
}

// GEM("foil")'s own markup, inlined, since GEM is not exported - the same
// approach the standings test file above already uses (see its comment at
// the Foil tile test) for the identical reason.
const FOIL_GEM =
  '<svg class="mark mark--foil" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg>';

describe("renderArchive", () => {
  // [a, M2] Three seasons, deliberately listed 2025, 2020, 2026-pre in the
  // fixture's own array order - an order that is neither newest-first nor
  // oldest-first - so a renderer that merely preserved file order would
  // fail every assertion below. Each season's title is set to its own id
  // so the rendered order can be read straight off the <h2> text. Only the
  // "2025" season carries a note, so the same fixture also proves a season
  // without one renders no <p class="stat"> between its heading and its
  // game list.
  describe("M2: season order, band tones, and the season note", () => {
    const fixture: ArchiveData = {
      seasons: [
        {
          id: "2025", title: "2025", note: "Before results were logged in full.",
          games: [archiveGame({ date: "2025-06-01" })],
        },
        { id: "2020", title: "2020", games: [archiveGame({ date: "2020-06-01" })] },
        { id: "2026-pre", title: "2026-pre", games: [archiveGame({ date: "2026-01-01" })] },
      ],
    };
    const html = renderArchive(fixture);
    // Element 0 is the intro band; the season sections follow it.
    const seasons = sectionBlocks(html).slice(1);

    test("orders seasons by each one's earliest game date, newest first", () => {
      const titles = seasons.map((s) => /<h2 class="display">([^<]*)<\/h2>/.exec(s)?.[1]);
      expect(titles).toEqual(["2026-pre", "2025", "2020"]);
    });

    test("the first season section is band-dark and tones alternate from there", () => {
      expect(seasons[0]).toStartWith('<section class="band-dark">');
      expect(seasons[1]).toStartWith('<section class="band-light">');
      expect(seasons[2]).toStartWith('<section class="band-dark">');
    });

    test("prints a season's note as a stat paragraph between its heading and its game list", () => {
      const withNote = seasons[1]!; // "2025", reordered to the middle slot
      const between = withNote.slice(
        withNote.indexOf("</h2>") + "</h2>".length,
        withNote.indexOf('<ol class="season">')
      );
      expect(between).toContain('<p class="stat">Before results were logged in full.</p>');
    });

    test("omits the stat paragraph entirely when a season has no note", () => {
      const noNote = seasons[0]!; // "2026-pre", carries no note
      const between = noNote.slice(
        noNote.indexOf("</h2>") + "</h2>".length,
        noNote.indexOf('<ol class="season">')
      );
      expect(between).not.toContain('class="stat"');
    });
  });

  // [b, M3] One season whose file lists three games dated 2025-03-11,
  // 2025-01-14, 2025-02-11 in that order - an order that is neither the
  // rendered (ascending) order nor its reverse. The middle game in
  // rendered order (2025-01-14, the "first card") carries every field the
  // checklist names: entrants, a three-entry podium whose third entry has
  // a handle, two bounties, and a note. The other two games each isolate
  // one absence: 2025-02-11 has no entrants, an empty bounties list, and
  // no note; 2025-03-11 exists only to pin the ordering.
  describe("M3: game order within a season, and one card's full content", () => {
    const januaryGame = archiveGame({
      date: "2025-01-14",
      entrants: 7,
      podium: [
        { place: 1, name: "Ada W." },
        { place: 2, name: "Cy T." },
        { place: 3, name: "Bly R.", handle: "blyr" },
      ],
      bounties: [
        { kind: "hope-slayer", name: "Ada W." },
        { kind: "bubble", name: "Bly R." },
      ],
      note: "First game of the year.",
    });
    const februaryGame = archiveGame({
      date: "2025-02-11",
      // entrants absent, bounties empty, no note - the three negative
      // cases this leg's other games are for.
    });
    const marchGame = archiveGame({ date: "2025-03-11" });

    const fixture: ArchiveData = {
      seasons: [{ id: "2025", title: "2025", games: [marchGame, januaryGame, februaryGame] }],
    };
    const html = renderArchive(fixture);
    const cards = seasonCardBlocks(html);

    test("orders games within a season ascending by date, regardless of file order", () => {
      const dates = cards.map((c) => /<p class="season-date">([^<]*)<\/p>/.exec(c)?.[1]);
      expect(dates).toEqual(["2025-01-14", "2025-02-11", "2025-03-11"]);
    });

    const jan = cards[0]!;

    test("the eyebrow names the month alone, with no \"· Played\" suffix", () => {
      expect(jan).toContain('<p class="eyebrow">January</p>');
    });

    test("the date paragraph holds the plain date with no anchor", () => {
      expect(jan).toContain('<p class="season-date">2025-01-14</p>');
      expect(jan).not.toContain("<a");
    });

    test("the podium reads place spans 1, 2, 3 in order, the third entry's handle in its own stat span", () => {
      const items = podiumItems(jan);
      expect(items.length).toBe(3);
      expect(items[0]).toContain('<span class="stat">1</span>');
      expect(items[1]).toContain('<span class="stat">2</span>');
      expect(items[2]).toContain('<span class="stat">3</span>');
      expect(items[2]).toContain('<span class="stat">blyr</span>');
    });

    test("the gem follows the place-1 name and follows no other podium row", () => {
      const items = podiumItems(jan);
      expect(items[0]).toContain(FOIL_GEM);
      expect(items[1]).not.toContain(FOIL_GEM);
      expect(items[2]).not.toContain(FOIL_GEM);
    });

    test("the bounties line joins each bounty's display name and holder with the middle dot", () => {
      expect(jan).toContain('<p class="stat">Hope Slayer: Ada W. · The Bubble: Bly R.</p>');
    });

    test("the turnout line reads the entrant count", () => {
      expect(jan).toContain("7 entrants");
    });

    test("the card's fields appear in strictly increasing order: eyebrow, date, podium, bounties, turnout, note", () => {
      const eyebrowIdx = jan.indexOf('<p class="eyebrow">January</p>');
      const dateIdx = jan.indexOf('<p class="season-date">2025-01-14</p>');
      const podiumIdx = jan.indexOf('<ol class="podium">');
      const bountiesIdx = jan.indexOf("Hope Slayer: Ada W.");
      const turnoutIdx = jan.indexOf("7 entrants");
      const noteIdx = jan.indexOf("First game of the year.");
      const indices = [eyebrowIdx, dateIdx, podiumIdx, bountiesIdx, turnoutIdx, noteIdx];
      for (const i of indices) expect(i).toBeGreaterThan(-1);
      for (let i = 1; i < indices.length; i++) expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    });

    test("a game with a note carries it as the card's last child", () => {
      expect(jan.trim().endsWith("</li>")).toBe(true);
      const noteMatch = /<p>First game of the year\.<\/p>\s*<\/li>$/.exec(jan);
      expect(noteMatch).not.toBeNull();
    });

    const feb = cards[1]!;

    test("a game with no entrants reads exactly \"Entrants not recorded\"", () => {
      expect(feb).toContain('<p class="stat">Entrants not recorded</p>');
    });

    test("a game with bounties: [] has no bounties line between its podium and its turnout", () => {
      // The podium's closing </ol> is followed directly by the turnout
      // paragraph with nothing between them - a bounties line, had one
      // rendered, would be its own <p class="stat"> sitting right here.
      expect(feb).toContain('</ol>\n      <p class="stat">Entrants not recorded</p>');
    });

    test("a game without a note has no trailing <p> after its turnout line", () => {
      expect(feb.trim().endsWith("</p>\n    </li>") || feb.trim().endsWith("</p></li>")).toBe(true);
    });
  });

  // A handle-only entry is docs/brand.md's second Names exception: the notes
  // never gave that player a "First L." form, so the handle IS the display
  // name and `handle` equals `name`. Printing the handle in its own stat
  // span as well would put the same word on the card twice in a row (the
  // live page showed `jfe <span class="stat">jfe</span>`), so
  // archivePodiumRow suppresses the span for exactly that identity. An
  // entry whose handle genuinely differs from its name is unaffected.
  describe("a handle-only podium entry prints its name once (review fix, 2026-09-06)", () => {
    const html = renderArchive({
      seasons: [{
        id: "2025", title: "2025",
        games: [archiveGame({
          date: "2025-05-13",
          podium: [
            { place: 1, name: "jfe", handle: "jfe" },
            { place: 2, name: "Ada W.", handle: "adaw" },
          ],
        })],
      }],
    });
    const items = podiumItems(seasonCardBlocks(html)[0]!);

    test("a handle-only entry renders its name once and no handle stat span", () => {
      expect(items[0]).toContain("jfe");
      expect(items[0]!.match(/jfe/g)!.length).toBe(1);
      expect(items[0]).not.toContain('<span class="stat">jfe</span>');
    });

    test("an entry whose handle differs from its name still gets the handle span", () => {
      expect(items[1]).toContain('<span class="stat">adaw</span>');
    });
  });

  // [c, M4] A slugged podium entry and a slugged bounty holder each link to
  // /player/<slug>/; their unslugged counterparts render as plain text. A
  // separate one-game fixture isolates the chop: two podium rows sharing
  // place 1, each carrying the gem.
  describe("M4: slug links and the chop", () => {
    const slugFixture: ArchiveData = {
      seasons: [{
        id: "2025", title: "2025",
        games: [archiveGame({
          date: "2025-04-01",
          entrants: 4,
          podium: [
            { place: 1, name: "Ada W.", slug: "ada-w" },
            { place: 2, name: "Cy T." },
          ],
          bounties: [
            { kind: "hope-slayer", name: "Bly R.", slug: "bly-r" },
            { kind: "bubble", name: "Gene" },
          ],
        })],
      }],
    };
    const slugHtml = renderArchive(slugFixture);

    test("a slugged podium entry links to its player page", () => {
      expect(slugHtml).toContain('<a href="/player/ada-w/">Ada W.</a>');
    });

    test("a slugged bounty holder links to their player page inside the bounties line", () => {
      expect(slugHtml).toContain('<a href="/player/bly-r/">Bly R.</a>');
    });

    test("an unslugged podium entry renders its name with no anchor", () => {
      expect(slugHtml).toContain("Cy T.");
      expect(slugHtml).not.toContain('>Cy T.</a>');
    });

    test("an unslugged bounty holder renders its name with no anchor", () => {
      expect(slugHtml).toContain("Gene");
      expect(slugHtml).not.toContain(">Gene</a>");
    });

    const chopFixture: ArchiveData = {
      seasons: [{
        id: "2025", title: "2025",
        games: [archiveGame({
          date: "2025-05-01",
          podium: [
            { place: 1, name: "Ada W." },
            { place: 1, name: "Cy T." },
          ],
          note: "A chop split the pot evenly.",
        })],
      }],
    };
    const chopHtml = renderArchive(chopFixture);

    test("a chop renders two podium rows, both place 1, both carrying the gem", () => {
      const card = seasonCardBlocks(chopHtml)[0]!;
      const items = podiumItems(card);
      expect(items.length).toBe(2);
      for (const item of items) {
        expect(item).toContain('<span class="stat">1</span>');
        expect(item).toContain(FOIL_GEM);
      }
    });
  });

  // [d, M1] The document shell: title, og:url, description, and the intro
  // section's exact copy plus its link to /games/.
  describe("M1: the document shell and the intro section", () => {
    const fixture: ArchiveData = {
      seasons: [{ id: "2025", title: "2025", games: [archiveGame({ date: "2025-06-01" })] }],
    };
    const html = renderArchive(fixture);

    test("the title begins \"Archive\"", () => {
      expect(html).toContain("<title>Archive");
    });

    test("declares its own canonical url for link unfurls", () => {
      expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/archive/">');
    });

    test("the description meta reads exactly the M1 sentence", () => {
      expect(html).toContain(
        '<meta name="description" content="Every K5M Shareholder Poker game before the record began: ' +
        '2020, 2025, and early 2026.">'
      );
    });

    test("the first section is band-light with the heading, the exact intro paragraph, and a link to /games/", () => {
      const intro = sectionBlocks(html)[0]!;
      expect(intro).toStartWith('<section class="band-light">');
      expect(intro).toContain('<h1 class="display">Before the record</h1>');
      expect(intro).toContain(
        "Every game before the data spine, from the notes that survive. Podiums, bounties, and who " +
        "showed up: no chips, no hands. The record proper picks up where this page leaves off."
      );
      expect(intro).toContain('<a href="/games/">');
    });

    test("highlights no nav link, since the archive page is outside the four main sections", () => {
      expect(html).not.toContain('aria-current="page"');
    });
  });

  // [e, M5] The footer's tone always opposes the last season section's own
  // tone: with one season (band-dark, the only section) the footer must be
  // band-light; with two seasons (band-dark then band-light) the footer
  // must be band-dark.
  describe("M5: the footer tone opposes the last season", () => {
    test("one season leaves the footer band-light", () => {
      const html = renderArchive({
        seasons: [{ id: "2025", title: "2025", games: [archiveGame({ date: "2025-06-01" })] }],
      });
      expect(html).toContain('<footer class="band-light"');
    });

    test("two seasons leave the footer band-dark", () => {
      const html = renderArchive({
        seasons: [
          { id: "2025", title: "2025", games: [archiveGame({ date: "2025-06-01" })] },
          { id: "2020", title: "2020", games: [archiveGame({ date: "2020-06-01" })] },
        ],
      });
      expect(html).toContain('<footer class="band-dark"');
    });
  });

  // [f, M6] No btn-primary, no em dash, no "experiment" anywhere in a
  // three-season render; and, on a fixture built to exercise esc(), every
  // special character comes out entity-encoded and the raw form is gone.
  describe("M6: forbidden substrings and escaping", () => {
    const threeSeasonFixture: ArchiveData = {
      seasons: [
        { id: "2025", title: "2025", games: [archiveGame({ date: "2025-06-01" })] },
        { id: "2020", title: "2020", games: [archiveGame({ date: "2020-06-01" })] },
        { id: "2026-pre", title: "2026-pre", games: [archiveGame({ date: "2026-01-01" })] },
      ],
    };
    const html = renderArchive(threeSeasonFixture);

    test("contains no btn-primary", () => {
      expect(html).not.toContain("btn-primary");
    });

    test("contains no em dash", () => {
      expect(html).not.toContain("—");
    });

    test("contains no \"experiment\"", () => {
      expect(html.toLowerCase()).not.toContain("experiment");
    });

    // A dedicated fixture whose names, handle, and notes each carry one of
    // the four characters esc() encodes. These necessarily break the
    // site's "First L." name pattern - that pattern is validateArchive's
    // job to enforce elsewhere, not renderArchive's, and testing escaping
    // at all requires characters the pattern forbids.
    const escFixture: ArchiveData = {
      seasons: [{
        id: "esc-season", title: "Esc Season", note: 'A season with a "quoted" word.',
        games: [archiveGame({
          date: "2025-07-01",
          podium: [{ place: 1, name: "A & B", handle: "<AB>" }],
          bounties: [{ kind: "cain", name: "C & D" }],
          note: "Contains <b>bold</b> text.",
        })],
      }],
    };
    const escHtml = renderArchive(escFixture);

    test("escapes an ampersand in a podium name", () => {
      expect(escHtml).toContain("A &amp; B");
      expect(escHtml).not.toContain("A & B");
    });

    test("escapes an ampersand in a bounty holder name, inside the bounties line", () => {
      expect(escHtml).toContain("C &amp; D");
      expect(escHtml).not.toContain("C & D");
    });

    test("escapes a less-than sign in a handle", () => {
      expect(escHtml).toContain("&lt;AB&gt;");
      expect(escHtml).not.toContain("<AB>");
    });

    test("escapes a game note containing a tag", () => {
      expect(escHtml).toContain("Contains &lt;b&gt;bold&lt;/b&gt; text.");
      expect(escHtml).not.toContain("<b>bold</b>");
    });

    test("escapes a double quote in a season note", () => {
      expect(escHtml).toContain("&quot;quoted&quot;");
      expect(escHtml).not.toContain('"quoted"');
    });
  });
});
