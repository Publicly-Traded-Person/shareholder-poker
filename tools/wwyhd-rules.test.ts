// The exam for the "What Would You Have Done?" opponent rule table,
// `site/wwyhd-rules.js`. That module is the half of the puzzle that plays the
// other seats: the engine (`site/wwyhd-engine.js`) hands it a view of the
// table and one player's profile numbers, and it answers with the one action
// that player takes. The Pages Function reaches the same file by relative
// path so the server's chip count comes from the code the browser ran. Run
// this file with `bun test tools/wwyhd-rules.test.ts`, or as part of
// `bun test tools`.
//
// WHAT THIS FILE PINS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It pins the contract in Task 4's Machine clauses and nothing else:
//
//   M1  `strengthBand(cards, board)` is an integer 0 to 4, and the ten
//       holding-and-board pairs M1 names return the band M1 names.
//   M2  `preflopPercentile(cards)` is in (0, 100], `Ah Ad` is its minimum and
//       `7d 2c` its maximum, and a suited holding never scores above its
//       offsuit twin.
//   M3  `decide(view, profile)` follows the v1 table, for the four archetype
//       profiles, in the three spots the Proof names.
//   M4  a band-4 holding is never folded; a band-0 holding never returns
//       `amount` equal to `maxRaiseTo` and never bets or raises when a check
//       is available. Asserted across EVERY view fixture in this file, which
//       is what M4 asks for.
//   M5  `THRESHOLDS` has exactly five keys, all finite, and `decide` reads
//       them from its optional third argument.
//   M6  two `decide` calls on equal inputs are deep-equal.
//
// It does NOT pin the preflop chart's ordering (M2 and the task Context both
// say any published ordering is fine as long as the three properties hold),
// the internal band helper names, or which of `bet` and `raise` the module
// uses anywhere the Proof does not name one. A different but correct rule
// table passes every assertion below, which is the point: this grades the
// contract, not one implementation of it.
//
// PRIVACY (spec §3, repo CLAUDE.md). Every handle and every profile number
// here is invented. The four archetypes are the plan's synthetic fixtures;
// no real player's handle or real card-stat number appears in this file, and
// none may be added. Real numbers reach the rules only through the hand files
// Charlie writes, which are not tests.
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the browser, the engine and the Pages Function
import {
  THRESHOLDS,
  decide,
  preflopPercentile,
  strengthBand,
} from "../site/wwyhd-rules.js";

// --- the four archetype profiles -------------------------------------------
//
// Verbatim from Task 4's Context. `vpip`, `foldToRaise` and `callDown` are
// percentages 0 to 100; `af` is bets plus raises over calls; `allInRate` is
// all-ins per hand, 0 to 1. Invented handles, per the privacy note above.

const TIGHT_PASSIVE = { vpip: 15, af: 0.6, allInRate: 0.01, foldToRaise: 80, callDown: 30 };
const LOOSE_PASSIVE = { vpip: 55, af: 0.7, allInRate: 0.02, foldToRaise: 30, callDown: 70 };
const TIGHT_AGGRESSIVE = { vpip: 20, af: 3.0, allInRate: 0.05, foldToRaise: 60, callDown: 40 };
const LOOSE_AGGRESSIVE = { vpip: 50, af: 2.5, allInRate: 0.3, foldToRaise: 25, callDown: 65 };

/** The four archetypes with the handle each one wears in the fixtures below. */
const ARCHETYPES = [
  { handle: "alice", name: "tight-passive", profile: TIGHT_PASSIVE },
  { handle: "bob", name: "loose-passive", profile: LOOSE_PASSIVE },
  { handle: "carol", name: "tight-aggressive", profile: TIGHT_AGGRESSIVE },
  { handle: "dave", name: "loose-aggressive", profile: LOOSE_AGGRESSIVE },
];

// --- the table the view fixtures sit on ------------------------------------
//
// Four synthetic players, blinds 100/200, 10000 behind each. The numbers in
// every view below are the ones that table would really produce, so no
// implementation has to guess what spot it is being asked about.

/** Build one seat's view. `View` is the engine's shape (Task 3 Context):
 *  `{handle, cards, board, street, pot, toCall, stack, playersIn, position,
 *  legal}`, with `legal` the engine's `legalActions` shape
 *  `{fold, check, call, minRaiseTo, maxRaiseTo}`. */
function view(handle: string, over: Record<string, unknown>) {
  return { handle, position: "late", ...over };
}

/** UNOPENED PREFLOP. Nobody has come in: the pot is exactly the blinds
 *  (100 + 200), the amount owed is exactly the big blind, and `minRaiseTo` is
 *  exactly twice the big blind, which is what an unraised preflop pot looks
 *  like and nothing else does. `Js Td` is the holding M3 and Proof leg (c)
 *  name, whose percentile leg (c) pins strictly between 20 and 50. */
const UNOPENED_PRE = (handle: string) =>
  view(handle, {
    cards: ["Js", "Td"],
    board: [],
    street: "PRE",
    pot: 300,
    toCall: 200,
    stack: 10000,
    playersIn: 4,
    legal: { fold: true, check: false, call: 200, minRaiseTo: 400, maxRaiseTo: 10000 },
  });

/** FACING A FLOP RAISE, BAND 2. Board `Ah 7d 2c`; the holding `7h 3s` pairs
 *  the seven, which is not the top board card, so M1 makes it band 2 (the
 *  test below asserts that before asserting any action). Preflop four players
 *  each put in 200, so the flop opens at 800; one player bets 400 and the next
 *  raises to 1200, so the pot is 2400, the amount owed is 1200 and the next
 *  legal raise is 1200 + 800 = 2000. */
const FLOP_RAISE_BAND2 = (handle: string) =>
  view(handle, {
    cards: ["7h", "3s"],
    board: ["Ah", "7d", "2c"],
    street: "FLOP",
    pot: 2400,
    toCall: 1200,
    stack: 9800,
    playersIn: 3,
    legal: { fold: true, check: false, call: 1200, minRaiseTo: 2000, maxRaiseTo: 9800 },
  });

/** FACING A RIVER BET, BAND 2. M1's own river pair: `9c 3d` on
 *  `Ah 7d 2c Ks 9h` pairs the nine, which is not the top board card, so it is
 *  band 2. One opponent has bet 1200 into 4000. */
const RIVER_BET_BAND2 = (handle: string) =>
  view(handle, {
    cards: ["9c", "3d"],
    board: ["Ah", "7d", "2c", "Ks", "9h"],
    street: "RIVER",
    pot: 5200,
    toCall: 1200,
    stack: 8000,
    playersIn: 2,
    legal: { fold: true, check: false, call: 1200, minRaiseTo: 2400, maxRaiseTo: 8000 },
  });

/** FACING AN ALL-IN WITH A BAND-4 HOLDING (Proof leg (i)). `Ah Ad` on
 *  `Ac 7d 2c Ks 9h` is three of a kind, so band 4. The bet covers the stack,
 *  so `minRaiseTo` and `maxRaiseTo` are null and the only actions the table
 *  allows are fold and call: the no-fold invariant is proved here without
 *  depending on the spec's all-in rule, which M3 does not carry. */
const RIVER_ALLIN_BAND4 = (handle: string) =>
  view(handle, {
    cards: ["Ah", "Ad"],
    board: ["Ac", "7d", "2c", "Ks", "9h"],
    street: "RIVER",
    pot: 12000,
    toCall: 8000,
    stack: 8000,
    playersIn: 2,
    legal: { fold: true, check: false, call: 8000, minRaiseTo: null, maxRaiseTo: null },
  });

/** BAND 0 WITH A CHECK AVAILABLE (Proof leg (i)). `5c 4d` on
 *  `Ac 7d 2c Ks 9h` pairs nothing, and no draw exists on a river board, so it
 *  is band 0. Nothing is owed and a raise is legal, so an implementation that
 *  bluffs with air has room to show it. */
const RIVER_CHECK_BAND0 = (handle: string) =>
  view(handle, {
    cards: ["5c", "4d"],
    board: ["Ac", "7d", "2c", "Ks", "9h"],
    street: "RIVER",
    pot: 4000,
    toCall: 0,
    stack: 8000,
    playersIn: 2,
    legal: { fold: true, check: true, call: 0, minRaiseTo: 200, maxRaiseTo: 8000 },
  });

/** BAND 0 FACING A BET (Proof leg (i)). The same air, now owed 1200, with a
 *  shove to `maxRaiseTo` legal and available. */
const RIVER_BET_BAND0 = (handle: string) =>
  view(handle, {
    cards: ["5c", "4d"],
    board: ["Ac", "7d", "2c", "Ks", "9h"],
    street: "RIVER",
    pot: 5200,
    toCall: 1200,
    stack: 8000,
    playersIn: 2,
    legal: { fold: true, check: false, call: 1200, minRaiseTo: 2400, maxRaiseTo: 8000 },
  });

/** Every view fixture in this file, by name. Proof leg (i) names three of
 *  them, but M4 says "invariants across every fixture in the file", so the
 *  M4 block sweeps all six against all four archetypes. */
const ALL_VIEWS: [string, (handle: string) => any][] = [
  ["unopened preflop, Js Td", UNOPENED_PRE],
  ["flop raise, 7h 3s on Ah 7d 2c", FLOP_RAISE_BAND2],
  ["river bet, 9c 3d on Ah 7d 2c Ks 9h", RIVER_BET_BAND2],
  ["river all-in, Ah Ad on Ac 7d 2c Ks 9h", RIVER_ALLIN_BAND4],
  ["river check, 5c 4d on Ac 7d 2c Ks 9h", RIVER_CHECK_BAND0],
  ["river bet, 5c 4d on Ac 7d 2c Ks 9h", RIVER_BET_BAND0],
];

// --- the legality check, Proof leg (h) -------------------------------------

/**
 * Throws (as a failed expectation) unless `action` is one the `legal` object
 * it was handed actually allows.
 *
 * Takes the returned action and the `legal` half of the view it came from.
 * Returns nothing. The shape it enforces is the plan's global action literal
 * plus Task 3's `legalActions` contract: the five type names; `amount` as the
 * TOTAL the street contribution becomes for a bet or a raise, and 0 for fold,
 * check and call; a fold only where folding is offered; a check only where
 * nothing is owed; a call only where something is owed; and a bet or raise
 * only where the table left the action open, between `minRaiseTo` and
 * `maxRaiseTo` inclusive.
 *
 * Why it is a helper and not four inline lines: M3 ends "and every returned
 * action is allowed by `view.legal`", which is a property of every action the
 * table ever returns, not of the four the Proof spells out. An opponent that
 * raises when the action is closed, or calls for a number of chips the engine
 * never offered, desynchronises the browser's hand from the Function's, and
 * the two chip counts stop agreeing. That is the bug this guards.
 */
function expectLegal(action: any, legal: any) {
  expect(["fold", "check", "call", "bet", "raise"]).toContain(action.type);
  expect(Number.isInteger(action.amount)).toBe(true);
  if (action.type === "fold") {
    expect(legal.fold).toBe(true);
    expect(action.amount).toBe(0);
  } else if (action.type === "check") {
    expect(legal.check).toBe(true);
    expect(action.amount).toBe(0);
  } else if (action.type === "call") {
    expect(legal.call).toBeGreaterThan(0);
    expect(action.amount).toBe(0);
  } else {
    expect(legal.minRaiseTo).not.toBeNull();
    expect(action.amount).toBeGreaterThanOrEqual(legal.minRaiseTo);
    expect(action.amount).toBeLessThanOrEqual(legal.maxRaiseTo);
  }
}

/** A structural copy, so "equal inputs" in M6 means equal and not identical.
 *  Views and profiles hold only JSON values, so a round trip is enough. */
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ===========================================================================
// M1, Proof leg (a): the ten holding-and-board pairs M1 names.
// ===========================================================================

describe("strengthBand [M1]", () => {
  /** The ten pairs, spelled exactly as M1 spells them, in M1's order: two
   *  preflop, five on the river board `Ah 7d 2c Ks 9h`, two on the flop
   *  `9h 8d 2c`, one on the flop `Ah 7h 2c`. */
  const NAMED: [string, string[], string[], number][] = [
    ["Ah Ad preflop is 4 (a pocket pair of jacks or better)", ["Ah", "Ad"], [], 4],
    ["7d 2c preflop is 0 (anything else)", ["7d", "2c"], [], 0],
    [
      "7h 7s on Ah 7d 2c Ks 9h is 4 (three of a kind or better)",
      ["7h", "7s"],
      ["Ah", "7d", "2c", "Ks", "9h"],
      4,
    ],
    [
      "Ac Qd on Ah 7d 2c Ks 9h is 3 (a pair with the top board card)",
      ["Ac", "Qd"],
      ["Ah", "7d", "2c", "Ks", "9h"],
      3,
    ],
    [
      "9c 3d on Ah 7d 2c Ks 9h is 2 (a pair with a board card that is not the top one)",
      ["9c", "3d"],
      ["Ah", "7d", "2c", "Ks", "9h"],
      2,
    ],
    [
      "6c 6d on Ah 7d 2c Ks 9h is 1 (a pocket pair pairing no board card, below the top one)",
      ["6c", "6d"],
      ["Ah", "7d", "2c", "Ks", "9h"],
      1,
    ],
    [
      "5c 4d on Ah 7d 2c Ks 9h is 0 (no draw exists on a river board)",
      ["5c", "4d"],
      ["Ah", "7d", "2c", "Ks", "9h"],
      0,
    ],
    [
      "Jc Tc on 9h 8d 2c is 1 (an open-ended straight draw before the river)",
      ["Jc", "Tc"],
      ["9h", "8d", "2c"],
      1,
    ],
    ["Qs 3s on 9h 8d 2c is 0 (anything else)", ["Qs", "3s"], ["9h", "8d", "2c"], 0],
    [
      "Kh 9h on Ah 7h 2c is 1 (a four-card flush draw before the river)",
      ["Kh", "9h"],
      ["Ah", "7h", "2c"],
      1,
    ],
  ];

  for (const [name, cards, board, band] of NAMED) {
    test(`leg (a): ${name}`, () => {
      expect(strengthBand(cards, board)).toBe(band);
    });
  }

  test("leg (a): the band of every named pair is an integer 0 to 4", () => {
    // M1's opening sentence: "`strengthBand(cards, board)` returns 0 to 4".
    for (const [name, cards, board] of NAMED) {
      const band = strengthBand(cards, board);
      expect(Number.isInteger(band), name).toBe(true);
      expect(band, name).toBeGreaterThanOrEqual(0);
      expect(band, name).toBeLessThanOrEqual(4);
    }
  });
});

// ===========================================================================
// M2, Proof leg (b): the preflop chart, swept over the 169 starting classes.
// ===========================================================================

describe("preflopPercentile [M2]", () => {
  /** The 169 starting-hand classes: 13 pocket pairs, 78 suited, 78 offsuit.
   *  A pair is `Xh Xd`, a suited holding `Xh Yh`, an offsuit holding `Xh Yd`,
   *  so the pocket aces entry is exactly M2's `Ah Ad` and each suited entry
   *  has exactly one offsuit twin at the same two ranks. */
  const RANKS = "AKQJT98765432".split("");
  const CLASSES: { label: string; cards: string[] }[] = [];
  const TWINS: { label: string; suited: string[]; offsuit: string[] }[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const hi = RANKS[i];
      const lo = RANKS[j];
      if (i === j) {
        CLASSES.push({ label: hi + lo, cards: [hi + "h", lo + "d"] });
      } else {
        const suited = [hi + "h", lo + "h"];
        const offsuit = [hi + "h", lo + "d"];
        CLASSES.push({ label: `${hi}${lo}s`, cards: suited });
        CLASSES.push({ label: `${hi}${lo}o`, cards: offsuit });
        TWINS.push({ label: `${hi}${lo}`, suited, offsuit });
      }
    }
  }

  test("the sweep really is the 169 classes and the 78 twins", () => {
    // Not a Machine clause: a guard on the fixture itself, so a miscounted
    // sweep fails as a miscounted sweep instead of quietly weakening the
    // three assertions below.
    expect(CLASSES.length).toBe(169);
    expect(TWINS.length).toBe(78);
    expect(CLASSES.some((c) => c.label === "AA" && c.cards.join(" ") === "Ah Ad")).toBe(true);
  });

  test("leg (b): every value over the 169 classes is greater than 0 and at most 100", () => {
    for (const c of CLASSES) {
      const p = preflopPercentile(c.cards);
      expect(Number.isFinite(p), c.label).toBe(true);
      expect(p, c.label).toBeGreaterThan(0);
      expect(p, c.label).toBeLessThanOrEqual(100);
    }
  });

  test("leg (b): Ah Ad is the minimum over the 169 classes", () => {
    const values = CLASSES.map((c) => preflopPercentile(c.cards));
    expect(preflopPercentile(["Ah", "Ad"])).toBe(Math.min(...values));
  });

  test("leg (b): 7d 2c is the maximum over the 169 classes", () => {
    // `7d 2c` is M2's named worst holding. The sweep's own seven-deuce entry
    // is `7h 2d`, the same class in other suits, so this asserts `7d 2c` is
    // at or above every swept value rather than assuming the two are equal:
    // M2 says nothing about suits inside an offsuit class.
    const worst = preflopPercentile(["7d", "2c"]);
    for (const c of CLASSES) {
      expect(preflopPercentile(c.cards), c.label).toBeLessThanOrEqual(worst);
    }
    expect(worst).toBe(Math.max(worst, ...CLASSES.map((c) => preflopPercentile(c.cards))));
  });

  test("leg (b): Ks Qs is not above Ks Qd, and 9h 8h is not above 9h 8c", () => {
    // The two pairs leg (b) names by hand, in exactly those suits.
    expect(preflopPercentile(["Ks", "Qs"])).toBeLessThanOrEqual(
      preflopPercentile(["Ks", "Qd"]),
    );
    expect(preflopPercentile(["9h", "8h"])).toBeLessThanOrEqual(
      preflopPercentile(["9h", "8c"]),
    );
  });

  test("leg (b): no suited holding is above its offsuit twin, across all 78 twins", () => {
    // The task Context: sweep the rule across every twin inside leg (b)'s own
    // sweep rather than only the two named pairs, since it costs nothing.
    for (const t of TWINS) {
      expect(preflopPercentile(t.suited), t.label).toBeLessThanOrEqual(
        preflopPercentile(t.offsuit),
      );
    }
  });
});

// ===========================================================================
// M3, Proof legs (c) to (h): the rule table, archetype by archetype.
// ===========================================================================

describe("decide [M3]", () => {
  test("leg (c): preflopPercentile of Js Td is strictly between 20 and 50", () => {
    // M3's whole archetype table is stated for "a holding whose
    // preflopPercentile lies strictly between 20 and 50", so this is the
    // premise legs (d) to (g) rest on and it is asserted first.
    const p = preflopPercentile(["Js", "Td"]);
    expect(p).toBeGreaterThan(20);
    expect(p).toBeLessThan(50);
  });

  test("leg (d)-(g): the flop fixture 7h 3s on Ah 7d 2c is band 2", () => {
    // The four legs each say "the flop raise with band 2", so the band is
    // part of what they assert [M1, M3].
    expect(strengthBand(["7h", "3s"], ["Ah", "7d", "2c"])).toBe(2);
  });

  test("leg (d)-(g): the river fixture 9c 3d on Ah 7d 2c Ks 9h is band 2", () => {
    expect(strengthBand(["9c", "3d"], ["Ah", "7d", "2c", "Ks", "9h"])).toBe(2);
  });

  test("leg (d): tight-passive folds unopened, folds the flop raise, folds the river bet", () => {
    // vpip 15 and the percentile is above 20, so it never enters.
    // foldToRaise 80 sets the bar at band 3, and the flop holding is band 2.
    // callDown 30 is under CALL_DOWN 50, so the river needs band 3.
    const p = TIGHT_PASSIVE;
    expect(decide(UNOPENED_PRE("alice"), p)).toEqual({ type: "fold", amount: 0 });
    expect(decide(FLOP_RAISE_BAND2("alice"), p)).toEqual({ type: "fold", amount: 0 });
    expect(decide(RIVER_BET_BAND2("alice"), p)).toEqual({ type: "fold", amount: 0 });
  });

  test("leg (e): loose-passive calls unopened, calls the flop raise, calls the river bet", () => {
    // vpip 55 is above the percentile so it enters, and af 0.7 is under
    // RAISE_AF 1.5 so it calls rather than raises.
    // foldToRaise 30 sets the bar at band 1, and band 2 is not 3 or 4, so call.
    // callDown 70 is at or above CALL_DOWN 50, so band 2 calls on the river.
    const p = LOOSE_PASSIVE;
    expect(decide(UNOPENED_PRE("bob"), p)).toEqual({ type: "call", amount: 0 });
    expect(decide(FLOP_RAISE_BAND2("bob"), p)).toEqual({ type: "call", amount: 0 });
    expect(decide(RIVER_BET_BAND2("bob"), p)).toEqual({ type: "call", amount: 0 });
  });

  test("leg (f): tight-aggressive folds unopened, calls the flop raise, folds the river bet", () => {
    // vpip 20 and the percentile is strictly above 20, so it does not enter.
    // foldToRaise 60 sets the bar at band 2, so band 2 clears it and, not
    // being 3 or 4, calls despite af 3.0.
    // callDown 40 is under CALL_DOWN 50, so the river needs band 3.
    const p = TIGHT_AGGRESSIVE;
    expect(decide(UNOPENED_PRE("carol"), p)).toEqual({ type: "fold", amount: 0 });
    expect(decide(FLOP_RAISE_BAND2("carol"), p)).toEqual({ type: "call", amount: 0 });
    expect(decide(RIVER_BET_BAND2("carol"), p)).toEqual({ type: "fold", amount: 0 });
  });

  test("leg (g): loose-aggressive raises unopened to minRaiseTo, calls the flop raise, calls the river bet", () => {
    // vpip 50 is above the percentile so it enters, and af 2.5 is at or above
    // RAISE_AF 1.5, so it raises to the view's own `legal.minRaiseTo`, 400.
    // foldToRaise 25 sets the bar at band 1 and band 2 is not 3 or 4, so call.
    // callDown 65 is at or above CALL_DOWN 50, so band 2 calls on the river.
    const p = LOOSE_AGGRESSIVE;
    const unopened = UNOPENED_PRE("dave");
    expect(decide(unopened, p)).toEqual({ type: "raise", amount: unopened.legal.minRaiseTo });
    expect(decide(unopened, p)).toEqual({ type: "raise", amount: 400 });
    expect(decide(FLOP_RAISE_BAND2("dave"), p)).toEqual({ type: "call", amount: 0 });
    expect(decide(RIVER_BET_BAND2("dave"), p)).toEqual({ type: "call", amount: 0 });
  });

  test("leg (h): every action in legs (d) to (g) is allowed by the legal object handed in", () => {
    for (const a of ARCHETYPES) {
      for (const make of [UNOPENED_PRE, FLOP_RAISE_BAND2, RIVER_BET_BAND2]) {
        const v = make(a.handle);
        expectLegal(decide(v, a.profile), v.legal);
      }
    }
  });

  test("[M3] RAISE_AF is 1.5 and CALL_DOWN is 50, the defaults the table above is stated for", () => {
    // M3 gives its archetype table "with RAISE_AF 1.5 and CALL_DOWN 50", so
    // those two numbers are part of the clause legs (d) to (g) encode.
    expect(THRESHOLDS.RAISE_AF).toBe(1.5);
    expect(THRESHOLDS.CALL_DOWN).toBe(50);
  });
});

// ===========================================================================
// M4, Proof leg (i): the invariants, across every fixture in the file.
// ===========================================================================

describe("the invariants [M4]", () => {
  test("leg (i): facing an all-in with Ah Ad on Ac 7d 2c Ks 9h, no archetype folds", () => {
    const board = ["Ac", "7d", "2c", "Ks", "9h"];
    expect(strengthBand(["Ah", "Ad"], board)).toBe(4);
    for (const a of ARCHETYPES) {
      const v = RIVER_ALLIN_BAND4(a.handle);
      expect(decide(v, a.profile).type, a.name).not.toBe("fold");
    }
  });

  test("leg (i): with 5c 4d on that board and a check available, no archetype bets or raises", () => {
    const board = ["Ac", "7d", "2c", "Ks", "9h"];
    expect(strengthBand(["5c", "4d"], board)).toBe(0);
    for (const a of ARCHETYPES) {
      const v = RIVER_CHECK_BAND0(a.handle);
      expect(v.legal.check).toBe(true);
      const action = decide(v, a.profile);
      expect(action.type, a.name).not.toBe("bet");
      expect(action.type, a.name).not.toBe("raise");
    }
  });

  test("leg (i): with 5c 4d facing a bet, no archetype returns amount equal to maxRaiseTo", () => {
    for (const a of ARCHETYPES) {
      const v = RIVER_BET_BAND0(a.handle);
      expect(decide(v, a.profile).amount, a.name).not.toBe(v.legal.maxRaiseTo);
    }
  });

  test("[M4] across every fixture in the file: band 4 never folds, band 0 never shoves and never bets into a check", () => {
    // M4 reads "invariants across every fixture in the file", so the three
    // views leg (i) names are swept together with the three legs (d) to (g)
    // use. Each check is guarded by the fixture's own band, so a fixture in
    // the middle bands is simply not constrained by M4.
    for (const [label, make] of ALL_VIEWS) {
      for (const a of ARCHETYPES) {
        const v = make(a.handle);
        const where = `${label} / ${a.name}`;
        const band = strengthBand(v.cards, v.board);
        expect(Number.isInteger(band), where).toBe(true);
        expect(band, where).toBeGreaterThanOrEqual(0);
        expect(band, where).toBeLessThanOrEqual(4);

        const action = decide(v, a.profile);
        expectLegal(action, v.legal);

        if (band === 4) {
          expect(action.type, where).not.toBe("fold");
        }
        if (band === 0) {
          expect(action.amount, where).not.toBe(v.legal.maxRaiseTo);
          if (v.legal.check === true) {
            expect(action.type, where).not.toBe("bet");
            expect(action.type, where).not.toBe("raise");
          }
        }
      }
    }
  });
});

// ===========================================================================
// M5, Proof leg (j): the thresholds, and that the table reads them.
// ===========================================================================

describe("THRESHOLDS [M5]", () => {
  /** The five names M5 fixes, spelled as the task spells them. */
  const NAMES = ["RAISE_AF", "CALL_DOWN", "ALL_IN_STRONG", "CHEAP_CALL_SHARE", "MIN_SHARED", "BET_AF"];

  test("leg (j): the exported keys sorted are exactly the five names sorted", () => {
    expect(Object.keys(THRESHOLDS).sort()).toEqual([...NAMES].sort());
  });

  test("leg (j): every threshold is a finite number", () => {
    for (const name of NAMES) {
      expect(typeof THRESHOLDS[name], name).toBe("number");
      expect(Number.isFinite(THRESHOLDS[name]), name).toBe(true);
    }
  });

  test("leg (j): the loose-aggressive unopened spot turns from raise to call under RAISE_AF 3.0", () => {
    // af 2.5 clears the default 1.5 and does not clear 3.0, so the same spot
    // must answer differently. This is what proves the table reads its third
    // argument rather than an inlined copy of the constant.
    const v = UNOPENED_PRE("dave");
    expect(decide(v, LOOSE_AGGRESSIVE)).toEqual({ type: "raise", amount: 400 });

    const raised = { ...THRESHOLDS, RAISE_AF: 3.0 };
    const action = decide(v, LOOSE_AGGRESSIVE, raised);
    expect(action).toEqual({ type: "call", amount: 0 });
    expectLegal(action, v.legal);

    // Passing the defaults explicitly is the same as passing nothing.
    expect(decide(v, LOOSE_AGGRESSIVE, { ...THRESHOLDS })).toEqual(
      decide(v, LOOSE_AGGRESSIVE),
    );
  });

  test("leg (j): handing a thresholds copy in does not mutate THRESHOLDS", () => {
    // The copy is the caller's; the module keeps its own defaults. Without
    // this, one call with a tuned copy would silently retune the rest of the
    // hand, and the browser and the Function would stop agreeing.
    const before = { ...THRESHOLDS };
    decide(UNOPENED_PRE("dave"), LOOSE_AGGRESSIVE, { ...THRESHOLDS, RAISE_AF: 3.0 });
    expect({ ...THRESHOLDS }).toEqual(before);
  });
});

// ===========================================================================
// M6, Proof leg (k): determinism.
// ===========================================================================

describe("determinism [M6]", () => {
  test("leg (k): two decide calls on equal inputs return deep-equal actions", () => {
    // The inputs are structurally equal copies, not the same objects, so this
    // catches a rule table that remembers anything between calls as well as
    // one that reads a clock or a random source. The whole puzzle is the
    // promise that the same hand file and the same choices give the same
    // chips on every machine.
    for (const [label, make] of ALL_VIEWS) {
      for (const a of ARCHETYPES) {
        const first = decide(make(a.handle), a.profile);
        const second = decide(copy(make(a.handle)), copy(a.profile));
        expect(second, `${label} / ${a.name}`).toEqual(first);
      }
    }
  });

  test("leg (k): decide does not mutate the view or the profile it was handed", () => {
    // A mutated view would make the second call's inputs unequal to the
    // first's, which is the same promise read from the other side.
    for (const [label, make] of ALL_VIEWS) {
      for (const a of ARCHETYPES) {
        const v = make(a.handle);
        const snapshot = copy(v);
        const profile = { ...a.profile };
        decide(v, profile);
        expect(v, `${label} / ${a.name}`).toEqual(snapshot);
        expect(profile, `${label} / ${a.name}`).toEqual(a.profile);
      }
    }
  });
});

// --- review fix, 2026-09-21 (fleet run 1 residual, task 4) ------------------
// A big blind nobody raised owes nothing. The rule table used to fold such a
// hand when it fell outside vpip, which the play-through showed as a seat
// quitting for free (LEWD in the big blind, hand 39). The check comes first.
describe("an unopened big blind never folds a free hand", () => {
  const FREE_BB = (handle: string) =>
    view(handle, {
      cards: ["7d", "2c"],
      board: [],
      street: "PRE",
      pot: 500,
      toCall: 0,
      stack: 5650,
      playersIn: 5,
      legal: { fold: true, check: true, call: 0, minRaiseTo: 400, maxRaiseTo: 5850 },
    });
  test("the tightest profile with the worst holding checks rather than folds", () => {
    expect(decide(FREE_BB("alice"), TIGHT_PASSIVE)).toEqual({ type: "check", amount: 0 });
  });
  test("the same profile still folds that holding when there is a raise to call", () => {
    const owed = { ...FREE_BB("alice"), toCall: 200, legal: { fold: true, check: false, call: 200, minRaiseTo: 400, maxRaiseTo: 5850 } };
    expect(decide(owed, TIGHT_PASSIVE)).toEqual({ type: "fold", amount: 0 });
  });
});

// --- 2026-09-21: preflop facing a raise ------------------------------------
// Every preflop spot used to take the unopened branch, so a hand inside vpip
// called any raise, an all-in included (Mike M., ace-five, 2026-09-21). With
// `raised` on the view, a raised pot applies the fold bar, and a call that
// costs more than CHEAP_CALL_SHARE of the stack needs band 3 or better.
describe("preflop facing a raise", () => {
  const MIKE = { vpip: 27, af: 1.35, allInRate: 0.11, foldToRaise: 48, callDown: 38 };
  const facing = (cards: string[], toCall: number, stack: number) =>
    view("mike", {
      cards, board: [], street: "PRE", pot: 500 + toCall, toCall, stack, playersIn: 4, raised: true,
      legal: { fold: true, check: false, call: toCall, minRaiseTo: toCall * 2, maxRaiseTo: stack },
    });
  test("ace-five suited folds to an all-in that costs a quarter of the stack", () => {
    expect(decide(facing(["Ad", "5d"], 1835, 6708), MIKE)).toEqual({ type: "fold", amount: 0 });
  });
  test("ace-five suited calls a small raise", () => {
    expect(decide(facing(["Ad", "5d"], 400, 6708), MIKE)).toEqual({ type: "call", amount: 0 });
  });
  test("pocket aces calls the all-in (it cannot raise a shove it covers only by calling)", () => {
    const v = facing(["Ah", "Ad"], 1835, 6708);
    const a = decide(v, MIKE);
    expect(["call", "raise"]).toContain(a.type);
    expect(a.type).not.toBe("fold");
  });
  test("a hand inside vpip but under the fold bar folds a raise: suited connectors against foldToRaise 80", () => {
    const tight = { ...TIGHT_PASSIVE, vpip: 60 };
    expect(decide(facing(["6h", "5h"], 400, 6708), tight)).toEqual({ type: "fold", amount: 0 });
  });
  test("an unopened pot is unchanged: the same holding limps when nothing is raised", () => {
    const unopened = { ...facing(["Ad", "5d"], 200, 6708), raised: false, pot: 300, legal: { fold: true, check: false, call: 200, minRaiseTo: 400, maxRaiseTo: 6708 } };
    expect(decide(unopened, MIKE)).toEqual({ type: "call", amount: 0 });
  });
});

// --- 2026-09-21: betting when checked to ------------------------------------
// "When I folded the hand played out in a really boring way": the v1 table
// never bet, so four players checked every street down. Checked to after the
// flop, a strong hand bets half the pot when the profile is aggressive enough
// (BET_AF), and a monster bets whatever the profile.
describe("betting when checked to", () => {
  const checkedTo = (cards: string[], board: string[], pot: number, over: Record<string, unknown> = {}) =>
    view("p", {
      cards, board, street: board.length === 3 ? "FLOP" : board.length === 4 ? "TURN" : "RIVER",
      pot, toCall: 0, stack: 5000, playersIn: 3, raised: false,
      legal: { fold: true, check: true, call: 0, minRaiseTo: 200, maxRaiseTo: 5000 },
      ...over,
    });
  const CHRIS = { vpip: 30, af: 0.84, allInRate: 0.01, foldToRaise: 48, callDown: 67 };
  test("an overpair on a dry flop bets half the pot at Chris H.'s aggression", () => {
    expect(decide(checkedTo(["Ah", "Ac"], ["Qs", "3s", "7s"], 1000), CHRIS)).toEqual({ type: "bet", amount: 500 });
  });
  test("the same hand checks behind at a passive profile", () => {
    expect(decide(checkedTo(["Ah", "Ac"], ["Qs", "3s", "7s"], 1000), TIGHT_PASSIVE)).toEqual({ type: "check", amount: 0 });
  });
  test("a set bets whatever the profile", () => {
    expect(decide(checkedTo(["7h", "7d"], ["Qs", "3s", "7s"], 1000), TIGHT_PASSIVE)).toEqual({ type: "bet", amount: 500 });
  });
  test("a bet never goes below the minimum or above the stack", () => {
    expect(decide(checkedTo(["7h", "7d"], ["Qs", "3s", "7s"], 100), CHRIS)).toEqual({ type: "bet", amount: 200 });
    expect(decide(checkedTo(["7h", "7d"], ["Qs", "3s", "7s"], 20000, { stack: 900, legal: { fold: true, check: true, call: 0, minRaiseTo: 200, maxRaiseTo: 900 } }), CHRIS)).toEqual({ type: "bet", amount: 900 });
  });
  test("air and a weak pair check behind", () => {
    expect(decide(checkedTo(["9d", "4c"], ["Qs", "3s", "7s"], 1000), CHRIS)).toEqual({ type: "check", amount: 0 });
    expect(decide(checkedTo(["6c", "6d"], ["Qs", "3s", "7s"], 1000), CHRIS)).toEqual({ type: "check", amount: 0 });
  });
});
