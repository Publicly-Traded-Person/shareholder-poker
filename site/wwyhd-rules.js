// The opponent rule table for "What Would You Have Done?": one player's
// profile plus what they can see, in; one action, out.
//
// Where it sits: the middle of the puzzle. The engine (site/wwyhd-engine.js)
// runs the hand and, at every seat that is not the visitor's, calls
// `decide(view, profile)` from here and plays whatever comes back. The reveal
// page and the Pages Function read `THRESHOLDS.MIN_SHARED` from here too, so
// the histogram floor is one number in one file. Served as a public static
// asset at /wwyhd-rules.js; `bun test tools` exercises it directly
// (tools/wwyhd-rules.test.ts). It imports the evaluator as a sibling module
// (`./wwyhd-eval.js`, both `evaluate` and `handCategory`, whose nine category
// names that file documents as its contract) and nothing else, so the same
// file runs in the browser, in the Worker and under bun.
//
// Why a table and not a solver (spec §4.3): this is deliberately simple so it
// can be argued with in a pull request. Every threshold is a named constant at
// the top of this file with the number's source beside it, and no number is
// inlined in the table itself, so retuning the opponents is a diff Charlie can
// read and the suite's fixtures show the retune as changed expected actions.
//
// NO CLOCK AND NO RANDOM SOURCE LIVE IN THIS FILE, and none may be added. The
// whole puzzle is a promise that the same hand file and the same choices give
// the same chips on every machine and on every replay, which also means the
// same spot must always draw the same action out of this table: an opponent
// who bluffs "sometimes" makes the visitor's score unrepeatable and the
// leaderboard meaningless. The suite greps site/wwyhd-*.js for `Math.random`,
// `Date.now` and `new Date`.

import { evaluate, handCategory } from "./wwyhd-eval.js";

// Card notation, the plan's global literal: two characters, rank then suit.
const RANK_ORDER = "23456789TJQKA";
const SUIT_ORDER = "shdc";
const CARDS_IN_HOLDING = 2;

// The five strength bands of spec §4.3 rule 1, low to high. These numbers are
// the return value of strengthBand() and the rungs the whole table is written
// against, so the names live here and the table never says "3".
const BAND_AIR = 0; // nothing: no pair, no draw
const BAND_DRAW = 1; // a weak pair or a draw
const BAND_MEDIUM = 2; // a real but beatable pair
const BAND_STRONG = 3; // two pair, top pair, an overpair
const BAND_MONSTER = 4; // trips or better preflop's premiums

// The thresholds. Every one of these is a number a human chose, so every one
// of them carries where it came from. `decide` takes this object as an
// optional third argument and reads the table's numbers off it, which is what
// lets a test (and a future tuning session) move one number without editing
// the table. Frozen because it is shared by every seat in every hand: a
// caller that mutated it would change the rules mid-puzzle and break replay.
export const THRESHOLDS = Object.freeze({
  // Aggression factor (bets plus raises over calls) at which a player raises
  // rather than calls. Spec §4.3 rules 2 and 3 name 1.5: it is just above
  // 1.0, the line between a player who mostly calls and one who mostly bets,
  // and the regulars' cards cluster either side of it.
  RAISE_AF: 1.5,
  // Share of river bets a player has called, at which they call one band
  // lighter. Spec §4.3 rule 4 names 50: half the time is the natural reading
  // of "calls down".
  CALL_DOWN: 50,
  // All-ins per hand above which a player will put their stack in on a strong
  // (not monster) hand. Spec §4.3 rule 5, as amended by the plan: a named
  // constant rather than the table median, because a median makes one
  // opponent's play depend on who else is seated and leaves the per-regular
  // fixtures with no canonical answer. 0.25 is "one hand in four", which on
  // the real cards separates the shovers from everyone else.
  ALL_IN_STRONG: 0.25,
  // Share of the stack below which committing it is cheap enough to do
  // without a monster. Spec §4.3 rule 5's last clause, "less than a fifth of
  // the stack".
  CHEAP_CALL_SHARE: 0.2,
  // How many first attempts must have reached a decision point before the
  // reveal page shows the share-of-visitors breakdown there. Spec §4.4: after
  // the first deviation visitors are in different hands, so a breakdown over
  // four people is noise wearing a percentage sign. Exported from here rather
  // than from the page so the Function that aggregates and the page that
  // renders cannot disagree; the table itself does not read it.
  MIN_SHARED: 5,
});

// The bar `foldToRaise` sets, spec §4.3 rule 3 ("higher foldToRaise, higher
// the bar") pinned to numbers by the plan. Read top down, first match wins.
// These are cut points in a profile percentage, not tuning knobs of the table,
// which is why they are not in THRESHOLDS: M5 fixes that object's five keys.
const FOLD_TO_RAISE_BARS = [
  { atLeast: 75, bar: BAND_STRONG },
  { atLeast: 50, bar: BAND_MEDIUM },
  { atLeast: 0, bar: BAND_DRAW },
];

// The two river bars of spec §4.3 rule 4: a player who calls down needs a
// medium hand, everyone else needs a strong one.
const RIVER_BAR_CALLS_DOWN = BAND_MEDIUM;
const RIVER_BAR_DEFAULT = BAND_STRONG;

// The band at which a player raises instead of calling, given the aggression
// for it (spec §4.3 rule 3, "raise with strong or monster").
const BAND_THAT_RAISES = BAND_STRONG;

// Preflop chart cut points, spec §4.3 rule 1's "fixed preflop chart" pinned to
// the bands by M1. A pocket pair of this rank or better, and the two-card
// minimum for "both cards ten or higher".
const PREMIUM_PAIR_RANK = 11; // jacks
const BROADWAY_RANK = 10; // a ten

// Hand categories, by the evaluator's own names (site/wwyhd-eval.js documents
// the nine strings as its contract, which is why this file keys on them
// rather than on the score encoding). "Three of a kind or better" is the
// monster line and "two pair" is one rung below it.
const MONSTER_CATEGORIES = new Set([
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
]);
const TWO_PAIR = "two pair";

// Draw shapes, before the river only. Four cards to a straight and four cards
// of a suit are each one card short of the made hand.
const CARDS_IN_DRAW = 4;
const RIVER_BOARD_CARDS = 5;

// The Chen formula (William Chen, published in "The Mathematics of Poker" and
// the standard hand-ranking shorthand since), which is what preflopPercentile
// ranks the 169 starting-hand classes with. Any published ordering would do;
// this one is short enough to read, is somebody else's opinion rather than
// ours, and puts the aces at the top and 7-2 offsuit at the bottom, which is
// what the puzzle's readers expect to see.
const CHEN_HIGH_CARD = { 14: 10, 13: 8, 12: 7, 11: 6 }; // A K Q J; the rest are half their pips
const CHEN_PAIR_MULTIPLIER = 2;
const CHEN_PAIR_FLOOR = 5;
const CHEN_SUITED_BONUS = 2;
const CHEN_GAP_PENALTY = [0, 1, 2, 4, 5]; // by cards missing between the two, 4 or more capped
const CHEN_STRAIGHT_BONUS = 1;
const CHEN_STRAIGHT_BONUS_MAX_GAP = 1;
const CHEN_STRAIGHT_BONUS_UNDER_RANK = 12; // both cards below a queen

// The 169 starting-hand classes: 13 pairs plus 78 rank combinations each way.
const STARTING_HAND_CLASSES = 169;
const PERCENT = 100;

/** The numeric value of a card's rank, 2 for a deuce through 14 for an ace. */
function rankOf(card) {
  return RANK_ORDER.indexOf(card[0]) + 2;
}

/**
 * Throws unless `cards` is a two-card holding in the notation.
 *
 * Takes the caller's array and a label for the message. Returns nothing.
 * Throws `RangeError` on anything but exactly two distinct, well-formed cards.
 *
 * Why it refuses rather than coping: a malformed holding here means a hand
 * file or an engine line is wrong, and a rule table that shrugs and returns
 * "fold" would publish a puzzle whose opponents played a hand nobody held.
 * Halt, do not guess.
 */
function checkHolding(cards, label) {
  if (!Array.isArray(cards) || cards.length !== CARDS_IN_HOLDING) {
    throw new RangeError(`${label} takes exactly ${CARDS_IN_HOLDING} cards`);
  }
  for (const card of cards) {
    if (
      typeof card !== "string" ||
      card.length !== 2 ||
      !RANK_ORDER.includes(card[0]) ||
      !SUIT_ORDER.includes(card[1])
    ) {
      throw new RangeError(
        `not a card: ${JSON.stringify(card)} (rank in ${RANK_ORDER}, suit in ${SUIT_ORDER})`,
      );
    }
  }
  if (cards[0] === cards[1]) {
    throw new RangeError(`duplicate card: ${cards[0]}`);
  }
}

/** The preflop band of a holding, M1's first five clauses in their order. */
function preflopBand(cards) {
  const [high, low] = cards.map(rankOf).sort((a, b) => b - a);
  const suited = cards[0][1] === cards[1][1];
  const pair = high === low;

  if (pair && high >= PREMIUM_PAIR_RANK) return BAND_MONSTER; // jacks or better
  if (high === 14 && low === 13) return BAND_MONSTER; // ace-king, either way
  if (pair) return BAND_STRONG; // any other pocket pair
  if (high === 14 && (low === 12 || low === 11)) return BAND_STRONG; // ace-queen, ace-jack
  if (high === 13 && low === 12) return BAND_STRONG; // king-queen
  if (low >= BROADWAY_RANK) return BAND_MEDIUM; // any other two cards ten or higher
  if (suited && high === 14) return BAND_MEDIUM; // a suited ace
  if (suited && high - low === 1) return BAND_DRAW; // suited connectors
  return BAND_AIR;
}

/** True when the ranks hold four in a row that a card at either end would
 *  finish. The loop stops below jack-high on purpose: J Q K A is four in a row
 *  but only a ten completes it, so it is not open at both ends. A 2 3 4 5 is,
 *  because the ace plays low there. */
function hasOpenEnder(ranks) {
  const present = new Set(ranks);
  for (let low = 2; low + CARDS_IN_DRAW - 1 <= 13; low++) {
    let run = 0;
    while (run < CARDS_IN_DRAW && present.has(low + run)) run++;
    if (run === CARDS_IN_DRAW) return true;
  }
  return false;
}

/** True when some suit appears at least four times. Five or more is a made
 *  flush, which the monster test above has already taken. */
function hasFlushDraw(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card[1], (counts.get(card[1]) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= CARDS_IN_DRAW);
}

/** The band of a holding against a board, M1's second set of clauses in their
 *  order. Split out from strengthBand() only to keep the two readings of the
 *  same word ("band", with and without a board) side by side. */
function postflopBand(cards, board) {
  const all = [...cards, ...board];
  const category = handCategory(evaluate(all));
  if (MONSTER_CATEGORIES.has(category)) return BAND_MONSTER; // three of a kind or better
  if (category === TWO_PAIR) return BAND_STRONG;

  const holeRanks = cards.map(rankOf);
  const boardRanks = board.map(rankOf);
  const topBoard = Math.max(...boardRanks);
  const pocketPair = holeRanks[0] === holeRanks[1];

  if (holeRanks.includes(topBoard)) return BAND_STRONG; // a pair with the top board card
  if (pocketPair && holeRanks[0] > topBoard) return BAND_STRONG; // an overpair
  if (holeRanks.some((rank) => boardRanks.includes(rank))) return BAND_MEDIUM; // a pair with a lesser board card
  if (pocketPair && holeRanks[0] < topBoard) return BAND_DRAW; // an underpair
  // A draw, and still a card to come for it. Both draws are read over the
  // holding and the board together, which is how the rule is worded: a board
  // that is itself four to a flush is a live card for everybody, and a table
  // that scored it as air would have every opponent bet into it.
  if (
    board.length < RIVER_BOARD_CARDS &&
    (hasOpenEnder(all.map(rankOf)) || hasFlushDraw(all))
  ) {
    return BAND_DRAW;
  }
  return BAND_AIR;
}

/**
 * How strong a holding is on the street the board describes, as one of the
 * five bands: 0 air, 1 a weak pair or a draw, 2 medium, 3 strong, 4 monster.
 *
 * Takes the two hole cards and the board so far (`[]` preflop, three cards on
 * the flop, four on the turn, five on the river), both in the two-character
 * notation. Returns an integer 0 to 4. Throws `RangeError` on a holding that
 * is not two distinct well-formed cards, and (from the evaluator) on a board
 * that leaves fewer than five cards in all or repeats a card the holding
 * already has, which means two seats hold the same physical card and the deck
 * itself is broken.
 *
 * The bands are coarse on purpose. They are the only thing `decide` knows
 * about cards, so a change here moves every opponent at once, and the point of
 * five wide rungs is that a reader can check a fixture's expected action by
 * eye. The clause order is load-bearing: a pocket pair that pairs the top
 * board card is trips, not an overpair, and a suited broadway holding is
 * "two cards ten or higher" before it is "suited connectors", so each test
 * assumes the ones above it have already failed.
 */
export function strengthBand(cards, board) {
  checkHolding(cards, "strengthBand");
  const community = board ?? [];
  if (!Array.isArray(community)) {
    throw new RangeError("strengthBand takes the board as an array");
  }
  return community.length === 0
    ? preflopBand(cards)
    : postflopBand(cards, community);
}

/** The Chen points of a rank pair. Higher is better. */
function chenPoints(high, low, suited) {
  const pair = high === low;
  let points = CHEN_HIGH_CARD[high] ?? high / 2;
  if (pair) points = Math.max(points * CHEN_PAIR_MULTIPLIER, CHEN_PAIR_FLOOR);
  if (suited) points += CHEN_SUITED_BONUS;
  const gap = Math.max(high - low - 1, 0);
  points -= CHEN_GAP_PENALTY[Math.min(gap, CHEN_GAP_PENALTY.length - 1)];
  if (
    !pair &&
    gap <= CHEN_STRAIGHT_BONUS_MAX_GAP &&
    high < CHEN_STRAIGHT_BONUS_UNDER_RANK
  ) {
    points += CHEN_STRAIGHT_BONUS;
  }
  // Chen rounds half a point upwards, and every total here is a whole or a
  // half, so a ceiling is that rule exactly.
  return Math.ceil(points);
}

// The whole chart, scored once when the module loads: the Chen points of all
// 169 classes, highest first. 169 numbers is nothing, and computing it here
// rather than writing it out by hand means the ordering cannot drift from the
// formula above it.
const CHART_SCORES = (() => {
  const scores = [];
  for (let high = 2; high <= 14; high++) {
    for (let low = 2; low <= high; low++) {
      scores.push(chenPoints(high, low, false)); // the pair, or the offsuit twin
      if (high !== low) scores.push(chenPoints(high, low, true));
    }
  }
  return scores.sort((a, b) => b - a);
})();

/**
 * Where a holding sits among all starting hands, as a percentage: the share of
 * the 169 starting-hand classes that are this good or better.
 *
 * Takes the two hole cards in the two-character notation. Returns a number
 * greater than 0 and at most 100, SMALL for a good hand and LARGE for a bad
 * one, because it is the number `vpip` is compared against: a player who
 * enters 20 percent of hands enters the ones whose percentile is 20 or less.
 * Pocket aces are the smallest value any holding returns and 7-2 offsuit the
 * largest. Throws `RangeError` on anything but two distinct well-formed cards.
 *
 * Two holdings that tie on the chart get the SAME percentile, which is why
 * this counts classes at or above the score rather than reading an index out
 * of a sorted list: an arbitrary tie break would make one of two equally good
 * hands look better than the other, and the suited version of a holding is
 * never ranked worse than its offsuit twin only because Chen's suited bonus
 * lands before the rounding.
 */
export function preflopPercentile(cards) {
  checkHolding(cards, "preflopPercentile");
  const [high, low] = cards.map(rankOf).sort((a, b) => b - a);
  const score = chenPoints(high, low, cards[0][1] === cards[1][1]);
  const atOrAbove = CHART_SCORES.filter((other) => other >= score).length;
  return (atOrAbove / STARTING_HAND_CLASSES) * PERCENT;
}

// The action shape, the plan's global literal: a bet or a raise carries the
// TOTAL the player's street contribution becomes (PokerNow's "raises to N"),
// and a fold, a check and a call all carry 0, because for those the engine
// already knows what they cost.
const NO_AMOUNT = 0;
const fold = () => ({ type: "fold", amount: NO_AMOUNT });
const check = () => ({ type: "check", amount: NO_AMOUNT });
const call = () => ({ type: "call", amount: NO_AMOUNT });
const raiseTo = (amount) => ({ type: "raise", amount });

/** The bar `foldToRaise` sets: the band below which a bet or a raise in front
 *  of this player takes the pot. */
function foldBar(foldToRaise) {
  const match = FOLD_TO_RAISE_BARS.find((step) => foldToRaise >= step.atLeast);
  // The last step's `atLeast` is 0, so only a missing or non-numeric
  // percentage can miss every step, and for that the loosest bar is the safe
  // reading: a profile with no number in it should not fold everything.
  return match ? match.bar : BAND_DRAW;
}

/**
 * The total a raise goes to, or null when this player cannot raise here and
 * must call instead.
 *
 * Spec §4.3 rule 5, the all-in rule, is a sizing rule in this table: a monster
 * puts the stack in, a strong hand does when the profile shoves often or when
 * the stack is nearly in already, and everything else takes the minimum. The
 * fold bars above are absolute either way (M3), so nothing here can turn a
 * fold into a call.
 */
function raiseTarget(band, profile, view, thresholds) {
  const { minRaiseTo, maxRaiseTo } = view.legal;
  if (minRaiseTo == null) return null; // no raise is legal here: call
  if (maxRaiseTo == null) return minRaiseTo;
  // A stack too short to make a full minimum raise. The engine says so by
  // leaving minRaiseTo null, so this is belt and braces; calling is the one
  // answer that is certainly legal.
  if (maxRaiseTo < minRaiseTo) return null;
  const toCall = view.toCall ?? NO_AMOUNT;
  const cheap =
    maxRaiseTo - toCall <= thresholds.CHEAP_CALL_SHARE * view.stack;
  const commit =
    band >= BAND_MONSTER ||
    (band >= BAND_STRONG &&
      (profile.allInRate > thresholds.ALL_IN_STRONG || cheap));
  return commit ? maxRaiseTo : minRaiseTo;
}

/**
 * One opponent's action in one spot: spec §4.3's v1 table, run.
 *
 * Takes the engine's view of the spot from that player's seat
 * (`{handle, cards, board, street, pot, toCall, stack, playersIn, position,
 * legal}`, with `legal` the engine's `{fold, check, call, minRaiseTo,
 * maxRaiseTo}`), that player's profile (`{vpip, af, allInRate, foldToRaise,
 * callDown}`, the first three already on their card and the last two new), and
 * optionally a thresholds object to read the table's numbers from, which
 * defaults to THRESHOLDS and is merged over it so a partial override still
 * leaves the rest in place. Returns `{type, amount}` with `type` one of
 * "fold", "check", "call" or "raise" and `amount` the total a raise goes to
 * (0 for the other three). Throws `RangeError` on a holding the bands refuse.
 *
 * The action is always one `view.legal` allows: a raise only when
 * `legal.minRaiseTo` is a number, and a call in its place when it is not. That
 * is not politeness, it is the engine's contract. An illegal action would
 * either abort the hand mid-puzzle or, worse, be applied and put chips in the
 * pot that no seat paid for, and chip conservation is the check that the whole
 * publish flow refuses on.
 *
 * Same spot, same action, every time: see the determinism note at the top of
 * the file. Nothing in here is stateful, so two calls on equal inputs return
 * deep-equal actions.
 */
export function decide(view, profile, thresholds) {
  const table = { ...THRESHOLDS, ...(thresholds ?? {}) };
  const board = view.board ?? [];
  const band = strengthBand(view.cards, board);
  const toCall = view.toCall ?? NO_AMOUNT;

  // Preflop, rule 2: the profile's `vpip` is the whole of the reading.
  //
  // Rule 2 is written for an unopened pot and rule 3 covers a raise in front,
  // but the view cannot tell the two apart: it carries no blind size and no
  // raise count, and the blinds make the arithmetic identical from inside it
  // (unopened five-handed the pot is a small blind plus a big blind and the
  // call is the big blind, two thirds of the pot; facing a three-times open
  // the pot is those two blinds plus the open and the call is the open, two
  // thirds of the pot again). So every preflop spot takes this branch. IF YOU
  // ADD A RAISE COUNT OR THE BLINDS TO THE VIEW, split this: a preflop spot
  // with a raise in front of it belongs to rule 3's bar below, and leaving it
  // here has loose players calling three-bets they should be folding.
  if (view.street === "preflop" || board.length === 0) {
    // A big blind nobody raised owes nothing: folding there gives up a free
    // hand, which no player at the real table does and the visitor would see
    // as a seat quitting for no reason. The check comes before the vpip test
    // for exactly that spot; every other preflop spot has chips to call.
    if (toCall <= NO_AMOUNT && view.legal.check === true) return check();
    if (preflopPercentile(view.cards) > profile.vpip) return fold();
    if (profile.af >= table.RAISE_AF && view.legal.minRaiseTo != null) {
      return raiseTo(view.legal.minRaiseTo);
    }
    return call();
  }

  // Nothing to answer. The v1 table is a response table: it never takes the
  // betting initiative, so a checked-to opponent checks behind whatever they
  // hold. That is the conservative half of the rule and it is visible to the
  // visitor as a quiet table, which the fixtures would rather have than a
  // bluffing engine nobody can predict.
  if (toCall <= NO_AMOUNT) return check();

  // The river, rule 4: no card left to come, so the only question is whether
  // this player pays to see the hand.
  if (view.street === "river" || board.length >= RIVER_BOARD_CARDS) {
    const bar =
      profile.callDown >= table.CALL_DOWN
        ? RIVER_BAR_CALLS_DOWN
        : RIVER_BAR_DEFAULT;
    return band >= bar ? call() : fold();
  }

  // Facing a bet or a raise with a card still to come, rule 3.
  if (band < foldBar(profile.foldToRaise)) return fold();
  if (band >= BAND_THAT_RAISES && profile.af >= table.RAISE_AF) {
    const target = raiseTarget(band, profile, view, table);
    if (target != null) return raiseTo(target);
  }
  return call();
}
