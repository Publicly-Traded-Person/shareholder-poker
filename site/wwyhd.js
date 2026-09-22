// The browser controller for "What would you have done?": it reads the hand
// file the page embeds, deals it, takes the visitor's decisions, submits the
// line, and draws the reveal.
//
// Where it sits: the front of the puzzle. tools/render.ts generates
// site/wwyhd/<id>/index.html with the hand file inside a
// `<script type="application/json" id="hand">` element and loads this file as
// `<script type="module" src="/wwyhd.js">`. The engine beside it
// (site/wwyhd-engine.js) rules every decision, the rule table
// (site/wwyhd-rules.js) answers for the other seats, and
// functions/api/wwyhd.js recounts the submitted line server side and owns the
// leaderboard. Served as a public static asset at /wwyhd.js.
//
// It lives HERE, one level above site/wwyhd/, because everything under
// site/wwyhd/ is generated and the suite compares that whole directory tree
// against a fresh render: a hand-written file in there would read as drift.
//
// Endpoint contract (functions/api/wwyhd.js):
//   POST /api/wwyhd?hand=<id>  {email, displayName, line}
//                              -> {ok: true, attempt, chips, name} | {error}
//   GET  /api/wwyhd?hand=<id>  -> {count, leaderboard: [{name, chips}], choices}
// Neither response ever carries an email (spec section 3).
//
// NO CLOCK AND NO RANDOM SOURCE LIVE IN THIS FILE, and none may be added. The
// same hand file and the same choices must give the same chips on every
// machine, and the suite greps every site/wwyhd-*.js and this file for a
// clock or a random call. `setTimeout` is the one time-ish thing here and it
// is not one: it delays a repaint, it never decides anything.
//
// Every line that touches the document sits behind the `typeof document`
// check at the bottom, so `bun` can import this module for its exam without a
// DOM and get `lineVsReal` out of it.
//
// Run: served to a browser at /wwyhd.js. Its exam is
// tools/wwyhd-pages.test.ts; run it with `bun test tools`.

import {
  startHand, legalActions, applyAction, isHandOver, seatView, playSeat,
} from "./wwyhd-engine.js";
import { decide, THRESHOLDS } from "./wwyhd-rules.js";
import { evaluate, handCategory } from "./wwyhd-eval.js";

/** The four betting streets in order, spelled as the engine spells them. The
 *  reveal walks streets in this order so a row for the flop never prints
 *  above the one for preflop. */
const STREETS = ["PRE", "FLOP", "TURN", "RIVER"];

/** How a street is named to a visitor. The engine's own spelling is a key,
 *  not copy. */
const STREET_NAME = { PRE: "Preflop", FLOP: "Flop", TURN: "Turn", RIVER: "River" };

/** What a street row says when a side took no action on it: the visitor who
 *  folded on the flop has no turn, and an empty cell would read as a missing
 *  number rather than as a hand that was already over. */
const NOTHING = "none";

/** The pacing, in milliseconds. None of it decides anything: every number
 *  here only delays a repaint, and the chips come out the same at any speed.
 *
 *  The puzzle is one hand, so it is short, and Mike's call on 2026-09-22 was
 *  to spend that shortness on drama rather than save it (Beau: "it needs a
 *  dramatic pause after the last action, it goes right to showing the
 *  result"). So the cards are dealt one at a time, every action is captioned
 *  across the felt, a new street waits a beat before it lands, and a
 *  showdown turns the cards over and runs the board out slower street by
 *  street, the river slowest, before the pot is pushed. */
const PAUSE_MS = 1100;        // an opponent thinking before it acts
const DEAL_CARD_MS = 140;     // one hole card landing, around the table twice
const DEAL_SETTLE_MS = 500;   // the cards are out, then the blinds line
const STREET_MS = 900;        // after a street's last action, and again after its cards land
const SHOWDOWN_MS = 1000;     // the last action standing there before anything turns over
const FLIP_MS = 600;          // between one seat's cards turning over and the next
const AWARD_MS = 1200;        // before the pot is pushed, and after, before the button
/** The runout at a showdown: how many board cards each street shows, its
 *  name, and how long the table waits before dealing it. Each wait is longer
 *  than the last, the way the river always takes longest on television. */
const RUNOUT = [[3, "flop", 1200], [4, "turn", 1700], [5, "river", 2400]];
/** How much of every wait a visitor who asked the system for reduced motion
 *  sits through: the same order of events, with almost no waiting. */
const CALM_SPEED = 0.15;

/** How many leaderboard rows the Function returns. The visitor's own row is
 *  added below that when they did not make the top ten. */
const LEADERBOARD_SIZE = 10;

/** The two things this page remembers between visits, and the only two. Keys
 *  are namespaced so nothing else on the site can collide with them. */
const EMAIL_KEY = "wwyhd.email";
const NAME_KEY = "wwyhd.name";

/**
 * The visitor's line beside the line the seat really took.
 *
 * Takes the visitor's actions as `{street, type, amount}` in order, the hand
 * file's whole `real.actions` list (every player's, as recorded), and the
 * handle of the seat being played. Returns one row per street either side
 * acted on, in betting order, as `{street, mine, real, differs}`: `mine` and
 * `real` are that street's actions as a readable phrase ("call", "raise to
 * 400", or "none"), and `differs` is true exactly when the two phrases are
 * not the same string. Throws nothing: a missing or malformed list is read as
 * no actions, because this runs on the reveal after a hand the visitor has
 * already played and a thrown error there would replace the whole reveal with
 * a blank band.
 *
 * Why it filters `real.actions` by the seat rather than taking a pre-filtered
 * list: the hand file records the whole table's line in one array, and the
 * caller that split it would be a second place that has to know which seat
 * the visitor is. One place is enough.
 *
 * Why the comparison is on the rendered phrase and not action by action: what
 * the page asks is "did you play this street the way they did", and a street
 * where the visitor called twice and the seat called once differs in exactly
 * the way the phrase differs. Comparing actions pairwise would have to decide
 * what to do with a street where the two sides took a different NUMBER of
 * actions, which is the common case the moment anybody deviates.
 */
export function lineVsReal(line, realActions, seat) {
  const mineBy = byStreet(Array.isArray(line) ? line : []);
  const realBy = byStreet(
    (Array.isArray(realActions) ? realActions : []).filter(
      (action) => action && action.handle === seat,
    ),
  );

  const order = [];
  for (const street of STREETS) {
    if (mineBy.has(street) || realBy.has(street)) order.push(street);
  }
  // A street neither list spells the engine's way still gets a row, after the
  // four known ones, rather than being silently dropped from the comparison.
  for (const street of [...mineBy.keys(), ...realBy.keys()]) {
    if (!order.includes(street)) order.push(street);
  }

  return order.map((street) => {
    const mine = phraseFor(mineBy.get(street));
    const real = phraseFor(realBy.get(street));
    return { street, mine, real, differs: mine !== real };
  });
}

/** Groups actions by their `street`, keeping each street's actions in the
 *  order they were taken. An action carrying no street is read as preflop,
 *  the street every hand starts on. */
function byStreet(actions) {
  const out = new Map();
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const street = typeof action.street === "string" && action.street !== "" ? action.street : STREETS[0];
    if (!out.has(street)) out.set(street, []);
    out.get(street).push(action);
  }
  return out;
}

/** One street's actions as a phrase, or NOTHING for a street with none. */
function phraseFor(actions) {
  if (!actions || actions.length === 0) return NOTHING;
  return actions.map(actionPhrase).join(", ");
}

/** One action as a visitor reads it. A bet or a raise carries the street
 *  TOTAL it goes to, which is what the engine and the hand file both mean by
 *  `amount`, so the phrase says "to" rather than printing a number that looks
 *  like an increment. */
function actionPhrase(action) {
  const type = action && typeof action.type === "string" ? action.type : "";
  const amount = Number(action && action.amount != null ? action.amount : 0);
  if (type === "bet") return `bet ${amount}`;
  if (type === "raise") return `raise to ${amount}`;
  if (type === "") return NOTHING;
  return type;
}

/**
 * A `decide(view)` callback answering for every seat but the visitor's.
 *
 * Takes the parsed hand file. Returns the callback the engine wants: it finds
 * the acting player's profile in the file and runs the rule table on it.
 * Throws nothing itself; the rule table throws on a holding it refuses.
 *
 * This is the same shape functions/api/wwyhd.js builds, on purpose: the
 * server recounts the submitted line with its own copy, and the two must
 * answer identically or the chips on the page and the chips in the table
 * would disagree for no reason the visitor could see.
 */
function opponentDecider(hand) {
  const players = Array.isArray(hand.players) ? hand.players : [];
  return (view) => {
    const player = players.find((seat) => seat.handle === view.handle);
    return decide(view, (player && player.profile) || {}, THRESHOLDS);
  };
}

// ---------------------------------------------------------------------------
// Everything below draws. Nothing below runs until boot() is called, and
// boot() is called only from inside the `typeof document` check at the foot of
// the file.

/** An element by id, or null. */
function byId(id) {
  return document.getElementById(id);
}

/** Replaces an element's children with one built node. */
function fill(el, node) {
  if (!el) return;
  el.textContent = "";
  if (node) el.appendChild(node);
}

/** A new element with a class and optional text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Reads one remembered field, or "" when the browser refuses storage (a
 *  private window, a blocked third-party context). A prefill that throws
 *  would take the Deal button down with it. */
function remembered(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

/** Remembers the two fields after a submit the server accepted. Wrapped
 *  because storage can refuse, and a visitor whose browser will not remember
 *  them has still played the hand. */
function remember(email, name) {
  try {
    window.localStorage.setItem(EMAIL_KEY, email);
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Nothing to do and nothing to say: the hand was played either way.
  }
}

/** The hand file the page embedded, or null when there is none (the index
 *  page loads this same module and has no puzzle on it). */
function embeddedHand() {
  const script = byId("hand");
  if (!script) return null;
  try {
    return JSON.parse(script.textContent || "");
  } catch {
    return null;
  }
}

/** The handle-to-name map the generator embeds beside the hand
 *  (`<script type="application/json" id="names">`): every real player as
 *  First L., the site's name rule, so the log, the pot line and the reveal
 *  can name people the way the seat list already does. Parsed once. An
 *  absent or unreadable map means handles are shown as they are. */
let namesCache = null;
function nameOf(handle) {
  if (namesCache === null) {
    namesCache = {};
    const script = byId("names");
    if (script) {
      try {
        const parsed = JSON.parse(script.textContent || "");
        if (parsed && typeof parsed === "object") namesCache = parsed;
      } catch {
        namesCache = {};
      }
    }
  }
  return namesCache[handle] || handle;
}

/** One playing card, drawn the way the generator draws the visitor's own:
 *  rank and suit glyph on a white face, red for hearts and diamonds, the
 *  two-character code kept in data-card. The classes must match
 *  tools/render.ts's wwyhdCard. */
const SUIT_GLYPH = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
function cardEl(code) {
  const rank = code[0] === "T" ? "10" : code[0];
  const suit = code[1];
  const card = el("span", `pc pc--${suit}`);
  card.dataset.card = code;
  card.setAttribute("aria-label", `${rank} of ${suit}`);
  card.appendChild(el("b", null, rank));
  card.appendChild(el("i", null, SUIT_GLYPH[suit] || suit));
  return card;
}

/** Paints the seat rows the generator wrote: every stack as it now stands,
 *  and the seat to act marked. `stacks`, when given, is a handle-to-chips map
 *  painted instead of the state's own: the showdown passes the stacks as they
 *  stood BEFORE the pot was pushed, because a settled state already holds the
 *  winner's chips and painting them would give the result away before a single
 *  card turns over. */
function paintSeats(state, stacks) {
  for (const seat of state.players) {
    const stack = document.querySelector(`[data-stack="${seat.handle}"]`);
    const chips = stacks && stacks[seat.handle] != null ? stacks[seat.handle] : seat.stack;
    if (stack) stack.textContent = `${chips} chips`;
    const row = document.querySelector(`[data-handle="${seat.handle}"]`);
    if (row) {
      row.classList.toggle("wwyhd-seat--acting", state.toAct === seat.handle);
      row.classList.toggle("wwyhd-seat--folded", seat.folded === true);
    }
    // The chips in front of the seat: this street's contribution, the way a
    // table shows a bet. Empty once the street is over and the pot has them.
    const front = document.querySelector(`[data-bet="${seat.handle}"]`);
    if (front) {
      front.textContent = "";
      if (seat.committed > 0) front.appendChild(el("span", "wwyhd-blind", String(seat.committed)));
    }
  }
}

/** How many board cards the state's street shows, counted the engine's way.
 *  A finished hand counts all five, because the engine runs an all-in out by
 *  moving the street marker to the river; the showdown deals them from the
 *  count the hand had before that instead. */
function boardCount(state) {
  return seatView(state, state.seat).board.length;
}

/**
 * Draws the board.
 *
 * Takes the state, how many of its cards to show (the street's own count when
 * left out), and the index the newly dealt cards start at, if any. Cards from
 * that index on get the deal animation; the ones already out stay still.
 * Returns nothing. The count is separate from the state because the page
 * holds a card back after the betting that brought it: a call that closes the
 * preflop shows the call first and deals the flop a beat later.
 */
function paintBoard(state, count, freshFrom) {
  const board = byId("wwyhd-board");
  if (!board) return;
  const shown = count == null ? boardCount(state) : count;
  board.textContent = "";
  state.board.slice(0, shown).forEach((card, index) => {
    const node = cardEl(card);
    if (freshFrom != null && index >= freshFrom) node.classList.add("pc--deal");
    board.appendChild(node);
  });
}

/**
 * Redraws one seat's two hole cards.
 *
 * Takes the seat's handle, its cards face up (or null for two backs), and
 * options: `undealt` hides the cards so the deal can bring them in one at a
 * time, `flip` plays the turn-over animation, and `label` writes a small line
 * under the cards. Returns nothing.
 *
 * Why `label` exists: most opponent holdings are authored for the puzzle,
 * because the log only records the hands that reached a showdown. A card
 * turned face up on the table reads as the real card unless it says
 * otherwise, so an authored holding carries "for this puzzle" at the seat,
 * the same words the reveal's holdings list uses (spec section 4.4).
 */
function paintHole(handle, cards, options = {}) {
  const row = document.querySelector(`[data-handle="${handle}"]`);
  const hole = row && row.querySelector(".wwyhd-hole");
  if (!hole) return;
  hole.textContent = "";
  const nodes = cards
    ? cards.map(cardEl)
    : [0, 1].map(() => {
        const back = el("span", "pc pc--down");
        back.setAttribute("aria-hidden", "true");
        return back;
      });
  for (const node of nodes) {
    if (options.undealt) node.classList.add("pc--undealt");
    if (options.flip) node.classList.add("pc--flip");
    hole.appendChild(node);
  }
  if (cards) hole.removeAttribute("aria-label");
  else if (!row.classList.contains("wwyhd-seat--you")) hole.setAttribute("aria-label", "two cards face down");
  const old = row.querySelector(".wwyhd-authored");
  if (old) old.remove();
  if (options.label) hole.after(el("p", "wwyhd-authored", options.label));
}

/** Writes the line across the felt that says what just happened, and
 *  restarts its entrance animation so a second "calls" after a first one
 *  still reads as new. */
function caption(text) {
  const node = byId("wwyhd-caption");
  if (!node) return;
  node.textContent = text;
  node.classList.remove("wwyhd-caption--new");
  void node.offsetWidth; // a reflow between the two class changes restarts the animation
  if (text) node.classList.add("wwyhd-caption--new");
}

/** "a pair", "two pair", "a flush": the category from handCategory() with the
 *  article English wants in front of it after "with". */
function withArticle(category) {
  return /^(pair|straight|flush|full house|straight flush)$/.test(category) ? `a ${category}` : category;
}

/**
 * One action as the caption says it: "Beau B. raises to 540.", "You call 200.",
 * "Drew A. calls 1835, all in."
 *
 * Takes the log entry, the state before it and the state after it, and the
 * visitor's handle. Returns the sentence. A call's size is not in the log
 * (the log keeps 0 for a call so decision keys spell the same way every
 * time), so it is read off the chips the seat actually put in, which is also
 * the honest number when a short stack calls for less than the bet.
 */
function describeAction(entry, before, after, visitor) {
  const you = entry.handle === visitor;
  const who = you ? "You" : nameOf(entry.handle);
  const verb = (plain, third) => (you ? plain : third);
  const was = before.players.find((seat) => seat.handle === entry.handle);
  const now = after.players.find((seat) => seat.handle === entry.handle);
  const paid = was && now ? now.in - was.in : 0;
  let text;
  if (entry.type === "fold") text = `${who} ${verb("fold", "folds")}`;
  else if (entry.type === "check") text = `${who} ${verb("check", "checks")}`;
  else if (entry.type === "call") text = `${who} ${verb("call", "calls")} ${paid}`;
  else if (entry.type === "bet") text = `${who} ${verb("bet", "bets")} ${entry.amount}`;
  else if (entry.type === "raise") text = `${who} ${verb("raise", "raises")} to ${entry.amount}`;
  else text = `${who} ${entry.type}`;
  const allIn = now && was && now.allIn && !was.allIn;
  return allIn ? `${text}, all in.` : `${text}.`;
}

/** The running action list, one line per decision, postings included. */
function paintLog(state) {
  const log = byId("wwyhd-log");
  if (!log) return;
  log.textContent = "";
  for (const entry of state.log) {
    const label = STREET_NAME[entry.street] || entry.street;
    log.appendChild(el("li", "stat", `${label}: ${nameOf(entry.handle)} ${actionPhrase(entry)}`));
  }
}

/** The pot and whose turn it is. */
function paintPot(state) {
  const pot = byId("wwyhd-pot");
  if (!pot) return;
  const street = STREET_NAME[state.street] || state.street;
  pot.textContent = state.over
    ? `Pot ${state.pot}`
    : `Pot ${state.pot} \u00b7 ${state.toAct === state.seat ? "your turn" : `${nameOf(state.toAct)} to act`}`;
}

/**
 * The raise totals the sizer offers, as street TOTALS the engine accepts.
 *
 * Takes the legal actions and the state. Returns `[{label, amount}]` for the
 * minimum, half the pot, the pot, and all in, with anything outside the legal
 * range pulled back inside it and duplicates dropped, so two buttons never
 * offer the same number. Returns [] when no raise is legal at all.
 */
function sizerOptions(legal, state) {
  if (legal.minRaiseTo == null || legal.maxRaiseTo == null) return [];
  const clamp = (n) => Math.min(Math.max(Math.round(n), legal.minRaiseTo), legal.maxRaiseTo);
  const candidates = [
    { label: "Min", amount: legal.minRaiseTo },
    // A pot-relative raise counts the call as already in the pot: with 500
    // in the middle and 200 to call, a pot-sized raise is TO 900 (200 to
    // call, then 700 more), not to 700. On an unopened street the call is 0
    // and the two formulas agree.
    { label: "Half pot", amount: clamp(state.currentBet + (state.pot + legal.call) / 2) },
    { label: "Pot", amount: clamp(state.currentBet + state.pot + legal.call) },
    { label: "All in", amount: legal.maxRaiseTo },
  ];
  const seen = new Set();
  return candidates.filter((option) => {
    if (seen.has(option.amount)) return false;
    seen.add(option.amount);
    return true;
  });
}

/** Boots the whole page: prefills the two fields, wires Deal, and hands the
 *  rest to the play and reveal steps below. Does nothing at all on a page
 *  with no embedded hand. */
function boot() {
  const hand = embeddedHand();
  if (!hand) return;

  const form = byId("wwyhd-sit");
  const emailField = byId("wwyhd-email");
  const nameField = byId("wwyhd-name");
  const sitError = byId("wwyhd-sit-error");
  const revealBand = byId("wwyhd-reveal");
  const controls = byId("wwyhd-controls");
  const history = byId("wwyhd-history");
  if (!form || !emailField || !revealBand || !controls) return;

  if (!emailField.value) emailField.value = remembered(EMAIL_KEY);
  if (nameField && !nameField.value) nameField.value = remembered(NAME_KEY);

  const decider = opponentDecider(hand);
  const line = [];
  let state = null;
  let pending = false;
  let results = null;

  // The caption line lives on the felt, above the board. It is made here
  // rather than by the generator because only the controller ever writes to
  // it, and a page with no script has nothing to caption.
  const felt = document.querySelector(".wwyhd-felt");
  if (felt && !byId("wwyhd-caption")) {
    const cap = el("p", "wwyhd-caption");
    cap.id = "wwyhd-caption";
    cap.setAttribute("aria-live", "polite");
    felt.insertBefore(cap, byId("wwyhd-board"));
  }

  // THE TIMELINE. Every paced step awaits wait(), and every deal bumps `run`:
  // a step that wakes up to find `run` moved on belongs to a hand that was
  // dealt again underneath it (Play again mid-showdown), and stands down
  // rather than painting the old hand over the new one. Skip does not cancel
  // anything; it sets the speed to zero and wakes the wait in progress, so
  // the same steps run in the same order with no waiting, and the page ends
  // exactly where it would have.
  const calm = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const baseSpeed = calm ? CALM_SPEED : 1;
  let speed = baseSpeed;
  let run = 0;
  let wake = null;

  function wait(ms) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(done, ms * speed);
      function done() {
        window.clearTimeout(timer);
        if (wake === done) wake = null;
        resolve();
      }
      wake = done;
    });
  }

  /** Waits, then says whether the hand that asked is still the one dealt. */
  async function beat(ms, my) {
    await wait(ms);
    return my === run;
  }

  function skip() {
    speed = 0;
    if (wake) wake();
  }

  /** The bar while the visitor has nothing to decide: what the table is
   *  doing, and Skip, which runs the rest of the wait at no speed. */
  function status(text) {
    controls.textContent = "";
    const bar = el("div", "wwyhd-status");
    bar.appendChild(el("p", "stat", text));
    const button = el("button", "wwyhd-preset", "Skip");
    button.type = "button";
    button.addEventListener("click", skip);
    bar.appendChild(button);
    controls.appendChild(bar);
  }

  /** Every seat's stack before the pot is pushed: what it sat down with, less
   *  everything it put in. A settled state already holds the winner's chips,
   *  so the showdown paints these until the award. */
  function stacksBeforeAward(s) {
    const out = {};
    for (const seat of s.players) {
      const start = hand.players.find((player) => player.handle === seat.handle);
      out[seat.handle] = Number(start ? start.stack : seat.stack) - seat.in;
    }
    return out;
  }

  /**
   * One action taken, by the visitor or an opponent: applied, captioned, and
   * painted, then handed to whatever comes next. The board stays at the
   * count it had BEFORE the action, because an action that closes a street
   * is shown first and the next street's cards land a beat later (proceed).
   */
  function act(action) {
    const before = state;
    state = applyAction(state, action);
    const entry = state.log[state.log.length - 1];
    paintSeats(state, state.over ? stacksBeforeAward(state) : null);
    paintBoard(state, boardCount(before));
    paintLog(state);
    paintPot(state);
    caption(describeAction(entry, before, state, hand.seat));
    proceed(before, run);
  }

  async function proceed(before, my) {
    if (isHandOver(state)) {
      showdown(before, my);
      return;
    }
    if (state.street !== before.street) {
      status("Dealing.");
      if (!(await beat(STREET_MS, my))) return;
      paintBoard(state, null, boardCount(before));
      caption(`The ${STREET_NAME[state.street].toLowerCase()}.`);
      if (!(await beat(STREET_MS, my))) return;
    }
    turn(my);
  }

  /** The visitor's buttons when it is their turn; otherwise the next
   *  opponent thinks for PAUSE_MS and acts. A visitor who pressed Skip gets
   *  the normal pace back at their next decision. */
  async function turn(my) {
    if (state.toAct === state.seat) {
      speed = baseSpeed;
      paintControls();
      return;
    }
    status("Thinking.");
    if (!(await beat(PAUSE_MS, my))) return;
    if (isHandOver(state) || state.toAct === state.seat) return;
    act(decider(seatView(state, state.toAct)));
  }

  function take(action) {
    line.push({ street: state.street, type: action.type, amount: action.amount || 0 });
    act(action);
  }

  /**
   * The end of the hand, played out on the table rather than skipped to.
   *
   * The line is submitted the moment the hand ends and the request runs
   * underneath all of this, so the drama costs the visitor nothing: by the
   * time the pot is pushed the room's results are usually already back. Then,
   * if two or more players are still in: a beat, every live opponent's cards
   * turned over one seat at a time (authored holdings labeled as such), and
   * the board run out street by street, each wait longer than the last. A
   * hand won by a fold turns nothing over, as at a real table. Then the pot
   * is pushed (stacks painted, winners marked, one line saying who won what)
   * and the bar offers the reveal.
   */
  async function showdown(before, my) {
    results = submit();
    const live = state.players.filter((seat) => !seat.folded);
    const contested = live.length > 1;
    status(contested ? "Showdown." : "The hand is over.");
    if (contested) {
      if (!(await beat(SHOWDOWN_MS, my))) return;
      caption("Showdown.");
      for (const seat of live) {
        if (seat.handle === state.seat) continue;
        if (!(await beat(FLIP_MS, my))) return;
        paintHole(seat.handle, seat.cards, { flip: true, label: seat.shown ? "" : "for this puzzle" });
      }
      let shown = boardCount(before);
      for (const [count, name, ms] of RUNOUT) {
        if (shown >= count) continue;
        if (!(await beat(ms, my))) return;
        paintBoard(state, count, shown);
        caption(`The ${name}.`);
        shown = count;
      }
    }
    if (!(await beat(AWARD_MS, my))) return;

    paintSeats(state);
    // The pot is pushed, so nothing is left in front of anybody.
    for (const front of document.querySelectorAll("[data-bet]")) front.textContent = "";
    const won = {};
    for (const pot of state.pots || []) {
      if (!pot.winners.length) continue;
      const share = Math.floor(pot.amount / pot.winners.length);
      for (const handle of pot.winners) won[handle] = (won[handle] || 0) + share;
    }
    const lines = Object.keys(won).map((handle) => {
      const you = handle === state.seat;
      const seat = state.players.find((player) => player.handle === handle);
      let how = "";
      if (contested && seat) {
        try {
          how = ` with ${withArticle(handCategory(evaluate([...seat.cards, ...state.board])))}`;
        } catch {
          how = "";
        }
      }
      const row = document.querySelector(`[data-handle="${handle}"]`);
      if (row) row.classList.add("wwyhd-seat--won");
      return `${you ? "You" : nameOf(handle)} ${you ? "win" : "wins"} ${won[handle]}${how}.`;
    });
    caption(lines.join(" "));
    paintPot(state);

    if (!(await beat(AWARD_MS, my))) return;
    controls.textContent = "";
    const bar = el("div", "wwyhd-status");
    const button = el("button", "wwyhd-act wwyhd-act--go", "See how you did");
    button.type = "button";
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Scoring.";
      results.then(({ result, room }) => {
        if (my !== run) return;
        reveal(result, room);
        // Back to its own name, so a visitor who scrolls up to the table
        // can jump down to the reveal again from where they are.
        button.disabled = false;
        button.textContent = "See how you did";
      });
    });
    bar.appendChild(button);
    controls.appendChild(bar);
  }

  /**
   * Deals the hole cards one at a time, clockwise from the seat after the
   * button, twice around, the way a dealer does. The cards are already in
   * the state; this only brings them onto the table. Then one line for the
   * blinds, and the first decision.
   */
  async function dealIn(my) {
    status("Dealing.");
    const count = state.players.length;
    const order = [];
    for (let round = 0; round < 2; round++) {
      for (let step = 1; step <= count; step++) {
        const seat = state.players[(state.dealerIndex + step) % count];
        const row = document.querySelector(`[data-handle="${seat.handle}"]`);
        const card = row && row.querySelectorAll(".wwyhd-hole .pc")[round];
        if (card) order.push(card);
      }
    }
    for (const card of order) {
      if (!(await beat(DEAL_CARD_MS, my))) return;
      card.classList.remove("pc--undealt");
    }
    if (!(await beat(DEAL_SETTLE_MS, my))) return;
    const who = (handle) => (handle === state.seat ? "You" : nameOf(handle));
    caption(`${who(state.blindSeats.sb)} and ${who(state.blindSeats.bb).replace(/^You$/, "you")} post the blinds.`);
    if (!(await beat(STREET_MS, my))) return;
    turn(my);
  }

  /**
   * The action bar, laid out the way every poker client lays it out: a row of
   * size presets (min, half pot, pot, all in) and the amount box above, and
   * three big equal buttons below, Fold, Check or Call, and Bet or Raise with
   * the amount in its label. A preset only sets the amount; the big button
   * commits it. When no raise is legal (a short all-in closed the action) the
   * third button and the presets do not render, so the bar never offers what
   * the engine would refuse.
   */
  function paintControls() {
    const legal = legalActions(state);
    controls.textContent = "";
    const bar = el("div", "wwyhd-actions");

    const canRaise = legal.minRaiseTo != null && legal.maxRaiseTo != null;
    const raiseType = state.currentBet === 0 ? "bet" : "raise";
    let amount = canRaise ? legal.minRaiseTo : 0;
    let go = null;
    let free = null;
    const setAmount = (n) => {
      amount = Math.min(Math.max(Math.round(n), legal.minRaiseTo), legal.maxRaiseTo);
      if (free) free.value = String(amount);
      if (go) go.textContent = `${raiseType === "bet" ? "Bet" : "Raise to"} ${amount}`;
    };

    if (canRaise) {
      const presets = el("div", "wwyhd-presets");
      for (const option of sizerOptions(legal, state)) {
        const pill = el("button", "wwyhd-preset", `${option.label} ${option.amount}`);
        pill.type = "button";
        pill.addEventListener("click", () => setAmount(option.amount));
        presets.appendChild(pill);
      }
      free = document.createElement("input");
      free.type = "number";
      free.className = "wwyhd-amount";
      free.min = String(legal.minRaiseTo);
      free.max = String(legal.maxRaiseTo);
      free.step = "1";
      free.value = String(amount);
      free.setAttribute("aria-label", "Amount");
      free.addEventListener("input", () => {
        const n = Number(free.value);
        if (Number.isFinite(n) && go) go.textContent = `${raiseType === "bet" ? "Bet" : "Raise to"} ${Math.round(n)}`;
      });
      free.addEventListener("change", () => setAmount(Number(free.value)));
      presets.appendChild(free);
      bar.appendChild(presets);
    }

    const main = el("div", canRaise ? "wwyhd-main" : "wwyhd-main wwyhd-main--two");
    const fold = el("button", "wwyhd-act wwyhd-act--fold", "Fold");
    fold.type = "button";
    fold.addEventListener("click", () => take({ type: "fold", amount: 0 }));
    main.appendChild(fold);

    const mid = el("button", "wwyhd-act", legal.check ? "Check" : `Call ${legal.call}`);
    mid.type = "button";
    mid.addEventListener("click", () => take(legal.check ? { type: "check", amount: 0 } : { type: "call", amount: 0 }));
    main.appendChild(mid);

    if (canRaise) {
      go = el("button", "wwyhd-act wwyhd-act--go", `${raiseType === "bet" ? "Bet" : "Raise to"} ${amount}`);
      go.type = "button";
      go.addEventListener("click", () => {
        const n = free ? Math.round(Number(free.value)) : amount;
        if (!Number.isFinite(n) || n < legal.minRaiseTo || n > legal.maxRaiseTo) { setAmount(amount); return; }
        take({ type: raiseType, amount: n });
      });
      main.appendChild(go);
    }
    bar.appendChild(main);
    controls.appendChild(bar);
  }

  /**
   * Submits the line and reads back what everybody else did.
   *
   * Takes nothing. Returns a promise of `{result, room}` that never rejects:
   * `result` is the POST's answer and `room` the GET's. The server's chip
   * count is the one shown, because it is the one that is stored; the
   * browser's own number is only ever a preview of it. On any failure the
   * hand still happened, so the promise resolves with the browser's count and
   * the error, and the reveal says which half is missing.
   */
  function submit() {
    if (pending) return results;
    pending = true;
    const chips = state.stacks[hand.seat];
    const email = emailField.value.trim();
    const displayName = nameField ? nameField.value.trim() : "";
    const url = `/api/wwyhd?hand=${encodeURIComponent(hand.id)}`;

    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName, line }),
    })
      .then((res) => res.json())
      .then((body) => {
        if (!body || !body.ok) throw new Error((body && body.error) || "That did not go through.");
        remember(email, displayName);
        return fetch(url)
          .then((res) => res.json())
          .then((room) => ({ result: body, room: room || {} }));
      })
      .catch((error) => ({ result: { chips, attempt: null, error: error.message }, room: {} }));
  }

  function reveal(result, room) {
    revealBand.hidden = false;
    const chips = Number(result.chips);
    const score = byId("wwyhd-score");
    if (score) score.textContent = `You finished with ${chips} chips.`;

    const body = byId("wwyhd-reveal-body");
    if (!body) return;
    body.textContent = "";

    const swing = chips - hand.startChips;
    body.appendChild(el("p", "stat", swing === 0
      ? `You started with ${hand.startChips} and ended level.`
      : `You started with ${hand.startChips}, a swing of ${swing > 0 ? "plus" : "minus"} ${Math.abs(swing)}.`));
    if (result.attempt != null) {
      body.appendChild(el("p", "stat", result.attempt === 1
        ? "That was your first go, so it counts."
        : `That was go number ${result.attempt}. Only the first one counts.`));
    }
    if (result.error) body.appendChild(el("p", "stat", `The room's results are not available: ${result.error}`));

    body.appendChild(el("h3", "rule-label", "What really happened"));
    body.appendChild(el("p", null, hand.real.result));

    body.appendChild(el("h3", "rule-label", "Your line against theirs"));
    body.appendChild(comparisonTable(lineVsReal(line, hand.real.actions, hand.seat)));

    body.appendChild(el("h3", "rule-label", "What everybody else did"));
    body.appendChild(choicesList(room.choices || {}));

    body.appendChild(el("h3", "rule-label", "The holdings"));
    body.appendChild(holdingsList());

    body.appendChild(el("h3", "rule-label", "Leaderboard"));
    body.appendChild(leaderboardTable(room, chips, result.name));

    const again = el("p", "wwyhd-again");
    const button = el("button", "wwyhd-act", "Play again");
    button.type = "button";
    button.addEventListener("click", () => {
      deal();
      const table = document.querySelector(".wwyhd-table");
      if (table) table.scrollIntoView({ block: "center" });
    });
    again.appendChild(button);
    body.appendChild(again);

    revealBand.scrollIntoView({ block: "start" });
  }

  /** The visitor's line beside the seat's, one row per street, with the
   *  streets that differ marked. */
  function comparisonTable(rows) {
    const table = el("table", "ledger");
    const head = el("tr");
    for (const label of ["Street", "You", "They"]) head.appendChild(el("th", null, label));
    table.appendChild(head);
    for (const row of rows) {
      const tr = el("tr", row.differs ? "wwyhd-differs" : null);
      tr.appendChild(el("td", null, STREET_NAME[row.street] || row.street));
      tr.appendChild(el("td", null, row.mine));
      tr.appendChild(el("td", null, row.real));
      table.appendChild(tr);
    }
    return table;
  }

  /** At each decision the visitor made, what share of the ranked room chose
   *  what, for the spots enough of them reached. A spot below the floor shows
   *  the visitor's own choice and says so, because a percentage over four
   *  people is noise wearing a percent sign (spec section 4.4). */
  function choicesList(choices) {
    const list = el("ul", "wwyhd-choices");
    let decisions = [];
    try {
      decisions = playSeat(hand, line, decider).decisions;
    } catch {
      decisions = [];
    }
    // One line per spot the room has reached in numbers; the spots it has
    // not are summed up in one sentence rather than repeated per decision.
    let quiet = 0;
    decisions.forEach((decision, index) => {
      const counts = choices[decision.key];
      if (!counts) {
        quiet += 1;
        return;
      }
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      const parts = Object.keys(counts)
        .sort()
        .map((type) => `${type} ${Math.round((counts[type] / total) * 100)}%`);
      list.appendChild(el("li", "stat", `Decision ${index + 1}: you chose ${decision.type}. The room: ${parts.join(", ")} of ${total}.`));
    });
    if (decisions.length === 0) {
      list.appendChild(el("li", "stat", "No decisions to compare."));
    } else if (quiet === decisions.length) {
      list.appendChild(el("li", "stat", "Too few people have played this hand yet to show what the room chose. Check back after the week."));
    } else if (quiet > 0) {
      list.appendChild(el("li", "stat", `${quiet} of your ${decisions.length} decisions were at spots too few people reached to say more.`));
    }
    return list;
  }

  /** Every seat's two cards, with the ones the log never showed labelled for
   *  what they are: chosen for this puzzle, not read off the record. */
  function holdingsList() {
    const list = el("ul", "wwyhd-holdings");
    for (const seat of hand.players) {
      const item = el("li", "wwyhd-holding");
      item.appendChild(el("span", "wwyhd-holding-who", `${nameOf(seat.handle)} (${seat.handle})`));
      const cards = el("span", "wwyhd-holding-cards");
      for (const card of seat.cards) cards.appendChild(cardEl(card));
      item.appendChild(cards);
      item.appendChild(el("span", "stat", seat.shown ? "shown at showdown" : "for this puzzle"));
      list.appendChild(item);
    }
    return list;
  }

  /** The top ten by chips. The visitor's own row is marked when it is up
   *  there (the POST answers with the display name the server stored, so the
   *  page can find it) and appended as "You" underneath when it is not, or
   *  when the server's name is unknown. Display names only: no response from
   *  the Function ever carries an email. */
  function leaderboardTable(room, chips, ownName) {
    const rows = Array.isArray(room.leaderboard) ? room.leaderboard : [];
    const table = el("table", "ledger");
    const head = el("tr");
    for (const label of ["#", "Player", "Chips"]) head.appendChild(el("th", null, label));
    table.appendChild(head);
    let listed = false;
    rows.slice(0, LEADERBOARD_SIZE).forEach((row, index) => {
      const mine = !listed && ownName != null && row.name === ownName && Number(row.chips) === chips;
      const tr = el("tr", mine ? "wwyhd-you" : null);
      tr.appendChild(el("td", "num", String(index + 1)));
      tr.appendChild(el("td", null, mine ? `${row.name} (you)` : row.name));
      tr.appendChild(el("td", "num", String(row.chips)));
      table.appendChild(tr);
      if (mine) listed = true;
    });
    if (!listed) {
      const you = el("tr", "wwyhd-you");
      you.appendChild(el("td", "num", ""));
      you.appendChild(el("td", null, "You"));
      you.appendChild(el("td", "num", String(chips)));
      table.appendChild(you);
    }
    if (rows.length === 0) {
      const empty = el("tr");
      const cell = el("td", null, "Nobody has a ranked go at this hand yet.");
      cell.colSpan = 3;
      empty.appendChild(cell);
      table.appendChild(empty);
    }
    return table;
  }

  /**
   * Deals the hand from the top: the first time, and every time after that.
   *
   * Takes nothing. Returns nothing. Clears the line, the reveal and the
   * submit guard, puts the fields away, and starts a fresh state, so a
   * second go is the same deal from the same stacks rather than a reload
   * (Mike, 2026-09-21: Play again should not make him click Deal again).
   * Every seat's stack, chips in front, folded state and the action log are
   * painted from that new state, so nothing of the last hand survives on
   * screen: opponents' cards go back face down, winner marks come off, and
   * every hole card is taken off the table for dealIn to bring back.
   * Bumping `run` retires anything still pending from the last hand.
   */
  function deal() {
    run += 1;
    speed = baseSpeed;
    line.length = 0;
    pending = false;
    results = null;
    revealBand.hidden = true;
    form.hidden = true;
    const cue = byId("wwyhd-cue");
    if (cue) cue.hidden = true;
    controls.hidden = false;
    if (history) history.open = false;
    state = startHand(hand);
    for (const seat of state.players) {
      paintHole(seat.handle, seat.handle === state.seat ? seat.cards : null, { undealt: true });
      const row = document.querySelector(`[data-handle="${seat.handle}"]`);
      if (row) row.classList.remove("wwyhd-seat--won");
    }
    paintSeats(state);
    paintBoard(state);
    paintLog(state);
    paintPot(state);
    caption("");
    dealIn(run);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state) return;
    if (!emailField.value.trim()) {
      if (sitError) sitError.textContent = "An email, so your go can be scored.";
      return;
    }
    if (sitError) sitError.textContent = "";
    // Remembered the moment they sit down, not after the submit succeeds, so
    // a replay never asks for them again even if the room was unreachable.
    remember(emailField.value.trim(), nameField ? nameField.value.trim() : "");
    deal();
  });
}

// The one place this module touches the document. Under bun there is no
// `document`, so nothing here runs and the import gets `lineVsReal` and
// nothing else.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
