// The hand file for "What Would You Have Done?": its shape, the validator
// that refuses a wrong one, the check that replays it against the log, and
// the loader the site generators read the committed files through.
//
// Where it sits in the publish flow: Charlie writes one
// site/data/wwyhd/<YYYY-MM-DD>-<n>.json per puzzle by hand (spec §5 step 2),
// runs `bun tools/wwyhd-check.ts <file>` on it (step 3), and opens a PR. The
// suite runs checkHandFile over every committed file as well, so a file whose
// real line does not replay to the log's stacks cannot merge (spec §6). The
// page generator and the Pages Function read the same files through
// loadHandFiles, so there is exactly one idea of what a hand file is.
//
// Run: never directly. `bun test tools/wwyhd-files.test.ts` exercises it, and
// `bun tools/wwyhd-check.ts` is the command Charlie actually types.
//
// Why every check here halts instead of repairing: a hand file is a claim
// about a real hand that really happened. A file quietly patched publishes a
// puzzle whose answer does not match the log, and the visitor scored against
// it would never know. Fix the file, never the check.
//
// No email, no private roster row and no real player's handle appears in a
// hand file or in any fixture beside one (repo CLAUDE.md, spec §3); the
// handles in a hand file are the ones already printed on the public game
// pages, and the fixtures here are synthetic.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GamesData } from "./standings";
// @ts-ignore - plain JS module shared with the browser, the Worker and bun
import { replay } from "../../site/wwyhd-engine.js";

/** One opponent's lifetime tendencies, through the game named in the file's
 *  `profileThrough` (spec §4.1 review note). The rules module reads these;
 *  nothing here does anything with them but insist all five are present,
 *  because a profile missing a field makes an opponent behave like a default
 *  rather than like the player, and nothing on the page would say so. */
export type HandProfile = {
  vpip: number;
  af: number;
  allInRate: number;
  foldToRaise: number;
  callDown: number;
};

/** One seat, in clockwise seat order. `profile` is null for exactly one
 *  player, the seat the visitor plays: that seat's tendencies are the
 *  visitor's, not the record's. `shown` false means Charlie chose the cards
 *  and the reveal page says so. */
export type HandPlayer = {
  handle: string;
  stack: number;
  cards: string[];
  shown: boolean;
  profile: HandProfile | null;
};

/** One recorded action from the real hand. `amount` is the TOTAL the player's
 *  street contribution becomes for a bet or a raise (PokerNow's "raises to
 *  N"); fold, check and call carry 0. */
export type HandAction = {
  street: string;
  handle: string;
  type: string;
  amount: number;
};

/** A committed puzzle. The plan's shared literal: the engine deals `blinds`,
 *  `dealer`, `players`, `board` and `seat`, the page prints `title`, `setup`
 *  and (after `closes`) `real.result`, and the check replays `real.actions`
 *  and compares `real.endStacks`. */
export type HandFile = {
  id: string;
  game: string;
  handNo: number;
  title: string;
  setup: string;
  seat: string;
  blinds: { sb: number; bb: number; ante: number };
  dealer: string;
  players: HandPlayer[];
  board: string[];
  real: {
    actions: HandAction[];
    result: string;
    seatChips: number;
    // The stack each handle holds when the hand is over, copied from the
    // log's next "Player stacks:" line. checkHandFile replays the real line
    // and refuses when the engine disagrees with any of these.
    endStacks: Record<string, number>;
  };
  startChips: number;
  profileThrough: string;
  opens: string;
  // Optional: absent means the puzzle ranks forever (the normal case).
  closes?: string;
};

/** The five fields an opponent profile must carry. Listed once so the halt
 *  message and the check cannot drift apart. */
const PROFILE_FIELDS = ["vpip", "af", "allInRate", "foldToRaise", "callDown"] as const;

/** The card notation used everywhere in this feature: two characters, rank
 *  then suit. One spelling across the file, the engine, the page and the
 *  Function, so a card is never two different strings. */
const CARD = /^[23456789TJQKA][shdc]$/;

/** Every halt from this module is prefixed so a failure in Charlie's terminal
 *  or in the suite says which layer refused, and names the field of the hand
 *  file that is wrong: the message is the whole of the repair instruction. */
function fail(field: string, message: string): never {
  throw new Error(`wwyhd: ${field}: ${message}`);
}

/** A whole number of chips, or a halt naming the field. Fractional chips mean
 *  the file was typed from memory rather than copied from the log, and half a
 *  chip cannot be split at a showdown. */
function whole(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(field, `must be a whole number of chips, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** A non-empty string, or a halt naming the field. */
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    fail(field, `must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Every handle games.json knows, lower-cased, the same set publish-game
 *  resolves a log handle against (tools/lib/slugs.ts resolveSlug). Built once
 *  per validate call rather than per player. */
function knownHandles(data: GamesData): Set<string> {
  const known = new Set<string>();
  for (const player of data.players ?? []) {
    for (const alias of player.aka ?? []) known.add(alias.toLowerCase());
  }
  return known;
}

/**
 * Reads one parsed hand file and returns it typed, or halts.
 *
 * Takes the parsed JSON (anything: this is the boundary where an unchecked
 * value becomes a HandFile) and the parsed site/data/games.json, whose
 * `players[].aka` lists are the only handles a hand file may name. Returns
 * the same object as a HandFile. Throws, with the offending field's name in
 * the message, on: a card outside the two-character notation (`cards`), a
 * card appearing twice across the holdings and the board (`board`), a handle
 * games.json does not know (`handle`), a seat carrying a profile (`profile`),
 * an opponent profile missing one of vpip, af, allInRate, foldToRaise or
 * callDown, a `startChips` that is not the seat's own starting stack
 * (`startChips`), a board that is not exactly five cards (`board`), and a
 * `closes` earlier than `opens` (`closes`). `closes` itself is optional;
 * a file without one ranks forever.
 *
 * Why an unknown handle halts rather than passing through: it is the rule
 * publish-game already applies to a log handle (repo CLAUDE.md, "never invent
 * a player"). A handle the record does not know renders a puzzle page naming
 * somebody the site cannot link to, and guessing which player it meant is how
 * a real person ends up attached to a hand they did not play.
 *
 * Why the seat's profile must be null: the seat is the visitor. A profile
 * there would be read by the opponent rules as one more bot at the table, and
 * the hand the visitor plays would not be the hand the page describes.
 *
 * Why the duplicate-card check spans holdings AND board: two copies of a card
 * is the single most common transcription slip, and the engine would settle
 * such a hand without complaint, paying a showdown off cards that never
 * existed.
 */
export function validateHandFile(hand: unknown, data: GamesData): HandFile {
  if (!hand || typeof hand !== "object" || Array.isArray(hand)) {
    fail("hand", `a hand file must be a JSON object, got ${JSON.stringify(hand)}`);
  }
  const file = hand as Record<string, any>;

  text(file.id, "id");
  text(file.game, "game");
  whole(file.handNo, "handNo");
  text(file.title, "title");
  text(file.setup, "setup");
  text(file.profileThrough, "profileThrough");
  const opens = text(file.opens, "opens");
  // `closes` is optional, and absent is the normal case: a puzzle ranks
  // forever, like an arcade high score, and ties go to whoever got there
  // first (Mike, 2026-09-22: "can't the puzzle stay open... forever?"). A
  // date is for the rare puzzle that should stop ranking on purpose.
  const closes = file.closes === undefined ? undefined : text(file.closes, "closes");

  const blinds = file.blinds;
  if (!blinds || typeof blinds !== "object") fail("blinds", "must be an object with sb, bb and ante");
  whole(blinds.sb, "blinds.sb");
  whole(blinds.bb, "blinds.bb");
  whole(blinds.ante ?? 0, "blinds.ante");

  if (!Array.isArray(file.players) || file.players.length < 2) {
    fail("players", "a hand needs at least two players in clockwise seat order");
  }
  const players: HandPlayer[] = file.players;

  // Handles first, before anything that looks a player up: a file whose
  // second seat is a handle games.json never heard of must say so, not
  // complain that its own `seat` is missing from the table.
  const known = knownHandles(data);
  const seen = new Set<string>();
  players.forEach((player, index) => {
    if (!player || typeof player !== "object") fail(`players[${index}]`, "must be a seat object");
    const handle = text(player.handle, `players[${index}].handle`);
    if (!known.has(handle.toLowerCase())) {
      fail(
        `players[${index}].handle`,
        `unknown handle ${JSON.stringify(handle)}. Add it to an existing player's aka list ` +
          `in site/data/games.json, or add a new player entry. Never guess.`,
      );
    }
    if (seen.has(handle)) fail(`players[${index}].handle`, `${handle} is at the table twice`);
    seen.add(handle);
  });

  const dealer = text(file.dealer, "dealer");
  if (!players.some((player) => player.handle === dealer)) {
    fail("dealer", `${JSON.stringify(dealer)} is not at this table`);
  }
  const seatHandle = text(file.seat, "seat");
  const seat = players.find((player) => player.handle === seatHandle);
  if (!seat) fail("seat", `${JSON.stringify(seatHandle)} is not at this table`);

  // Holdings: two cards each, both in the notation. The board is checked
  // below, so a bad card here is always a holding and always says `cards`.
  players.forEach((player, index) => {
    whole(player.stack, `players[${index}].stack`);
    if (typeof player.shown !== "boolean") {
      fail(`players[${index}].shown`, "must be true (the cards are the log's) or false (chosen)");
    }
    const cards = player.cards;
    if (!Array.isArray(cards) || cards.length !== 2) {
      fail(`players[${index}].cards`, `must be exactly two cards, got ${JSON.stringify(cards)}`);
    }
    for (const card of cards) {
      if (typeof card !== "string" || !CARD.test(card)) {
        fail(
          `players[${index}].cards`,
          `${JSON.stringify(card)} is not a card: two characters, rank in 23456789TJQKA, ` +
            `suit in shdc (Ah, Td, 7d)`,
        );
      }
    }
  });

  // The board is the full five-card runout even when the real hand ended
  // early (spec §4.1): the engine slices it per street, so four cards would
  // leave a river that cannot be dealt and a showdown that cannot be scored.
  const board = file.board;
  if (!Array.isArray(board) || board.length !== 5) {
    fail(
      "board",
      `must be exactly five board cards, got ${Array.isArray(board) ? board.length : JSON.stringify(board)}`,
    );
  }
  board.forEach((card: unknown, index: number) => {
    if (typeof card !== "string" || !CARD.test(card)) {
      fail(
        "board",
        `board[${index}] ${JSON.stringify(card)} is not a card: board cards are two characters, ` +
          `rank in 23456789TJQKA, suit in shdc (Ah, Td, 7d)`,
      );
    }
  });

  const where = new Map<string, string>();
  for (const player of players) {
    for (const card of player.cards) {
      const first = where.get(card);
      if (first) fail("board", `the card ${card} appears twice: ${first} and ${player.handle}'s hand`);
      where.set(card, `${player.handle}'s hand`);
    }
  }
  board.forEach((card: string, index: number) => {
    const first = where.get(card);
    if (first) fail("board", `the card ${card} appears twice: ${first} and board[${index}]`);
    where.set(card, `board[${index}]`);
  });

  players.forEach((player, index) => {
    if (player.handle === seatHandle) {
      // Strictly `null`, never an omitted key: the seat is the ONE player a
      // null profile identifies, and every consumer reads `profile === null`
      // for "this is the visitor". A file that leaves the key out would
      // validate and then be a hand with no seat.
      if (player.profile !== null) {
        fail(
          `players[${index}].profile`,
          `the seat ${seatHandle} is the visitor, so its profile must be null, got ` +
            `${JSON.stringify(player.profile)}`,
        );
      }
      return;
    }
    const profile = player.profile as Record<string, unknown> | null | undefined;
    if (!profile || typeof profile !== "object") {
      fail(
        `players[${index}].profile`,
        `an opponent needs a profile carrying ${PROFILE_FIELDS.join(", ")}`,
      );
    }
    for (const field of PROFILE_FIELDS) {
      if (typeof profile[field] !== "number" || !Number.isFinite(profile[field] as number)) {
        fail(
          `players[${index}].profile.${field}`,
          `${player.handle}'s profile is missing ${field}: an opponent profile needs ` +
            `${PROFILE_FIELDS.join(", ")}, all numbers`,
        );
      }
    }
  });

  // The score the page prints is the seat's end stack against this number, so
  // a startChips that is not the seat's own stack scores every visitor
  // against a hand nobody played.
  const startChips = whole(file.startChips, "startChips");
  if (startChips !== seat.stack) {
    fail(
      "startChips",
      `is ${startChips} but the seat ${seatHandle} starts the hand with ${seat.stack}`,
    );
  }

  const real = file.real;
  if (!real || typeof real !== "object") fail("real", "must carry actions, result, seatChips and endStacks");
  if (!Array.isArray(real.actions) || real.actions.length === 0) {
    fail("real.actions", "must be the real line, one action object per decision");
  }
  real.actions.forEach((action: any, index: number) => {
    if (!action || typeof action !== "object") fail(`real.actions[${index}]`, "is not an action");
    text(action.street, `real.actions[${index}].street`);
    text(action.handle, `real.actions[${index}].handle`);
    text(action.type, `real.actions[${index}].type`);
    whole(action.amount ?? 0, `real.actions[${index}].amount`);
  });
  text(real.result, "real.result");
  whole(real.seatChips, "real.seatChips");
  const endStacks = real.endStacks;
  if (!endStacks || typeof endStacks !== "object" || Array.isArray(endStacks)) {
    fail("real.endStacks", "must map every handle to its stack after the hand, from the log");
  }
  for (const player of players) {
    whole(endStacks[player.handle], `real.endStacks.${player.handle}`);
  }

  // `closes` is the only source of truth for when a puzzle stops ranking
  // (spec §4.1 review note). A window that closes before it opens ranks
  // nobody, and the page would say so to nobody.
  if (closes !== undefined && closes < opens) fail("closes", `${closes} is earlier than opens ${opens}`);

  noSpoiler(file as HandFile, "title");
  noSpoiler(file as HandFile, "setup");

  return file as HandFile;
}

/** How a rank is spelled in English, keyed by the card notation's rank
 *  character. Plurals always count ("aces", "fours"); a singular counts only
 *  for the four face cards, because "two", "three" and "four" turn up in
 *  ordinary sentences ("three handed", "two tables") and "ace" or "king"
 *  do not. */
const RANK_WORDS: Record<string, string[]> = {
  A: ["ace", "aces"], K: ["king", "kings"], Q: ["queen", "queens"], J: ["jack", "jacks"],
  T: ["tens"], "9": ["nines"], "8": ["eights"], "7": ["sevens"], "6": ["sixes"],
  "5": ["fives"], "4": ["fours"], "3": ["threes", "treys"], "2": ["twos", "deuces"],
};

/** Words that name how a hand turned out rather than how it started. None of
 *  them can be true of a hand the visitor has not played yet, so none of them
 *  belongs in copy the visitor reads before the deal. */
const OUTCOME_WORDS = [
  "flush", "full house", "boat", "quads", "trips", "set", "two pair",
  "rivered", "runner-runner", "cracked", "cracks", "bad beat", "suckout",
];

/**
 * Refuses a `title` or `setup` that gives the hand away.
 *
 * Takes a hand file and which of the two fields to read. Returns nothing when
 * the line names only what a visitor can see before the deal. Throws, naming
 * the field and the word, when it names a rank the visitor cannot see (a rank
 * in another player's holding or on the board that is not also in the
 * visitor's own two cards) or an outcome word from OUTCOME_WORDS.
 *
 * Why this is a halt and not a runbook sentence: the title and setup are the
 * page heading, the browser tab, the link preview in Discord and in the
 * email, and the index row, all before anybody plays. The first puzzle
 * shipped as "Seven-deuce against the aces" and gave the whole hand away
 * (Mike, 2026-09-22). The runbook already asked for care; a written rule is
 * read at 10pm by somebody in a hurry, and a check is not.
 *
 * It is deliberately a word list, not an understanding of English: it will
 * miss a spoiler phrased cleverly, and it may one day refuse an innocent
 * sentence. The repair for the second case is to reword the line, never to
 * loosen the list for one file.
 */
function noSpoiler(hand: HandFile, field: "title" | "setup"): void {
  const line = String(hand[field]).toLowerCase();
  const seat = hand.players.find((player) => player.handle === hand.seat);
  const mine = new Set((seat?.cards ?? []).map((card) => card[0]));
  const unseen = new Set<string>();
  for (const player of hand.players) {
    if (player.handle === hand.seat) continue;
    for (const card of player.cards ?? []) unseen.add(card[0]);
  }
  for (const card of hand.board ?? []) unseen.add(card[0]);
  for (const rank of mine) unseen.delete(rank);

  const says = (word: string) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(line);
  for (const rank of unseen) {
    for (const word of RANK_WORDS[rank] ?? []) {
      if (says(word)) {
        fail(field, `names "${word}", a card the visitor cannot see before playing. ` +
          `The ${field} is shown before the deal (heading, tab, link previews, index): ` +
          `name only the visitor's own cards, seat and stacks, and put the story in real.result`);
      }
    }
  }
  for (const word of OUTCOME_WORDS) {
    if (says(word)) {
      fail(field, `names "${word}", which says how the hand turned out. ` +
        `The ${field} is shown before the deal: put the outcome in real.result`);
    }
  }
}

/**
 * Proves a hand file against the log it was copied from.
 *
 * Takes a validated hand file. Returns nothing when the engine, replaying
 * `real.actions` from the file's own stacks and blinds, leaves every player
 * holding exactly what `real.endStacks` says. Throws, naming the handle and
 * both numbers, on the first player the replay disagrees about, and lets the
 * engine's own halt through unchanged when the recorded line is not legal
 * poker (an action out of turn, a raise below the minimum, a line that runs
 * out before the hand ends).
 *
 * This is the whole of spec §5 step 3 and §6's "a wrong file cannot merge":
 * if the replay and the log disagree, the file is wrong, not the engine. It
 * runs both from `bun tools/wwyhd-check.ts` before a PR and from the suite
 * over every committed file, so the two can never be checked to different
 * standards.
 */
export function checkHandFile(hand: HandFile): void {
  const state = replay(hand, hand.real.actions);
  const stacks: Record<string, number> = state.stacks ?? {};
  for (const player of hand.players) {
    const replayed = stacks[player.handle];
    const recorded = hand.real.endStacks[player.handle];
    if (replayed !== recorded) {
      throw new Error(
        `wwyhd: ${hand.id}: real.endStacks says ${player.handle} ends the hand with ` +
          `${recorded}, but replaying the real line leaves ${player.handle} with ${replayed}. ` +
          `The file is wrong, not the engine: recheck the log.`,
      );
    }
  }
}

/**
 * Every committed hand file in a directory, newest puzzle first.
 *
 * Takes the directory (site/data/wwyhd/ in the generators, a temp directory
 * in the exam) and the parsed site/data/games.json. Returns one validated
 * HandFile per `*.json` in it, sorted by `opens` with the newest first and
 * ties broken by id so two renders of the same tree order them the same way.
 * Returns [] when the directory does not exist, which is the state at the
 * moment this feature lands and before the first puzzle is written. Throws
 * whatever validateHandFile throws, with the filename in front of it, so one
 * bad file names itself rather than making the whole directory unreadable.
 *
 * Why an absent directory is zero files rather than a halt: the loader is on
 * the render path, and a site with no puzzle yet is a site that renders fine
 * without one. An empty directory and no directory mean the same thing here.
 */
export function loadHandFiles(dir: string, data: GamesData): HandFile[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const files: HandFile[] = [];
  for (const name of names) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`wwyhd: ${path}: ${(error as Error).message}`);
    }
    try {
      files.push(validateHandFile(parsed, data));
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`);
    }
  }
  return files.sort((a, b) => b.opens.localeCompare(a.opens) || a.id.localeCompare(b.id));
}
