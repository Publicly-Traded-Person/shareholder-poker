// The no-limit hold'em hand engine for "What Would You Have Done?": it deals
// one hand file out, rules every betting decision the way a dealer would, and
// settles the pot.
//
// Where it sits: the middle of the puzzle. The page (site/wwyhd.js) drives it
// for the visitor, the opponent rules (site/wwyhd-rules.js) answer the
// `decide` callback for everybody else, the Pages Function re-runs the
// visitor's line through `playSeat` so the server's chip count is the one that
// counts, and `bun tools/wwyhd-check.ts` replays each committed hand file's
// real action list through `replay` to prove the file matches the log. Served
// as a public static asset at /wwyhd-engine.js. Run its exam with
// `bun test tools/wwyhd-engine.test.ts`.
//
// It is a plain ES module whose only import is the evaluator beside it, so the
// same file runs in the browser, in the Worker, and under bun: no require, no
// Node or Bun API, no DOM.
//
// NO CLOCK AND NO RANDOM SOURCE LIVE IN THIS FILE, and none may be added. The
// whole puzzle is a promise that the same hand file and the same choices give
// the same chips on every machine and on every replay; one nondeterministic
// call anywhere under site/wwyhd-*.js breaks that promise everywhere at once,
// and the suite greps for it. Every function here is pure: it reads a state
// object and returns a NEW one, never editing the caller's. That is also what
// lets the page keep a history of states for an undo and what lets the Worker
// hand a state around without copying defensively.
//
// The state object, which is plain JSON all the way down (so it survives
// `JSON.stringify` into a Function request and back):
//
//   {
//     id, seat,                  the hand file's id and the seat the visitor plays
//     dealer, dealerIndex,       the button, as a handle and as an index into players
//     blinds: { sb, bb, ante },
//     blindSeats: { sb, bb },    who posted them, which is what fixes position
//     board: [c, c, c, c, c],    the file's full runout; seatView() slices it to the street
//     players: [seat, ...],      seat order clockwise, see makeSeat() below
//     street,                    "PRE" | "FLOP" | "TURN" | "RIVER"
//     currentBet,                the street contribution a player must match
//     lastRaiseSize,             the last full raise, which sets the next minimum
//     noReopen,                  true after an all-in too small to reopen the action
//     pot,                       every chip in the middle, antes and this street included
//     toAct, toActIndex,         whose turn it is (null once the hand is over)
//     log: [{ street, handle, type, amount }, ...],
//     over, settled, stacks, pots
//   }
//
// The `log` carries the blind and ante postings as their own entries
// (`type` "sb", "bb", "ante") ahead of the real actions, because playSeat()
// builds its decision keys out of it: two visitors who reach the same spot in
// the same hand must produce the same key string, or the "what everyone else
// did here" figures on the reveal page would count one spot as two.

import { evaluate } from "./wwyhd-eval.js";

/** The four betting streets in order. The hand file's `board` is the runout
 *  for all of them: the flop is board[0..2], the turn board[3], the river
 *  board[4]. */
const STREETS = ["PRE", "FLOP", "TURN", "RIVER"];

/** How many board cards are face up on each street. seatView() slices with
 *  these so an opponent's decision can never read a card that is not out yet,
 *  which is the whole reason the engine keeps the runout hidden from the rules
 *  module rather than trusting it not to peek. */
const BOARD_SHOWN = { PRE: 0, FLOP: 3, TURN: 4, RIVER: 5 };

/** A hand cannot take more turns than this. Nothing legal comes near it; it is
 *  a guard so a bug in the turn order fails loudly instead of hanging the
 *  visitor's browser or the Worker. */
const TURN_LIMIT = 500;

/** Every error this module throws is prefixed so a stack trace in the Worker
 *  log or in Charlie's terminal says which layer refused. */
function fail(message) {
  throw new Error(`wwyhd: ${message}`);
}

/** Chips are whole numbers, always. A fractional stack or blind means the hand
 *  file was typed rather than copied from the log, and half a chip cannot be
 *  split at a showdown, so halt instead of rounding something into the
 *  visitor's score. */
function whole(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} must be a whole number of chips, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** One seat's state. `committed` is this street's contribution, which is what
 *  a bet or raise `amount` counts up to (PokerNow's "raises to N"); `in` is
 *  everything the seat has put in this hand, antes included, which is what the
 *  side pots are built from. They differ, so both are kept: mixing them up is
 *  how an engine silently lets a player call for less than they owe. */
function makeSeat(player, index) {
  if (!player || typeof player.handle !== "string" || player.handle === "") {
    fail(`players[${index}] needs a handle`);
  }
  return {
    handle: player.handle,
    stack: whole(player.stack, `players[${index}].stack`),
    cards: Array.isArray(player.cards) ? [...player.cards] : [],
    shown: player.shown === true,
    profile: player.profile ?? null,
    committed: 0,
    in: 0,
    folded: false,
    allIn: false,
    acted: false,
  };
}

/** A copy nothing in the caller's state is shared with, so applyAction() can
 *  work in place on the copy and still leave its argument untouched (M7, and
 *  the page's undo depends on it). `profile` is read-only reference data and is
 *  shared on purpose. */
function cloneState(state) {
  return {
    ...state,
    blinds: { ...state.blinds },
    blindSeats: { ...state.blindSeats },
    board: [...state.board],
    players: state.players.map((seat) => ({ ...seat, cards: [...seat.cards] })),
    log: state.log.map((entry) => ({ ...entry })),
    stacks: state.stacks ? { ...state.stacks } : null,
    pots: state.pots ? state.pots.map(clonePot) : null,
  };
}

function clonePot(pot) {
  return { ...pot, eligible: [...pot.eligible], winners: [...pot.winners] };
}

/** The seat with this handle, or a halt naming it. */
function seatOf(state, handle) {
  const seat = state.players.find((player) => player.handle === handle);
  if (!seat) fail(`${handle} is not at this table`);
  return seat;
}

/** The seat whose turn it is, or a halt. Every public entry point that needs a
 *  player to act goes through here so "the hand is over" is one message rather
 *  than an undefined dereference three frames down. */
function actingSeat(state) {
  if (state.over || state.toActIndex === null) fail("the hand is over: nobody is to act");
  return state.players[state.toActIndex];
}

/** Moves chips from a seat to the pot, capped at the stack so a short player
 *  simply goes all-in rather than going negative. `dead` chips (the ante) go to
 *  the pot without counting toward the street contribution, which is what makes
 *  an ante dead money: it does not pay any part of the blind. */
function putChips(state, seat, chips, dead = false) {
  const paid = Math.max(0, Math.min(chips, seat.stack));
  seat.stack -= paid;
  seat.in += paid;
  if (!dead) seat.committed += paid;
  state.pot += paid;
  if (seat.stack === 0 && paid > 0) seat.allIn = true;
  return paid;
}

/** Appends to the log playSeat() keys its decisions off. `amount` is the street
 *  total for a bet or raise and 0 for everything else (the plan's global
 *  literal), so the same spot always spells the same way. */
function record(state, handle, type, amount) {
  state.log.push({ street: state.street, handle, type, amount });
}

/** True when this seat still owes the table a decision: it has not folded, is
 *  not all-in, and either has not acted this street or has not matched the
 *  current bet. The big blind's option falls out of this for free: posting is
 *  not acting, so preflop the action comes back to them even when everyone
 *  called. */
function seatNeedsAction(state, seat) {
  if (seat.folded || seat.allIn) return false;
  return !seat.acted || seat.committed !== state.currentBet;
}

/** The next seat that needs to act, searching clockwise from `fromIndex`
 *  inclusive, or -1 when the betting round is complete. */
function nextActor(state, fromIndex) {
  const count = state.players.length;
  for (let step = 0; step < count; step++) {
    const index = (fromIndex + step) % count;
    if (seatNeedsAction(state, state.players[index])) return index;
  }
  return -1;
}

/** Seats still in the hand, in seat order. */
function liveSeats(state) {
  return state.players.filter((seat) => !seat.folded);
}

/** Opens a new betting round: street contributions back to zero, everyone owed
 *  a decision again, and the first live seat clockwise from the dealer to act.
 *  The minimum bet resets to the big blind, which is the rule postflop. */
function openStreet(state, street) {
  state.street = street;
  state.currentBet = 0;
  state.lastRaiseSize = state.blinds.bb;
  state.noReopen = false;
  for (const seat of state.players) {
    seat.committed = 0;
    seat.acted = false;
  }
  const index = nextActor(state, (state.dealerIndex + 1) % state.players.length);
  if (index < 0) return finish(state);
  state.toActIndex = index;
  state.toAct = state.players[index].handle;
  return state;
}

/** Hands the turn on after an action, ending the street or the hand when there
 *  is nothing left to decide. Three ways a hand ends here:
 *
 *  - one player left, everybody else folded;
 *  - the river's betting round closed;
 *  - at most one player is not all-in and nobody owes chips, in which case the
 *    rest of the board runs out and the hand goes straight to a showdown. The
 *    runout needs no dealing: the hand file's `board` is already the whole five
 *    cards, so "running it out" is moving the street marker to RIVER.
 */
function advance(state, fromIndex) {
  if (liveSeats(state).length <= 1) return finish(state);
  const index = nextActor(state, fromIndex);
  if (index >= 0) {
    state.toActIndex = index;
    state.toAct = state.players[index].handle;
    return state;
  }
  const canStillBet = liveSeats(state).filter((seat) => !seat.allIn);
  if (canStillBet.length <= 1) {
    state.street = "RIVER";
    return finish(state);
  }
  if (state.street === "RIVER") return finish(state);
  return openStreet(state, STREETS[STREETS.indexOf(state.street) + 1]);
}

/** Closes the hand: nobody to act, the pot awarded, the result recorded on the
 *  state so `replay` can return it and `settle` can hand back the same answer
 *  twice.
 *
 *  Each seat's `stack` becomes what it ends the hand with, and `pot`, `in` and
 *  `committed` are deliberately left standing: they are the record of what the
 *  hand cost each player, which is what the reveal page reads back. The chips
 *  are not in two places at once, because settle() on an already-settled state
 *  returns the recorded result instead of paying anything out again. */
function finish(state) {
  const result = computeSettle(state);
  state.over = true;
  state.settled = true;
  state.toAct = null;
  state.toActIndex = null;
  state.stacks = result.stacks;
  state.pots = result.pots;
  for (const seat of state.players) seat.stack = result.stacks[seat.handle];
  return state;
}

/**
 * Deals a hand file out to its first decision.
 *
 * Takes a hand file (the plan's shared shape: `blinds`, `dealer`, `players` in
 * seat order clockwise, `board`, `seat`). Returns a fresh state with the ante
 * posted by every player, then the small and big blinds posted by the two
 * players clockwise after the dealer, and the player left of the big blind to
 * act. Heads-up the dealer posts the small blind and acts first preflop, which
 * is the one place the seat order rule flips. Throws when the file has fewer
 * than two players, a repeated handle, a dealer who is not at the table, or a
 * stack or blind that is not a whole number of chips.
 *
 * Why it halts rather than patching a bad file: a hand file is a claim about a
 * real hand that really happened. A file the engine quietly repairs publishes a
 * puzzle whose answer does not match the log, and nobody would ever see it.
 */
export function startHand(hand) {
  if (!hand || typeof hand !== "object") fail("startHand takes a hand file object");
  const blinds = hand.blinds ?? {};
  const sb = whole(blinds.sb, "blinds.sb");
  const bb = whole(blinds.bb, "blinds.bb");
  const ante = whole(blinds.ante ?? 0, "blinds.ante");
  if (!Array.isArray(hand.players) || hand.players.length < 2) {
    fail("a hand needs at least two players");
  }

  const players = hand.players.map(makeSeat);
  const seen = new Set();
  for (const seat of players) {
    if (seen.has(seat.handle)) fail(`${seat.handle} is at the table twice`);
    seen.add(seat.handle);
  }
  const dealerIndex = players.findIndex((seat) => seat.handle === hand.dealer);
  if (dealerIndex < 0) fail(`the dealer ${JSON.stringify(hand.dealer)} is not at this table`);
  if (hand.seat != null && !players.some((seat) => seat.handle === hand.seat)) {
    fail(`the seat ${JSON.stringify(hand.seat)} is not at this table`);
  }

  const count = players.length;
  const headsUp = count === 2;
  // Heads-up the button posts the small blind; at a full table the two seats
  // clockwise after the button do.
  const sbIndex = headsUp ? dealerIndex : (dealerIndex + 1) % count;
  const bbIndex = (sbIndex + 1) % count;

  const state = {
    id: hand.id ?? null,
    seat: hand.seat ?? null,
    dealer: players[dealerIndex].handle,
    dealerIndex,
    blinds: { sb, bb, ante },
    blindSeats: { sb: players[sbIndex].handle, bb: players[bbIndex].handle },
    board: Array.isArray(hand.board) ? [...hand.board] : [],
    players,
    street: "PRE",
    currentBet: 0,
    lastRaiseSize: bb,
    noReopen: false,
    pot: 0,
    toAct: null,
    toActIndex: null,
    log: [],
    over: false,
    settled: false,
    stacks: null,
    pots: null,
  };

  // Antes first, in seat order, then the blinds. That order is also the order
  // the postings take in the log, and so in every decision key.
  if (ante > 0) {
    for (const seat of players) {
      const paid = putChips(state, seat, ante, true);
      record(state, seat.handle, "ante", paid);
    }
  }
  record(state, players[sbIndex].handle, "sb", putChips(state, players[sbIndex], sb));
  record(state, players[bbIndex].handle, "bb", putChips(state, players[bbIndex], bb));

  // The bet to match is the big blind even when the player posting it was too
  // short to cover it: a short blind does not make the hand cheaper to enter.
  state.currentBet = bb;
  state.lastRaiseSize = bb;

  const first = headsUp ? dealerIndex : (bbIndex + 1) % count;
  const index = nextActor(state, first);
  if (index < 0) {
    // Everybody was all-in before a card was dealt: the antes and blinds took
    // the last of somebody's chips. The board runs out and the hand settles.
    if (liveSeats(state).length > 1) state.street = "RIVER";
    return finish(state);
  }
  state.toActIndex = index;
  state.toAct = players[index].handle;
  return state;
}

/**
 * What the player to act may legally do.
 *
 * Takes a state. Returns `{fold, check, call, minRaiseTo, maxRaiseTo}`:
 * `check` only when nothing is owed, `call` the amount owed capped at the
 * stack (so a short player calls all-in for what they have), `minRaiseTo` the
 * current bet plus the last full raise and never less than a big blind above
 * it, and `maxRaiseTo` the stack plus what is already in front of the player,
 * because both are street TOTALS, not increments. When the stack cannot reach
 * `minRaiseTo` both come back as the all-in total: the only raise available is
 * everything. When an all-in too small to reopen the action stands in front of
 * a player who has already acted this street, both are null and only fold and
 * call remain (M3).
 *
 * Throws when the hand is over and nobody is to act.
 */
export function legalActions(state) {
  const seat = actingSeat(state);
  const owed = Math.max(0, state.currentBet - seat.committed);
  const call = Math.min(owed, seat.stack);
  const allInTo = seat.stack + seat.committed;

  let minRaiseTo = null;
  let maxRaiseTo = null;
  const closed = state.noReopen && seat.acted;
  if (!closed && seat.stack > 0) {
    const floor = state.currentBet + Math.max(state.lastRaiseSize, state.blinds.bb);
    minRaiseTo = allInTo < floor ? allInTo : floor;
    maxRaiseTo = allInTo;
  }
  return { fold: true, check: owed === 0, call, minRaiseTo, maxRaiseTo };
}

/**
 * Applies one action by the player to act.
 *
 * Takes a state and `{type, amount}` with `type` one of fold, check, call, bet
 * or raise, and `amount` the street TOTAL the player's contribution becomes
 * for a bet or a raise (0, and ignored, for the rest). A hand file written to
 * the spec's older `to` spelling is read too. Returns a NEW state with the turn
 * moved on, the street or the hand closed if that action closed it, and the
 * pot settled if the hand is over. Never edits the state it was given (M7).
 * Throws, naming the player, on a check while chips are owed, a raise below the
 * minimum or above the stack, a bet or raise into an action an undersized
 * all-in has closed, an unknown type, or an action after the hand is over.
 *
 * Why it refuses instead of clamping a too-small raise up to the minimum: the
 * visitor's score is the promise this page makes. An engine that repairs a
 * raise gives back a chip count for a hand the visitor did not play, and the
 * Function's recount would then disagree with the browser's.
 */
export function applyAction(state, action) {
  const next = cloneState(state);
  const seat = actingSeat(next);
  const legal = legalActions(next);
  const type = action?.type;
  // `to` is the spec's original spelling of a raise total; the plan settled on
  // `amount`, and the engine reads either so an early hand file still replays.
  const amount = action?.amount ?? action?.to ?? 0;
  const seatIndex = next.toActIndex;

  switch (type) {
    case "fold":
      seat.folded = true;
      seat.acted = true;
      record(next, seat.handle, "fold", 0);
      break;

    case "check":
      if (!legal.check) {
        fail(`${seat.handle} cannot check: ${state.currentBet - seat.committed} owed`);
      }
      seat.acted = true;
      record(next, seat.handle, "check", 0);
      break;

    case "call":
      putChips(next, seat, legal.call);
      seat.acted = true;
      record(next, seat.handle, "call", 0);
      break;

    case "bet":
    case "raise": {
      if (legal.minRaiseTo === null) {
        fail(
          `${seat.handle} cannot ${type}: the action is closed, an all-in for less than a full raise does not reopen it`,
        );
      }
      const to = whole(amount, `${seat.handle}'s ${type} amount`);
      if (to > legal.maxRaiseTo) {
        fail(`${seat.handle} cannot ${type} to ${to}: only ${legal.maxRaiseTo} is behind`);
      }
      if (to < legal.minRaiseTo) {
        fail(`${seat.handle} cannot ${type} to ${to}: the minimum is ${legal.minRaiseTo}`);
      }
      putChips(next, seat, to - seat.committed);
      if (to > next.currentBet) {
        const size = to - next.currentBet;
        if (size >= Math.max(next.lastRaiseSize, next.blinds.bb)) {
          // A full raise reopens the action: everyone still in owes a decision
          // again, whatever they did earlier this street.
          next.lastRaiseSize = size;
          next.noReopen = false;
          for (const other of next.players) {
            if (other !== seat) other.acted = false;
          }
        } else {
          // An all-in for less than a full raise. The bet to match goes up, but
          // the players who already acted may only fold or call it (M3), and
          // the next legal raise size is still the last FULL one.
          next.noReopen = true;
        }
        next.currentBet = to;
      }
      seat.acted = true;
      record(next, seat.handle, type, to);
      break;
    }

    default:
      fail(`${seat.handle}: ${JSON.stringify(type)} is not an action`);
  }

  return advance(next, (seatIndex + 1) % next.players.length);
}

/**
 * Whether the hand is finished.
 *
 * Takes a state. Returns true once everybody but one has folded, the river's
 * betting is done, or everyone left is all-in and the board has run out, which
 * is also the moment the pot was awarded. Throws nothing: the page's loop asks
 * this every turn and must never be the thing that breaks.
 */
export function isHandOver(state) {
  return state.over === true;
}

/** Handles in clockwise order starting one seat after the button. The odd chip
 *  in a split pot follows this order, which is how a dealer breaks the tie. */
function clockwiseFromDealer(state) {
  const count = state.players.length;
  const order = [];
  for (let step = 1; step <= count; step++) {
    order.push(state.players[(state.dealerIndex + step) % count].handle);
  }
  return order;
}

/** Awards the pot from the chips each seat has put in. Split out of settle()
 *  so settle() can short-circuit on an already-settled state and still hand
 *  back the same pots twice. */
function computeSettle(state) {
  const stacks = {};
  const contributed = new Map();
  let started = 0;
  for (const seat of state.players) {
    stacks[seat.handle] = seat.stack;
    contributed.set(seat.handle, seat.in);
    started += seat.stack + seat.in;
  }

  // The uncalled bet goes back to whoever made it: the last bettor out on their
  // own, or the winner of a hand everybody folded to. It is the amount by which
  // one player's contribution stands above every other, so it exists only when
  // a single player is on top.
  const totals = [...contributed.entries()].sort((a, b) => b[1] - a[1]);
  if (totals.length > 1 && totals[0][1] > totals[1][1]) {
    const back = totals[0][1] - totals[1][1];
    stacks[totals[0][0]] += back;
    contributed.set(totals[0][0], totals[0][1] - back);
  }

  // One pot per all-in level among the players still in the hand. A folded
  // player's chips are dead money: they swell the pots at or below what they
  // put in and make nobody eligible for anything.
  const live = liveSeats(state);
  const levels = [...new Set(live.map((seat) => contributed.get(seat.handle)))]
    .filter((level) => level > 0)
    .sort((a, b) => a - b);

  const pots = [];
  let floor = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of state.players) {
      const put = contributed.get(seat.handle);
      amount += Math.min(put, level) - Math.min(put, floor);
    }
    if (amount > 0) {
      pots.push({
        amount,
        eligible: live
          .filter((seat) => contributed.get(seat.handle) >= level)
          .map((seat) => seat.handle),
        winners: [],
      });
    }
    floor = level;
  }

  const order = clockwiseFromDealer(state);
  for (const pot of pots) {
    if (pot.eligible.length === 1) {
      // Everyone else folded or could not cover this level: no showdown, and
      // no cards needed, which matters because a hand that ends before the
      // river may have no honest board to evaluate against.
      pot.winners = [...pot.eligible];
    } else {
      let best = -1;
      for (const handle of pot.eligible) {
        const score = evaluate([...seatOf(state, handle).cards, ...state.board]);
        if (score > best) {
          best = score;
          pot.winners = [handle];
        } else if (score === best) {
          pot.winners.push(handle);
        }
      }
    }
    const share = Math.floor(pot.amount / pot.winners.length);
    for (const handle of pot.winners) stacks[handle] += share;
    // The chips a split cannot divide evenly go one each, clockwise from the
    // button, to the winners in that order.
    const odd = pot.amount - share * pot.winners.length;
    const queue = order.filter((handle) => pot.winners.includes(handle));
    for (let chip = 0; chip < odd; chip++) stacks[queue[chip % queue.length]] += 1;
  }

  // Chip conservation, the same refuse-to-publish check the rest of the repo
  // runs: the table ends the hand with exactly the chips it started with. A
  // mismatch means a side pot or an odd chip went astray, and a puzzle that
  // scores a visitor off invented chips is worse than one that does not load.
  const ended = Object.values(stacks).reduce((sum, chips) => sum + chips, 0);
  if (ended !== started) {
    fail(`chips are not conserved: the table started with ${started} and ended with ${ended}`);
  }
  return { stacks, pots };
}

/**
 * Awards the pot.
 *
 * Takes a state. Returns `{stacks, pots}`: `stacks` the chips every player
 * holds once the hand is paid out, keyed by handle, and `pots` the main pot
 * first and then one side pot per all-in level, each `{amount, eligible,
 * winners}`. An uncalled bet goes back to its bettor before the pots are cut,
 * each pot goes to the best `evaluate` score among the players eligible for
 * it, a tie splits evenly with the odd chip to the first winner clockwise from
 * the dealer, and the stacks returned always sum to the stacks the hand
 * started with. Throws if they do not, or if a showdown needs a card the hand
 * file did not supply.
 *
 * Calling it twice gives the same answer: on a hand that is already over it
 * hands back the recorded result rather than paying the pot out a second time.
 */
export function settle(state) {
  if (state.settled && state.stacks && state.pots) {
    return { stacks: { ...state.stacks }, pots: state.pots.map(clonePot) };
  }
  return computeSettle(state);
}

/** `blinds`, `late` (the button and the seat before it) or `early`. A blind is
 *  named as a blind even when it is also one of those seats, because it is the
 *  forced bet, not the seat number, that shapes how the hand plays from there.
 *  Heads-up that makes the button `blinds`, which is the honest answer: it is
 *  the small blind. */
function positionOf(state, seat) {
  if (seat.handle === state.blindSeats.sb || seat.handle === state.blindSeats.bb) {
    return "blinds";
  }
  const count = state.players.length;
  const index = state.players.indexOf(seat);
  if (index === state.dealerIndex || index === (state.dealerIndex - 1 + count) % count) {
    return "late";
  }
  return "early";
}

/**
 * Everything one player can honestly see.
 *
 * Takes a state and a handle. Returns
 * `{handle, cards, board, street, pot, toCall, stack, playersIn, position,
 * legal}`: the player's own two cards, only the board cards that are face up
 * on this street, the whole pot including this street's bets, the chips owed
 * capped at the stack, how many players are still in the hand, the position
 * band, and the legal action set when it is this player's turn (null when it is
 * not). Throws when the handle is not at the table.
 *
 * This is the only thing the opponent rules (site/wwyhd-rules.js) are handed.
 * They cannot see another player's cards or a card still to come because the
 * view never contains one, which is a stronger promise than asking them not to
 * look.
 */
export function seatView(state, handle) {
  const seat = seatOf(state, handle);
  const shown = BOARD_SHOWN[state.street] ?? state.board.length;
  return {
    handle: seat.handle,
    cards: [...seat.cards],
    board: state.board.slice(0, shown),
    street: state.street,
    pot: state.pot,
    toCall: Math.min(Math.max(0, state.currentBet - seat.committed), seat.stack),
    stack: seat.stack,
    playersIn: liveSeats(state).length,
    position: positionOf(state, seat),
    // True once this street's bet stands above what is forced: above the big
    // blind preflop, above nothing after the flop. It is what lets the rule
    // table tell a raised pot from an unopened one.
    raised: state.currentBet > (state.street === "PRE" ? state.blinds.bb : 0),
    legal: !state.over && state.toAct === handle ? legalActions(state) : null,
  };
}

/**
 * Replays a recorded line of action.
 *
 * Takes a hand file and its actions as `{street, handle, type, amount}` in the
 * order they happened (the file's `real.actions`). Returns the settled state,
 * whose `stacks` are what every player ends the hand with. Throws, naming the
 * handle, on an action by a player who is not to act, on an action tagged with
 * a street the hand is not on, on an illegal action, and on a line that runs
 * out before the hand does or runs on after it ends.
 *
 * This is how a hand file is proved: `bun tools/wwyhd-check.ts` replays the
 * real line and compares these stacks with the log's. When they disagree the
 * file is wrong, not the engine, which is why nothing here is forgiving.
 */
export function replay(hand, actions) {
  if (!Array.isArray(actions)) fail("replay takes an array of actions");
  let state = startHand(hand);
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action || typeof action !== "object") fail(`action ${i} is not an action`);
    if (isHandOver(state)) {
      fail(
        `the hand was already over: ${actions.length - i} actions remain, starting with ${
          action.handle ?? "an action"
        } ${action.type ?? ""}`.trim(),
      );
    }
    if (action.handle != null && action.handle !== state.toAct) {
      seatOf(state, action.handle);
      fail(`${action.handle} is not to act: it is ${state.toAct}'s turn`);
    }
    if (action.street != null && action.street !== state.street) {
      fail(
        `${state.toAct}: the line says ${action.street} but the hand is on the ${state.street}`,
      );
    }
    state = applyAction(state, action);
  }
  if (!isHandOver(state)) fail(`the line runs out while ${state.toAct} is still to act`);
  return state;
}

/** The spot a decision was made in: the street, a colon, and every action the
 *  hand has seen so far as `handle:type:amount`, postings included. Two
 *  visitors who reach the same spot spell it the same way, which is what lets
 *  the reveal page say how many of them did what here. */
function decisionKey(state) {
  const prefix = state.log
    .map((entry) => `${entry.handle}:${entry.type}:${entry.amount}`)
    .join(",");
  return `${state.street}:${prefix}`;
}

/**
 * Plays one hand from one seat: the visitor's whole turn at the table.
 *
 * Takes a hand file, the seat's own actions as `{street, type, amount}` in
 * order, and a `decide(view)` callback that answers for every other player
 * (site/wwyhd-rules.js in the page and in the Worker). Returns
 * `{chips, line, decisions}`: `chips` the seat's stack when the hand is over,
 * which IS the score; `line` the seat actions as played; and `decisions` one
 * `{key, type}` per decision the seat made, keyed by the spot it was made in.
 * Throws when the line runs out while the seat still has to act, when actions
 * are left over after the hand ends, and on any illegal action by the seat or
 * by `decide`.
 *
 * The seat is the hand file's `seat`. The Pages Function runs exactly this
 * function on the line a visitor submits and keeps ITS chip count, never the
 * browser's, so a tampered-with score is just a line that replays to something
 * else.
 */
export function playSeat(hand, seatLine, decide) {
  if (!Array.isArray(seatLine)) fail("playSeat takes the seat's actions as an array");
  if (typeof decide !== "function") fail("playSeat takes a decide(view) function");
  let state = startHand(hand);
  const seat = state.seat;
  if (seat == null) fail("this hand file names no seat to play");

  const line = [];
  const decisions = [];
  let taken = 0;
  let turns = 0;
  while (!isHandOver(state)) {
    if (++turns > TURN_LIMIT) fail("the hand did not end: the turn order is broken");
    if (state.toAct === seat) {
      if (taken >= seatLine.length) {
        fail(`the line runs out while ${seat} is still to act on the ${state.street}`);
      }
      const action = seatLine[taken++];
      if (!action || typeof action !== "object") fail(`${seat}'s action ${taken - 1} is not an action`);
      if (action.street != null && action.street !== state.street) {
        fail(`${seat}: the line says ${action.street} but the hand is on the ${state.street}`);
      }
      decisions.push({ key: decisionKey(state), type: action.type });
      line.push({ ...action });
      state = applyAction(state, action);
    } else {
      state = applyAction(state, decide(seatView(state, state.toAct)));
    }
  }
  if (taken < seatLine.length) {
    fail(`${seatLine.length - taken} of ${seat}'s actions are left over: the hand is over`);
  }
  return { chips: state.stacks[seat], line, decisions };
}
