// Poker hand evaluator for "What Would You Have Done?": the best five of a
// player's five to seven cards, as one comparable integer.
//
// Where it sits: the puzzle's showdown. The engine (site/wwyhd-engine.js) and
// the opponent rules (site/wwyhd-rules.js) import it as
// `import { evaluate } from "./wwyhd-eval.js"`, the Pages Function reaches it
// by relative path into site/, and bun test exercises it directly
// (tools/wwyhd-eval.test.ts). Served as a public static asset at
// /wwyhd-eval.js; it is a plain ES module with no imports of its own, so the
// same file runs in the browser, in the Worker, and under bun.
//
// Written from scratch rather than vendored on purpose: the site has no build
// step and no runtime npm, and a hundred licence-free lines with their own
// tests are easier for Charlie to read at 10pm than a minified third-party
// file.
//
// NO CLOCK AND NO RANDOM SOURCE LIVE IN THIS FILE, and none may be added. The
// whole puzzle is a promise that the same hand file and the same choices give
// the same chips on every machine and on every replay; a single nondeterminism
// anywhere under site/wwyhd-*.js breaks that promise everywhere at once. The
// suite greps for it.

// Card notation, the plan's global literal: two characters, rank then suit.
// Rank order is also the scoring order, so a rank's value is its index here
// plus 2 (deuce is 2, ace is 14).
const RANK_ORDER = "23456789TJQKA";
const SUIT_ORDER = "shdc";

// The nine category names, low to high. The index into this array IS the
// category part of a score, which is what lets handCategory() run the
// encoding backwards. Do not reorder: the names are the contract, and their
// order is the ranking.
const CATEGORIES = [
  "high card",
  "pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
];

// Score encoding. A score is a category index in base RANK_BASE followed by
// the five ranking ranks, most significant first:
//
//   category * 15^5 + r1*15^4 + r2*15^3 + r3*15^2 + r4*15 + r5
//
// RANK_BASE is 15 because the highest digit any slot can hold is the ace at
// 14, so 15 leaves every rank its own digit and no slot can carry into the
// one above it. That carry-free property is the whole point: it is what makes
// a higher category beat a lower one no matter how good the lower one's
// kickers are, and a better kicker beat a worse one at equal category. Five
// slots because a poker hand is five cards; hands that rank on fewer values
// (a full house ranks on two, the trips and the pair) pad the rest with zero,
// which is below every real rank. The largest score is under seven million,
// so every score is a safe integer and plain `>` compares them.
const RANK_SLOTS = 5;
const RANK_BASE = 15;
const CATEGORY_BASE = RANK_BASE ** RANK_SLOTS;

/** The numeric value of a card's rank, 2 for a deuce through 14 for an ace. */
function rankOf(card) {
  return RANK_ORDER.indexOf(card[0]) + 2;
}

/**
 * Throws unless `cards` is a legal hand to evaluate.
 *
 * Takes the caller's array. Returns nothing. Throws `RangeError` on fewer
 * than five cards, on more than seven, on anything that is not two characters
 * of the notation, and on a repeated card.
 *
 * Why it refuses rather than coping: every one of these inputs means a hand
 * file or an engine line is wrong, and a wrong hand file that scores anyway
 * publishes a puzzle whose answer is quietly false. Fewer than five cards
 * cannot make a poker hand; more than seven means a deal went wrong; a
 * duplicate means two seats hold the same physical card, so the deck itself
 * is broken and the strongest hand at the table is fiction. Halt, do not
 * guess.
 */
function checkHand(cards) {
  if (!Array.isArray(cards)) {
    throw new RangeError("evaluate takes an array of cards");
  }
  if (cards.length < RANK_SLOTS || cards.length > 7) {
    throw new RangeError(
      `evaluate takes 5 to 7 cards, got ${cards.length}`,
    );
  }
  const seen = new Set();
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
    if (seen.has(card)) {
      throw new RangeError(`duplicate card: ${card}`);
    }
    seen.add(card);
  }
}

/**
 * The top rank of the straight in five distinct-or-not ranks, or 0 for no
 * straight. `ranks` arrives sorted high to low.
 *
 * The wheel is the reason this is a function and not one comparison: A 2 3 4 5
 * is a straight, but the ace plays low in it, so the five ranks arrive as
 * 14 5 4 3 2 and the run is not visible as a descending span. It scores as a
 * five-high straight, which puts it below every other straight, exactly as
 * the rules have it.
 */
function straightTop(ranks) {
  const distinct = new Set(ranks).size === RANK_SLOTS;
  if (!distinct) return 0;
  if (ranks[0] - ranks[RANK_SLOTS - 1] === RANK_SLOTS - 1) return ranks[0];
  const wheel = [14, 5, 4, 3, 2];
  if (ranks.every((rank, i) => rank === wheel[i])) return 5;
  return 0;
}

/** The five ranks of a straight topped by `top`, high to low. The wheel's
 *  lowest card comes out as 1, below the deuce, which is right: in that hand
 *  the ace is the low end of the run, not the high one. */
function runRanks(top) {
  return [top, top - 1, top - 2, top - 3, top - 4];
}

/** Folds a category and its ranking ranks into one comparable integer, zero
 *  padding any unused slot. See the encoding note above CATEGORY_BASE. */
function pack(category, values) {
  let score = category;
  for (let slot = 0; slot < RANK_SLOTS; slot++) {
    score = score * RANK_BASE + (values[slot] ?? 0);
  }
  return score;
}

/**
 * Scores exactly five cards. Internal: callers go through evaluate(), which
 * validates and picks the best five.
 *
 * The shape string is the group sizes largest first ("41" is four of a kind,
 * "32" a full house, "311" trips, "221" two pair, "2111" one pair, "11111"
 * nothing), and `byGroup` is those groups' ranks in the same order, which is
 * already the standard kicker order: the pair or trips that names the hand
 * first, then the loose cards high to low.
 */
function scoreFive(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((card) => card[1] === cards[0][1]);
  const top = straightTop(ranks);

  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  // Bigger groups first, and higher ranks first within equal group sizes, so
  // that aces up outranks kings up and the kickers fall in order behind.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(([, size]) => size).join("");
  const byGroup = groups.map(([rank]) => rank);

  if (top && flush) return pack(8, runRanks(top));
  if (shape === "41") return pack(7, byGroup);
  if (shape === "32") return pack(6, byGroup);
  if (flush) return pack(5, ranks);
  if (top) return pack(4, runRanks(top));
  if (shape === "311") return pack(3, byGroup);
  if (shape === "221") return pack(2, byGroup);
  if (shape === "2111") return pack(1, byGroup);
  return pack(0, ranks);
}

/**
 * Scores a poker hand: the strength of the best five of the cards given.
 *
 * Takes 5, 6 or 7 cards in the two-character notation (`["Ah","Ad","Kc",...]`,
 * rank in 23456789TJQKA, suit in shdc); seven is the showdown case, two hole
 * cards and the five-card board. Returns an integer that is larger for the
 * better hand and EQUAL for two hands whose best five cards have the same
 * ranks, whatever their suits, because suits do not break ties in this game
 * and an equal score is how the engine knows to split the pot. Throws
 * `RangeError` on a hand checkHand() refuses.
 *
 * It looks at all twenty-one five-card subsets of a seven-card hand and keeps
 * the best. A cleverer seven-card ranker exists, but twenty-one scorings are
 * free at the one-hand-per-page scale this runs at, and this version can be
 * read straight through and believed, which is worth more here.
 */
export function evaluate(cards) {
  checkHand(cards);
  let best = -1;
  const five = new Array(RANK_SLOTS);
  // Walk the subsets in order, filling `five` one card at a time. The loop
  // bound leaves enough cards behind index i to finish the subset.
  const choose = (start, depth) => {
    if (depth === RANK_SLOTS) {
      const score = scoreFive(five);
      if (score > best) best = score;
      return;
    }
    for (let i = start; i <= cards.length - (RANK_SLOTS - depth); i++) {
      five[depth] = cards[i];
      choose(i + 1, depth + 1);
    }
  };
  choose(0, 0);
  return best;
}

/**
 * Names the category a score falls in, for the reveal's plain-English line
 * ("Drew won with a full house").
 *
 * Takes a score from evaluate(). Returns one of exactly nine strings:
 * "high card", "pair", "two pair", "three of a kind", "straight", "flush",
 * "full house", "four of a kind", "straight flush". Throws `RangeError` on
 * anything that is not a score this module produced.
 *
 * It refuses rather than clamping because a score out of range means the
 * caller did arithmetic on a score (added a bonus, scaled it, compared it
 * against chips), and a clamped answer would put a confident wrong hand name
 * in front of a reader on the reveal page.
 */
export function handCategory(score) {
  if (!Number.isInteger(score) || score < 0 || score >= CATEGORIES.length * CATEGORY_BASE) {
    throw new RangeError(`not a hand score: ${score}`);
  }
  return CATEGORIES[Math.floor(score / CATEGORY_BASE)];
}
