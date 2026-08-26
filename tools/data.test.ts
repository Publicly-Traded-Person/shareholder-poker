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
