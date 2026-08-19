import { describe, expect, test } from "bun:test";
import { renderStandings, renderGamesIndex } from "./render";
import type { GamesData } from "./lib/standings";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-m", since: "2026-04-14" },
  players: [
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
    { slug: "chris-g", name: "Chris G.", aka: ["LEWD"] },
  ],
  games: [
    { date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      results: [
        { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 2, trophies: [] },
      ] },
  ],
};

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
  test("states the record starts with July 2026 and earlier seasons are being backfilled", () => {
    expect(html).toContain("This record starts with July 2026");
    expect(html).toContain("2020, and April and June 2026");
    expect(html).toContain("backfilled");
  });
  test("contains no em dash", () => {
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
  test("states the record starts with July 2026 and earlier seasons are being backfilled", () => {
    expect(html).toContain("This record starts with July 2026");
    expect(html).toContain("2020, and April and June 2026");
    expect(html).toContain("backfilled");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
});
