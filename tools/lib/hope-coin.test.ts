// Tests for tools/lib/hope-coin.ts: validateCoinHistory, the chain guard
// for hopeCoin.history. Every fixture is synthetic (invented slugs,
// invented dates) per the repo's privacy rule for committed test data;
// nothing here reads site/data/games.json — tools/data.test.ts is what
// runs this validator against the real file.
//
// Run: bun test tools/lib/hope-coin.test.ts

import { describe, expect, test } from "bun:test";
import { validateCoinHistory } from "./hope-coin";
import type { GamesData, HopeCoinStop } from "./standings";

// --- fixture builder ----------------------------------------------------
// A minimal GamesData with just enough shape for the validator: it only
// ever reads data.hopeCoin, so games/players are always empty here.
function data(holder: string, since: string, history?: HopeCoinStop[]): GamesData {
  return {
    nextGame: { date: "2099-01-01", time: "7:00pm PT" },
    hopeCoin: history === undefined ? { holder, since } : { holder, since, history },
    players: [],
    games: [],
  };
}

describe("validateCoinHistory: M1 — the five broken chains", () => {
  test("[a] stops out of ascending date order throw, naming the later date", () => {
    // stop 0's own from/to is backwards (2026-06-01 -> 2026-01-01) purely to
    // isolate the order check from the handoff-match check below: its `to`
    // still equals stop 1's `from` exactly, so only ordering is violated.
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2026-06-01", to: "2026-01-01", how: "won it" },
      { holder: "bob", from: "2026-01-01", how: "took it back" },
    ];
    expect(() => validateCoinHistory(data("bob", "2026-01-01", history))).toThrow(
      /out of order.*2026-06-01/s
    );
  });

  test("[b] a stop's `to` differing from the next stop's `from` throws, naming the mismatch", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2025-12-01", to: "2026-01-01", how: "won it" },
      { holder: "bob", from: "2026-02-02", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("bob", "2026-02-02", history))).toThrow(
      /2026-01-01.*2026-02-02/s
    );
  });

  test("[c] a non-final stop with no `to` throws", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2025-12-01", how: "won it" }, // not last, no `to`
      { holder: "bob", from: "2026-01-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("bob", "2026-01-01", history))).toThrow(
      /stop 1 \(alice\) has no "to"/
    );
  });

  test("[d] a non-first stop with no `from` throws", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2025-12-01", to: "2026-01-01", how: "won it" },
      { holder: "bob", how: "took it" }, // not first, no `from`
    ];
    expect(() => validateCoinHistory(data("bob", "2026-01-01", history))).toThrow(
      /stop 2 \(bob\) has no "from"/
    );
  });

  test("[e-i] hopeCoin.holder disagreeing with the last stop's holder throws", () => {
    const history: HopeCoinStop[] = [
      { holder: "beau-g", from: "2026-01-01", how: "won it" },
    ];
    // hopeCoin.holder says nick-m, but the only (and therefore last) stop is beau-g.
    expect(() => validateCoinHistory(data("nick-m", "2026-01-01", history))).toThrow(
      /hopeCoin\.holder is "nick-m".*"beau-g"/s
    );
  });

  test("[e-ii] hopeCoin.since disagreeing with the last stop's `from` throws", () => {
    const history: HopeCoinStop[] = [
      { holder: "beau-g", from: "2026-01-01", how: "won it" },
    ];
    // holder agrees, but since (2026-02-02) does not match the stop's from (2026-01-01).
    expect(() => validateCoinHistory(data("beau-g", "2026-02-02", history))).toThrow(
      /hopeCoin\.since is "2026-02-02".*"2026-01-01"/s
    );
  });
});

describe("validateCoinHistory: M2 — well-formed histories return without throwing", () => {
  test("[f] a well-formed three-stop history does not throw", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2025-10-01", to: "2025-12-01", how: "found it" },
      { holder: "bob", from: "2025-12-01", to: "2026-01-01", how: "won it" },
      { holder: "carol", from: "2026-01-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-01-01", history))).not.toThrow();
  });

  test("[g] a first stop with no `from`, otherwise well formed, does not throw", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "nobody remembers" }, // first stop, no from
      { holder: "bob", from: "2026-01-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("bob", "2026-01-01", history))).not.toThrow();
  });

  test("[h] hopeCoin with no `history` field at all does not throw", () => {
    expect(() => validateCoinHistory(data("nick-m", "2026-04-14"))).not.toThrow();
  });

  test("an empty `history` array does not throw (same claim as no history at all)", () => {
    expect(() => validateCoinHistory(data("nick-m", "2026-04-14", []))).not.toThrow();
  });
});

describe("validateCoinHistory: date format (2026-09-05, Beau's chain of custody)", () => {
  // Seven of the twelve real handoffs are known only to the month, so a
  // stop date is YYYY-MM-DD or YYYY-MM and nothing else. The page already
  // prints month and year, so a month-only value shows exactly like a full
  // one; what this rule buys is a loud failure on a typo ("2022-4",
  // "04/2022", "April 2022") that string comparison would otherwise order
  // wrongly and silently.
  test("a month-only date is accepted, and handoffs match on the same month string", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2022-04", how: "started here" },
      { holder: "bob", from: "2022-04", to: "2022-07-14", how: "season champion" },
      { holder: "carol", from: "2022-07-14", how: "third skull" },
    ];
    expect(() => validateCoinHistory(data("carol", "2022-07-14", history))).not.toThrow();
  });
  test("a date that is neither YYYY-MM-DD nor YYYY-MM throws, naming the stop and the value", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2022-4", how: "started here" },
      { holder: "bob", from: "2022-4", how: "season champion" },
    ];
    expect(() => validateCoinHistory(data("bob", "2022-4", history))).toThrow(/stop 1 \(alice\).*"2022-4"/s);
  });
  test("a month-only date with an impossible month throws", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2022-13", how: "started here" },
      { holder: "bob", from: "2022-13", how: "season champion" },
    ];
    expect(() => validateCoinHistory(data("bob", "2022-13", history))).toThrow(/"2022-13"/);
  });
});

describe("validateCoinHistory: the equal-date boundary (deliberate ruling)", () => {
  // The Coin can change hands twice in one game night: a stop whose own
  // `from` equals its own `to` (won and lost the same date), immediately
  // followed by the next stop starting on that same date. That puts two
  // adjacent stops' `from` values exactly equal — a real, legitimate
  // chain, not an ordering error. Only a *decrease* is a violation (leg a
  // above); a tie is not.
  test("two adjacent stops sharing the same start date do not throw", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", from: "2026-01-01", to: "2026-03-01", how: "won it in January" },
      { holder: "bob", from: "2026-03-01", to: "2026-03-01", how: "took it, lost it same night" },
      { holder: "carol", from: "2026-03-01", how: "took it right back" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).not.toThrow();
  });
});
