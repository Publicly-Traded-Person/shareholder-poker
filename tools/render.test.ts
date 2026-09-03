import { describe, expect, test } from "bun:test";
import {
  esc, recordQualifier, renderStandings, renderGamesIndex, renderNextGameIcs, secondTuesday,
  playerSlugs, renderPlayer, renderHopeCoin,
} from "./render";
import { deriveStandings, type GamesData } from "./lib/standings";
import { TROPHIES } from "./lib/trophies";

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
const SIX_JUDGED_IDS = [
  "hope-slayer", "two-seven-showdown", "final-countdown", "cain-and-abel", "abel-stands", "kevin-deuce",
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
    // Founder's Table date: shelf-three and shelf-seven both get
    // founders-table from being here, on top of whatever judged ids their
    // own result carries.
    { date: "2026-07-14", hands: 100, startingStack: 5000, buyIn: 50, entries: 2, pot: 100,
      results: [
        // 2 judged ids + founders-table (game date) = 3 earned.
        { slug: "shelf-three", handle: "three", finish: 4, payout: 0, rebuys: 0,
          trophies: ["hope-slayer", "two-seven-showdown"] },
        // 6 judged ids + founders-table (game date) = 7 earned.
        { slug: "shelf-seven", handle: "seven", finish: 5, payout: 0, rebuys: 0, trophies: SIX_JUDGED_IDS },
      ] },
    // shelf-zero: no judged ids, finish outside the podium/champion/bubble
    // thresholds, no rebuy, no payout - earns nothing at all.
    { date: "2026-07-21", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-zero", handle: "zero", finish: 4, payout: 0, rebuys: 0, trophies: [] },
      ] },
    // 6 judged ids, no founders-table (wrong date), no champion/podium
    // (finish 5) = exactly 6 earned - the cap's own boundary from below.
    { date: "2026-07-28", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-six", handle: "six", finish: 5, payout: 0, rebuys: 0, trophies: SIX_JUDGED_IDS },
      ] },
    // The spine's latest game, so this is also where renderStandings finds
    // its reigning champion. finish 1 earns BOTH champion and podium, so
    // 6 judged ids + champion + podium = exactly 8 earned - two past the cap.
    { date: "2026-08-04", hands: 100, startingStack: 5000, buyIn: 50, entries: 1, pot: 0,
      results: [
        { slug: "shelf-eight", handle: "eight", finish: 1, payout: 0, rebuys: 0, trophies: SIX_JUDGED_IDS },
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
    // (shield/sapphire), founders-table (ribbon/pewter).
    const iSkull = shelf!.indexOf('mark--skull"');
    const iShield = shelf!.indexOf("mark--shield mark--sapphire");
    const iRibbon = shelf!.indexOf("mark--ribbon mark--pewter");
    expect(iSkull).toBeGreaterThan(-1);
    expect(iShield).toBeGreaterThan(iSkull);
    expect(iRibbon).toBeGreaterThan(iShield);
  });

  test("a player who has earned nothing still gets a present, empty Trophies cell (M2)", () => {
    const rows = standingsRowBlocks(html);
    expect(rows.length).toBe(5); // one per player on this fixture's roster
    for (const row of rows) expect(bareCells(row).length).toBe(2);
    const zeroRow = rowFor(html, "Zero Z.");
    const [, shelf] = bareCells(zeroRow);
    expect(shelf).toBe("");
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
//   count 3), founders-table (played 07-14, count 1) - 8 earned, 7 locked
//   (hope-slayer and the five judged shield trophies, plus the-bubble,
//   since neither game he cashed in had a bubble seat and 09-08 has zero
//   paid spots).
//   chris-g played 07-14 and 08-11 only (missed 09-08): earns hope-slayer
//   (judged, on his 07-14 result), champion (won 07-14, count 1), hope-coin
//   (his one stop has no `from`, so count 1 with an EMPTY dates array),
//   podium (top 3 both games, count 2), cashed (07-14 only, count 1),
//   clean-night (07-14, count 1), founders-table (07-14, count 1) - 7
//   earned, 8 locked (the five judged shield trophies, comeback since he
//   never rebought into a cash, regular since his run is only two games,
//   and the-bubble since neither game put him one out).
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

  test("renders one tile per registry entry, every earned tile before every locked tile", () => {
    const tiles = nick.match(/<div class="trophy( trophy--locked)?">/g) ?? [];
    expect(tiles.length).toBe(TROPHIES.length);
    const lastEarned = nick.lastIndexOf('<div class="trophy">');
    const firstLocked = nick.indexOf('<div class="trophy trophy--locked">');
    expect(lastEarned).toBeGreaterThan(-1);
    expect(firstLocked).toBeGreaterThan(-1);
    expect(lastEarned).toBeLessThan(firstLocked);
  });

  test("an earned count above one renders xN; a count of one renders no x marker", () => {
    expect(nick).toContain("<h3>Cashed</h3>"); // cashed twice (07-14, 08-11)
    expect(nick).toContain("x2 · 2026-08-11");
    expect(nick).toContain("<h3>Champion</h3>"); // won once
    expect(nick).not.toContain("x1"); // never renders for a count of one, anywhere on the page
  });

  test("a locked tile shows the trophy's earn line", () => {
    expect(nick).toContain("Reach showdown holding 7-2 with five or more players at the table.");
  });

  test("the Hope Coin can be earned with a count and an empty dates array, and renders no placeholder date", () => {
    // Chris's one stop has no `from`, so trophyCase gives him count 1 with
    // dates: []. The tile must not crash, must not print "x1" (count is
    // exactly one), and must not invent a date to fill the empty list.
    const idx = chris.indexOf("<h3>The Hope Coin</h3>");
    expect(idx).toBeGreaterThan(-1);
    const tileEnd = chris.indexOf("</div>", idx);
    const tile = chris.slice(idx, tileEnd).trim();
    expect(tile).toBe("<h3>The Hope Coin</h3>\n        <p></p>");
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
});
