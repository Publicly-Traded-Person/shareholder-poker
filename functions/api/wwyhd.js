// The "What Would You Have Done?" endpoint (spec section 4.5). POST records one
// attempt at a weekly hand puzzle and re-runs the engine server-side on the
// submitted line; GET returns the puzzle's leaderboard and the share-of-visitors
// breakdown. Served at /api/wwyhd on poker.kmikeym.com, with the puzzle's id in
// the `hand` query parameter on both verbs, exactly as `game` rides on
// functions/api/rsvp.js. One file, no bracketed dynamic segment.
//
// Where it sits in the flow: Charlie commits a hand file to
// site/data/wwyhd/<hand_id>.json, the page (site/wwyhd.js) drives the same
// engine in the visitor's browser, and this Function is the only writer of the
// wwyhd_results table in the D1 database poker-rsvp-db (DDL in site/schema.sql).
// Its exam is tools/wwyhd-api.test.ts; run it with `bun test tools`.
//
// The two promises this file keeps:
//
//   1. THE SCORE IS THE SERVER'S. Every POST replays the submitted line through
//      the same pure engine the browser ran and stores ITS chip count. A `chips`
//      field in the request body is read by nothing here. That is the whole
//      anti-cheat and it costs one function call.
//   2. NO RESPONSE EVER CARRIES AN EMAIL. Same boundary as RSVP (spec section 3),
//      same test. The GET selects display names, never the email column; the POST
//      echoes back only the attempt number and the chips.
//
// The engine and the rule table are imported straight out of site/ as relative
// ES modules. That works because both are plain modules with no Node or Bun API
// in them: a `wrangler pages dev` probe on 2026-09-20 returned a computed value
// from a Function importing ../../site/engine.js, so the import bundles.
import { validEmail, cleanDisplayName } from "./_lib.js";
import { playSeat } from "../../site/wwyhd-engine.js";
import { decide, THRESHOLDS } from "../../site/wwyhd-rules.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// A hand id is a game date and a hand number within it: '2026-09-08-1'. Anything
// else (a missing parameter included) is a 404 BEFORE any asset fetch, so a
// probe for a path-ish id never reaches the asset binding at all.
const HAND_RE = /^\d{4}-\d{2}-\d{2}-\d+$/;

// How many names the leaderboard shows (spec section 4.5).
const LEADERBOARD_SIZE = 10;

// The fallback display name, as in rsvp.js: display_name is NOT NULL and a
// visitor whose name cleans away to nothing still has to be called something.
const ANONYMOUS = "player";

/**
 * The name this player appears under on the leaderboard.
 *
 * Takes the email, the name they typed, and the roster rows. Returns, in
 * order: what they typed once cleaned, else their roster handle, else the
 * part of their email before the @. Never the whole email. Throws nothing.
 *
 * WHAT THEY TYPED WINS. This deliberately differs from RSVP's
 * `resolveDisplay`, where the roster handle beats the typed name: an RSVP
 * list answers "who is coming" and the handle is how the room knows each
 * other, while this is a field labelled Display name on a leaderboard, and a
 * field that ignores what you put in it is a lie. Mike typed "Mike" on
 * 2026-09-21 and the board showed "kmikeym".
 *
 * The roster is still the fallback, so a regular who leaves the field empty
 * shows as the handle everyone knows rather than an email fragment.
 */
function displayNameFor(email, typed, rosterRows) {
  const cleaned = cleanDisplayName(typed);
  if (cleaned) return cleaned;
  const hit = rosterRows.find((r) => String(r.email).toLowerCase() === String(email).toLowerCase());
  if (hit && hit.handle) return hit.handle;
  return cleanDisplayName(String(email).split("@")[0]);
}

/**
 * The D1 database this endpoint writes to.
 *
 * Takes the Function's `env`. Returns the D1 binding, which in production is
 * `POKER_RSVP_DB`: wwyhd_results lives in the same database as rsvps and roster
 * because the roster read that resolves a display name is the same read RSVP
 * does. Throws nothing; returns undefined when nothing is bound, and the caller
 * then fails on the first `prepare`, which is the loud failure we want in a
 * deploy with a missing binding.
 *
 * The fallback scan exists so a harness can bind a D1-shaped adapter under any
 * name; production always hits the first branch.
 */
function dbOf(env) {
  if (env?.POKER_RSVP_DB) return env.POKER_RSVP_DB;
  for (const value of Object.values(env ?? {})) {
    if (value && typeof value.prepare === "function") return value;
  }
  return undefined;
}

/**
 * Today's date in UTC as 'YYYY-MM-DD', or the date a test injected.
 *
 * Takes the Function's `env`. Returns a ten-character date string. Throws
 * nothing.
 *
 * `WWYHD_NOW` is read ONLY when the key is present, so production, which binds
 * no such variable, always reads the real clock. It exists because whether an
 * attempt ranks depends on a date, and a test that cannot say what day it is
 * cannot test the day after `closes` without waiting for it. The clock lives
 * here and nowhere near site/wwyhd-*.js: the puzzle itself must be
 * deterministic, and the suite greps those files for exactly this call.
 */
function todayUtc(env) {
  const injected = env?.WWYHD_NOW;
  if (injected != null && injected !== "") return String(injected).slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * The hand file for a hand id, read through the Pages static asset binding.
 *
 * Takes the request (for its origin), the `env` and the validated hand id.
 * Returns the parsed hand file, or null when the asset is not there. Throws
 * nothing: a fetch that is not ok and a body that is not JSON both come back as
 * null, and the caller turns that into a 404.
 *
 * Reading the committed asset IS the whole hand-id validation (spec section
 * 4.5): there is no second list of ids to keep in step with site/data/wwyhd/,
 * so a puzzle exists exactly when its file does.
 */
async function loadHand(request, env, handId) {
  const url = new URL("/data/wwyhd/" + handId + ".json", request.url);
  const res = await env.ASSETS.fetch(url);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * A `decide(view)` callback that answers for every seat but the visitor's.
 *
 * Takes the parsed hand file. Returns the callback `playSeat` wants: it looks
 * the acting player's profile up in the file and runs the rule table
 * (site/wwyhd-rules.js) on it. Throws nothing itself; the rule table throws on a
 * holding it refuses, and the caller catches that as a bad line.
 *
 * A seat the file gives no profile falls back to an empty one rather than
 * crashing the Worker, because the rule table reads a missing percentage as its
 * loosest reading. The visitor's own seat has `profile: null` by the spec, but
 * this is never called for it: `playSeat` takes the submitted line there.
 */
function opponentDecider(hand) {
  const players = Array.isArray(hand?.players) ? hand.players : [];
  return (view) => {
    const player = players.find((seat) => seat.handle === view.handle);
    return decide(view, player?.profile ?? {});
  };
}

/**
 * How many chips the submitted line is actually worth.
 *
 * Takes the hand file and the seat's line as `{street, type, amount}` in order.
 * Returns `{chips, line, decisions}` from the engine's own `playSeat`, or
 * `{error}` carrying the engine's message when the line does not replay. Throws
 * nothing: every failure here is a visitor's bad submit, not a server fault, and
 * the caller answers 400 with the message so the page can say what went wrong.
 *
 * The engine's number is the one that is stored. Never the client's: a line that
 * claims a score it does not replay to is just a line that replays to something
 * else.
 */
function replaySubmission(hand, line) {
  if (!Array.isArray(line)) return { error: "the line must be a list of actions" };
  try {
    return playSeat(hand, line, opponentDecider(hand));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The share-of-visitors breakdown for a puzzle.
 *
 * Takes the `decisions` column of every ranked row, already parsed into arrays
 * of `{key, type}`. Returns a map from decision key to per-type counts
 * (`{fold: n, call: n, raise: n}`, only the types that actually occurred),
 * carrying ONLY the keys at least `THRESHOLDS.MIN_SHARED` rows reached. Throws
 * nothing.
 *
 * The floor is why this is not a plain tally: after the first deviation two
 * visitors are in different hands, so a key deep in the tree is reached by a
 * handful of people and a percentage over four of them is noise wearing a
 * percent sign (spec section 4.4). The number comes from the rule table so the
 * page that renders the histogram and the Function that computes it cannot
 * disagree about where the floor is.
 *
 * A key is counted ONCE per row even if a row somehow lists it twice, because
 * the threshold is "reached by this many ranked rows", not "seen this often".
 */
function tallyChoices(rowDecisions) {
  const counts = new Map(); // key -> Map(type -> n)
  const reachedBy = new Map(); // key -> how many rows reached it
  for (const decisions of rowDecisions) {
    if (!Array.isArray(decisions)) continue;
    const seenInRow = new Set();
    for (const decision of decisions) {
      const key = decision?.key;
      const type = decision?.type;
      if (typeof key !== "string" || typeof type !== "string") continue;
      if (!counts.has(key)) counts.set(key, new Map());
      const byType = counts.get(key);
      byType.set(type, (byType.get(type) ?? 0) + 1);
      if (!seenInRow.has(key)) {
        seenInRow.add(key);
        reachedBy.set(key, (reachedBy.get(key) ?? 0) + 1);
      }
    }
  }

  const choices = {};
  for (const [key, byType] of counts) {
    if ((reachedBy.get(key) ?? 0) < THRESHOLDS.MIN_SHARED) continue;
    choices[key] = Object.fromEntries(byType);
  }
  return choices;
}

/** The stored `decisions` JSON, or an empty list when a row's column will not
 *  parse. A single unreadable row must not take the whole histogram down. */
function parseDecisions(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/wwyhd?hand=<hand_id>: the public result of one puzzle.
 *
 * Takes the Pages Function context. Returns a JSON response
 * `{count, leaderboard, choices}` built from the puzzle's `ranked = 1` rows
 * only: `count` how many there are, `leaderboard` the top ten as `{name, chips}`
 * by chips descending and, on a tie, by the earlier `created_at`, and `choices`
 * the share-of-visitors map above. Responds 404 on a hand id that is not a hand
 * id. Throws only what the database throws.
 *
 * Replays (`attempt` 2 and up) and attempts after `closes` carry `ranked` 0 and
 * are invisible here: they are kept so a visitor can see their own history, and
 * they rank nowhere (spec section 4.5).
 *
 * THIS BODY NEVER CONTAINS AN EMAIL. The query selects display_name and chips;
 * the email column is not read on this path at all. That is the privacy boundary
 * (spec section 3), not a style choice, and it is what the exam asserts by
 * looking for an '@' in the whole body.
 *
 * It deliberately does NOT read the hand file: the id shape is checked, and
 * whether a puzzle's asset is still published has no bearing on the results
 * already recorded for it.
 */
export async function onRequestGet({ request, env }) {
  const handId = new URL(request.url).searchParams.get("hand") || "";
  if (!HAND_RE.test(handId)) return json({ error: "no such hand" }, 404);

  const db = dbOf(env);
  const { results } = await db
    .prepare(
      `SELECT display_name, chips FROM wwyhd_results
       WHERE hand_id = ? AND ranked = 1
       ORDER BY chips DESC, created_at ASC`,
    )
    .bind(handId)
    .all();
  const rows = results ?? [];

  const { results: decisionRows } = await db
    .prepare("SELECT decisions FROM wwyhd_results WHERE hand_id = ? AND ranked = 1")
    .bind(handId)
    .all();

  return json({
    count: rows.length,
    leaderboard: rows
      .slice(0, LEADERBOARD_SIZE)
      .map((row) => ({ name: row.display_name, chips: row.chips })),
    choices: tallyChoices((decisionRows ?? []).map((row) => parseDecisions(row.decisions))),
  });
}

/**
 * POST /api/wwyhd?hand=<hand_id>: record one attempt at a puzzle.
 *
 * Takes the Pages Function context; the body is `{email, displayName, line}`.
 * Returns `{ok: true, attempt, chips, name}` on success, with `attempt` one more
 * than that email's highest for this hand, `chips` the server's own replay of
 * `line`, and `name` the display name that was stored (never the email). Responds 404 on a hand id that is not a hand id or whose asset is not
 * there, and 400 on an unparseable body, an email that is not an email, or a
 * line that does not replay (with the engine's own message in `error`, because
 * the page shows it and "something went wrong" would send nobody anywhere).
 * Throws only what the database throws.
 *
 * `ranked` is decided here and stored, not derived on read: 1 only when this is
 * the first attempt AND the submit's UTC date is on or before the hand file's
 * `closes`. The first go is the one that counts, and the page says so once.
 *
 * Nothing stops a visitor submitting under someone else's email; RSVP has the
 * same property and v1 does not design against it (spec section 2).
 */
export async function onRequestPost({ request, env }) {
  // The id rides in the query, as `game` does for RSVP. A body that also names
  // it is honoured only when the query does not, so one shape is canonical and
  // the other cannot contradict it.
  let body;
  let parsed = true;
  try {
    body = await request.json();
  } catch {
    parsed = false;
  }
  const handId = new URL(request.url).searchParams.get("hand") || String(body?.hand ?? "");
  if (!HAND_RE.test(handId)) return json({ error: "no such hand" }, 404);
  if (!parsed) return json({ error: "bad body" }, 400);

  const { email, displayName, line } = body || {};
  if (!validEmail(email)) return json({ error: "That email does not look right." }, 400);

  const hand = await loadHand(request, env, handId);
  if (!hand) return json({ error: "no such hand" }, 404);

  const played = replaySubmission(hand, line);
  if (played.error) return json({ error: played.error }, 400);

  const db = dbOf(env);
  const key = email.toLowerCase();

  const { results: roster } = await db.prepare("SELECT email, handle FROM roster").all();
  const display = displayNameFor(email, displayName, roster ?? []);

  // One more than this email's highest attempt at this hand, so the first submit
  // is 1 and nothing is ever overwritten.
  const previous = await db
    .prepare("SELECT COALESCE(MAX(attempt), 0) AS high FROM wwyhd_results WHERE hand_id = ? AND email = ?")
    .bind(handId, key)
    .first();
  const attempt = 1 + Number(previous?.high ?? 0);

  // Both dates are 'YYYY-MM-DD', which compares correctly as text. `closes` in
  // the hand file is the only source of truth for when a puzzle stops ranking;
  // nothing here infers it from the next puzzle's `opens` (spec section 4.1).
  // A file that names no `closes` has nothing to be after, so it never stops
  // ranking; only a date the submit is past takes the rank away.
  const closes = typeof hand.closes === "string" ? hand.closes : "";
  const onTime = closes === "" || todayUtc(env) <= closes;
  const ranked = attempt === 1 && onTime ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO wwyhd_results
         (hand_id, email, attempt, display_name, line, decisions, chips, ranked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      handId,
      key,
      attempt,
      cleanDisplayName(display) || ANONYMOUS,
      JSON.stringify(played.line),
      JSON.stringify(played.decisions),
      played.chips,
      ranked,
    )
    .run();

  // `name` is the display name as stored (a roster handle, or what they typed,
  // cleaned), never the email: the page uses it to find the visitor's own row
  // on the leaderboard instead of printing a second "You" row under it.
  return json({ ok: true, attempt, chips: played.chips, name: cleanDisplayName(display) || ANONYMOUS });
}
