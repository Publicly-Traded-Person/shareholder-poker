// Guards on the committed site/data/games.json — the data spine every page
// derives from. These run against the REAL data file (not fixtures) so a bad
// publish fails the suite before it ships.
//
// The privacy format rule (Mike, 2026-08-18): player display names are
// "First L." (first name + last initial), never a full surname, so nobody can
// google a player and find their poker record. Slugs follow the same rule
// because /data/games.json is a public URL. Handle-derived slugs with no
// surname (kmikeym, webvee) are fine. See docs/brand.md "Names".
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { validateCoinHistory } from "./lib/hope-coin";
import type { GamesData } from "./lib/standings";

const data = JSON.parse(
  await Bun.file(new URL("../site/data/games.json", import.meta.url)).text()
) as GamesData;

describe("player privacy format", () => {
  test("names are 'First', 'First L.', or a bare initial — never a full surname", () => {
    // A bare initial ("J.") is allowed: it is how one player asks to be
    // named, and it discloses less than a first name, not more.
    for (const p of data.players) {
      expect(p.name).toMatch(/^([A-Z][a-z]+( [A-Z]\.)?|[A-Z]\.)$/);
    }
  });
  test("slugs carry at most a single-letter surname initial", () => {
    for (const p of data.players) {
      expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z])?$/);
    }
  });
});

describe("data consistency (the checks the seed validator ran, now permanent)", () => {
  const slugs = new Set(data.players.map(p => p.slug));
  test("every result resolves to a known player slug", () => {
    for (const g of data.games)
      for (const r of g.results) expect(slugs.has(r.slug)).toBe(true);
  });
  test("pot equals entries x buy-in, and entries equal players + rebuys", () => {
    for (const g of data.games) {
      expect(g.entries * g.buyIn).toBe(g.pot);
      const buyins = g.results.length + g.results.reduce((n, r) => n + r.rebuys, 0);
      expect(buyins).toBe(g.entries);
    }
  });
  test("finishes are dense 1..N", () => {
    for (const g of data.games) {
      const finishes = g.results.map(r => r.finish).sort((a, b) => a - b);
      finishes.forEach((f, i) => expect(f).toBe(i + 1));
    }
  });
  test("hopeCoin holder is a known slug", () => {
    expect(slugs.has(data.hopeCoin.holder)).toBe(true);
  });
});

// Task 6: the Hope Coin chain validator, run against the REAL file. This is
// what puts site/data/games.json's own hopeCoin.history under the same rule
// Charlie's monthly append is checked against — see tools/lib/hope-coin.ts
// and its own fixture-based tests in tools/lib/hope-coin.test.ts.
describe("hope coin chain (Task 6)", () => {
  test("validateCoinHistory does not throw on the committed data", () => {
    expect(() => validateCoinHistory(data)).not.toThrow();
  });
  // Beau's chain of custody, 2026-09-05: twelve stops from the coin's first
  // home to Nick today. This replaced the one-stop seed of 2026-09-02, and
  // the pending flag came off in the same commit because the chain now
  // starts where the coin did. If a stop is ever added or corrected, update
  // the count and the endpoints here in the same commit, on purpose: this
  // test is the record's own statement of how long the journey is.
  test("history is Beau's twelve-stop chain: starts with kmikeym, undated, ends with nick-m since 2026-04-14", () => {
    const history = data.hopeCoin.history ?? [];
    expect(history.length).toBe(12);
    expect(history[0].holder).toBe("kmikeym");
    expect(history[0].from).toBeUndefined();
    expect(history[history.length - 1].holder).toBe("nick-m");
    expect(history[history.length - 1].from).toBe("2026-04-14");
    expect(history[history.length - 1].to).toBeUndefined();
    for (const stop of history) expect(stop.how.length).toBeGreaterThan(0);
  });
  test("every stop's holder is on the roster, so the page has a name to print", () => {
    const roster = new Set(data.players.map(p => p.slug));
    for (const stop of data.hopeCoin.history ?? []) expect(roster.has(stop.holder)).toBe(true);
  });
  test("the journey reaches the coin's first stop, so historyPending is gone", () => {
    expect(data.hopeCoin.historyPending).toBeUndefined();
  });
  test("stop dates are YYYY-MM-DD, or YYYY-MM when only the month is on record", () => {
    for (const stop of data.hopeCoin.history ?? []) {
      for (const d of [stop.from, stop.to]) {
        if (d !== undefined) expect(d).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      }
    }
  });

  // Task 3, #48: Beau's figures pinned against the real chain. These four
  // tests are the record's own statement of the odometer numbers driving
  // the Hope Coin page's route graphic; a future correction to a leg's
  // mileage or a road-trip route updates these pins in the same commit, on
  // purpose, so nobody discovers the drift after the page has already
  // shipped a wrong number.

  // (a) [M1] The odometer total the coin page adds up: every milesIn plus
  // every milesHeld across the whole chain. If a leg's mileage is ever
  // corrected, or a stop's miles field added or removed, this sum moves and
  // the pin must move with it in the same commit.
  test("the sum of every milesIn and every milesHeld across the chain is 17677", () => {
    const history = data.hopeCoin.history ?? [];
    const total = history.reduce(
      (sum, stop) => sum + (stop.milesIn ?? 0) + (stop.milesHeld ?? 0),
      0
    );
    expect(total).toBe(17677);
  });

  // (b) [M2] Exactly two stops are road trips with a named route: both of
  // Beau's RV stints. Pinning the exact arrays (not just their length)
  // catches a place dropped, reordered, or misspelled on either leg.
  test("exactly two stops carry a route, both beau-g's RV trips, with their exact stops and milesHeld", () => {
    const history = data.hopeCoin.history ?? [];
    const routed = history.filter(stop => stop.route !== undefined);
    expect(routed.length).toBe(2);
    for (const stop of routed) expect(stop.holder).toBe("beau-g");
    expect(routed[0].route).toEqual([
      "Petaluma",
      "Puget Sound",
      "Southern California",
      "Pahrump",
      "Las Vegas",
      "San Diego",
    ]);
    expect(routed[0].milesHeld).toBe(5420);
    expect(routed[1].route).toEqual([
      "Seattle",
      "Wenatchee",
      "Bellingham",
      "Hope, British Columbia",
      "Cassiar Highway",
      "Yukon",
      "Fairbanks",
      "Denali",
      "Homer, Alaska",
    ]);
    expect(routed[1].milesHeld).toBe(4454);
  });

  // (c) [M3] milesIn is absent only on the first and last stops (nobody
  // knows the mileage of the coin arriving at its own origin, and the last
  // stop's figure rests on an assumed city per the brief) and present on
  // every stop in between. A stop missing its figure fails by index here
  // rather than silently leaving a gap in the page's odometer strip.
  test("milesIn is absent at the first and last stop and present at every stop between", () => {
    const history = data.hopeCoin.history ?? [];
    expect(history.length).toBe(12);
    expect(history[0].milesIn).toBeUndefined();
    expect(history[history.length - 1].milesIn).toBeUndefined();
    for (let i = 1; i <= history.length - 2; i++) {
      expect(typeof history[i].milesIn).toBe("number");
    }
  });

  // (d) [M4] The file stays in canonical JSON.stringify(data, null, 2) form
  // with a trailing newline, so a published game (or this task's edit)
  // appends as a small, readable diff rather than a reformatted blob.
  test("the file text is the canonical JSON.stringify(data, null, 2) round trip, byte for byte", async () => {
    const text = await Bun.file(
      new URL("../site/data/games.json", import.meta.url)
    ).text();
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  });
});

describe("card set references", () => {
  test("cardSet names that month's set page, and the page exists", () => {
    for (const g of data.games) {
      if (g.cardSet === undefined) continue;
      expect(g.cardSet).toBe(g.date.slice(0, 7));
      expect(
        existsSync(new URL(`../site/cards/${g.cardSet}/index.html`, import.meta.url).pathname)
      ).toBe(true);
    }
  });
});
