// The exam for the "What Would You Have Done?" Pages Function,
// `functions/api/wwyhd.js`, and for the `wwyhd_results` table it writes in
// `site/schema.sql`. The Function is the half of the puzzle the visitor cannot
// edit: it fetches the hand file through the static asset binding, re-runs
// `playSeat` from `site/wwyhd-engine.js` on the submitted line with the
// opponents answered by `decide` from `site/wwyhd-rules.js`, and keeps ITS
// chip count, never the browser's. Run this file with
// `bun test tools/wwyhd-api.test.ts`, or as part of `bun test tools`.
//
// HOW TO READ THIS FILE. Every `describe` names one Proof leg and the Machine
// clause it comes from, and every `test` inside it is one sentence of that
// leg. The notes below say where the exam had to choose a way to observe
// something, or had to settle a reading, and why it chose as it did.
//
// 1. A REAL DATABASE, BUILT FROM THE REAL SCHEMA. M7 says the exam builds its
//    database from `site/schema.sql`, so it does: `bun:sqlite` executes that
//    file verbatim into a fresh `:memory:` database per test, and `d1()` wraps
//    it in the D1 shape the Function is written against
//    (`prepare(sql).bind(...).all()` giving `{results}`, plus `.first()` and
//    `.run()`; `exec` and `batch` are there too so a handler that reaches for
//    another corner of the D1 surface still runs). Rows are therefore checked
//    by reading the table back with SQL, not by peering at a stub's array.
//
// 2. THE HAND FILE IS INLINE AND SYNTHETIC. Task 5 owns
//    `tools/fixtures/wwyhd-mini.json` and that file does not exist here, so
//    this exam carries its own copy of a hand in the plan's shared shape. Its
//    handles are the plan's invented four (`alice`, `bob`, `carol`), it holds
//    no email, and `env.ASSETS.fetch` is stubbed to serve it at
//    `/data/wwyhd/<id>.json` and to answer 404 for every other path.
//
// 3. THE CHIP COUNT IS NEVER HARDCODED. M1 says the stored `chips` is "from
//    the server's own `playSeat` replay", so leg (a) compares the response
//    and the row against `playSeat`'s own return value for the same hand,
//    the same line and the same `decide(view, profileOf(view.handle))`
//    callback the Function's Context specifies. Same for leg (b)'s engine
//    message: it is caught from `playSeat` itself rather than transcribed, so
//    the assertion cannot drift from the engine's wording.
//
// 4. `WWYHD_NOW`. Rankedness is a fact about a date, and a suite that read the
//    wall clock would change its answer in 2031. Every request in this file
//    carries the optional `ctx.env.WWYHD_NOW` string the Function's Context
//    defines (the plain UTC date it should read), so every assertion here is
//    the same on every machine and in every year.
//
// 5. LEG (d)'s "DISTINCT CHIPS" AND ITS TIE. The leg asks for "eleven ranked
//    rows with distinct chips" and, in the same sentence, for "a tie between
//    two rows broken by earlier `created_at`". The only reading under which
//    both stand is: eleven rows whose chips are distinct apart from the one
//    deliberate tie. That tie sits third and fourth so it lands inside the top
//    ten where the tie break is visible, and the tied pair is arranged so that
//    ONLY `created_at` produces the expected order: the row with the earlier
//    `created_at` is inserted second, sorts last by email and last by display
//    name, so insertion order, rowid order, a stable JS sort and SQLite's own
//    incidental order for an untied `ORDER BY chips DESC` all put the other
//    row first and fail the assertion. That arrangement was checked against
//    `bun:sqlite` on this seed; without it a handler that omits the
//    `created_at` tie break passes by luck.
//
// 6. LEG (d)'s `count`. M4 says `count` is the number of ranked rows; spec
//    §4.5 called it distinct emails. The eleven ranked rows carry eleven
//    distinct emails, so both readings give 11 and this exam does not have to
//    pick one.
//
// 7. "PER-TYPE COUNTS" AND THE ZERO QUESTION. M4 does not say whether a type
//    nobody chose appears as a 0. So the exam pins what M4 does pin: which
//    keys are in the map (exactly, by `Object.keys`), the count of every type
//    that was actually chosen, and that the map's values sum to the number of
//    rows that reached the key, which leaves any unmentioned type no room to
//    be anything but zero.
//
// 8. NO EMAIL ANYWHERE. Every email below is at `example.com` and invented,
//    every display name is invented, and M5's assertions are made on the raw
//    response text so a leak through any field, not just the ones this exam
//    names, fails.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import { onRequestGet, onRequestPost } from "../functions/api/wwyhd.js";
// @ts-ignore - plain JS module shared with the browser, the Worker and bun
import { playSeat } from "../site/wwyhd-engine.js";
// @ts-ignore - plain JS module shared with the browser, the Worker and bun
import { decide, THRESHOLDS } from "../site/wwyhd-rules.js";

// --- the schema under test --------------------------------------------------
// File-scope read: top-level await is fine in a bun test module.
const SCHEMA = await Bun.file(new URL("../site/schema.sql", import.meta.url)).text();

// --- the synthetic hand file ------------------------------------------------
//
// The plan's shared hand-file shape. Three-handed at 100/200, `alice` on the
// button and in the seat, so preflop order is alice, bob (small blind), carol
// (big blind) and postflop bob acts before alice. Every handle is invented and
// no field holds an email.

const HAND_ID = "2026-01-01-1";
const CLOSES = "2026-09-30";

const HAND = {
  id: HAND_ID,
  game: "2026-01-01",
  handNo: 1,
  title: "A hand for the exam",
  setup: "Blinds 100/200, three handed.",
  seat: "alice",
  blinds: { sb: 100, bb: 200, ante: 0 },
  dealer: "alice",
  players: [
    { handle: "alice", stack: 20000, cards: ["Ah", "Kd"], shown: true, profile: null },
    {
      handle: "bob",
      stack: 20000,
      cards: ["Qs", "Qc"],
      shown: true,
      profile: { vpip: 40, af: 2, allInRate: 0.1, foldToRaise: 40, callDown: 60 },
    },
    {
      handle: "carol",
      stack: 20000,
      cards: ["7h", "2d"],
      shown: true,
      profile: { vpip: 20, af: 1, allInRate: 0.05, foldToRaise: 70, callDown: 30 },
    },
  ],
  board: ["Kc", "8h", "3s", "4d", "9c"],
  real: { actions: [], result: "alice takes it on the river.", seatChips: 23600, endStacks: {} },
  startChips: 20000,
  profileThrough: "2026-01-01",
  opens: "2026-01-01",
  closes: CLOSES,
};

/** The seat's line the whole exam submits: five decisions, one on each street
 *  and two preflop. It is a legal line for the hand above, which is what lets
 *  leg (b) make a one-action-short copy that is illegal for exactly one
 *  reason.
 *
 *  It checks the last three streets because bob's own profile decides what
 *  the hand allows (rules rewritten 2026-09-21 so every decision comes from
 *  the player's numbers): bob holds queens on a king-high board, an underpair,
 *  and his foldToRaise of 40 sets a continue bar above that, so he folds to any
 *  bet. A line that bet a street would end the hand there and leave actions
 *  over. Nothing here hardcodes a chip count; REPLAY below computes it. */
const SEAT_LINE = [
  { street: "PRE", type: "raise", amount: 600 },
  { street: "PRE", type: "call", amount: 0 },
  { street: "FLOP", type: "check", amount: 0 },
  { street: "TURN", type: "check", amount: 0 },
  { street: "RIVER", type: "check", amount: 0 },
];

/** The opponents answered exactly as the Function's Context says the Function
 *  answers them: `decide(view, profileOf(view.handle))`, the profile being
 *  that player's from the hand file. */
const profileOf = (handle: string) =>
  HAND.players.find((p) => p.handle === handle)!.profile;
const decideForHand = (view: any) => decide(view, profileOf(view.handle));

/** The server's own answer, computed here the same way the Function must
 *  compute it. Nothing below hardcodes a chip count. */
const REPLAY = playSeat(HAND, SEAT_LINE, decideForHand) as {
  chips: number;
  line: unknown[];
  decisions: { key: string; type: string }[];
};

/** The engine's own message for a line that runs out one action early, caught
 *  from the engine rather than transcribed (note 3). */
const SHORT_LINE = SEAT_LINE.slice(0, -1);
const SHORT_LINE_MESSAGE = (() => {
  try {
    playSeat(HAND, SHORT_LINE, decideForHand);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("fixture broken: the short line replayed without error");
})();

// --- the D1-shaped adapter over a real database -----------------------------

type Args = any[];

/** Wraps a `bun:sqlite` database in the D1 binding shape the Function is
 *  written against. Takes the database; returns an object with `prepare`
 *  (whose statements answer `bind`, `all`, `first` and `run`), `exec` and
 *  `batch`. Throws whatever SQLite throws, which is the point: a handler that
 *  writes a column the schema does not have fails here rather than being
 *  quietly accepted by a hand-written stub. */
function d1(db: Database) {
  const statement = (sql: string, args: Args) => ({
    sql,
    args,
    bind: (...next: Args) => statement(sql, next),
    all: async () => ({ results: db.query(sql).all(...args), success: true }),
    first: async (column?: string) => {
      const row = (db.query(sql).get(...args) ?? null) as Record<string, unknown> | null;
      if (row === null || column === undefined) return row;
      return row[column] ?? null;
    },
    run: async () => {
      db.query(sql).run(...args);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => statement(sql, []),
    exec: async (sql: string) => {
      db.run(sql);
      return { count: 0 };
    },
    batch: async (statements: { all: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
  };
}

// --- the environment --------------------------------------------------------

/** A date comfortably inside the window, used wherever a leg needs a ranked
 *  row but is not itself about the `closes` boundary. */
const BEFORE_CLOSES = "2026-09-25";
const AFTER_CLOSES = "2026-10-01";

type RosterRow = { email: string; handle: string; slug: string };

function assetUrl(input: unknown): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  if (typeof input === "string") return new URL(input);
  return new URL(String((input as { url?: string } | null)?.url ?? input));
}

/** A fresh database built from `site/schema.sql` (M7), an ASSETS stub over the
 *  synthetic hand, and the injected `now`. */
function makeEnv(options: { now?: string; roster?: RosterRow[] } = {}) {
  const db = new Database(":memory:");
  db.run(SCHEMA);
  for (const row of options.roster ?? []) {
    db.query("INSERT INTO roster (email, handle, slug) VALUES (?, ?, ?)").run(
      row.email,
      row.handle,
      row.slug,
    );
  }
  const env = {
    POKER_RSVP_DB: d1(db),
    ASSETS: {
      fetch: async (input: unknown) => {
        const url = assetUrl(input);
        if (url.pathname === `/data/wwyhd/${HAND_ID}.json`) {
          return new Response(JSON.stringify(HAND), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    },
    WWYHD_NOW: options.now ?? BEFORE_CLOSES,
  };
  return { env, db };
}

const postReq = (body: unknown, hand: string = HAND_ID) =>
  new Request(`https://poker.example/api/wwyhd?hand=${hand}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const getReq = (hand: string = HAND_ID) =>
  new Request(`https://poker.example/api/wwyhd?hand=${hand}`);

type ResultRow = {
  hand_id: string;
  email: string;
  attempt: number;
  display_name: string;
  line: string;
  decisions: string;
  chips: number;
  ranked: number;
  created_at: string;
};

const storedRows = (db: Database): ResultRow[] =>
  db.query("SELECT * FROM wwyhd_results ORDER BY rowid").all() as ResultRow[];

// --- leg (a) ---------------------------------------------------------------

describe("(a) POST records one row per attempt and scores it itself [M1]", () => {
  test("a first POST answers {ok: true, attempt: 1, chips} with the server's own playSeat chips", async () => {
    const { env, db } = makeEnv();
    const res = await onRequestPost({
      request: postReq({
        email: "Alice.Tester@Example.com",
        displayName: "Tester",
        line: SEAT_LINE,
      }),
      env,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, attempt: 1, chips: REPLAY.chips, name: "Tester" });

    const rows = storedRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.hand_id).toBe(HAND_ID);
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[0]!.chips).toBe(REPLAY.chips);
    // RSVP's rule, cloned: emails are lowercased before storage.
    expect(rows[0]!.email).toBe("alice.tester@example.com");
  });

  test("a second POST from the same email is attempt 2, and the first row stands", async () => {
    const { env, db } = makeEnv();
    const body = { email: "alice.tester@example.com", displayName: "Tester", line: SEAT_LINE };
    const first = await onRequestPost({ request: postReq(body), env });
    const second = await onRequestPost({ request: postReq(body), env });

    expect((await first.json()).attempt).toBe(1);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, attempt: 2, chips: REPLAY.chips, name: "Tester" });

    const rows = storedRows(db);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);
  });

  test("a chips field in the body changes nothing: the server's number is stored and returned", async () => {
    const { env, db } = makeEnv();
    const res = await onRequestPost({
      request: postReq({
        email: "cheat@example.com",
        displayName: "Cheat",
        line: SEAT_LINE,
        chips: 999999,
      }),
      env,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, attempt: 1, chips: REPLAY.chips, name: "Cheat" });
    const rows = storedRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.chips).toBe(REPLAY.chips);
    expect(rows[0]!.chips).not.toBe(999999);
  });

  test("the row keeps the line and the decisions playSeat returned", async () => {
    // The Context: `decisions` is stored as JSON from `playSeat`, and it is
    // what the GET's histogram is aggregated from. This is the seam between
    // the two verbs, so the exam pins it against playSeat's own return.
    const { env, db } = makeEnv();
    await onRequestPost({
      request: postReq({ email: "alice.tester@example.com", displayName: "Tester", line: SEAT_LINE }),
      env,
    });
    const row = storedRows(db)[0]!;
    expect(JSON.parse(row.line)).toEqual(REPLAY.line);
    expect(JSON.parse(row.decisions)).toEqual(REPLAY.decisions);
  });
});

// --- leg (b) ---------------------------------------------------------------

describe("(b) POST refuses an unknown hand, a bad email and a line that will not replay [M2]", () => {
  test("a hand id the ASSETS fetch answers 404 for is a 404, and writes nothing", async () => {
    const { env, db } = makeEnv();
    const res = await onRequestPost({
      request: postReq(
        { email: "alice.tester@example.com", displayName: "Tester", line: SEAT_LINE },
        "2026-01-01-9",
      ),
      env,
    });
    expect(res.status).toBe(404);
    expect(storedRows(db)).toEqual([]);
  });

  test("a bad email is a 400, and writes nothing", async () => {
    const { env, db } = makeEnv();
    const res = await onRequestPost({
      request: postReq({ email: "nope", displayName: "Tester", line: SEAT_LINE }),
      env,
    });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(storedRows(db)).toEqual([]);
  });

  test("a line one action short is a 400 carrying the engine's own message, and writes nothing", async () => {
    const { env, db } = makeEnv();
    const res = await onRequestPost({
      request: postReq({
        email: "alice.tester@example.com",
        displayName: "Tester",
        line: SHORT_LINE,
      }),
      env,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    // SHORT_LINE_MESSAGE is what playSeat itself throws for this line:
    // "wwyhd: the line runs out while alice is still to act on the RIVER".
    expect(body.error).toContain(SHORT_LINE_MESSAGE);
    expect(storedRows(db)).toEqual([]);
  });
});

// --- leg (c) ---------------------------------------------------------------

describe("(c) ranked is the first attempt, on or before closes [M3]", () => {
  const submit = (env: unknown) =>
    onRequestPost({
      request: postReq({
        email: "alice.tester@example.com",
        displayName: "Tester",
        line: SEAT_LINE,
      }),
      env,
    });

  test("a first attempt on the closes date is ranked 1", async () => {
    const { env, db } = makeEnv({ now: CLOSES });
    await submit(env);
    const rows = storedRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[0]!.ranked).toBe(1);
  });

  test("a first attempt the day after closes is ranked 0", async () => {
    const { env, db } = makeEnv({ now: AFTER_CLOSES });
    await submit(env);
    const rows = storedRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[0]!.ranked).toBe(0);
  });

  test("a second attempt on the closes date is ranked 0", async () => {
    const { env, db } = makeEnv({ now: CLOSES });
    await submit(env);
    await submit(env);
    const rows = storedRows(db);
    expect(rows.length).toBe(2);
    expect(rows[0]!.ranked).toBe(1);
    expect(rows[1]!.attempt).toBe(2);
    expect(rows[1]!.ranked).toBe(0);
  });
});

// --- leg (d) ---------------------------------------------------------------
//
// The GET's three figures, over rows inserted straight into the table so the
// exam controls `ranked`, `chips` and `created_at` exactly. The decision keys
// are the real ones the engine produced for this hand (note 3 again: nothing
// here is a key this exam invented), so an implementation cannot pass by
// keying on anything but what `playSeat` stores.

const KEY_A = REPLAY.decisions[0]!.key;
const KEY_B = REPLAY.decisions[1]!.key;
const KEY_C = REPLAY.decisions[2]!.key;

type SeedRow = {
  email: string;
  name: string;
  chips: number;
  ranked: number;
  createdAt: string;
  decisions: { key: string; type: string }[];
};

function insertRow(db: Database, row: SeedRow) {
  db.query(
    `INSERT INTO wwyhd_results
       (hand_id, email, attempt, display_name, line, decisions, chips, ranked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    HAND_ID,
    row.email,
    1,
    row.name,
    JSON.stringify(SEAT_LINE),
    JSON.stringify(row.decisions),
    row.chips,
    row.ranked,
    row.createdAt,
  );
}

const at = (second: string) => `2026-09-25 10:00:${second}`;

/** The eleven ranked rows and two unranked ones, in the order they are
 *  inserted. The tied pair at 1800 is `Abe Abbott` (created_at :04, inserted
 *  first, first by email and by name) and `Zed Ziegler` (created_at :03,
 *  inserted second, last by email and by name), so `Zed` comes first on the
 *  leaderboard under the `created_at` tie break and under nothing else
 *  (note 5). Five ranked rows reach KEY_A, four reach KEY_B, two reach KEY_C,
 *  and the two UNRANKED rows also reach KEY_B: if a handler aggregated
 *  unranked rows, KEY_B would reach six and appear in `choices`, so its
 *  absence is the ranked-only filter. */
const SEED: SeedRow[] = [
  { email: "p01@example.com", name: "Player One", chips: 2000, ranked: 1, createdAt: at("01"), decisions: [{ key: KEY_A, type: "raise" }] },
  { email: "p02@example.com", name: "Player Two", chips: 1900, ranked: 1, createdAt: at("02"), decisions: [{ key: KEY_A, type: "raise" }] },
  { email: "a01@example.com", name: "Abe Abbott", chips: 1800, ranked: 1, createdAt: at("04"), decisions: [{ key: KEY_A, type: "raise" }] },
  { email: "z01@example.com", name: "Zed Ziegler", chips: 1800, ranked: 1, createdAt: at("03"), decisions: [{ key: KEY_A, type: "call" }] },
  { email: "p05@example.com", name: "Player Five", chips: 1700, ranked: 1, createdAt: at("05"), decisions: [{ key: KEY_A, type: "call" }] },
  { email: "p06@example.com", name: "Player Six", chips: 1600, ranked: 1, createdAt: at("06"), decisions: [{ key: KEY_B, type: "fold" }] },
  { email: "p07@example.com", name: "Player Seven", chips: 1500, ranked: 1, createdAt: at("07"), decisions: [{ key: KEY_B, type: "fold" }] },
  { email: "p08@example.com", name: "Player Eight", chips: 1400, ranked: 1, createdAt: at("08"), decisions: [{ key: KEY_B, type: "call" }] },
  { email: "p09@example.com", name: "Player Nine", chips: 1300, ranked: 1, createdAt: at("09"), decisions: [{ key: KEY_B, type: "call" }] },
  { email: "p10@example.com", name: "Player Ten", chips: 1200, ranked: 1, createdAt: at("10"), decisions: [{ key: KEY_C, type: "check" }] },
  { email: "p11@example.com", name: "Player Eleven", chips: 1100, ranked: 1, createdAt: at("11"), decisions: [{ key: KEY_C, type: "check" }] },
  { email: "r01@example.com", name: "Replay One", chips: 99999, ranked: 0, createdAt: at("12"), decisions: [{ key: KEY_B, type: "raise" }] },
  { email: "r02@example.com", name: "Replay Two", chips: 99999, ranked: 0, createdAt: at("13"), decisions: [{ key: KEY_B, type: "raise" }] },
];

/** The top ten of the eleven ranked rows: chips descending, the 1800 tie
 *  broken by the earlier `created_at`, and the 1100 row off the bottom. */
const EXPECTED_LEADERBOARD = [
  { name: "Player One", chips: 2000 },
  { name: "Player Two", chips: 1900 },
  { name: "Zed Ziegler", chips: 1800 },
  { name: "Abe Abbott", chips: 1800 },
  { name: "Player Five", chips: 1700 },
  { name: "Player Six", chips: 1600 },
  { name: "Player Seven", chips: 1500 },
  { name: "Player Eight", chips: 1400 },
  { name: "Player Nine", chips: 1300 },
  { name: "Player Ten", chips: 1200 },
];

function seededEnv() {
  const made = makeEnv();
  for (const row of SEED) insertRow(made.db, row);
  return made;
}

describe("(d) GET reads the ranked rows only [M4]", () => {
  test("the fixture's five-and-four split is MIN_SHARED and one below it", () => {
    // The leg's "five ranked rows sharing a decision key and four sharing
    // another" is MIN_SHARED and MIN_SHARED - 1. Stated here so a retune of
    // the constant fails with a sentence rather than a puzzle.
    expect(THRESHOLDS.MIN_SHARED).toBe(5);
  });

  test("count is the eleven ranked rows: the two unranked ones do not count", async () => {
    const { env } = seededEnv();
    const res = await onRequestGet({ request: getReq(), env });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(11);
  });

  test("leaderboard is the top ten by chips descending, ties broken by earlier created_at", async () => {
    const { env } = seededEnv();
    const res = await onRequestGet({ request: getReq(), env });
    const body = await res.json();
    expect(body.leaderboard).toEqual(EXPECTED_LEADERBOARD);
  });

  test("the unranked rows change neither, though their chips would top the board", async () => {
    const { env } = seededEnv();
    const body = await (await onRequestGet({ request: getReq(), env })).json();
    expect(body.count).toBe(11);
    expect(body.leaderboard).toEqual(EXPECTED_LEADERBOARD);
    expect(body.leaderboard.map((r: { chips: number }) => r.chips)).not.toContain(99999);
  });

  test("choices carries the key five ranked rows reached, with its per-type counts", async () => {
    const { env } = seededEnv();
    const body = await (await onRequestGet({ request: getReq(), env })).json();
    const counts = body.choices[KEY_A];
    expect(counts).toBeDefined();
    expect(counts.raise).toBe(3);
    expect(counts.call).toBe(2);
    // Sum over every type present: five rows reached this key and no sixth
    // count can hide in a type this assertion does not name (note 7).
    expect(
      (Object.values(counts) as number[]).reduce((total, n) => total + n, 0),
    ).toBe(5);
  });

  test("choices lacks the key only four ranked rows reached, and every other key", async () => {
    const { env } = seededEnv();
    const body = await (await onRequestGet({ request: getReq(), env })).json();
    expect(Object.keys(body.choices)).toEqual([KEY_A]);
    expect(KEY_B in body.choices).toBe(false);
    expect(KEY_C in body.choices).toBe(false);
  });
});

// --- leg (e) ---------------------------------------------------------------

describe("(e) no response body carries an email [M5]", () => {
  test("the GET body holds no @ though every stored email does", async () => {
    const { env, db } = seededEnv();
    // The premise: every row's email really does carry an @, so the absence
    // of one in the body is the boundary holding and not an empty table.
    const emails = storedRows(db).map((r) => r.email);
    expect(emails.length).toBe(SEED.length);
    expect(emails.every((e) => e.includes("@"))).toBe(true);

    const text = await (await onRequestGet({ request: getReq(), env })).text();
    expect(text).not.toContain("@");
  });

  test("the POST body holds no @ though the submitted email does", async () => {
    const { env } = makeEnv();
    const res = await onRequestPost({
      request: postReq({
        email: "alice.tester@example.com",
        displayName: "Tester",
        line: SEAT_LINE,
      }),
      env,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("@");
  });
});

// --- leg (f) ---------------------------------------------------------------

describe("(f) the display name is the roster handle, or the cleaned typed name [M6]", () => {
  const ROSTER: RosterRow[] = [{ email: "known@example.com", handle: "alice", slug: "alice" }];

  test("a roster email shows its handle on the leaderboard, not what they typed", async () => {
    const { env } = makeEnv({ roster: ROSTER });
    await onRequestPost({
      request: postReq({
        email: "known@example.com",
        displayName: "Some Other Name",
        line: SEAT_LINE,
      }),
      env,
    });
    const body = await (await onRequestGet({ request: getReq(), env })).json();
    expect(body.leaderboard).toEqual([{ name: "alice", chips: REPLAY.chips }]);
  });

  test("a stranger shows the name they typed, cleaned", async () => {
    // `cleanDisplayName` strips angle brackets and trims; "  <b>Newcomer</b>  "
    // is its documented worked case, so the expected string is its output.
    const { env } = makeEnv({ roster: ROSTER });
    await onRequestPost({
      request: postReq({
        email: "stranger@example.com",
        displayName: "  <b>Newcomer</b>  ",
        line: SEAT_LINE,
      }),
      env,
    });
    const body = await (await onRequestGet({ request: getReq(), env })).json();
    expect(body.leaderboard).toEqual([{ name: "bNewcomer/b", chips: REPLAY.chips }]);
  });

  test("both together: the handle for the known email, the cleaned name for the stranger", async () => {
    const { env } = makeEnv({ roster: ROSTER });
    for (const body of [
      { email: "known@example.com", displayName: "Some Other Name", line: SEAT_LINE },
      { email: "stranger@example.com", displayName: "  <b>Newcomer</b>  ", line: SEAT_LINE },
    ]) {
      await onRequestPost({ request: postReq(body), env });
    }
    const got = await (await onRequestGet({ request: getReq(), env })).json();
    expect(got.count).toBe(2);
    // Both rows replay to the same chips, so `created_at` breaks the tie and
    // the two may land either way round within the same second: the names are
    // compared as a set, which is what M6 is about.
    expect(got.leaderboard.map((r: { name: string }) => r.name).sort()).toEqual([
      "alice",
      "bNewcomer/b",
    ]);
    expect(got.leaderboard.every((r: { chips: number }) => r.chips === REPLAY.chips)).toBe(true);
  });
});

// --- leg (g) ---------------------------------------------------------------

describe("(g) site/schema.sql carries the wwyhd_results table [M7]", () => {
  test("the schema file declares the table with IF NOT EXISTS", () => {
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS wwyhd_results");
  });

  test("executing the schema builds exactly the nine columns M7 names", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA);
    const columns = db.query("PRAGMA table_info(wwyhd_results)").all() as {
      name: string;
      pk: number;
    }[];
    expect(columns.map((c) => c.name)).toEqual([
      "hand_id",
      "email",
      "attempt",
      "display_name",
      "line",
      "decisions",
      "chips",
      "ranked",
      "created_at",
    ]);
  });

  test("the primary key is hand_id, email, attempt in that order", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA);
    const columns = db.query("PRAGMA table_info(wwyhd_results)").all() as {
      name: string;
      pk: number;
    }[];
    // PRAGMA's `pk` is the 1-based position in the primary key, 0 for a column
    // outside it: one row per attempt per email per hand.
    const keyPositions = Object.fromEntries(columns.map((c) => [c.name, c.pk]));
    expect(keyPositions).toEqual({
      hand_id: 1,
      email: 2,
      attempt: 3,
      display_name: 0,
      line: 0,
      decisions: 0,
      chips: 0,
      ranked: 0,
      created_at: 0,
    });
  });
});
