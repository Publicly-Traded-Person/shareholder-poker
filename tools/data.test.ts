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
  test("history carries exactly the one seeded stop: nick-m from 2026-04-14, still current", () => {
    // Mike, 2026-09-02: ship with only the one stop the record already
    // knows; every earlier stop is his to reconstruct from memory and
    // arrives later as a data-only commit. Never let this test's shape grow
    // to expect more than one stop until that commit actually lands.
    const history = data.hopeCoin.history ?? [];
    expect(history.length).toBe(1);
    expect(history[0].holder).toBe("nick-m");
    expect(history[0].from).toBe("2026-04-14");
    expect(history[0].to).toBeUndefined();
    expect(history[0].how.length).toBeGreaterThan(0);
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
