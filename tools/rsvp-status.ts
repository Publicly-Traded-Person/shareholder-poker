// RSVP/roster preflight for the monthly routine (issue #26). Reports how
// many rows the roster and rsvps tables actually hold, and answers "who has
// not RSVP'd yet" for a game. Sits at beat 2 of the RSVP week (the
// individual-outreach pass needs the missing list) and in the runbook
// preflight (docs/publishing.md), because the roster is seeded by hand from
// a gitignored file and nothing else in the repo can see whether that ever
// happened.
//
// Usage:
//   bun tools/rsvp-status.ts                     # counts: roster rows, RSVPs for nextGame
//   bun tools/rsvp-status.ts --missing           # who has not RSVP'd for nextGame
//   bun tools/rsvp-status.ts --game 2026-10-13   # either verb, explicit game date
//   bun tools/rsvp-status.ts --local             # rehearse against local dev D1
//
// Output goes to stdout only. --missing prints emails; that is inside the
// privacy boundary (exports go to stdout, never to files in the repo; see
// site/schema.sql) but treat the terminal scrollback accordingly.

import { readFileSync } from "node:fs";
import {
  countsSql,
  missingSql,
  formatCounts,
  formatMissing,
  type CountsRow,
  type MissingRow,
} from "./lib/rsvp-status";
import { runWrangler, realWranglerDeps } from "./lib/wrangler";

// Anchored to this file's module URL, not the process cwd, so the tool works
// from any working directory - same pattern as tools/portrait-asks.ts.
const GAMES_JSON_URL = new URL("../site/data/games.json", import.meta.url);

// The seam to the outside world: one wrangler subprocess direction (d1),
// the games.json read, and stdout. run() takes this object instead of
// touching Bun/process directly so bun test can drive both verbs with an
// in-memory recorder and no real D1 in the loop.
export type RsvpStatusDeps = {
  d1: (sql: string) => Promise<{ results: unknown[] }>;
  readGames: () => { nextGame?: { date?: string } };
  print: (s: string) => void;
};

// Parses argv and runs one verb. Takes the argv tail (after the script
// path) and deps; prints the report. Throws on a malformed --game date
// BEFORE any query runs: a bad date would silently count RSVPs for a game
// that does not exist, which is the same shape of silent-zero this tool
// exists to prevent. With no --game, the date comes from games.json
// nextGame, the same source the live RSVP form uses, so the preflight and
// the form can never disagree about which game is being counted.
export async function run(argv: string[], deps: RsvpStatusDeps): Promise<void> {
  const missing = argv.includes("--missing");
  const gameIdx = argv.indexOf("--game");
  let game = gameIdx >= 0 ? argv[gameIdx + 1] : deps.readGames().nextGame?.date;
  if (!game || !/^\d{4}-\d{2}-\d{2}$/.test(game)) {
    throw new Error(`--game must be YYYY-MM-DD (got: ${game ?? "nothing"})`);
  }

  const counts = (await deps.d1(countsSql(game))).results[0] as CountsRow;
  if (!missing) {
    deps.print(formatCounts(counts, game));
    return;
  }
  // Counts run first even for --missing: formatMissing needs the roster
  // count to tell "everyone RSVP'd" apart from "the roster is empty".
  const rows =
    counts.roster_n === 0 ? [] : ((await deps.d1(missingSql(game))).results as MissingRow[]);
  deps.print(formatMissing(rows, counts.roster_n, game));
}

// Real deps: every d1 call shells out to wrangler against poker-rsvp-db
// (--remote by default; --local for rehearsal, matching portrait-asks)
// through the shared tools/lib/wrangler.ts wrapper, which retries a silent
// wrangler failure once and otherwise throws wrangler's own stderr (issue
// #34). Kept out of run() so the tests above the seam never spawn a process.
function realDeps(local: boolean): RsvpStatusDeps {
  const wrangler = realWranglerDeps();
  return {
    d1: async (sql: string) => {
      const out = runWrangler(
        ["d1", "execute", "poker-rsvp-db", local ? "--local" : "--remote", "--json", "--command", sql],
        wrangler
      );
      // wrangler --json prints an array of result objects, one per statement.
      const parsed = JSON.parse(out);
      return { results: parsed[0]?.results ?? [] };
    },
    readGames: () => JSON.parse(readFileSync(GAMES_JSON_URL, "utf8")),
    print: (s: string) => console.log(s),
  };
}

// Entry point guard, same as the other tools: only run as a script, never
// on import (the test file imports run() and must not touch wrangler).
if (import.meta.main) {
  const argv = process.argv.slice(2);
  run(argv.filter((a) => a !== "--local"), realDeps(argv.includes("--local"))).catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
