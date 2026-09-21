// The exam for the "What Would You Have Done?" hand engine,
// `site/wwyhd-engine.js`. That module is the dealer half of the puzzle: it
// posts the blinds, rules on what a player may do, builds the side pots and
// pays them out through the evaluator (`site/wwyhd-eval.js`), and it replays a
// committed hand file's real line so a wrong file cannot merge. The puzzle
// page, the Pages Function and `bun test` all run this one copy. Run this file
// with `bun test tools/wwyhd-engine.test.ts`, or as part of `bun test tools`.
//
// HOW TO READ THIS FILE. Every `describe` names one Proof leg and the Machine
// clause it comes from, and every `test` inside it is one sentence of that
// leg. Nothing here is pinned that the task does not pin; the notes below say
// where the exam had to choose a way to observe something, and why it chose
// that way.
//
// 1. HANDLES. The task writes its worked tables as A, B, C, D. The privacy
//    rule says fixtures carry invented handles only, so this file uses the
//    plan's four: A is `alice`, B is `bob`, C is `carol`, D is `dave`. Leg
//    (f)'s decision key is spelled exactly as the Proof spells it, with those
//    handles substituted for the shorthand letters:
//      Proof:      PRE:B:sb:100,C:bb:200
//      this file:  PRE:bob:sb:100,carol:bb:200
//    The shape (street, colon, comma-joined handle:type:amount) is pinned
//    character for character; only the names are the synthetic ones.
//
// 2. "X IS TO ACT" HAS NO ACCESSOR. `applyAction(state, action)` takes no
//    handle: it acts for whoever is to act. Nothing in Produces reports who
//    that is, and the state's own field names are the implementer's to choose.
//    So this exam never reads a state field. It proves the actor the way a
//    dealer would: it applies one action and asks, through `seatView`, whose
//    stack moved.
//
// 3. A STREET CONTRIBUTION IS READ THROUGH THE VIEW. "B at 2900 with 100 in"
//    is asserted as B's `stack` 2900, B's `toCall` 100 (owing the 100 that
//    takes the small blind up to the big) and the `pot` 300. Those three are
//    pinned View fields; a per-player contribution field is not.
//
// 4. POSTFLOP ORDER. No Machine clause pins it, and leg (d)'s heads-up "A bets
//    500 on the flop" only lands under the dealer's universal rule that action
//    after the flop starts with the first live player left of the button, so
//    heads-up the non-dealer acts first and the button bets last. The exam
//    scripts that order and then asserts that A is the one whose stack dropped
//    by the 500, so an engine that runs the button first fails on a named
//    assertion instead of quietly passing a different hand.
//
// 5. WHOLE-OBJECT EQUALITY ON `legalActions`. M2 fixes exactly five keys and
//    the Interfaces spell the same five, so every `legalActions` assertion
//    compares the whole object rather than picking at it.
//
// 6. THE ARITHMETIC IS HAND-COMPUTED. Every expected chip number below is
//    worked out in a comment beside it, from the task's own worked cases or,
//    for the replay line, from a line built here and totted up street by
//    street. If one of these numbers is ever wrong, the comment is where the
//    error is findable; do not "fix" a number without redoing the arithmetic
//    in the comment.
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the browser, the Worker and bun
import {
  applyAction,
  isHandOver,
  legalActions,
  playSeat,
  replay,
  seatView,
  settle,
  startHand,
} from "../site/wwyhd-engine.js";

// --- fixtures ---------------------------------------------------------------
//
// The hand file shape is the plan's shared literal (Task 5 validates it, Task 6
// fetches it, Task 7 embeds it). The engine only reads `blinds`, `dealer`,
// `players`, `board` and `real.actions`, but the fixtures are whole files so
// nothing here depends on a partial file being tolerated.
//
// No file below carries an email, and every handle is invented.

/** A stand-in opponent profile. The engine never reads it; the rules module
 *  (Task 4) does. Present so the fixtures are shaped like real files. */
const PROFILE = { vpip: 30, af: 2, foldToRaise: 40, callDown: 50, allInRate: 0.5 };

function player(handle: string, stack: number, cards: string[], profile: unknown = PROFILE) {
  return { handle, stack, cards, shown: true, profile };
}

function handFile(fields: Record<string, unknown>) {
  return {
    id: "2026-09-08-1",
    game: "2026-09-08",
    handNo: 1,
    title: "A hand for the exam",
    setup: "Blinds 100/200.",
    seat: "alice",
    blinds: { sb: 100, bb: 200, ante: 0 },
    dealer: "alice",
    players: [],
    board: ["3s", "8h", "9c", "Jd", "Qs"],
    real: { actions: [], result: "", seatChips: 0, endStacks: {} },
    startChips: 0,
    profileThrough: "2026-09-08",
    opens: "2026-09-23",
    closes: "2026-09-30",
    ...fields,
  };
}

/** The task's worked side-pot table, and the same table leg (a) and leg (b)
 *  open on: A (dealer, 1000), B (3000), C (6000), blinds 100/200, no ante.
 *  Cards and board are the worked case's: A `Ah Ad` (aces), B `Kh Kd`
 *  (kings), C `2c 7d` (queen high on `3s 8h 9c Jd Qs`), so A beats B beats C
 *  and the main and the side pot go to different players. */
function sidePotHand(fields: Record<string, unknown> = {}) {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [
      player("alice", 1000, ["Ah", "Ad"], null),
      player("bob", 3000, ["Kh", "Kd"]),
      player("carol", 6000, ["2c", "7d"]),
    ],
    board: ["3s", "8h", "9c", "Jd", "Qs"],
    startChips: 1000,
    ...fields,
  });
}

/** Heads-up, A on the button: A (dealer, 5000), B (5000), blinds 100/200.
 *  Used for leg (a)'s heads-up sentence and leg (d)'s uncalled bet. */
function headsUpHand() {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [player("alice", 5000, ["Ah", "Ad"], null), player("bob", 5000, ["Kh", "Kd"])],
    board: ["3s", "8h", "9c", "Jd", "Qs"],
    startChips: 5000,
  });
}

/** Four-handed, with the short stack on the button so that it faces a raise
 *  with nothing yet in: A (dealer, 400), B (3000), C (6000), D (5000), blinds
 *  100/200. D is first to act preflop, so D's raise to 600 leaves A owing 600
 *  with 400 behind, which is leg (b)'s last sentence. */
function shortDealerHand() {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [
      player("alice", 400, ["Ah", "Ad"], null),
      player("bob", 3000, ["Kh", "Kd"]),
      player("carol", 6000, ["2c", "7d"]),
      player("dave", 5000, ["Qh", "Qd"]),
    ],
    board: ["3s", "8h", "9c", "Jd", "Ts"],
    startChips: 400,
  });
}

/** The task's worked no-reopen table: A (dealer, 5000), B (5000), C (650),
 *  blinds 100/200. C's stack cannot reach a full raise over A's 600, so C's
 *  all-in to 650 is the short all-in that must not reopen the action. */
function noReopenHand() {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [
      player("alice", 5000, ["Ah", "Ad"], null),
      player("bob", 5000, ["Kh", "Kd"]),
      player("carol", 650, ["2c", "7d"]),
    ],
    board: ["3s", "8h", "9c", "Jd", "Qs"],
    startChips: 5000,
  });
}

/** The task's worked odd-chip table: A (dealer, 1000), B (1000), C (999),
 *  blinds 100/200. On board `8h 7c 6d 2s 3c`, A `Th 9d` and B `Tc 9s` both
 *  make the ten-high straight T 9 8 7 6 and tie; C `Ah Kd` has ace high. The
 *  board alone (8 7 6 3 2) holds no straight and no three of one suit, so the
 *  tie is exactly between A and B. */
function oddChipHand() {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [
      player("alice", 1000, ["Th", "9d"], null),
      player("bob", 1000, ["Tc", "9s"]),
      player("carol", 999, ["Ah", "Kd"]),
    ],
    board: ["8h", "7c", "6d", "2s", "3c"],
    startChips: 1000,
  });
}

/** Leg (e)'s scripted full-table line, four-handed at 5000 each, blinds
 *  100/200, dealer A. Seat order is A (dealer), B (small blind), C (big
 *  blind), D, so D acts first preflop and C acts first on every later street
 *  once B has folded.
 *
 *  The line, and the chips it moves:
 *
 *    PRE    D raises to 600, A calls 600, B folds (100 in), C calls 600
 *           in: A 600, B 100, C 600, D 600            pot 1900
 *    FLOP   C checks, D bets 800, A folds, C calls 800
 *           in: C 800, D 800                          pot 3500
 *    TURN   C checks, D checks                        pot 3500
 *    RIVER  C bets 1000, D calls 1000                 pot 5500
 *
 *  Showdown between C and D on `2h 9c Jd 4s 7h`: D holds `Jh Jc` for three
 *  jacks, C holds `Kh Kc` for a pair of kings, so D takes the 5500.
 *
 *    A 5000 - 600            = 4400
 *    B 5000 - 100            = 4900
 *    C 5000 - 600 - 800 - 1000 = 2600
 *    D 5000 - 600 - 800 - 1000 + 5500 = 8100
 *    sum 4400 + 4900 + 2600 + 8100 = 20000, the four starting stacks.
 */
const REPLAY_ACTIONS = [
  { street: "PRE", handle: "dave", type: "raise", amount: 600 },
  { street: "PRE", handle: "alice", type: "call", amount: 0 },
  { street: "PRE", handle: "bob", type: "fold", amount: 0 },
  { street: "PRE", handle: "carol", type: "call", amount: 0 },
  { street: "FLOP", handle: "carol", type: "check", amount: 0 },
  { street: "FLOP", handle: "dave", type: "bet", amount: 800 },
  { street: "FLOP", handle: "alice", type: "fold", amount: 0 },
  { street: "FLOP", handle: "carol", type: "call", amount: 0 },
  { street: "TURN", handle: "carol", type: "check", amount: 0 },
  { street: "TURN", handle: "dave", type: "check", amount: 0 },
  { street: "RIVER", handle: "carol", type: "bet", amount: 1000 },
  { street: "RIVER", handle: "dave", type: "call", amount: 0 },
];

const REPLAY_END_STACKS = { alice: 4400, bob: 4900, carol: 2600, dave: 8100 };

function replayHand() {
  return handFile({
    dealer: "alice",
    seat: "alice",
    players: [
      player("alice", 5000, ["Ah", "Ad"], null),
      player("bob", 5000, ["5s", "5d"]),
      player("carol", 5000, ["Kh", "Kc"]),
      player("dave", 5000, ["Jh", "Jc"]),
    ],
    board: ["2h", "9c", "Jd", "4s", "7h"],
    real: {
      actions: structuredClone(REPLAY_ACTIONS),
      result: "Dave took it with three jacks.",
      seatChips: 4400,
      endStacks: { ...REPLAY_END_STACKS },
    },
    startChips: 5000,
  });
}

/** Totals a `settle` stacks record, for M4's "the returned stacks sum to the
 *  starting stacks". Chip conservation is the one invariant that catches a
 *  side-pot bug the per-player numbers can hide. */
function sum(stacks: Record<string, number>): number {
  return Object.values(stacks).reduce((total, chips) => total + chips, 0);
}

// --- leg (a), M1: antes, blinds and the first actor --------------------------

describe("leg (a) [M1]: startHand posts the antes and the blinds and seats the first actor", () => {
  test("three-handed at 100/200 with A on the button: B is at 2900 with 100 in, C at 5800 with 200 in", () => {
    const state = startHand(sidePotHand());

    // The two players clockwise after the dealer post: B the small blind, C
    // the big blind. A, the dealer, has posted nothing.
    expect(seatView(state, "alice").stack).toBe(1000);
    expect(seatView(state, "bob").stack).toBe(2900); // 3000 - 100
    expect(seatView(state, "carol").stack).toBe(5800); // 6000 - 200

    // "with 100 in" and "with 200 in", read through the pinned View fields:
    // the pot holds both posts, B still owes the 100 that completes, and C,
    // in for the full 200, owes nothing.
    expect(seatView(state, "alice").pot).toBe(300);
    expect(seatView(state, "bob").toCall).toBe(100);
    expect(seatView(state, "carol").toCall).toBe(0);
    expect(seatView(state, "alice").toCall).toBe(200);
  });

  test("three-handed: the player left of the big blind acts first preflop", () => {
    const state = startHand(sidePotHand());

    // Note 2 in the header: applyAction acts for whoever is to act, so the
    // actor is proved by whose stack the call came out of. A is left of the
    // big blind, so the 200 must come from A.
    const after = applyAction(state, { type: "call", amount: 0 });
    expect(seatView(after, "alice").stack).toBe(800); // 1000 - 200
    expect(seatView(after, "bob").stack).toBe(2900); // untouched
    expect(seatView(after, "carol").stack).toBe(5800); // untouched
  });

  test("with an ante of 25 every player has 25 more in and the pot before any action is 375", () => {
    const state = startHand(sidePotHand({ blinds: { sb: 100, bb: 200, ante: 25 } }));

    // Every player antes, then the blinds go up on top: A 25, B 25 + 100,
    // C 25 + 200.
    expect(seatView(state, "alice").stack).toBe(975); // 1000 - 25
    expect(seatView(state, "bob").stack).toBe(2875); // 3000 - 25 - 100
    expect(seatView(state, "carol").stack).toBe(5775); // 6000 - 25 - 200

    // 3 antes of 25, plus 100 and 200, is 375.
    expect(seatView(state, "alice").pot).toBe(375);
  });

  test("heads-up the dealer posts the small blind and acts first", () => {
    const state = startHand(headsUpHand());

    expect(seatView(state, "alice").stack).toBe(4900); // the dealer's 100
    expect(seatView(state, "bob").stack).toBe(4800); // the big blind's 200
    expect(seatView(state, "alice").toCall).toBe(100);
    expect(seatView(state, "alice").pot).toBe(300);

    // A acts first: the completing 100 comes out of A's stack, not B's.
    const after = applyAction(state, { type: "call", amount: 0 });
    expect(seatView(after, "alice").stack).toBe(4800); // 4900 - 100
    expect(seatView(after, "bob").stack).toBe(4800); // untouched
  });
});

// --- leg (b), M2: the action set ---------------------------------------------

describe("leg (b) [M2]: legalActions reports fold, check, call, minRaiseTo and maxRaiseTo", () => {
  test("before any action the first actor's minRaiseTo is the big blind floor and maxRaiseTo the whole stack", () => {
    const state = startHand(sidePotHand());

    // A owes the 200 big blind, so check is false and call is 200. The last
    // raise size is the blind itself, 200, so minRaiseTo is 200 + 200 = 400,
    // which is also the big blind floor. maxRaiseTo is A's 1000 stack plus
    // A's street contribution of nothing.
    expect(legalActions(state)).toEqual({
      fold: true,
      check: false,
      call: 200,
      minRaiseTo: 400,
      maxRaiseTo: 1000,
    });
  });

  test("after A raises to 600 the small blind has check false, call 500, minRaiseTo 1000 and maxRaiseTo 3000", () => {
    const state = applyAction(startHand(sidePotHand()), { type: "raise", amount: 600 });

    // B posted 100, so B owes 600 - 100 = 500. The last raise size is
    // 600 - 200 = 400, so minRaiseTo is 600 + 400 = 1000. maxRaiseTo is B's
    // 2900 behind plus the 100 already in, which is 3000.
    expect(legalActions(state)).toEqual({
      fold: true,
      check: false,
      call: 500,
      minRaiseTo: 1000,
      maxRaiseTo: 3000,
    });
  });

  test("applyAction with check throws while chips are owed", () => {
    const state = applyAction(startHand(sidePotHand()), { type: "raise", amount: 600 });

    // B owes 500. A check is not a legal way to stay in the hand.
    expect(() => applyAction(state, { type: "check", amount: 0 })).toThrow();
  });

  test("a player owed nothing has check true and call 0", () => {
    let state = startHand(sidePotHand());
    state = applyAction(state, { type: "fold", amount: 0 }); // A folds
    state = applyAction(state, { type: "call", amount: 0 }); // B completes to 200

    // C is the big blind with the full 200 already in and nothing owed.
    const legal = legalActions(state);
    expect(legal.check).toBe(true);
    expect(legal.call).toBe(0);
  });

  test("a player with 400 behind facing 600 owed gets call 400 and minRaiseTo equal to maxRaiseTo", () => {
    // Four-handed with the short stack on the button, so D opens and A, with
    // 400 and nothing yet in, faces the 600.
    const state = applyAction(startHand(shortDealerHand()), { type: "raise", amount: 600 });

    // The call is the 600 owed capped at the 400 stack, and because 400
    // cannot reach minRaiseTo (600 + 400 = 1000), both raise bounds collapse
    // to the all-in total of 400 + 0 already in.
    const legal = legalActions(state);
    expect(legal.call).toBe(400);
    expect(legal.minRaiseTo).toBe(legal.maxRaiseTo);
    expect(legal).toEqual({
      fold: true,
      check: false,
      call: 400,
      minRaiseTo: 400,
      maxRaiseTo: 400,
    });
  });
});

// --- leg (c), M3: the short all-in does not reopen the action ----------------

describe("leg (c) [M3]: an all-in for less than a full raise does not reopen the action", () => {
  /** A raises to 600, B calls 600, C is all-in to 650. C's raise is 50 over
   *  the 600, short of the 400 a full raise needs, so A and B, who have both
   *  already acted this street, may only fold or call the 50. */
  function afterShortAllIn() {
    let state = startHand(noReopenHand());
    state = applyAction(state, { type: "raise", amount: 600 }); // A raises to 600
    state = applyAction(state, { type: "call", amount: 0 }); // B calls 600
    state = applyAction(state, { type: "raise", amount: 650 }); // C all-in to 650
    return state;
  }

  test("A, who already acted, gets call 50 with both raise bounds null", () => {
    expect(legalActions(afterShortAllIn())).toEqual({
      fold: true,
      check: false,
      call: 50, // 650 - 600 already in
      minRaiseTo: null,
      maxRaiseTo: null,
    });
  });

  test("B, who already acted, gets call 50 with both raise bounds null", () => {
    const state = applyAction(afterShortAllIn(), { type: "call", amount: 0 }); // A calls the 50

    expect(legalActions(state)).toEqual({
      fold: true,
      check: false,
      call: 50,
      minRaiseTo: null,
      maxRaiseTo: null,
    });
  });

  test("applyAction with a raise throws for A and for B", () => {
    const atA = afterShortAllIn();
    // 1300 would be a full raise over the 650 and is well inside both stacks;
    // it is refused because the short all-in did not reopen the action.
    expect(() => applyAction(atA, { type: "raise", amount: 1300 })).toThrow();

    const atB = applyAction(atA, { type: "call", amount: 0 });
    expect(() => applyAction(atB, { type: "raise", amount: 1300 })).toThrow();
  });

  test("applyAction with check throws for A and for B", () => {
    const atA = afterShortAllIn();
    expect(() => applyAction(atA, { type: "check", amount: 0 })).toThrow();

    const atB = applyAction(atA, { type: "call", amount: 0 });
    expect(() => applyAction(atB, { type: "check", amount: 0 })).toThrow();
  });
});

// --- leg (d), M4: uncalled bets, side pots and the odd chip ------------------

describe("leg (d) [M4]: settle returns the uncalled bet, builds the side pots and splits the ties", () => {
  test("heads-up A bets 500 on the flop and B folds: A's stack shows the 500 back", () => {
    let state = startHand(headsUpHand());
    expect(isHandOver(state)).toBe(false);

    state = applyAction(state, { type: "call", amount: 0 }); // A completes to 200
    state = applyAction(state, { type: "check", amount: 0 }); // B checks, preflop closes

    // Note 4 in the header: after the flop the first live player left of the
    // button acts, which heads-up is B, and the button bets last.
    state = applyAction(state, { type: "check", amount: 0 }); // B checks the flop
    state = applyAction(state, { type: "bet", amount: 500 }); // A bets 500

    // The bet is A's, not B's: A is 4800 - 500 behind.
    expect(seatView(state, "alice").stack).toBe(4300);

    state = applyAction(state, { type: "fold", amount: 0 }); // B folds
    expect(isHandOver(state)).toBe(true);

    // The 500 was never called, so it goes back to A, who then takes the 400
    // the two of them put in preflop: 4300 + 500 + 400 = 5200.
    const result = settle(state);
    expect(result.stacks).toEqual({ alice: 5200, bob: 4800 });
    expect(sum(result.stacks)).toBe(10000); // 5000 + 5000
  });

  test("the worked side-pot case settles to A 3000, B 4000, C 3000 over two pots", () => {
    let state = startHand(sidePotHand());
    state = applyAction(state, { type: "raise", amount: 1000 }); // A all-in to 1000
    state = applyAction(state, { type: "raise", amount: 3000 }); // B all-in to 3000
    state = applyAction(state, { type: "call", amount: 0 }); // C calls 3000

    const result = settle(state);

    // One pot per all-in level: the main pot is 1000 from each of the three,
    // the side pot is the extra 2000 from each of B and C.
    expect(result.pots.length).toBe(2);
    expect(result.pots[0]).toEqual({
      amount: 3000,
      eligible: ["alice", "bob", "carol"],
      winners: ["alice"], // aces
    });
    expect(result.pots[1]).toEqual({
      amount: 4000,
      eligible: ["bob", "carol"],
      winners: ["bob"], // kings, C having only queen high
    });

    // A ends on the 3000 main pot, B on the 4000 side pot, C on the 3000 left
    // behind from the 6000 start.
    expect(result.stacks).toEqual({ alice: 3000, bob: 4000, carol: 3000 });
    expect(sum(result.stacks)).toBe(10000); // 1000 + 3000 + 6000
  });

  test("the worked odd-chip case settles to A 1499, B 1500, C 0", () => {
    let state = startHand(oddChipHand());
    state = applyAction(state, { type: "raise", amount: 1000 }); // A all-in to 1000
    state = applyAction(state, { type: "call", amount: 0 }); // B all-in calling 1000
    state = applyAction(state, { type: "call", amount: 0 }); // C all-in for 999

    const result = settle(state);

    // Main pot 999 x 3 = 2997 among all three; side pot 1 x 2 = 2 between A
    // and B. A and B tie the ten-high straight in both.
    expect(result.pots.length).toBe(2);
    expect(result.pots[0].amount).toBe(2997);
    expect(result.pots[0].eligible).toEqual(["alice", "bob", "carol"]);
    expect([...result.pots[0].winners].sort()).toEqual(["alice", "bob"]);
    expect(result.pots[1].amount).toBe(2);
    expect(result.pots[1].eligible).toEqual(["alice", "bob"]);
    expect([...result.pots[1].winners].sort()).toEqual(["alice", "bob"]);

    // 2997 does not halve, and the odd chip goes to the first eligible player
    // clockwise from the dealer, which is B: B 1499 and A 1498 of the main,
    // then 1 each of the side. A 1498 + 1 = 1499, B 1499 + 1 = 1500.
    expect(result.stacks).toEqual({ alice: 1499, bob: 1500, carol: 0 });
    expect(sum(result.stacks)).toBe(2999); // 1000 + 1000 + 999
  });
});

// --- leg (e), M5: replay ------------------------------------------------------

describe("leg (e) [M5]: replay applies a real line and refuses an illegal one", () => {
  test("a scripted full-table line returns the hand-computed stacks", () => {
    const hand = replayHand();

    const state = replay(hand, hand.real.actions);

    expect(state.stacks).toEqual(REPLAY_END_STACKS);
    expect(sum(state.stacks)).toBe(20000); // four stacks of 5000
  });

  test("a line whose second action names the wrong handle throws with that handle in the message", () => {
    // The second action is A's call. Naming B instead makes it an action by a
    // player who is not to act.
    const actions = structuredClone(REPLAY_ACTIONS);
    actions[1].handle = "bob";

    expect(() => replay(replayHand(), actions)).toThrow(/bob/);
  });

  test("a raise below minRaiseTo throws with that handle in the message", () => {
    // D opens to 300 where minRaiseTo is 400, the big blind floor.
    const actions = structuredClone(REPLAY_ACTIONS);
    actions[0].amount = 300;

    expect(() => replay(replayHand(), actions)).toThrow(/dave/);
  });
});

// --- leg (f), M6: playSeat ----------------------------------------------------

/** Leg (f)'s scripted opponent: call whatever is owed, check otherwise. */
function callOrCheck(view: any) {
  return view.toCall > 0 ? { type: "call", amount: 0 } : { type: "check", amount: 0 };
}

/** The seat's whole line on the side-pot table: one raise, all-in for 1000. */
const SEAT_LINE = [{ street: "PRE", type: "raise", amount: 1000 }];

describe("leg (f) [M6]: playSeat consumes the seat's line and keys every decision the seat made", () => {
  test("the seat's aces take the 3000 the three of them each put 1000 into", () => {
    // A raises all-in to 1000; B and C each call it, and then check down the
    // flop, turn and river, so the only pot is 1000 x 3.
    const out = playSeat(sidePotHand(), structuredClone(SEAT_LINE), callOrCheck);

    expect(out.chips).toBe(3000);
  });

  test("line comes back equal to the seat actions given", () => {
    const out = playSeat(sidePotHand(), structuredClone(SEAT_LINE), callOrCheck);

    expect(out.line).toEqual([{ street: "PRE", type: "raise", amount: 1000 }]);
  });

  test("decisions has one entry for the seat's single decision, keyed by the actions before it", () => {
    const out = playSeat(sidePotHand(), structuredClone(SEAT_LINE), callOrCheck);

    // The key is the street, a colon, and the comma-joined handle:type:amount
    // of every action before the decision, blind postings included. Only the
    // two blind posts come before A's raise.
    expect(out.decisions.length).toBe(1);
    expect(out.decisions[0].key).toBe("PRE:bob:sb:100,carol:bb:200");
    expect(out.decisions[0].type).toBe("raise");
    expect(out.decisions).toEqual([{ key: "PRE:bob:sb:100,carol:bb:200", type: "raise" }]);
  });

  test("decide is called with a full View", () => {
    // M6 calls decide for every other player's turn, and the Context fixes the
    // View's fields. Extra fields are the implementer's business; these ten
    // are the contract.
    const seen: any[] = [];
    playSeat(sidePotHand(), structuredClone(SEAT_LINE), (view: any) => {
      seen.push(view);
      return callOrCheck(view);
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const view of seen) {
      for (const field of [
        "handle",
        "cards",
        "board",
        "street",
        "pot",
        "toCall",
        "stack",
        "playersIn",
        "position",
        "legal",
      ]) {
        expect(view).toHaveProperty(field);
      }
      expect(["blinds", "early", "late"]).toContain(view.position);
    }
  });

  test("a seat line one action short throws", () => {
    // The seat still has to open the hand, and there is nothing left to play.
    expect(() => playSeat(sidePotHand(), [], callOrCheck)).toThrow();
  });

  test("a seat line one action long throws", () => {
    // A is all-in after the raise and never acts again, so the extra check is
    // an action left over after the hand ended.
    const tooLong = [...structuredClone(SEAT_LINE), { street: "FLOP", type: "check", amount: 0 }];

    expect(() => playSeat(sidePotHand(), tooLong, callOrCheck)).toThrow();
  });
});

// --- leg (g), M7: determinism and no mutation --------------------------------

describe("leg (g) [M7]: equal inputs give deep-equal results and applyAction does not mutate", () => {
  test("two playSeat calls on the same inputs are deep-equal", () => {
    // Two equal-but-separate hand files and seat lines, so a run that quietly
    // wrote into its inputs would show up here as well as a clock or a random
    // source would.
    const first = playSeat(sidePotHand(), structuredClone(SEAT_LINE), callOrCheck);
    const second = playSeat(sidePotHand(), structuredClone(SEAT_LINE), callOrCheck);

    expect(first).toEqual(second);
  });

  test("the state passed to applyAction is unchanged by the call", () => {
    const state = startHand(sidePotHand());
    const before = structuredClone(state);

    applyAction(state, { type: "raise", amount: 600 });

    expect(state).toEqual(before);
  });
});

// --- 2026-09-21: the view says whether the street has been raised ----------
// The rule table could not tell an unopened preflop pot from a raised one
// (Mike M. called an all-in with ace-five). `raised` is true once the
// street's bet stands above the forced blinds preflop, or above nothing
// after the flop.
describe("seatView carries `raised`", () => {
  const hand = {
    id: "t", game: "2026-01-01", handNo: 1, title: "t", setup: "s", seat: "bob",
    blinds: { sb: 100, bb: 200, ante: 0 }, dealer: "alice",
    players: [
      { handle: "alice", stack: 5000, cards: ["Ah", "Ad"], shown: true, profile: null },
      { handle: "bob", stack: 5000, cards: ["Kh", "Kd"], shown: true, profile: null },
      { handle: "carol", stack: 5000, cards: ["Qh", "Qd"], shown: true, profile: null },
    ],
    board: ["2c", "3c", "4c", "5d", "9h"],
    real: { actions: [], result: "r", seatChips: 5000, endStacks: {} },
    startChips: 5000, profileThrough: "2026-01-01", opens: "2026-01-02", closes: "2026-01-09",
  };
  test("false while only the blinds stand, true once someone raises, false again on a checked flop", () => {
    let state = startHand(hand);
    expect(seatView(state, "alice").raised).toBe(false);
    state = applyAction(state, { type: "raise", amount: 600 });
    expect(seatView(state, "bob").raised).toBe(true);
    state = applyAction(state, { type: "call", amount: 0 });
    state = applyAction(state, { type: "call", amount: 0 });
    expect(seatView(state, state.toAct).raised).toBe(false);
    state = applyAction(state, { type: "bet", amount: 300 });
    expect(seatView(state, state.toAct).raised).toBe(true);
  });
});
