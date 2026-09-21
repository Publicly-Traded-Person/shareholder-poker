// The exam for the "What Would You Have Done?" hand evaluator,
// `site/wwyhd-eval.js`. That module is the showdown half of the puzzle: the
// engine (`site/wwyhd-engine.js`) and the opponent rules
// (`site/wwyhd-rules.js`) import `evaluate` to decide who takes the pot, and
// the puzzle page names the winning hand with `handCategory`. Run it with
// `bun test tools/wwyhd-eval.test.ts`, or as part of `bun test tools`.
//
// WHAT THIS FILE PINS, AND WHAT IT DELIBERATELY DOES NOT:
//
// The score encoding is the implementer's choice (Task 1 Context: "a category
// index times a large base plus the five ranking ranks in order is the usual
// shape"). So nothing here asserts a numeric score. Every pin is one of four
// shapes, and each is exactly what a Machine clause asserts:
//
//   ordering   `evaluate(x) > evaluate(y)`       - M1, M2, M3
//   equality   `evaluate(x) === evaluate(y)`     - M3, and the 5/6/7 clause of M1
//   integer    `Number.isInteger(evaluate(x))`   - M1
//   throwing   `expect(() => evaluate(x)).toThrow()` - M5
//
// A wrong encoding that still satisfies all four is a correct evaluator, which
// is the point: the exam grades the contract, not one implementation of it.
//
// THE LADDER (read before adding or "tidying" a hand). Proof legs (a) to (h)
// are eight adjacent comparisons up the nine categories in M1's order, so the
// file builds one concrete seven-card hand per category, once, and both the
// ladder tests and leg (l)'s `handCategory` sweep read from the same nine.
// Every hand was checked by hand for accidental categories: no hand below has
// five cards of one suit unless it is meant to be the flush or the straight
// flush, and no hand carries a five-card run unless it is meant to be a
// straight. A hand that quietly makes a better category than its name would
// turn a real failure green, so if you touch one of these arrays, recount the
// suits and the runs across all seven cards, not just the intended five.
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the browser, the engine and the Pages Function
import { evaluate, handCategory } from "../site/wwyhd-eval.js";

// --- the nine rungs, in M1's order, weakest first ---------------------------
//
// Each entry is [category name, a seven-card hand whose best five is exactly
// that category]. The name strings are the nine literals M4 fixes, spelled as
// the task spells them.

/** high card: A K 9 7 5. Suits run h,d,c,s,h,d,c so no suit reaches five, and
 *  2 3 5 7 9 K A has no five-card run (no 4, so not even the wheel). */
const HIGH_CARD = ["Ah", "Kd", "9c", "7s", "5h", "3d", "2c"];

/** pair: A A K 9 7. This is M2's own left-hand hand and leg (k)'s seven-card
 *  hand, used here too so the ladder and those legs agree on one hand. */
const PAIR = ["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"];

/** two pair: A A K K 7. */
const TWO_PAIR = ["Ah", "Ad", "Kc", "Kd", "7s", "3h", "2c"];

/** three of a kind: A A A K 7. K 7 3 2 are all singletons, so the trips do not
 *  drag a second pair along and make this a full house. */
const THREE_OF_A_KIND = ["Ah", "Ad", "Ac", "Kd", "7s", "3h", "2c"];

/** straight: 6 7 8 9 T. This is leg (j)'s middle straight, reused here. */
const STRAIGHT = ["6h", "7d", "8c", "9s", "Th", "2d", "3c"];

/** flush: K J 9 5 2 in hearts. The five hearts are not consecutive, so this is
 *  a flush and not a straight flush; 2 3 4 5 is only four in a row across the
 *  seven (no 6, no A), so it is not a straight either. */
const FLUSH = ["2h", "5h", "9h", "Jh", "Kh", "3d", "4c"];

/** full house: A A A K K. */
const FULL_HOUSE = ["Ah", "Ad", "Ac", "Kd", "Kh", "7s", "2c"];

/** four of a kind: A A A A K. */
const FOUR_OF_A_KIND = ["Ah", "Ad", "Ac", "As", "Kd", "7s", "2c"];

/** straight flush: 6 7 8 9 T in hearts. */
const STRAIGHT_FLUSH = ["6h", "7h", "8h", "9h", "Th", "2d", "3c"];

/** The ladder itself: [category name, hand], weakest first. M1 names this
 *  order and M4 names these nine strings; both read off this one list. */
const LADDER: Array<[string, string[]]> = [
  ["high card", HIGH_CARD],
  ["pair", PAIR],
  ["two pair", TWO_PAIR],
  ["three of a kind", THREE_OF_A_KIND],
  ["straight", STRAIGHT],
  ["flush", FLUSH],
  ["full house", FULL_HOUSE],
  ["four of a kind", FOUR_OF_A_KIND],
  ["straight flush", STRAIGHT_FLUSH],
];

describe("M1: the category ladder, one adjacent pair per Proof leg", () => {
  // Legs (a) to (h) are the eight adjacent steps up LADDER, each named for the
  // leg it discharges. Each is its own test so a failure names the step that
  // broke rather than reporting "the ladder" and leaving the reader to bisect.

  test("(a) a pair beats high card on concrete seven-card hands", () => {
    expect(evaluate(PAIR)).toBeGreaterThan(evaluate(HIGH_CARD));
  });

  test("(b) two pair beats a pair", () => {
    expect(evaluate(TWO_PAIR)).toBeGreaterThan(evaluate(PAIR));
  });

  test("(c) three of a kind beats two pair", () => {
    expect(evaluate(THREE_OF_A_KIND)).toBeGreaterThan(evaluate(TWO_PAIR));
  });

  test("(d) a straight beats three of a kind", () => {
    expect(evaluate(STRAIGHT)).toBeGreaterThan(evaluate(THREE_OF_A_KIND));
  });

  test("(e) a flush beats a straight", () => {
    expect(evaluate(FLUSH)).toBeGreaterThan(evaluate(STRAIGHT));
  });

  test("(f) a full house beats a flush", () => {
    expect(evaluate(FULL_HOUSE)).toBeGreaterThan(evaluate(FLUSH));
  });

  test("(g) four of a kind beats a full house", () => {
    expect(evaluate(FOUR_OF_A_KIND)).toBeGreaterThan(evaluate(FULL_HOUSE));
  });

  test("(h) a straight flush beats four of a kind", () => {
    expect(evaluate(STRAIGHT_FLUSH)).toBeGreaterThan(evaluate(FOUR_OF_A_KIND));
  });

  test("the whole ladder is strictly increasing, and every rung is an integer", () => {
    // The eight tests above are the Proof's legs one by one; this one is the
    // same claim read end to end, which is what catches an encoding where two
    // non-adjacent categories collide (say a monster high card outscoring a
    // weak pair) while every adjacent step still happens to pass. The integer
    // half is M1's "returns an integer" on seven-card hands.
    const scores = LADDER.map(([, hand]) => evaluate(hand));
    for (const score of scores) expect(Number.isInteger(score)).toBe(true);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });
});

describe("M2: within a category the kickers decide in standard order", () => {
  test("(i) aces with a king kicker beat aces with a queen kicker", () => {
    // M2 spells both hands out; they are copied verbatim. Same pair, same 9
    // and 7 behind it, and the only difference is K against Q in the third
    // slot, so nothing but kicker order can separate them.
    expect(evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]))
      .toBeGreaterThan(evaluate(["Ah", "Ad", "Qc", "7s", "2d", "9h", "3c"]));
  });
});

describe("M3: equal ranks score equal, and the wheel is the lowest straight", () => {
  // The four hands of leg (j), verbatim from the Proof.
  const WHEEL_ONE = ["Ah", "2d", "3c", "4s", "5h", "9d", "Tc"];
  const WHEEL_TWO = ["Ac", "2h", "3d", "4d", "5c", "9s", "Th"];
  const SIX_HIGH_STRAIGHT = ["6h", "7d", "8c", "9s", "Th", "2d", "3c"];
  const BROADWAY = ["Th", "Jd", "Qc", "Ks", "Ah", "2d", "3c"];

  test("(j) the two wheels score equal whatever their suits", () => {
    // Same five ranks (5 4 3 2 A) dealt in different suits. M3's first
    // sentence: the score may not carry suit information at all, because two
    // hands of the same strength have to split the pot.
    expect(evaluate(WHEEL_ONE)).toBe(evaluate(WHEEL_TWO));
  });

  test("(j) both wheels score below the six-high straight", () => {
    // The wheel is the LOWEST straight: read the ace high inside A 2 3 4 5 and
    // it would outrank 6 7 8 9 T, which is the classic evaluator bug this pins.
    expect(evaluate(WHEEL_ONE)).toBeLessThan(evaluate(SIX_HIGH_STRAIGHT));
    expect(evaluate(WHEEL_TWO)).toBeLessThan(evaluate(SIX_HIGH_STRAIGHT));
  });

  test("(j) T J Q K A scores above both wheels and above the six-high straight", () => {
    expect(evaluate(BROADWAY)).toBeGreaterThan(evaluate(WHEEL_ONE));
    expect(evaluate(BROADWAY)).toBeGreaterThan(evaluate(WHEEL_TWO));
    expect(evaluate(BROADWAY)).toBeGreaterThan(evaluate(SIX_HIGH_STRAIGHT));
  });
});

describe("M1: five, six and seven cards all evaluate, and the best five decide", () => {
  test("(k) the five-, six- and seven-card forms of A A K 9 7 all score equal", () => {
    // Verbatim from leg (k). The five-card hand IS the best five; the six- and
    // seven-card hands bury it under 2d, and 3c, which cannot improve it. An
    // evaluator that scored all seven cards, or that only handled length 7,
    // fails here.
    const five = evaluate(["Ah", "Ad", "Kc", "9h", "7s"]);
    const six = evaluate(["Ah", "Ad", "Kc", "9h", "7s", "2d"]);
    const seven = evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]);

    expect(Number.isInteger(five)).toBe(true);
    expect(Number.isInteger(six)).toBe(true);
    expect(Number.isInteger(seven)).toBe(true);

    expect(five).toBe(seven);
    expect(six).toBe(seven);
  });

  test("(k) the five-card K K Q 7 2 scores below all three", () => {
    const kings = evaluate(["Kh", "Kd", "Qc", "7s", "2d"]);
    expect(kings).toBeLessThan(evaluate(["Ah", "Ad", "Kc", "9h", "7s"]));
    expect(kings).toBeLessThan(evaluate(["Ah", "Ad", "Kc", "9h", "7s", "2d"]));
    expect(kings).toBeLessThan(evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]));
  });
});

describe("M4: handCategory names the category", () => {
  test("(l) each of the nine ladder hands reports its own category name", () => {
    // One assertion per rung, with the hand in the failure message, so a
    // mislabelled boundary (a full house read as two pair, say) names itself.
    for (const [name, hand] of LADDER) {
      expect({ hand, category: handCategory(evaluate(hand)) })
        .toEqual({ hand, category: name });
    }
  });

  test("(l) the names returned across the nine hands are exactly the nine strings", () => {
    // M4: "one of exactly those nine strings". Sorted so the comparison is on
    // the SET, not on ladder order, which the test above already pins. If an
    // implementation returned "trips" or "quads" or "straight-flush", or
    // collapsed two rungs onto one name, this array stops matching.
    const returned = LADDER.map(([, hand]) => handCategory(evaluate(hand)));
    expect([...returned].sort()).toEqual([
      "flush",
      "four of a kind",
      "full house",
      "high card",
      "pair",
      "straight",
      "straight flush",
      "three of a kind",
      "two pair",
    ]);
  });
});

describe("M5: evaluate rejects hands it cannot score", () => {
  // Each of the four bad inputs is paired with the corrected hand from leg
  // (m), asserted in the same test. The pairing is what makes the throw
  // meaningful: an `evaluate` that threw on everything would pass the throw
  // half alone, and the corrected hand is the half that says the rejection is
  // about the defect and not about the whole shape of the input.

  test("(m) fewer than five cards throws; the same hand at seven scores", () => {
    expect(() => evaluate(["Ah", "Ad", "Kc", "7s"])).toThrow();
    expect(Number.isInteger(evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]))).toBe(true);
  });

  test("(m) more than seven cards throws; the same hand at seven scores", () => {
    expect(() => evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c", "4c"])).toThrow();
    expect(Number.isInteger(evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]))).toBe(true);
  });

  test("(m) a duplicate card throws; the same hand with it corrected scores", () => {
    // Ah twice. A deck holds one of each, so a duplicate means the caller
    // built the seven out of a board and hole cards that overlap, and a
    // silently-scored duplicate would hand the pot to the wrong player.
    expect(() => evaluate(["Ah", "Ah", "Kc", "7s", "2d", "9h", "3c"])).toThrow();
    expect(Number.isInteger(evaluate(["Ah", "Ad", "Kc", "7s", "2d", "9h", "3c"]))).toBe(true);
  });

  test("(m) a card outside the notation throws; the same hand corrected scores", () => {
    // "1h": rank 1 is not in 23456789TJQKA. The plan's card notation is the
    // one literal every wwyhd file shares, so a card that misses it is a bug
    // upstream, not a hand to guess at.
    expect(() => evaluate(["1h", "Kc", "7s", "2d", "9h", "3c", "4c"])).toThrow();
    expect(Number.isInteger(evaluate(["Ah", "Kc", "7s", "2d", "9h", "3c", "4c"]))).toBe(true);
  });
});
