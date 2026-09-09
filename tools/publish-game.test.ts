import { describe, expect, test } from "bun:test";
import { prepareGame } from "./publish-game";
import type { GamesData } from "./lib/standings";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();
// Two tables of one tournament (see the fixtures): ivy busts on table 2 after
// one rebuy and never reaches the final table, so she is invisible to any
// check that reads only the final table's stacks.
const t1 = await Bun.file(new URL("./fixtures/mini-t1.csv", import.meta.url)).text();
const t2 = await Bun.file(new URL("./fixtures/mini-t2.csv", import.meta.url)).text();

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

describe("prepareGame, two tables", () => {
  const sixPlayers: GamesData = {
    ...data,
    players: ["dave", "erin", "frank", "gina", "hank", "ivy"].map(n => ({ slug: n, name: n[0].toUpperCase() + n.slice(1), aka: [n] })),
  };
  const six = [
    { handle: "gina", finish: 1, payout: 245, rebuys: 0, trophies: [] },
    { handle: "dave", finish: 2, payout: 105, rebuys: 0, trophies: [] },
    { handle: "hank", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    { handle: "frank", finish: 4, payout: 0, rebuys: 0, trophies: [] },
    { handle: "erin", finish: 5, payout: 0, rebuys: 0, trophies: [] },
    { handle: "ivy", finish: 6, payout: 0, rebuys: 1, trophies: [] },
  ];
  test("reads both logs as one game: entries from the final table, hands from every table", () => {
    const g = prepareGame([t1, t2], six, sixPlayers, { date: "2026-01-01", buyIn: 50, startingStack: 1000 });
    expect(g.entries).toBe(7);
    expect(g.pot).toBe(350);
    expect(g.hands).toBe(6);
    expect(g.results.map(r => r.slug)).toEqual(["gina", "dave", "hank", "frank", "erin", "ivy"]);
  });
  test("halts when results.json leaves out a player who only ever sat at a non-final table", () => {
    // Chip conservation cannot see this: 5 players + 2 rebuys still equals
    // the 7 entries the final stacks add up to. Only the handle set can.
    const withoutIvy = [
      ...six.slice(0, 4),
      { handle: "erin", finish: 5, payout: 0, rebuys: 2, trophies: [] },
    ];
    expect(() => prepareGame([t1, t2], withoutIvy, sixPlayers, { date: "2026-01-01", buyIn: 50, startingStack: 1000 }))
      .toThrow(/ivy/);
  });
});

describe("prepareGame", () => {
  test("builds a game with entries from chip conservation", () => {
    const g = prepareGame([csv], results, data, { date: "2026-01-01", buyIn: 50 });
    expect(g.entries).toBe(3);
    expect(g.pot).toBe(150);
    expect(g.hands).toBe(3);
    expect(g.results[0].slug).toBe("alice");
  });
  test("halts on an unknown handle", () => {
    const bad = [...results.slice(0, 2), { handle: "mallory", finish: 3, payout: 0, rebuys: 0, trophies: [] }];
    expect(() => prepareGame([csv], bad, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/mallory/);
  });
  test("halts when declared buy-ins disagree with chip conservation", () => {
    const withRebuy = results.map(r => r.handle === "bob" ? { ...r, rebuys: 1 } : r);
    expect(() => prepareGame([csv], withRebuy, data, { date: "2026-01-01", buyIn: 50 }))
      .toThrow(/conservation|entries/i);
  });
  test("rejects a duplicate game date", () => {
    const withGame = { ...data, games: [prepareGame([csv], results, data, { date: "2026-01-01", buyIn: 50 })] };
    expect(() => prepareGame([csv], results, withGame, { date: "2026-01-01", buyIn: 50 })).toThrow(/already/);
  });
  test("halts on a gapped finish order (1, 2, 4 instead of 1, 2, 3)", () => {
    const gapped = [
      { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: [] },
      { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "carol", finish: 4, payout: 0, rebuys: 0, trophies: [] },
    ];
    expect(() => prepareGame([csv], gapped, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/finish/i);
  });
  test("halts on a duplicated finish", () => {
    const duped = [
      { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: [] },
      { handle: "bob", finish: 1, payout: 45, rebuys: 0, trophies: [] },
      { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    expect(() => prepareGame([csv], duped, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/finish/i);
  });
  test("halts when payouts do not sum to the pot", () => {
    const wrongPayout = [
      { handle: "alice", finish: 1, payout: 100, rebuys: 0, trophies: [] },
      { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    expect(() => prepareGame([csv], wrongPayout, data, { date: "2026-01-01", buyIn: 50 })).toThrow(/payout/i);
  });
  test("halts on a trophy id the registry does not know", () => {
    const typo = [
      { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slyer"] },
      { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    expect(() => prepareGame([csv], typo, data, { date: "2026-01-01", buyIn: 50 })).toThrow(
      /hope-slyer.*trophies\.ts/s
    );
  });
  test("accepts trophy ids the registry knows, unchanged", () => {
    const withTrophies = [
      { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer", "cain-and-abel"] },
      { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    const g = prepareGame([csv], withTrophies, data, { date: "2026-01-01", buyIn: 50 });
    expect(g.results.find(r => r.slug === "alice")!.trophies).toEqual(["hope-slayer", "cain-and-abel"]);
  });
  // Abel's Triumph is Gene's alone (tools/lib/trophies.ts, `only`). A
  // results.json that hands it to anyone else is a typo in the wrong row,
  // and trophyCase would silently hide it on that player's page: they would
  // be recorded as earning a trophy nobody could ever see. Halt instead.
  // The synthetic log seats carol; on Gene's night that seat is his, so his
  // aka list carries both handles (prepareGame checks that everyone seated
  // in the log has a row, matched by slug through `aka`).
  const withGene: GamesData = {
    ...data,
    players: [...data.players.slice(0, 2), { slug: "webvee", name: "Gene", aka: ["webvee", "carol"] }],
  };
  test("halts on an only-for-one-player trophy recorded on anyone else", () => {
    const misfiled = [
      { handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: ["abels-triumph"] },
      { handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "webvee", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    expect(() => prepareGame([csv], misfiled, withGene, { date: "2026-01-01", buyIn: 50 })).toThrow(
      /abels-triumph.*webvee.*alice/s
    );
  });
  test("accepts that same trophy on the one player it belongs to", () => {
    const genesNight = [
      { handle: "webvee", finish: 1, payout: 105, rebuys: 0, trophies: ["abels-triumph"] },
      { handle: "alice", finish: 2, payout: 45, rebuys: 0, trophies: [] },
      { handle: "bob", finish: 3, payout: 0, rebuys: 0, trophies: [] },
    ];
    const g = prepareGame([csv], genesNight, withGene, { date: "2026-01-01", buyIn: 50 });
    expect(g.results.find(r => r.slug === "webvee")!.trophies).toEqual(["abels-triumph"]);
  });
  test("accepts a game where every result's trophies is empty (the happy path, unchanged by the new check)", () => {
    const g = prepareGame([csv], results, data, { date: "2026-01-01", buyIn: 50 });
    expect(g.entries).toBe(3);
    expect(g.pot).toBe(150);
    expect(g.results.map(r => r.finish)).toEqual([1, 2, 3]);
  });
});
