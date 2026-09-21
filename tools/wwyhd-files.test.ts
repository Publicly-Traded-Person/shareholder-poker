// The exam for the "What Would You Have Done?" hand files: the loader and the
// validators in `tools/lib/wwyhd.ts`, the check tool `tools/wwyhd-check.ts`,
// and the suite sweep over every committed file under `site/data/wwyhd/`.
//
// Where it sits in the publish flow: step 3 of the weekly runbook (spec §5).
// Charlie writes a hand file, runs `bun tools/wwyhd-check.ts <file>` to prove
// the file replays to the log's real stacks, and opens a PR. The sweep at the
// bottom of this file is the guard that stops a wrong hand file merging even
// if that step was skipped (spec §6).
//
// Run: `bun test tools/wwyhd-files.test.ts`, or as part of `bun test tools`.
//
// HOW TO READ THIS FILE. Every `describe` names one Proof leg of Task 5 and
// the Machine clause it comes from, and every `test` inside it is one sentence
// of that leg. Nothing is pinned here that the task does not pin. The notes
// below record the four places where the exam had to choose how to observe
// something, and why it chose that way.
//
// 1. THE FIXTURE IS NOT THIS FILE'S TO WRITE. `tools/fixtures/wwyhd-mini.json`
//    is one of the task's Create files, so the exam reads it from disk rather
//    than building it inline. Two Proof legs can only be encoded at all if the
//    fixture carries a particular value, so those two are asserted up front in
//    the "fixture preconditions" block with messages saying what the leg needs:
//      - leg (b) replaces `"Ah"` with `"1h"` and demands the throw name field
//        `cards`, so `Ah` has to be one of the HOLDING cards, not a board card;
//      - leg (l) demands the line `ok wwyhd-mini`, and M4 says the tool prints
//        `ok <id>`, so the fixture's `id` is `wwyhd-mini`.
//    The rest of that block is the task's Context read back: three handed
//    `alice`/`bob`/`carol`, blinds 100/200, the seat `bob` with `profile: null`,
//    the other two with archetype-style profiles, a five-card board, chips
//    conserved, and no email anywhere in the file (privacy, spec §3).
//
// 2. LEG (d) RENAMES CONSISTENTLY. "A copy whose second player is `dave`"
//    lands on the seat, because the Context orders the fixture alice, bob,
//    carol and names `bob` as the seat. A bare rename of `players[1].handle`
//    would therefore break two rules at once (an unknown handle AND a `seat`
//    that is no longer at the table), and M1 does not pin which of the two an
//    implementation reports first. So the copy carries the rename through
//    every reference to that handle: `seat`, `dealer`, `real.actions[].handle`
//    and the `real.endStacks` key. The one fault left standing is the one the
//    leg names, a handle absent from `data.players[].aka`.
//
// 3. LEG (k) IS RUN IN TWO DIRECTORIES. The Context suggests naming the
//    later-`opens` copy `0-later.json` so a loader returning directory order
//    would fail the ordering check. It would not, on its own: `readdirSync`
//    returns the order the filesystem keeps, not alphabetical order, so with
//    two files a loader that sorted nothing passes or fails by luck. The
//    ordering assertion therefore runs over two directories holding the SAME
//    two filenames (`wwyhd-mini.json` and the Context's `0-later.json`) and
//    differing only in which file carries the later `opens`. Both read
//    identically off disk and their correct answers are opposite, so an
//    unsorted loader fails one of them on every filesystem.
//
// 4. THE CHIP NUMBERS ARE DERIVED, NOT TYPED. Leg (j) needs "both numbers":
//    the stack the engine computes for `alice` and the wrong one in the file.
//    The first is the fixture's own `real.endStacks.alice` (that is what
//    `checkHandFile` returning for the fixture means), and the second is that
//    value plus 1. Nothing here hardcodes a chip count, so the numbers stay
//    right when the fixture's hand changes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GamesData } from "./lib/standings";
import type { HandFile } from "./lib/wwyhd";
import { checkHandFile, loadHandFiles, validateHandFile } from "./lib/wwyhd";

const TOOLS = import.meta.dir;
const REPO = join(TOOLS, "..");
const FIXTURE_PATH = join(TOOLS, "fixtures", "wwyhd-mini.json");
const CHECK_TOOL = join(TOOLS, "wwyhd-check.ts");
const SWEEP_DIR = join(REPO, "site", "data", "wwyhd");

/** The fixture, parsed fresh on every call. Fresh because every leg below
 *  mutates its own copy: handing the same object to two legs would let one
 *  leg's fault leak into the next one's "otherwise valid file". */
type AnyHand = Record<string, any>;
function fixture(): AnyHand {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

/** The synthetic roster every leg validates against. Invented handles only
 *  (privacy, spec §3 and repo CLAUDE.md): `alice`, `bob` and `carol` are on it,
 *  and `dave` deliberately is NOT, which is what leg (d) turns on. */
const DATA: GamesData = {
  nextGame: { date: "2026-10-06", time: "7:00 PM" },
  hopeCoin: { holder: "alice-a", since: "2026-09-08" },
  players: [
    { slug: "alice-a", name: "Alice A.", aka: ["alice"] },
    { slug: "bob-b", name: "Bob B.", aka: ["bob"] },
    { slug: "carol-c", name: "Carol C.", aka: ["carol"] },
  ],
  games: [],
};

/** Runs `fn`, requires it to throw, and requires every needle to appear in the
 *  thrown message. Returns the message so a caller can assert more about it.
 *  Written as a helper rather than `expect().toThrow(/re/)` so a failure
 *  reports the message that WAS thrown, which is what tells Charlie whether
 *  the file named the wrong field or simply did not halt. */
function throwsWith(fn: () => unknown, ...needles: string[]): string {
  let message: string | null = null;
  let returned = false;
  try {
    fn();
    returned = true;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(returned, "expected a throw, but the call returned").toBe(false);
  for (const needle of needles) {
    expect(
      message ?? "",
      `the thrown message should name ${JSON.stringify(needle)}; it was: ${message}`
    ).toContain(needle);
  }
  return message ?? "";
}

/** The seat the visitor plays, as a player object on the given copy. */
function seatPlayer(hand: AnyHand): AnyHand {
  const seat = hand.players.find((p: AnyHand) => p.handle === hand.seat);
  expect(seat, `the fixture's seat ${JSON.stringify(hand.seat)} is not at the table`).toBeDefined();
  return seat;
}

/** The first player who is not the seat: an opponent, the seats that carry a
 *  profile (spec §4.1). */
function opponent(hand: AnyHand): AnyHand {
  const other = hand.players.find((p: AnyHand) => p.handle !== hand.seat);
  expect(other, "the fixture needs at least one opponent").toBeDefined();
  return other;
}

/** A YYYY-MM-DD date shifted by whole years, which is all the ordering legs
 *  need. No clock is read: the input date comes from the fixture. */
function bumpYear(date: string, by: number): string {
  return String(Number(date.slice(0, 4)) + by) + date.slice(4);
}

/** A temp directory that did not exist a moment ago, so two `bun test tools`
 *  runs in flight on the same machine can never share a path (the pattern of
 *  the render drift check in tools/site.test.ts). */
function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeHand(dir: string, name: string, hand: AnyHand): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(hand, null, 2));
  return path;
}

// --- fixture preconditions --------------------------------------------------
//
// The task's Context describes the fixture; note 1 in the header says why two
// of these are load-bearing for legs (b) and (l) rather than merely tidy.

describe("the fixture tools/fixtures/wwyhd-mini.json is the synthetic hand the Context describes", () => {
  test("it exists and parses", () => {
    expect(existsSync(FIXTURE_PATH), `${FIXTURE_PATH} is missing`).toBe(true);
    expect(typeof fixture()).toBe("object");
  });

  test("its id is `wwyhd-mini`, which is the id leg (l) requires the tool to print", () => {
    expect(fixture().id).toBe("wwyhd-mini");
  });

  test("`Ah` is one of the holdings, which is the card leg (b) replaces with `1h`", () => {
    const holders = fixture().players.filter((p: AnyHand) => (p.cards ?? []).includes("Ah"));
    expect(
      holders.length,
      "leg (b) replaces `Ah` with `1h` and expects the throw to name field `cards`, so `Ah` has to be a holding card"
    ).toBeGreaterThan(0);
  });

  test("three handed: alice, bob and carol, and nobody else", () => {
    expect(fixture().players.map((p: AnyHand) => p.handle)).toEqual(["alice", "bob", "carol"]);
  });

  test("blinds are 100/200 and the seat is bob", () => {
    expect(fixture().blinds).toEqual({ sb: 100, bb: 200, ante: 0 });
    expect(fixture().seat).toBe("bob");
  });

  test("the seat carries `profile: null` and both opponents carry all five profile fields", () => {
    const hand = fixture();
    expect(seatPlayer(hand).profile).toBe(null);
    for (const player of hand.players.filter((p: AnyHand) => p.handle !== hand.seat)) {
      expect(
        Object.keys(player.profile).sort(),
        `${player.handle}'s profile should carry the five archetype fields`
      ).toEqual(["af", "allInRate", "callDown", "foldToRaise", "vpip"]);
    }
  });

  test("every card is two characters in the repo's notation, and the board is five of them", () => {
    const hand = fixture();
    const notation = /^[23456789TJQKA][shdc]$/;
    expect(hand.board.length).toBe(5);
    for (const card of [...hand.board, ...hand.players.flatMap((p: AnyHand) => p.cards)] as string[]) {
      expect(card, `${card} is not in the two-character notation`).toMatch(notation);
    }
  });

  test("`startChips` is the seat's stack, and `endStacks` names every player", () => {
    const hand = fixture();
    expect(hand.startChips).toBe(seatPlayer(hand).stack);
    expect(Object.keys(hand.real.endStacks).sort()).toEqual(["alice", "bob", "carol"]);
  });

  test("chips are conserved: the stacks the hand ends with total the stacks it started with", () => {
    const hand = fixture();
    const before = hand.players.reduce((sum: number, p: AnyHand) => sum + p.stack, 0);
    const after = Object.values(hand.real.endStacks as Record<string, number>)
      .reduce((sum, chips) => sum + chips, 0);
    expect(after).toBe(before);
  });

  test("privacy: no email anywhere in the file", () => {
    expect(readFileSync(FIXTURE_PATH, "utf8")).not.toContain("@");
  });
});

// --- leg (a) [M1] -----------------------------------------------------------

describe("leg (a) [M1]: validateHandFile returns the typed hand for the fixture", () => {
  test("it returns the file, field for field, against a roster whose aka lists cover its handles", () => {
    const hand: HandFile = validateHandFile(fixture(), DATA);
    expect(hand).toEqual(fixture());
  });
});

// --- leg (b) [M1] -----------------------------------------------------------

describe("leg (b) [M1]: a card outside the notation throws naming `cards`", () => {
  test("`Ah` replaced by `1h` in a holding halts", () => {
    const hand = fixture();
    for (const player of hand.players) {
      player.cards = (player.cards ?? []).map((card: string) => (card === "Ah" ? "1h" : card));
    }
    throwsWith(() => validateHandFile(hand, DATA), "cards");
  });
});

// --- leg (c) [M1] -----------------------------------------------------------

describe("leg (c) [M1]: a card appearing twice across holdings and board throws naming `board`", () => {
  test("the board's first card set to a holding card halts, naming the duplicate", () => {
    const hand = fixture();
    const duplicate = hand.players[0].cards[0] as string;
    hand.board[0] = duplicate;
    throwsWith(() => validateHandFile(hand, DATA), "board", duplicate);
  });
});

// --- leg (d) [M1] -----------------------------------------------------------

describe("leg (d) [M1]: a handle absent from data.players[].aka throws naming `handle`", () => {
  test("the second player renamed `dave` halts, naming dave", () => {
    const hand = fixture();
    const was = hand.players[1].handle as string;
    // The rename is carried through every reference to that handle (header
    // note 2), so the only rule the copy breaks is the one this leg names.
    hand.players[1].handle = "dave";
    if (hand.seat === was) hand.seat = "dave";
    if (hand.dealer === was) hand.dealer = "dave";
    for (const action of hand.real.actions as AnyHand[]) {
      if (action.handle === was) action.handle = "dave";
    }
    if (was in hand.real.endStacks) {
      hand.real.endStacks.dave = hand.real.endStacks[was];
      delete hand.real.endStacks[was];
    }
    expect(DATA.players.some((p) => p.aka.includes("dave"))).toBe(false);
    throwsWith(() => validateHandFile(hand, DATA), "handle", "dave");
  });
});

// --- leg (e) [M1] -----------------------------------------------------------

describe("leg (e) [M1]: a seat whose profile is not null throws naming `profile`", () => {
  test("the seat given an opponent's profile halts", () => {
    const hand = fixture();
    seatPlayer(hand).profile = { ...opponent(hand).profile };
    throwsWith(() => validateHandFile(hand, DATA), "profile");
  });
});

// --- leg (f) [M1] -----------------------------------------------------------

describe("leg (f) [M1]: an opponent profile missing one of vpip af allInRate foldToRaise callDown throws naming it", () => {
  test("an opponent profile missing `callDown` halts, naming callDown", () => {
    const hand = fixture();
    delete opponent(hand).profile.callDown;
    throwsWith(() => validateHandFile(hand, DATA), "callDown");
  });

  // The Context asks for a second copy covering a second of the five fields.
  test("an opponent profile missing `foldToRaise` halts, naming foldToRaise", () => {
    const hand = fixture();
    delete opponent(hand).profile.foldToRaise;
    throwsWith(() => validateHandFile(hand, DATA), "foldToRaise");
  });
});

// --- leg (g) [M1] -----------------------------------------------------------

describe("leg (g) [M1]: startChips unequal to the seat's stack throws naming `startChips`", () => {
  test("startChips one chip off halts", () => {
    const hand = fixture();
    hand.startChips = hand.startChips + 1;
    throwsWith(() => validateHandFile(hand, DATA), "startChips");
  });
});

// --- leg (h) [M1] -----------------------------------------------------------

describe("leg (h) [M1]: a board not of exactly five cards throws naming `board`", () => {
  test("a four-card board halts", () => {
    const hand = fixture();
    hand.board = hand.board.slice(0, 4);
    expect(hand.board.length).toBe(4);
    throwsWith(() => validateHandFile(hand, DATA), "board");
  });
});

// --- leg (i) [M1] -----------------------------------------------------------

describe("leg (i) [M1]: `closes` earlier than `opens` throws naming `closes`", () => {
  test("closes a year before opens halts", () => {
    const hand = fixture();
    hand.closes = bumpYear(hand.opens as string, -1);
    expect(hand.closes < hand.opens).toBe(true);
    throwsWith(() => validateHandFile(hand, DATA), "closes");
  });
});

// --- leg (j) [M2] -----------------------------------------------------------

describe("leg (j) [M2]: checkHandFile replays real.actions through the engine", () => {
  test("it returns for the fixture", () => {
    const hand: HandFile = validateHandFile(fixture(), DATA);
    expect(checkHandFile(hand)).toBeUndefined();
  });

  test("endStacks.alice plus 1 halts, naming alice and both numbers", () => {
    const engineSays = fixture().real.endStacks.alice as number;
    const copy = fixture();
    copy.real.endStacks.alice = engineSays + 1;
    const hand: HandFile = validateHandFile(copy, DATA);
    throwsWith(
      () => checkHandFile(hand),
      "alice",
      String(engineSays),
      String(engineSays + 1)
    );
  });
});

// --- leg (k) [M3] -----------------------------------------------------------

describe("leg (k) [M3]: loadHandFiles reads a directory, validated, newest `opens` first", () => {
  let root: string;
  let contextOrder: string;
  let swappedOpens: string;
  let withBadFile: string;

  /** The fixture with a new id, and with `opens` (and `closes`, so the copy
   *  stays valid under M1) shifted by whole years. */
  function copyOf(id: string, years: number): AnyHand {
    const copy = fixture();
    copy.id = id;
    copy.opens = bumpYear(copy.opens as string, years);
    copy.closes = bumpYear(copy.closes as string, years);
    return copy;
  }

  // Two directories carry the SAME two filenames, `wwyhd-mini.json` and the
  // Context's `0-later.json`, and differ only in which of the two holds the
  // later `opens`. Header note 3 says why: `readdirSync` hands back whatever
  // order the filesystem keeps, so a loader that sorted nothing would pass one
  // directory or the other by luck. It cannot pass both, because the two
  // directories read identically off disk and their correct answers are
  // opposite.
  beforeAll(() => {
    root = tempDir("wwyhd-load-");
    contextOrder = join(root, "context-order");
    swappedOpens = join(root, "swapped-opens");
    // The same two files plus the third one, in a directory of its own rather
    // than written into `contextOrder` part-way through the block: the leg's
    // "added to that directory" is the same situation either way, and a
    // separate directory keeps one test from depending on another having run.
    withBadFile = join(root, "with-bad-file");
    mkdirSync(contextOrder, { recursive: true });
    mkdirSync(swappedOpens, { recursive: true });
    mkdirSync(withBadFile, { recursive: true });
    // `0-later.json` is the later one here, which is the Context's arrangement.
    writeHand(contextOrder, "wwyhd-mini.json", fixture());
    writeHand(contextOrder, "0-later.json", copyOf("wwyhd-later", 1));
    // The same filenames, with the later `opens` on the other file.
    writeHand(swappedOpens, "wwyhd-mini.json", copyOf("wwyhd-mini", 1));
    writeHand(swappedOpens, "0-later.json", copyOf("wwyhd-later", 0));
    const bad = fixture();
    bad.id = "wwyhd-bad-board";
    bad.board = bad.board.slice(0, 4);
    writeHand(withBadFile, "wwyhd-mini.json", fixture());
    writeHand(withBadFile, "0-later.json", copyOf("wwyhd-later", 1));
    writeHand(withBadFile, "bad-board.json", bad);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("an absent directory returns []", () => {
    const missing = join(root, "not-a-directory");
    expect(existsSync(missing)).toBe(false);
    expect(loadHandFiles(missing, DATA)).toEqual([]);
  });

  test("two files come back with the later `opens` first, the later one named `0-later.json`", () => {
    const loaded = loadHandFiles(contextOrder, DATA);
    expect(loaded.map((h) => h.id)).toEqual(["wwyhd-later", fixture().id]);
    expect(loaded[0].opens > loaded[1].opens).toBe(true);
    // The second entry is the fixture itself, validated and unchanged: the
    // loader returns typed hand files, not filenames.
    expect(loaded[1]).toEqual(fixture());
  });

  test("the same two filenames with the later `opens` on the other file come back in the opposite order", () => {
    const loaded = loadHandFiles(swappedOpens, DATA);
    expect(loaded.map((h) => h.id)).toEqual(["wwyhd-mini", "wwyhd-later"]);
    expect(loaded[0].opens > loaded[1].opens).toBe(true);
  });

  test("a third file with a four-card board makes the load halt, naming `board`", () => {
    throwsWith(() => loadHandFiles(withBadFile, DATA), "board");
  });
});

// --- leg (l) [M4] -----------------------------------------------------------

describe("leg (l) [M4]: bun tools/wwyhd-check.ts <file...>", () => {
  let cwd: string;
  let brokenPath: string;

  /** Spawns the tool as its own process, the way Charlie runs it in step 3 of
   *  the runbook. `process.execPath` (the bun binary running this suite) is
   *  used rather than the bare string "bun" so this does not depend on PATH
   *  inside the child. The cwd is a temp directory holding a synthetic
   *  site/data/games.json, because the tool reads that file relative to its
   *  working directory exactly as tools/render.ts does. */
  function runCheck(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [CHECK_TOOL, ...args], {
        cwd,
        stdio: "pipe",
        encoding: "utf8",
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status: number | null; stdout: unknown; stderr: unknown };
      return {
        status: e.status ?? -1,
        stdout: e.stdout ? String(e.stdout) : "",
        stderr: e.stderr ? String(e.stderr) : "",
      };
    }
  }

  /** The `ok` lines the tool printed, in order. M4 pins those lines (one per
   *  file, `ok <id>`) and says nothing about a tool that also prints something
   *  else, so the equality below is over the ok lines rather than over all of
   *  stdout: what it pins is that the file that failed got no ok line, and
   *  that every file before it did. */
  const okLines = (text: string) =>
    text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("ok"));

  beforeAll(() => {
    cwd = tempDir("wwyhd-check-cli-");
    mkdirSync(join(cwd, "site", "data"), { recursive: true });
    writeFileSync(join(cwd, "site", "data", "games.json"), JSON.stringify(DATA, null, 2));
    const broken = fixture();
    broken.real.endStacks.alice = (broken.real.endStacks.alice as number) + 1;
    brokenPath = writeHand(cwd, "broken-endstacks.json", broken);
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("on the fixture it exits 0 and prints `ok wwyhd-mini`", () => {
    const run = runCheck([FIXTURE_PATH]);
    expect(run.status, `stderr was: ${run.stderr}`).toBe(0);
    expect(okLines(run.stdout)).toEqual(["ok wwyhd-mini"]);
  });

  test("on the fixture then the broken copy it exits 1, prints the ok line for the file before it, and names alice on stderr", () => {
    const run = runCheck([FIXTURE_PATH, brokenPath]);
    expect(run.status).toBe(1);
    expect(okLines(run.stdout)).toEqual(["ok wwyhd-mini"]);
    expect(run.stderr).toContain("alice");
  });

  test("with no files it exits 2 and prints a usage line on stderr", () => {
    const run = runCheck([]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage");
  });
});

// --- leg (m) [M5] -----------------------------------------------------------
//
// The sweep. The directory does not exist until the first puzzle is committed,
// so `loadHandFiles` treating an absent directory as zero files is what makes
// this pass and say so at BASE. The count is read at collection time so the
// test NAME carries it, which is the leg's own wording: a test named with the
// count of files found under site/data/wwyhd/.

describe("leg (m) [M5]: the suite sweeps every committed hand file", () => {
  const realData: GamesData = JSON.parse(
    readFileSync(join(REPO, "site", "data", "games.json"), "utf8")
  );
  const swept: HandFile[] = loadHandFiles(SWEEP_DIR, realData);
  // Counted straight off disk rather than from the loader, so the sweep cannot
  // silently skip a file by returning fewer than are there. The directory is
  // flat: one `<YYYY-MM-DD>-<n>.json` per puzzle (spec §4.1).
  const onDisk = existsSync(SWEEP_DIR)
    ? readdirSync(SWEEP_DIR).filter((name) => name.endsWith(".json")).length
    : 0;

  test(`checkHandFile over all ${swept.length} hand files under site/data/wwyhd/`, () => {
    expect(swept.length).toBe(onDisk);
    for (const hand of swept) {
      checkHandFile(hand);
    }
  });
});
