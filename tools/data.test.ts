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
  test("names are 'First' or 'First L.' — never a full surname", () => {
    for (const p of data.players) {
      expect(p.name).toMatch(/^[A-Z][a-z]+( [A-Z]\.)?$/);
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
