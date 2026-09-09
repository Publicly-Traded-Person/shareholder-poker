import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
      bestField: 3,
      totalPayout: 150,
      rebuys: 0,
      lastPlayed: "2026-08-11",
    });
  });
  test("best finish is the one hardest to earn: 4th of 14 beats 4th of 6", () => {
    const wide: GamesData = {
      ...data,
      games: [
        { ...data.games[0], results: [
          { slug: "a", handle: "a", finish: 1, payout: 150, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 4, payout: 0, rebuys: 0, trophies: [] },
          { slug: "c", handle: "c", finish: 2, payout: 0, rebuys: 0, trophies: [] },
          { slug: "d", handle: "d", finish: 3, payout: 0, rebuys: 0, trophies: [] },
          { slug: "e", handle: "e", finish: 5, payout: 0, rebuys: 0, trophies: [] },
          { slug: "f", handle: "f", finish: 6, payout: 0, rebuys: 0, trophies: [] },
        ] },
        { ...data.games[1], results: [
          { slug: "a", handle: "a", finish: 1, payout: 700, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 4, payout: 0, rebuys: 0, trophies: [] },
          ...Array.from({ length: 12 }, (_, i) => ({ slug: `p${i}`, handle: `p${i}`, finish: i + 2 + (i >= 2 ? 1 : 0), payout: 0, rebuys: 0, trophies: [] as string[] })),
        ] },
      ],
    };
    const bert = deriveStandings(wide).rows.find((r) => r.slug === "b")!;
    expect(bert.bestFinish).toBe(4);
    expect(bert.bestField).toBe(14);
  });
  // Money outranks the win (Mike, 2026-09-09): a season's winnings is the
  // first number, wins are a fact on the row.
  test("sorts by winnings first: a bigger cash outranks a smaller win", () => {
    const s = deriveStandings({
      ...data,
      games: [
        { ...data.games[0], results: [
          { slug: "a", handle: "a", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 2, payout: 50, rebuys: 0, trophies: [] },
          { slug: "c", handle: "c", finish: 3, payout: 0, rebuys: 0, trophies: [] },
        ] },
        { ...data.games[1], results: [
          { slug: "c", handle: "c", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 2, payout: 90, rebuys: 0, trophies: [] },
          { slug: "a", handle: "a", finish: 3, payout: 0, rebuys: 0, trophies: [] },
        ] },
      ],
    });
    // b: $140 and no win; a and c: $100 and a win each.
    expect(s.rows.map((r) => r.slug)).toEqual(["b", "a", "c"]);
  });
  test("cashes break a winnings tie", () => {
    const s = deriveStandings({
      ...data,
      games: [
        { ...data.games[0], results: [
          { slug: "a", handle: "a", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 2, payout: 50, rebuys: 0, trophies: [] },
          { slug: "c", handle: "c", finish: 3, payout: 0, rebuys: 0, trophies: [] },
        ] },
        { ...data.games[1], results: [
          { slug: "c", handle: "c", finish: 1, payout: 100, rebuys: 0, trophies: [] },
          { slug: "b", handle: "b", finish: 2, payout: 50, rebuys: 0, trophies: [] },
          { slug: "a", handle: "a", finish: 3, payout: 0, rebuys: 0, trophies: [] },
        ] },
      ],
    });
    // Everyone has $100; b cashed twice, a and c once. Then name.
    expect(s.rows.map((r) => r.slug)).toEqual(["b", "a", "c"]);
  });
  test("best share breaks a cashes tie: 4th of 14 sorts above 4th of 7", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ slug: `q${i}`, handle: `q${i}`, finish: i + 1 + (i >= 3 ? 1 : 0), payout: 0, rebuys: 0, trophies: [] as string[] }));
    const fourteen = Array.from({ length: 14 }, (_, i) => ({ slug: `p${i}`, handle: `p${i}`, finish: i + 1 + (i >= 3 ? 1 : 0), payout: 0, rebuys: 0, trophies: [] as string[] }));
    const s2 = deriveStandings({
      ...data,
      games: [
        { ...data.games[0], results: [...seven, { slug: "a", handle: "a", finish: 4, payout: 0, rebuys: 0, trophies: [] }] },
        { ...data.games[1], results: [...fourteen, { slug: "b", handle: "b", finish: 4, payout: 0, rebuys: 0, trophies: [] }] },
      ],
    });
    const order = s2.rows.map((r) => r.slug);
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });
  test("a win is always Best: 1st of 6 stays over a later 2nd of 14", () => {
    const six = Array.from({ length: 5 }, (_, i) => ({ slug: `q${i}`, handle: `q${i}`, finish: i + 2, payout: 0, rebuys: 0, trophies: [] as string[] }));
    const fourteen = Array.from({ length: 13 }, (_, i) => ({ slug: `p${i}`, handle: `p${i}`, finish: i + 1 + (i >= 1 ? 1 : 0), payout: 0, rebuys: 0, trophies: [] as string[] }));
    const s = deriveStandings({
      ...data,
      games: [
        { ...data.games[0], results: [{ slug: "a", handle: "a", finish: 1, payout: 150, rebuys: 0, trophies: [] }, ...six] },
        { ...data.games[1], results: [...fourteen, { slug: "a", handle: "a", finish: 2, payout: 200, rebuys: 0, trophies: [] }] },
      ],
    });
    const anne = s.rows.find((r) => r.slug === "a")!;
    expect([anne.bestFinish, anne.bestField]).toEqual([1, 6]);
  });
  test("between two wins, the bigger field is Best", () => {
    const six = Array.from({ length: 5 }, (_, i) => ({ slug: `q${i}`, handle: `q${i}`, finish: i + 2, payout: 0, rebuys: 0, trophies: [] as string[] }));
    const fourteen = Array.from({ length: 13 }, (_, i) => ({ slug: `p${i}`, handle: `p${i}`, finish: i + 2, payout: 0, rebuys: 0, trophies: [] as string[] }));
    const s = deriveStandings({
      ...data,
      games: [
        { ...data.games[0], results: [{ slug: "a", handle: "a", finish: 1, payout: 150, rebuys: 0, trophies: [] }, ...six] },
        { ...data.games[1], results: [{ slug: "a", handle: "a", finish: 1, payout: 700, rebuys: 0, trophies: [] }, ...fourteen] },
      ],
    });
    const anne = s.rows.find((r) => r.slug === "a")!;
    expect([anne.bestFinish, anne.bestField]).toEqual([1, 14]);
  });
  test("the live table, September 2026: money, then cashes, then best share, then name", () => {
    const live = JSON.parse(readFileSync(new URL("../../site/data/games.json", import.meta.url), "utf8")) as GamesData;
    const s = deriveStandings(live);
    expect(s.rows.slice(0, 7).map((r) => r.slug)).toEqual([
      "chris-g", "josh-b", "thomas-d", "j", "nick-m", "beau-g", "kmikeym",
    ]);
    // Amy M. (3/7) and Drew A. (6/14) share a best share, so name decides.
    const order = s.rows.map((r) => r.slug);
    expect(order.indexOf("amy-m")).toBe(order.indexOf("drew-a") - 1);
  });
  test("carries the seeded coin holder and counts skulls from trophies", () => {
    const s = deriveStandings(data);
    expect(s.hopeCoin.holder).toBe("nick-mershon");
    expect(s.hopeCoin.skulls).toEqual({ a: 1, c: 1 });
  });
});
