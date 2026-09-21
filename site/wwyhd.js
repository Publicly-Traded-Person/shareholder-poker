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

/** The pause between one opponent acting and the next, in milliseconds. It is
 *  there so the hand reads as a hand rather than resolving in one frame
 *  (spec section 4.4); nothing about the result depends on it. */
const PAUSE_MS = 650;

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
 *  and the seat to act marked. */
function paintSeats(state) {
  for (const seat of state.players) {
    const stack = document.querySelector(`[data-stack="${seat.handle}"]`);
    if (stack) stack.textContent = `${seat.stack} chips`;
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

/** The board as it stands on the current street, as text in the one card
 *  notation. */
function paintBoard(state) {
  const board = byId("wwyhd-board");
  if (!board) return;
  const view = seatView(state, state.seat);
  board.textContent = "";
  if (view.board.length === 0) return;
  for (const card of view.board) board.appendChild(cardEl(card));
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

  // One state in, one repaint out. Everything that changes the hand ends
  // here, so there is exactly one description of what the page shows.
  function paint() {
    paintSeats(state);
    paintBoard(state);
    paintLog(state);
    paintPot(state);
    if (isHandOver(state)) {
      fill(controls, el("p", "stat", "The hand is over."));
      finish();
      return;
    }
    if (state.toAct === state.seat) {
      paintControls();
      return;
    }
    fill(controls, el("p", "stat", "Thinking."));
    window.setTimeout(opponentActs, PAUSE_MS);
  }

  function opponentActs() {
    if (isHandOver(state) || state.toAct === state.seat) return;
    state = applyAction(state, decider(seatView(state, state.toAct)));
    paint();
  }

  function take(action) {
    line.push({ street: state.street, type: action.type, amount: action.amount || 0 });
    state = applyAction(state, action);
    paint();
  }

  function paintControls() {
    const legal = legalActions(state);
    controls.textContent = "";

    const row = el("div", "wwyhd-buttons");
    const fold = el("button", "btn-secondary", "Fold");
    fold.type = "button";
    fold.addEventListener("click", () => take({ type: "fold", amount: 0 }));
    row.appendChild(fold);

    if (legal.check) {
      const check = el("button", "btn-secondary", "Check");
      check.type = "button";
      check.addEventListener("click", () => take({ type: "check", amount: 0 }));
      row.appendChild(check);
    } else {
      const call = el("button", "btn-secondary", `Call ${legal.call}`);
      call.type = "button";
      call.addEventListener("click", () => take({ type: "call", amount: 0 }));
      row.appendChild(call);
    }
    controls.appendChild(row);

    const options = sizerOptions(legal, state);
    if (options.length === 0) return;

    const raiseType = state.currentBet === 0 ? "bet" : "raise";
    const sizer = el("div", "wwyhd-sizer");
    for (const option of options) {
      const button = el("button", "btn-secondary", `${option.label} ${option.amount}`);
      button.type = "button";
      button.addEventListener("click", () => take({ type: raiseType, amount: option.amount }));
      sizer.appendChild(button);
    }

    const free = document.createElement("input");
    free.type = "number";
    free.className = "wwyhd-amount";
    free.min = String(legal.minRaiseTo);
    free.max = String(legal.maxRaiseTo);
    free.step = "1";
    free.value = String(legal.minRaiseTo);
    free.setAttribute("aria-label", "Raise to");
    sizer.appendChild(free);

    const go = el("button", "btn-secondary", raiseType === "bet" ? "Bet to" : "Raise to");
    go.type = "button";
    go.addEventListener("click", () => {
      const amount = Math.round(Number(free.value));
      if (!Number.isFinite(amount) || amount < legal.minRaiseTo || amount > legal.maxRaiseTo) return;
      take({ type: raiseType, amount });
    });
    sizer.appendChild(go);
    controls.appendChild(sizer);
  }

  // The hand is over: submit the line, then read back what everybody else
  // did. The server's chip count is the one shown, because it is the one that
  // is stored; the browser's own number is only ever a preview of it.
  function finish() {
    if (pending) return;
    pending = true;
    const email = emailField.value.trim();
    const displayName = nameField ? nameField.value.trim() : "";
    const url = `/api/wwyhd?hand=${encodeURIComponent(hand.id)}`;

    fetch(url, {
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
          .then((room) => reveal(body, room || {}));
      })
      .catch((error) => {
        // The hand still happened, so the reveal still runs: only the room's
        // half of it is missing, and the sentence says which half.
        reveal({ chips: state.stacks[hand.seat], attempt: null, error: error.message }, {});
      });
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state) return;
    if (!emailField.value.trim()) {
      if (sitError) sitError.textContent = "An email, so your go can be scored.";
      return;
    }
    if (sitError) sitError.textContent = "";
    form.hidden = true;
    const cue = byId("wwyhd-cue");
    if (cue) cue.hidden = true;
    controls.hidden = false;
    state = startHand(hand);
    paint();
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
