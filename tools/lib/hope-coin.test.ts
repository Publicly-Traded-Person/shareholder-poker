// Tests for tools/lib/hope-coin.ts: validateCoinHistory, the chain guard
// for hopeCoin.history, and the pure month and mile helpers built beside
// it (monthIndex, tenureMonths, holderShares, odometer, formatMiles) that
// the odometer tile, the donut, the tenure strip, and the legend table all
// read from (spec 2026-09-05-hope-coin-infographics-design.md, section 6
// and 7.1). Every fixture is synthetic (invented slugs, invented dates)
// per the repo's privacy rule for committed test data; nothing here reads
// site/data/games.json — tools/data.test.ts is what runs this validator
// against the real file.
//
// Run: bun test tools/lib/hope-coin.test.ts

import { describe, expect, test } from "bun:test";
import { formatMiles, holderShares, monthIndex, odometer, tenureMonths, validateCoinHistory } from "./hope-coin";
import type { HolderShare, TenureSegment } from "./hope-coin";
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

describe("validateCoinHistory: rule 5, milesIn, milesHeld, and route (2026-09-05, the odometer and route graphic)", () => {
  // [a] M1: a chain that uses all three fields correctly, plus milesIn
  // alone on the stops around it, passes with no throw. milesIn is put on
  // the first and last stops here purely to prove the rule accepts it in
  // both positions; the HopeCoinStop comment's usual guidance (absent on
  // the first stop) is about what real data looks like, not something this
  // rule enforces.
  test("[a] milesIn, milesHeld, and a route on the middle stop, plus milesIn on the others, does not throw", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it", milesIn: 0 },
      {
        holder: "bob",
        from: "2026-01-01",
        to: "2026-03-01",
        how: "drove it around in the RV",
        milesIn: 648,
        milesHeld: 4454,
        route: ["Seattle", "Portland"],
      },
      { holder: "carol", from: "2026-03-01", how: "took it", milesIn: 12 },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).not.toThrow();
  });

  // [b] through [i] all put the one bad value on stop 2, held by the
  // invented slug "bob", and check the thrown message names both the
  // 1-based position and the holder.
  test("[b] a negative milesIn throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", milesIn: -1 },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[c] a non-integer milesIn throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", milesIn: 1.5 },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[d] a milesHeld of zero throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", milesHeld: 0 },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[e] a negative milesHeld throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", milesHeld: -5 },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[f] a route with no milesHeld on the same stop throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", route: ["Seattle"] },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[g] an empty route array throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      { holder: "bob", from: "2026-01-01", to: "2026-03-01", how: "drove it", milesHeld: 10, route: [] },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[h] a route containing an empty string throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      {
        holder: "bob",
        from: "2026-01-01",
        to: "2026-03-01",
        how: "drove it",
        milesHeld: 10,
        route: ["Seattle", ""],
      },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  test("[i] a route name containing an em dash throws, naming the stop and holder", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2026-01-01", how: "found it" },
      {
        holder: "bob",
        from: "2026-01-01",
        to: "2026-03-01",
        how: "drove it",
        milesHeld: 10,
        route: ["Seattle—ish"],
      },
      { holder: "carol", from: "2026-03-01", how: "took it" },
    ];
    expect(() => validateCoinHistory(data("carol", "2026-03-01", history))).toThrow(/stop 2 \(bob\)/);
  });

  // [j] M3: nothing above touches the describe blocks earlier in this file.
  // None of their fixtures set milesIn, milesHeld, or route, so rule 5
  // never fires for them, and every existing assertion in this file (both
  // the throws and the not.toThrow() calls) still holds unchanged. Not
  // duplicated here; see the earlier describe blocks in this same file.
});

describe("monthIndex: M1, a plain month index, not a calendar", () => {
  test("[a] a month-only date and the same month with a day give the same index", () => {
    // 2023 * 12 + 6 is what a one-based month (treating July as month 7
    // rather than index 6) or a day-sensitive parse would both get wrong.
    expect(monthIndex("2023-07")).toBe(2023 * 12 + 6);
    expect(monthIndex("2023-07-14")).toBe(2023 * 12 + 6);
  });
});

describe("tenureMonths: M2, one segment per stop, in chain order", () => {
  test("[b] an undated first stop, a month-only handoff, and a same-month stop", () => {
    // alice is the undated first stop (no "from"): she produces no
    // segment. bob's "from" is a full date, so his segment's "from" must
    // come back cut to its month. bob's "to" is month-only, the handoff
    // carol's "from" matches exactly, both already the YYYY-MM form.
    // carol's "from" and "to" share a month, so her segment has months: 0.
    // dave is the current holder (no "to"); latestGame is five months
    // after his "from", so his segment's "to" is latestGame's own month.
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2023-07", how: "found it" },
      { holder: "bob", from: "2023-07-15", to: "2023-10", how: "won it" },
      { holder: "carol", from: "2023-10", to: "2023-10", how: "took it and handed it right back" },
      { holder: "dave", from: "2023-10", how: "holds it now" },
    ];
    expect(tenureMonths(history, "2024-03-20")).toEqual([
      { holder: "bob", from: "2023-07", to: "2023-10", months: 3 },
      { holder: "carol", from: "2023-10", to: "2023-10", months: 0 },
      { holder: "dave", from: "2023-10", to: "2024-03", months: 5 },
    ] satisfies TenureSegment[]);
  });

  test("[c] a first stop with a from produces a segment too", () => {
    const history: HopeCoinStop[] = [
      { holder: "eve", from: "2022-01", to: "2022-04", how: "found it" },
      { holder: "frank", from: "2022-04", how: "took it" },
    ];
    expect(tenureMonths(history, "2022-09-01")).toEqual([
      { holder: "eve", from: "2022-01", to: "2022-04", months: 3 },
      { holder: "frank", from: "2022-04", to: "2022-09", months: 5 },
    ] satisfies TenureSegment[]);
  });
});

describe("holderShares: M3, months descending, ties by first appearance, largest-remainder percents", () => {
  test("[d] a 27/6/6 split hands the rounding point to a six-month holder, by first appearance, never the largest holder", () => {
    // hal's two segments (3 and 24 months) sum to 27, the most months, but
    // the largest fractional remainder (27/39 = 69.23%) belongs to neither
    // six-month holder: floors are 69, 15, 15, one point short of 100.
    // amy and zoe are both six months (15.38% each, the largest remaining
    // fraction), tied exactly. amy's first segment (index 0) appears
    // before zoe's only segment (index 3), so amy is listed first and
    // wins the tied point: 69, 16, 15. An implementation that gives the
    // leftover point to hal (the largest holder) or that breaks the tie
    // some other way (alphabetical, insertion order of a plain object)
    // fails this.
    const segments: TenureSegment[] = [
      { holder: "amy", from: "2020-01", to: "2020-02", months: 1 },
      { holder: "hal", from: "2020-02", to: "2020-05", months: 3 },
      { holder: "amy", from: "2020-05", to: "2020-10", months: 5 },
      { holder: "zoe", from: "2020-10", to: "2021-04", months: 6 },
      { holder: "hal", from: "2021-04", to: "2023-07", months: 24 },
    ];
    expect(holderShares(segments)).toEqual([
      { holder: "hal", reigns: 2, months: 27, percent: 69 },
      { holder: "amy", reigns: 2, months: 6, percent: 16 },
      { holder: "zoe", reigns: 1, months: 6, percent: 15 },
    ] satisfies HolderShare[]);
  });

  test("[e-i] an even three-way split still sums to exactly 100", () => {
    const segments: TenureSegment[] = [
      { holder: "amy", from: "2020-01", to: "2020-02", months: 1 },
      { holder: "hal", from: "2020-02", to: "2020-03", months: 1 },
      { holder: "zoe", from: "2020-03", to: "2020-04", months: 1 },
    ];
    const totalPercent = holderShares(segments).reduce((sum, h) => sum + h.percent, 0);
    expect(totalPercent).toBe(100);
  });

  test("[e-ii] a chain of entirely same-month stops gives every holder 0 percent, never NaN", () => {
    const segments: TenureSegment[] = [
      { holder: "amy", from: "2020-01", to: "2020-01", months: 0 },
      { holder: "hal", from: "2020-01", to: "2020-01", months: 0 },
      { holder: "zoe", from: "2020-01", to: "2020-01", months: 0 },
    ];
    expect(holderShares(segments)).toEqual([
      { holder: "amy", reigns: 1, months: 0, percent: 0 },
      { holder: "hal", reigns: 1, months: 0, percent: 0 },
      { holder: "zoe", reigns: 1, months: 0, percent: 0 },
    ] satisfies HolderShare[]);
  });
});

describe("odometer: M4, miles on record and unmeasured legs", () => {
  test("[f-i] a stop with both fields, a stop with only milesIn, and a stop with neither", () => {
    // onRecord must be the sum of all three figures Beau actually
    // reported (100 + 200 + 50 = 350), not a per-stop fallback that picks
    // one of milesIn or milesHeld and drops the other when both are
    // present on the same stop.
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2023-01", how: "found it", milesIn: 100, milesHeld: 200 },
      { holder: "bob", from: "2023-01", to: "2023-02", how: "drove it", milesIn: 50 },
      { holder: "carol", from: "2023-02", how: "holds it now" },
    ];
    expect(odometer(history)).toEqual({ onRecord: 350, unmeasuredLegs: 1 });
  });

  test("[f-ii] every stop after the first has milesIn: zero unmeasured legs", () => {
    const history: HopeCoinStop[] = [
      { holder: "alice", to: "2023-01", how: "found it" },
      { holder: "bob", from: "2023-01", to: "2023-02", how: "drove it", milesIn: 50 },
      { holder: "carol", from: "2023-02", how: "holds it now", milesIn: 12 },
    ];
    expect(odometer(history).unmeasuredLegs).toBe(0);
  });

  test("[f-iii] a first stop with no milesIn is not counted as unmeasured", () => {
    // A single-stop chain where that one stop is both first and last: if
    // the first stop's own missing milesIn were counted, this would be 1.
    const history: HopeCoinStop[] = [{ holder: "alice", how: "found it" }];
    expect(odometer(history).unmeasuredLegs).toBe(0);
  });
});

describe("formatMiles: M5, the one thousands-separator helper", () => {
  test("[g] the three canonical values", () => {
    expect(formatMiles(17677)).toBe("17,677");
    expect(formatMiles(0)).toBe("0");
    expect(formatMiles(938)).toBe("938");
  });
});
