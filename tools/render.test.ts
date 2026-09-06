import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  esc, recordQualifier, renderStandings, renderGamesIndex, renderNextGameIcs, secondTuesday,
  playerSlugs, renderPlayer, renderHopeCoin, coinHero, odometerTiles, routeLoop,
} from "./render";
import { deriveStandings, type GamesData, type HopeCoinStop } from "./lib/standings";
import { TROPHIES, displayOrder, visibleTrophies } from "./lib/trophies";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  backfillPending: ["2020", "April 2026", "June 2026"],
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
  test("states the record starts with its earliest game and names the seasons still pending", () => {
    expect(html).toContain("This record starts with July 2026.");
    expect(html).toContain("Earlier seasons (2020, April 2026, and June 2026) predate the data spine and are being backfilled.");
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
  test("states the record starts with its earliest game and names the seasons still pending", () => {
    expect(html).toContain("This record starts with July 2026.");
    expect(html).toContain("Earlier seasons (2020, April 2026, and June 2026) predate the data spine and are being backfilled.");
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

// Issue #3: the "record starts with" line used to be a hardcoded string, so a
// backfill that added 2020 games would have left the standings page claiming
// the record starts in July 2026 while displaying 2020. Both halves now come
// from games.json: the month from the earliest game on the spine, the
// pending list from backfillPending, which Charlie trims in the same commit
// as each backfilled game.
describe("recordQualifier", () => {
  const april: GamesData = {
    ...data,
    games: [
      ...data.games,
      { date: "2026-04-14", hands: 150, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
        results: [
          { slug: "nick-m", handle: "nickmershon", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "chris-g", handle: "LEWD", finish: 2, payout: 0, rebuys: 0, trophies: [] },
        ] },
    ],
    backfillPending: ["2020", "June 2026"],
  };
  test("takes the start month from the earliest game, whatever order games.json lists them in", () => {
    expect(recordQualifier(april)).toStartWith("This record starts with April 2026.");
  });
  test("lists the pending seasons with an Oxford comma", () => {
    expect(recordQualifier(april)).toContain("Earlier seasons (2020 and June 2026) predate the data spine and are being backfilled.");
    expect(recordQualifier(data)).toContain("(2020, April 2026, and June 2026)");
  });
  test("a single pending season reads as one, not a list", () => {
    expect(recordQualifier({ ...data, backfillPending: ["2020"] }))
      .toContain("Earlier seasons (2020) predate the data spine and are being backfilled.");
  });
  test("drops the backfill sentence entirely once nothing is pending", () => {
    for (const pending of [[], undefined]) {
      const q = recordQualifier({ ...data, backfillPending: pending });
      expect(q).toBe("This record starts with July 2026.");
      expect(q).not.toContain("backfilled");
    }
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
  // sentence saying so on the page, mirroring recordQualifier's own
  // backfillPending-driven sentence (top of this file) so a hardcoded line
  // can never survive on the page after the data underneath it changes.
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

// Task 7 (#48): the stint loops. A stop whose holder drove the Coin around
// carries a `route` (the places it rode through) and `milesHeld`, and that
// trip is drawn as a loop off the journey's line inside that stop's own
// <li>. The chain below invents its places, as every fixture in this file
// does, EXCEPT the border test further down: the flag is keyed on a name
// containing "British Columbia", so that one leg has to spell a real
// crossing or it would not be testing the rule the site actually ships.
//
// Two routed stops (2 and 4) with three plain stops around and between
// them, so a renderer that drew only the first routed stop, only the last,
// or a loop on every stop all fail the placement leg below.
const loopChain: HopeCoinStop[] = [
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
const threeNameStop = loopChain[1]!;

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

describe("routeLoop and the stint loops (Task 7, #48)", () => {
  const loop = routeLoop(threeNameStop);

  test("M1 leg (a): the loop is an <svg class=\"route-loop\"> carrying a viewBox and exactly one route-loop-path", () => {
    expect(loop).toStartWith('<svg class="route-loop" viewBox="');
    expect(loop).toMatch(/^<svg class="route-loop" viewBox="[\d .]+"/);
    expect(loop.match(/class="route-loop-path"/g)?.length).toBe(1);
  });

  test("M1 leg (a): exactly three tick groups, their texts the three place names in route order, no fourth", () => {
    const groups = tickGroups(loop);
    expect(groups.length).toBe(3);
    expect(groups.map(tickText)).toEqual(["Cinder Bend", "Marrow Gap", "Ochre Ridge"]);
  });

  test("M1 leg (a): each tick group holds exactly one <circle>", () => {
    for (const group of tickGroups(loop)) {
      expect(group.match(/<circle\b/g)?.length).toBe(1);
    }
  });

  test('M1 leg (a): exactly one miles text, reading the formatted milesHeld plus " miles on the road"', () => {
    const miles = [...loop.matchAll(/<text class="route-loop-miles"[^>]*>([\s\S]*?)<\/text>/g)];
    expect(miles.length).toBe(1);
    expect(miles[0]![1]).toBe("1,234 miles on the road");
  });

  test("M2 leg (b): a stop with no route renders exactly the empty string", () => {
    const parked: HopeCoinStop = {
      holder: "cly-d", from: "2024-03-01", to: "2024-06-01", place: "Salt Pan",
      how: "Kept it on the shelf all spring.",
    };
    expect(routeLoop(parked)).toBe("");
  });

  test("M2 leg (b): renderHopeCoin draws a loop inside each routed stop's own <li>, after its how paragraph, and nowhere else", () => {
    const full = renderHopeCoin(odoData(loopChain));
    expect(full.match(/<svg class="route-loop"/g)?.length).toBe(2);

    const blocks = routeStopBlocks(full);
    expect(blocks.length).toBe(5);
    for (const [i, how] of [[1, "Drove it the whole way in the RV."], [3, "Took it out on the second trip."]] as const) {
      const block = blocks[i]!;
      const howHtml = `<p>${how}</p>`;
      expect(block).toContain(howHtml);
      // The loop lands AFTER the how sentence, inside the same stop's <li>.
      expect(block.indexOf('<svg class="route-loop"')).toBeGreaterThan(block.indexOf(howHtml));
    }
    for (const i of [0, 2, 4]) {
      expect(blocks[i]!).not.toContain("route-loop");
    }
  });

  const borderStop: HopeCoinStop = {
    holder: "bly-r", from: "2024-01-01", to: "2024-03-01", milesIn: 12, milesHeld: 2400,
    route: ["Cinder Bend", "Hope, British Columbia", "Marrow Gap"],
    how: "Drove it north and back.",
  };
  const borderLoop = routeLoop(borderStop);

  test("M3 leg (c): exactly one route-flag, inside the British Columbia tick, whose text names the crossing", () => {
    expect(borderLoop.match(/class="route-flag"/g)?.length).toBe(1);
    const groups = tickGroups(borderLoop);
    expect(groups.length).toBe(3);
    const flagged = groups.filter((g) => g.includes("route-flag"));
    expect(flagged.length).toBe(1);
    expect(tickText(flagged[0]!)).toBe("Hope, British Columbia, the coin's one border crossing");
  });

  test("M3 leg (c): the other two ticks carry neither the flag nor the border sentence", () => {
    const plain = tickGroups(borderLoop).filter((g) => !g.includes("British Columbia"));
    expect(plain.length).toBe(2);
    for (const group of plain) {
      expect(group).not.toContain("route-flag");
      expect(group).not.toContain("border crossing");
    }
  });

  // Review finding (2026-09-05): the first cut re-anchored an overflowing
  // label to the frame's edge, which for a short route with a long name
  // traded a right-edge overflow for a left-edge one - the three-name
  // British Columbia fixture above rendered its 53-character label running
  // off the left side, clipped by the svg's own viewBox. This leg pins the
  // numeric bound rather than the anchor, using the same 6.6-units-per-
  // character estimate routeLoop() measures with, so any future placement
  // scheme has to keep every label on the drawing to pass.
  test("every text on the loop stays inside the viewBox, at the shortest route that carries the long border label", () => {
    const viewBox = /viewBox="0 0 ([\d.]+) [\d.]+"/.exec(borderLoop);
    expect(viewBox).not.toBeNull();
    const frameWidth = Number.parseFloat(viewBox![1]!);

    const texts = [...borderLoop.matchAll(/<text[^>]*\bx="([\d.-]+)"[^>]*text-anchor="(\w+)"[^>]*>([\s\S]*?)<\/text>/g)];
    // Three tick names plus the mileage: if this count ever drops, the
    // regex stopped matching and the bounds below stopped being checked.
    expect(texts.length).toBe(4);
    for (const [, xAttr, anchor, content] of texts) {
      const x = Number.parseFloat(xAttr!);
      const w = content!.length * 6.6;
      const start = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start + w).toBeLessThanOrEqual(frameWidth);
    }
  });

  test("M5 leg (e): neither loop carries an em dash", () => {
    expect(loop).not.toContain("—");
    expect(borderLoop).not.toContain("—");
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

// Task 7 (#48), M4: site/styles.css guards for the five stint-loop rules.
// Each declaration gets its own check, by name, so a loop that lost its
// stroke, its fill, or its small monospace face fails on the declaration
// that went missing rather than on a vague "the rule changed."
describe("site/styles.css: the stint loop (Task 7, #48, M4)", () => {
  const css = stripCssComments(readFileSync(CSS_PATH, "utf8"));
  const ruleFor = (selector: string) => cssRules(css).find((r) => r.selector === selector);

  test(".route-loop is sized by CSS: width 100%, height auto, and a max-width", () => {
    const rule = ruleFor(".route-loop");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "width")).toBe("100%");
    expect(declValue(rule!.body, "height")).toBe("auto");
    expect(declValue(rule!.body, "max-width")).not.toBeNull();
  });

  test(".route-loop-path is a drawn pewter line, never a filled shape", () => {
    const rule = ruleFor(".route-loop-path");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "stroke")).toBe("var(--pewter-deep)");
    expect(declValue(rule!.body, "fill")).toBe("none");
  });

  test(".route-tick circle is filled pewter", () => {
    const rule = ruleFor(".route-tick circle");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "fill")).toBe("var(--pewter-deep)");
  });

  test(".route-flag is filled foil, the one accent on the loop", () => {
    const rule = ruleFor(".route-flag");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "fill")).toBe("var(--foil-deep)");
  });

  test(".route-tick text carries a font-family and a font-size of at most 11px", () => {
    const rule = ruleFor(".route-tick text");
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, "font-family")).not.toBeNull();
    const size = declValue(rule!.body, "font-size");
    expect(size).toMatch(/^\d+(\.\d+)?px$/);
    expect(Number.parseFloat(size!)).toBeLessThanOrEqual(11);
  });
});
