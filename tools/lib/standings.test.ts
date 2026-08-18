import { describe, expect, test } from "bun:test";
import { deriveStandings, type GamesData } from "./standings";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-mershon", since: "2026-04-14" },
  players: [
    { slug: "a", name: "Anne", aka: ["a"] },
    { slug: "b", name: "Bert", aka: ["b"] },
    { slug: "c", name: "Cleo", aka: ["c"] },
  ],
  games: [
    {
      date: "2026-07-14",
      hands: 10,
      startingStack: 5000,
      buyIn: 50,
      entries: 3,
      pot: 150,
      results: [
        { slug: "a", handle: "a", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "b", handle: "b", finish: 2, payout: 45, rebuys: 0, trophies: [] },
        { slug: "c", handle: "c", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
    {
      date: "2026-08-11",
      hands: 10,
      startingStack: 5000,
      buyIn: 50,
      entries: 3,
      pot: 150,
      results: [
        { slug: "c", handle: "c", finish: 1, payout: 105, rebuys: 1, trophies: ["hope-slayer"] },
        { slug: "a", handle: "a", finish: 2, payout: 45, rebuys: 0, trophies: [] },
        { slug: "b", handle: "b", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
  ],
};

describe("deriveStandings", () => {
  test("aggregates per player across games", () => {
    const s = deriveStandings(data);
    const anne = s.rows.find((r) => r.slug === "a")!;
    expect(anne).toEqual({
      slug: "a",
      name: "Anne",
      games: 2,
      wins: 1,
      cashes: 2,
      bestFinish: 1,
      totalPayout: 150,
      rebuys: 0,
      lastPlayed: "2026-08-11",
    });
  });
  test("sorts by wins, then cashes, then best finish", () => {
    const s = deriveStandings(data);
    expect(s.rows.map((r) => r.slug)).toEqual(["a", "c", "b"]);
  });
  test("carries the seeded coin holder and counts skulls from trophies", () => {
    const s = deriveStandings(data);
    expect(s.hopeCoin.holder).toBe("nick-mershon");
    expect(s.hopeCoin.skulls).toEqual({ a: 1, c: 1 });
  });
});
