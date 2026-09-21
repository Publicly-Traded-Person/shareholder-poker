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
  // These are SCALE FACTORS, not decisions. Every decision below is derived
  // from the acting player's own numbers (vpip, af, allInRate, foldToRaise,
  // callDown), their stack and the pot; nothing here says "fold" or "raise"
  // for everyone (Mike, 2026-09-21: "every player is acting a little
  // differently... rules should be based on the attributes of the players").
  //
  // Looseness. A player enters with the top `vpip` percent of holdings, shifted
  // by position: later seats play more, earlier seats less.
  POS_LATE: 1.25,
  POS_EARLY: 0.8,
  // Aggression. The hand strength band (0 air .. 4 monster) a player needs to
  // bet into a check is 4 minus BET_BAR_SLOPE times af, floored at 1: af 0.6
  // bets only a monster, af 0.84 bets a strong hand (Chris H. bet aces on the
  // flop of hand 39), af 2.5 bets a draw.
  BET_BAR_SLOPE: 1.2,
  // Raising into a bet needs this much more band than betting into a check.
  RAISE_OVER_BET: 1.5,
  // Bet size as a share of the pot: BET_FRAC_BASE + BET_FRAC_SLOPE x af,
  // between 0.4 and 1.0 of the pot.
  BET_FRAC_BASE: 0.3,
  BET_FRAC_SLOPE: 0.2,
  // Continuing against a bet needs a band of foldToRaise / CONTINUE_SCALE
  // before the river, (100 - callDown) / CONTINUE_SCALE on it: foldToRaise 80
  // needs a strong hand, 30 continues with a draw; callDown 70 pays off a
  // medium hand, 25 only a strong one.
  CONTINUE_SCALE: 30,
  // Risk tolerance, 0.1 to 1: RISK_ALLIN x allInRate + callDown / RISK_CALLDOWN.
  // The share of the stack a player will put in with a band-b hand is
  // risk x (b/4)^2; a monster has no limit.
  RISK_ALLIN: 4,
  RISK_CALLDOWN: 150,
  // Shoving needs a band of 4 minus SHOVE_SLOPE x allInRate, never under 2:
  // allInRate 0.3 shoves a strong hand, 0.05 only a monster. It also needs
  // the bet to be worth that much: a player only puts the last of a stack in
  // when the size they wanted already commits COMMIT_SHARE of it, which a
  // frequent shover reaches sooner (minus COMMIT_ALLIN x allInRate). Without
  // it, a monster open-shoved 29 big blinds into a limped pot.
  SHOVE_SLOPE: 4,
  COMMIT_SHARE: 0.7,
  COMMIT_ALLIN: 0.8,
  // The histogram floor the page and the Function share (spec section 4.4).
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
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * One player's tendencies, read off their profile and the scale factors.
 *
 * Takes a profile `{vpip, af, allInRate, foldToRaise, callDown}` (a missing
 * number reads as 0, the tightest reading of it) and the thresholds object.
 * Returns the numbers every decision is made from: `entry(position)` the
 * percentile a holding must be inside to play; `betBar` the band needed to
 * bet into a check; `raiseBar` the band needed to raise into a bet;
 * `betFrac` the bet as a share of the pot; `continueBar(street)` the band
 * needed to keep going against a bet; `maxShare(band)` the share of the
 * stack the player will put in with that band; `shoveBar` the band needed
 * to go all in. Throws nothing.
 */
export function traits(profile, thresholds) {
  const t = { ...THRESHOLDS, ...(thresholds ?? {}) };
  const p = profile ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const vpip = num(p.vpip), af = num(p.af), allIn = num(p.allInRate);
  const foldToRaise = num(p.foldToRaise), callDown = num(p.callDown);
  const risk = clamp(t.RISK_ALLIN * allIn + callDown / t.RISK_CALLDOWN, 0.1, 1);
  const betBar = clamp(4 - t.BET_BAR_SLOPE * af, 1, 4);
  return {
    entry: (position) =>
      vpip * (position === "late" ? t.POS_LATE : position === "early" ? t.POS_EARLY : 1),
    betBar,
    raiseBar: betBar + t.RAISE_OVER_BET,
    betFrac: clamp(t.BET_FRAC_BASE + t.BET_FRAC_SLOPE * af, 0.4, 1),
    continueBar: (street) =>
      street === "RIVER" || street === "river" ? (100 - callDown) / t.CONTINUE_SCALE : foldToRaise / t.CONTINUE_SCALE,
    maxShare: (band) => (band >= BAND_MONSTER ? 1 : risk * (band / 4) ** 2),
    shoveBar: clamp(4 - t.SHOVE_SLOPE * allIn, 2, 4),
    // The share of the stack a raise must already cost before going all in is
    // on the table at all.
    commitShare: clamp(t.COMMIT_SHARE - t.COMMIT_ALLIN * allIn, 0.25, 1),
    risk,
  };
}

/** The raise or bet the player makes: all in when the band clears their shove
 *  bar, otherwise the minimum plus their share of the pot, inside the engine's
 *  bounds. Returns null when no raise is legal. */
function sizedRaise(band, tr, view, type) {
  const legal = view.legal;
  if (!legal || legal.minRaiseTo == null || legal.maxRaiseTo == null) return null;
  // A bet into a check is a share of the pot; a raise into a bet is the
  // minimum raise plus that share, so it always stands above the bet it answers.
  const share = Math.round(tr.betFrac * (view.pot ?? 0));
  const base = type === "bet" ? share : legal.minRaiseTo + share;
  const wanted = clamp(base, legal.minRaiseTo, legal.maxRaiseTo);
  // All in only when the hand is strong enough AND the size already commits
  // most of the stack. A big hand in a small pot bets the pot, not the stack.
  const commits = wanted >= tr.commitShare * legal.maxRaiseTo;
  return { type, amount: band >= tr.shoveBar && commits ? legal.maxRaiseTo : wanted };
}

/**
 * The opponent's action, from their own profile (spec section 4.3, as
 * rewritten 2026-09-21 on Mike's principle: no universal rules).
 *
 * Takes the engine's view of the seat `{handle, cards, board, street, pot,
 * toCall, stack, playersIn, position, raised, legal}`, the player's profile,
 * and optionally a thresholds copy (the scale factors) that defaults to
 * THRESHOLDS. Returns `{type, amount}` allowed by `view.legal`. Throws
 * nothing. Deterministic: the same view and profile always give the same
 * action, which is what lets the Function re-score a line the browser played.
 *
 * The shape, every number the player's own (see `traits`):
 *   nothing owed  -> bet when the band clears betBar, sized by betFrac,
 *                    all in when it clears shoveBar; otherwise check.
 *   preflop, no raise yet -> enter with a holding inside entry(position);
 *                    raise when the band clears betBar; otherwise call.
 *   facing a bet or raise -> fold under continueBar(street); fold when the
 *                    call costs more of the stack than maxShare(band) allows;
 *                    raise when the band clears raiseBar; otherwise call.
 * A monster never folds and never faces a stack limit; a band-0 holding never
 * bets or raises and never goes all in, because betBar and shoveBar never
 * drop below 1 and 2.
 */
export function decide(view, profile, thresholds) {
  const tr = traits(profile, thresholds);
  const board = view.board ?? [];
  const band = strengthBand(view.cards, board);
  const toCall = view.toCall ?? NO_AMOUNT;
  const legal = view.legal ?? {};
  const preflop = view.street === "PRE" || view.street === "preflop" || board.length === 0;

  // Nothing owed: a free big blind, or checked to after the flop.
  if (toCall <= NO_AMOUNT) {
    if (preflop) return check();
    if (band >= tr.betBar) return sizedRaise(band, tr, view, "bet") ?? check();
    return check();
  }

  // Preflop with nothing but the blinds in front: play the holding when it is
  // inside the player's entry range for the seat, raise when it clears the
  // bet bar, otherwise limp.
  if (preflop && view.raised !== true) {
    if (preflopPercentile(view.cards) > tr.entry(view.position)) return fold();
    if (band >= tr.betBar) return sizedRaise(band, tr, view, "raise") ?? call();
    return call();
  }

  // Facing a bet or a raise, on any street.
  if (band < tr.continueBar(view.street)) return fold();
  const stackBefore = (view.stack ?? 0) + toCall;
  const share = stackBefore > 0 ? toCall / stackBefore : 1;
  if (share > tr.maxShare(band)) return fold();
  if (band >= tr.raiseBar) return sizedRaise(band, tr, view, "raise") ?? call();
  return call();
}
