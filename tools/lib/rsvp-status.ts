// SQL builders and formatters for the RSVP/roster preflight
// (tools/rsvp-status.ts). Pure functions only: no wrangler, no filesystem,
// no clock, so bun test can exercise every branch with synthetic rows.
// Sits in the monthly flow at beat 2 of the RSVP routine (who has not
// RSVP'd yet), and in the runbook preflight (docs/publishing.md).
//
// Why this exists at all (issue #26): the roster table is seeded by hand
// from a gitignored file, because emails never enter git. That privacy rule
// also means no test or drift check can see whether the table has rows, so
// it sat empty for two weeks while every page rendered fine. These
// functions cannot check the live table either; what they CAN do is make
// the empty-roster state loud everywhere it would otherwise be silent.

import { sq } from "./portraits";

// One row back from countsSql. Loosely typed for the same reason the
// portraits status row is: it crosses the wrangler JSON boundary.
export type CountsRow = { roster_n: number; rsvps_n: number };
export type MissingRow = { handle: string; email: string };

// Builds the one-query counts probe: total roster rows plus RSVP rows for
// the given game (YYYY-MM-DD). Takes the game string, returns SQL. The game
// value goes through sq() even though callers validate it first: SQL
// escaping belongs to the layer that splices the string, not to a promise
// made somewhere else.
export function countsSql(game: string): string {
  return (
    `SELECT (SELECT COUNT(*) FROM roster) AS roster_n, ` +
    `(SELECT COUNT(*) FROM rsvps WHERE game = ${sq(game)}) AS rsvps_n`
  );
}

// Builds the who-has-not-RSVP'd query for a game: every roster row with no
// rsvps row for that game. LEFT JOIN with IS NULL, not NOT IN, so the roster
// side always survives; the join is on email because email is the roster's
// primary key and the rsvps upsert key.
export function missingSql(game: string): string {
  return (
    `SELECT r.handle, r.email FROM roster r ` +
    `LEFT JOIN rsvps v ON v.email = r.email AND v.game = ${sq(game)} ` +
    `WHERE v.email IS NULL ORDER BY r.handle`
  );
}

// Formats the counts report. Takes the counts row and the game date, returns
// the printable report. A zero-row roster gets a WARNING block naming the
// seed procedure, because zero is the silent-failure state issue #26 is
// about: handle resolution and the missing-RSVP query both no-op on it.
export function formatCounts(row: CountsRow, game: string): string {
  const lines = [`roster: ${row.roster_n} rows`, `rsvps for ${game}: ${row.rsvps_n}`];
  if (row.roster_n === 0) {
    lines.push(
      "",
      "WARNING: the roster table is EMPTY. RSVP handle resolution and the",
      "--missing query both silently do nothing until it is seeded:",
      "  wrangler d1 execute poker-rsvp-db --remote --file <gitignored-seed.sql>",
      "Player list + seed procedure: K5M/Charlie/Poker/Poker Roster.md (issue #26)."
    );
  }
  return lines.join("\n");
}

// Formats the missing-RSVP list. Takes the missing rows, the roster count
// (from countsSql, run first), and the game date. Three states, and the
// order of the checks is the point:
//   roster empty  -> refuse. An empty result from an empty roster is
//                    indistinguishable from "everyone RSVP'd", which is the
//                    exact trap this tool exists to close. Never print a
//                    clean answer from meaningless input.
//   no rows       -> everyone on the roster has RSVP'd.
//   rows          -> one "handle  email" line each. Emails go to stdout by
//                    design (exports go to stdout, never to files in the
//                    repo; see site/schema.sql).
export function formatMissing(rows: MissingRow[], rosterN: number, game: string): string {
  if (rosterN === 0) {
    return (
      "cannot answer: the roster is empty, so an empty result means nothing.\n" +
      "Seed the roster first (see issue #26), then re-run."
    );
  }
  if (rows.length === 0) {
    return `everyone on the roster (${rosterN}) has RSVP'd for ${game}.`;
  }
  const list = rows.map((r) => `${r.handle}  ${r.email}`).join("\n");
  return `${rows.length} of ${rosterN} have not RSVP'd for ${game}:\n${list}`;
}
