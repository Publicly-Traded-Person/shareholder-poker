import { describe, expect, test } from "bun:test";
import { prepareGame } from "./publish-game";
import type { GamesData } from "./lib/standings";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();

const data: GamesData = {
  nextGame: { date: "2026-02-01", time: "7:00pm PT" },
  hopeCoin: { holder: "alice", since: "2026-01-01" },
  players: [
    { slug: "alice", name: "Alice", aka: ["alice"] },
    { slug: "bob", name: "Bob", aka: ["bob"] },
    { slug: "carol", name: "Carol", aka: ["carol"] },
  ],
  games: [],
};

const results = [
  { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: [] },
  { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
  { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
];

describe("prepareGame", () => {
  test("builds a game with entries from chip conservation", () => {
    const g = prepareGame(csv, results, data, { date: "2026-01-01", buyIn: 50 });
    expect(g.entries).toBe(3);
    expect(g.pot).toBe(150);
    expect(g.hands).toBe(3);
    expect(g.results[0].slug).toBe("alice");
  });
  test("halts on an unknown handle", () => {
    const bad = [...results.slice(0, 2), { handle: "mallory", finish: 3, payout: 0, rebuys: 0, trophies: [] }];
    expect(() => prepareGame(csv, bad, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/mallory/);
  });
  test("halts when declared buy-ins disagree with chip conservation", () => {
    const withRebuy = results.map(r => r.handle === "bob" ? { ...r, rebuys: 1 } : r);
    expect(() => prepareGame(csv, withRebuy, data, { date: "2026-01-01", buyIn: 50 }))
      .toThrow(/conservation|entries/i);
  });
  test("rejects a duplicate game date", () => {
    const withGame = { ...data, games: [prepareGame(csv, results, data, { date: "2026-01-01", buyIn: 50 })] };
    expect(() => prepareGame(csv, results, withGame, { date: "2026-01-01", buyIn: 50 })).toThrow(/already/);
  });
});
