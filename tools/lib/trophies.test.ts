// Tests for tools/lib/trophies.ts: the registry shape (TROPHIES) and the
// one function that reads it against a player's record (trophyCase). Every
// fixture below is synthetic (invented slugs, invented dates) per the
// repo's privacy rule for committed test data; nothing here reads
// site/data/games.json.
//
// Run: bun test tools/lib/trophies.test.ts

import { describe, expect, test } from "bun:test";
import { TROPHIES, trophyCase } from "./trophies";
import type { Game, GameResult, GamesData } from "./standings";

// --- fixture builders -------------------------------------------------
// Small helpers so each test states only the fields it cares about. None of
// this is exported; it exists to keep the legs below readable.

function result(overrides: {
  slug: string;
  finish?: number;
  payout?: number;
  rebuys?: number;
  trophies?: string[];
}): GameResult {
  return {
    slug: overrides.slug,
    handle: overrides.slug,
    finish: overrides.finish ?? 1,
    payout: overrides.payout ?? 0,
    rebuys: overrides.rebuys ?? 0,
    trophies: overrides.trophies ?? [],
  };
}

function game(date: string, results: GameResult[]): Game {
  return {
    date,
    hands: 10,
    startingStack: 5000,
    buyIn: 50,
    entries: results.length,
    pot: results.length * 50,
    results,
  };
}

function data(games: Game[], overrides: Partial<GamesData> = {}): GamesData {
  return {
    nextGame: { date: "2099-01-01", time: "7:00pm PT" },
    hopeCoin: { holder: "nobody", since: "2026-01-01" },
    players: [],
    games,
    ...overrides,
  };
}

// The full display-order id sequence: TROPHIES stably sorted by metal
// (foil, sapphire, copper, pewter), registry order preserved within a
// metal. Legs (m) and (n) both check against slices of this.
const DISPLAY_ORDER_IDS = [
  "hope-slayer", "champion", "hope-coin",
  "two-seven-showdown", "final-countdown", "cain-and-abel", "abel-stands", "kevin-deuce",
  "podium", "cashed", "clean-night", "comeback",
  "regular", "founders-table", "the-bubble",
];

// --- M1: the registry itself -------------------------------------------

describe("TROPHIES", () => {
  test("has 15 entries with 15 unique ids [a]", () => {
    expect(TROPHIES.length).toBe(15);
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(15);
  });

  const SHAPES = ["gem", "skull", "coin", "shield", "ribbon"];
  const METALS = ["foil", "sapphire", "copper", "pewter"];

  // One case per registry entry, named by id, so a broken entry names
  // itself in the test output instead of hiding inside a loop assertion.
  for (const trophy of TROPHIES) {
    test(trophy.id, () => {
      expect(trophy.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(trophy.name.length).toBeGreaterThan(0);
      expect(trophy.earn.length).toBeGreaterThan(0);
      expect(SHAPES).toContain(trophy.look.shape);
      expect(METALS).toContain(trophy.look.metal);
      // A rule exists exactly on derived entries: judged trophies are read
      // straight off a result's own trophies array and have nothing to
      // derive.
      expect(trophy.rule !== undefined).toBe(trophy.kind === "derived");
    });
  }
});

// --- M2: the judged path -------------------------------------------------

describe("trophyCase: judged ids", () => {
  test("collects every judged id the player carries, each with its own count [b]", () => {
    const d = data([
      game("2026-01-01", [result({ slug: "p", trophies: ["hope-slayer"] })]),
      game("2026-02-01", [result({ slug: "p", trophies: ["hope-slayer"] })]),
      game("2026-03-01", [result({ slug: "p", trophies: ["cain-and-abel"] })]),
    ]);
    const { earned } = trophyCase(d, "p");
    expect(earned.find((e) => e.id === "hope-slayer")?.count).toBe(2);
    expect(earned.find((e) => e.id === "cain-and-abel")?.count).toBe(1);
  });

  test("dates come back oldest first even when the games are given newest first [b2]", () => {
    const d = data([
      game("2026-03-01", [result({ slug: "p", trophies: ["cain-and-abel"] })]),
      game("2026-02-01", [result({ slug: "p", trophies: ["hope-slayer"] })]),
      game("2026-01-01", [result({ slug: "p", trophies: ["hope-slayer"] })]),
    ]);
    const { earned } = trophyCase(d, "p");
    expect(earned.find((e) => e.id === "hope-slayer")?.dates).toEqual([
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  test("only the queried slug's own results count, not a tablemate's in the same game [b3]", () => {
    const d = data([
      game("2026-01-01", [
        result({ slug: "p", finish: 2 }),
        result({ slug: "other", finish: 1, trophies: ["hope-slayer", "cain-and-abel"] }),
      ]),
    ]);
    const { earned } = trophyCase(d, "p");
    expect(earned.find((e) => e.id === "hope-slayer")).toBeUndefined();
    expect(earned.find((e) => e.id === "cain-and-abel")).toBeUndefined();
  });
});

// --- M3: the nine derived rules ------------------------------------------

describe("trophyCase: champion", () => {
  test("count and date reflect the win only, not the fourth [c]", () => {
    const d = data([
      game("2026-01-01", [result({ slug: "p", finish: 1 })]),
      game("2026-02-01", [result({ slug: "p", finish: 4 })]),
    ]);
    const champion = trophyCase(d, "p").earned.find((e) => e.id === "champion");
    expect(champion?.count).toBe(1);
    expect(champion?.dates).toEqual(["2026-01-01"]);
  });
});

describe("trophyCase: hope-coin", () => {
  test("earned with count of stops (a from-less stop still counts), absent with none [d]", () => {
    // "p" held the coin twice: first as the very first-ever holder (nobody
    // remembers when that started, so this stop has no `from`), lost it,
    // then took it back.
    const holder = data([], {
      hopeCoin: {
        holder: "p",
        since: "2026-02-01",
        history: [
          { holder: "p", to: "2026-01-01", how: "the original holder, nobody remembers when" },
          { holder: "other", from: "2026-01-01", to: "2026-02-01", how: "took three skulls off p" },
          { holder: "p", from: "2026-02-01", how: "took it back" },
        ],
      },
    });
    const coin = trophyCase(holder, "p").earned.find((e) => e.id === "hope-coin");
    expect(coin?.count).toBe(2);
    // Only the second stop has a `from`; the from-less first stop
    // contributes to count but never to dates.
    expect(coin?.dates).toEqual(["2026-02-01"]);

    const never = data([], { hopeCoin: { holder: "other", since: "2026-01-01", history: [] } });
    expect(trophyCase(never, "p").locked.some((t) => t.id === "hope-coin")).toBe(true);
  });
});

describe("trophyCase: podium", () => {
  test("earned on a finish of 3, not on a finish of 4 [e]", () => {
    const d = data([
      game("2026-01-01", [result({ slug: "p", finish: 3 })]),
      game("2026-02-01", [result({ slug: "q", finish: 4 })]),
    ]);
    expect(trophyCase(d, "p").earned.some((e) => e.id === "podium")).toBe(true);
    expect(trophyCase(d, "q").earned.some((e) => e.id === "podium")).toBe(false);
  });
});

describe("trophyCase: cashed", () => {
  test("earned on a payout above zero, not on zero [f]", () => {
    const d = data([
      game("2026-01-01", [
        result({ slug: "p", finish: 1, payout: 100 }),
        result({ slug: "q", finish: 4, payout: 0 }),
      ]),
    ]);
    expect(trophyCase(d, "p").earned.some((e) => e.id === "cashed")).toBe(true);
    expect(trophyCase(d, "q").earned.some((e) => e.id === "cashed")).toBe(false);
  });
});

describe("trophyCase: clean-night", () => {
  test("earned when cashed with zero rebuys, not when cashed with one [g]", () => {
    const d = data([
      game("2026-01-01", [
        result({ slug: "p", finish: 1, payout: 100, rebuys: 0 }),
        result({ slug: "q", finish: 2, payout: 50, rebuys: 1 }),
      ]),
    ]);
    expect(trophyCase(d, "p").earned.some((e) => e.id === "clean-night")).toBe(true);
    expect(trophyCase(d, "q").earned.some((e) => e.id === "clean-night")).toBe(false);
  });
});

describe("trophyCase: comeback", () => {
  test("earned when cashed with one rebuy, not when cashed with zero [h]", () => {
    const d = data([
      game("2026-01-01", [
        result({ slug: "p", finish: 1, payout: 100, rebuys: 1 }),
        result({ slug: "q", finish: 2, payout: 50, rebuys: 0 }),
      ]),
    ]);
    expect(trophyCase(d, "p").earned.some((e) => e.id === "comeback")).toBe(true);
    expect(trophyCase(d, "q").earned.some((e) => e.id === "comeback")).toBe(false);
  });
});

describe("trophyCase: regular", () => {
  test("absent on two consecutive games, earned on the third [i]", () => {
    const two = data([
      game("2026-01-01", [result({ slug: "p" })]),
      game("2026-02-01", [result({ slug: "p" })]),
    ]);
    expect(trophyCase(two, "p").locked.some((t) => t.id === "regular")).toBe(true);

    const three = data([
      game("2026-01-01", [result({ slug: "p" })]),
      game("2026-02-01", [result({ slug: "p" })]),
      game("2026-03-01", [result({ slug: "p" })]),
    ]);
    expect(trophyCase(three, "p").earned.some((e) => e.id === "regular")).toBe(true);
  });

  test("absent when the player's three games are broken by a missed game [i]", () => {
    const broken = data([
      game("2026-01-01", [result({ slug: "p" })]),
      game("2026-02-01", [result({ slug: "q" })]), // p sits this one out
      game("2026-03-01", [result({ slug: "p" })]),
      game("2026-04-01", [result({ slug: "p" })]),
    ]);
    expect(trophyCase(broken, "p").locked.some((t) => t.id === "regular")).toBe(true);
  });

  test("count is the best streak, even when a later streak is shorter [i]", () => {
    const d = data([
      game("2026-01-01", [result({ slug: "p" })]),
      game("2026-02-01", [result({ slug: "p" })]),
      game("2026-03-01", [result({ slug: "p" })]),
      game("2026-04-01", [result({ slug: "p" })]), // four-game streak
      game("2026-05-01", [result({ slug: "q" })]), // breaks it
      game("2026-06-01", [result({ slug: "p" })]),
      game("2026-07-01", [result({ slug: "p" })]), // later two-game streak
    ]);
    const regular = trophyCase(d, "p").earned.find((e) => e.id === "regular");
    expect(regular?.count).toBe(4);
  });
});

describe("trophyCase: founders-table", () => {
  test("earned in the 2026-07-14 game, still absent for a 2020 backfill alone [j]", () => {
    const founding = data([game("2026-07-14", [result({ slug: "p" })])]);
    expect(trophyCase(founding, "p").earned.some((e) => e.id === "founders-table")).toBe(true);

    const backfilled = data([game("2020-06-09", [result({ slug: "p" })])]);
    expect(trophyCase(backfilled, "p").locked.some((t) => t.id === "founders-table")).toBe(true);
  });
});

describe("trophyCase: the-bubble", () => {
  test("earned one place outside two paid spots, not by either payee [k]", () => {
    const twoSpot = data([
      game("2026-01-01", [
        result({ slug: "winner", finish: 1, payout: 100 }),
        result({ slug: "second", finish: 2, payout: 50 }),
        result({ slug: "bubble", finish: 3, payout: 0 }),
      ]),
    ]);
    expect(trophyCase(twoSpot, "bubble").earned.some((e) => e.id === "the-bubble")).toBe(true);
    expect(trophyCase(twoSpot, "winner").earned.some((e) => e.id === "the-bubble")).toBe(false);
    expect(trophyCase(twoSpot, "second").earned.some((e) => e.id === "the-bubble")).toBe(false);
  });

  test("earned one place outside three paid spots, not by any of the three payees [k]", () => {
    const threeSpot = data([
      game("2026-02-01", [
        result({ slug: "winner", finish: 1, payout: 100 }),
        result({ slug: "second", finish: 2, payout: 60 }),
        result({ slug: "third", finish: 3, payout: 40 }),
        result({ slug: "bubble", finish: 4, payout: 0 }),
      ]),
    ]);
    expect(trophyCase(threeSpot, "bubble").earned.some((e) => e.id === "the-bubble")).toBe(true);
    expect(trophyCase(threeSpot, "winner").earned.some((e) => e.id === "the-bubble")).toBe(false);
    expect(trophyCase(threeSpot, "second").earned.some((e) => e.id === "the-bubble")).toBe(false);
    expect(trophyCase(threeSpot, "third").earned.some((e) => e.id === "the-bubble")).toBe(false);
  });

  test("nobody is awarded it on a night with zero paid spots (review finding 4)", () => {
    // Modeled on a backfilled 2020 game: buy-ins and winnings are not
    // shown (README.md), so every result can legitimately carry
    // payout: 0. Without the paidSpots === 0 guard, finish === paidSpots +
    // 1 (0 + 1) matches the outright winner, which would invent an award
    // nobody earned.
    const zeroPaid = data([
      game("2020-06-09", [
        result({ slug: "winner", finish: 1, payout: 0 }),
        result({ slug: "second", finish: 2, payout: 0 }),
        result({ slug: "third", finish: 3, payout: 0 }),
      ]),
    ]);
    expect(trophyCase(zeroPaid, "winner").earned.some((e) => e.id === "the-bubble")).toBe(false);
    expect(trophyCase(zeroPaid, "second").earned.some((e) => e.id === "the-bubble")).toBe(false);
    expect(trophyCase(zeroPaid, "third").earned.some((e) => e.id === "the-bubble")).toBe(false);
  });
});

// --- M4: earned/locked partition and display order -----------------------

describe("trophyCase: earned/locked partition and display order", () => {
  test("earned and locked share no id and together cover the whole registry [l]", () => {
    const d = data([
      game("2026-01-01", [result({ slug: "p", finish: 1, payout: 100, trophies: ["hope-slayer"] })]),
    ]);
    const { earned, locked } = trophyCase(d, "p");
    const earnedIds = earned.map((e) => e.id);
    const lockedIds = locked.map((t) => t.id);
    expect(earnedIds.filter((id) => lockedIds.includes(id))).toEqual([]);
    expect(earnedIds.length + lockedIds.length).toBe(15);
    expect(new Set([...earnedIds, ...lockedIds])).toEqual(new Set(TROPHIES.map((t) => t.id)));
  });

  test("locked is the full registry, in display order, for a player who earns nothing [m]", () => {
    const d = data([game("2026-01-01", [result({ slug: "other", finish: 1, payout: 100 })])]);
    const locked = trophyCase(d, "ghost").locked;
    expect(locked.map((t) => t.id)).toEqual(DISPLAY_ORDER_IDS);
  });

  test("earned comes back in display order across all four metals, not match order [n]", () => {
    // One game gives "p" a trophy from every metal: champion is foil,
    // cain-and-abel is sapphire, podium/cashed/clean-night are copper
    // (finish 1 with no rebuy pays for all three), and the game's own date
    // earns founders-table, pewter. Raw registry order would put
    // cain-and-abel before champion; display order (this test's point)
    // does not.
    const d = data([
      game("2026-07-14", [
        result({ slug: "p", finish: 1, payout: 100, rebuys: 0, trophies: ["cain-and-abel"] }),
        result({ slug: "q", finish: 2, payout: 0, rebuys: 0 }),
      ]),
    ]);
    const earned = trophyCase(d, "p").earned;
    expect(earned.map((e) => e.id)).toEqual([
      "champion",
      "cain-and-abel",
      "podium",
      "cashed",
      "clean-night",
      "founders-table",
    ]);
  });
});
