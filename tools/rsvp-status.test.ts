// Tests for the RSVP/roster preflight (issue #26): the pure SQL builders and
// formatters in tools/lib/rsvp-status.ts, and the run() shell in
// tools/rsvp-status.ts driven through an in-memory deps recorder, so no real
// wrangler/D1 is ever in the loop. Fixture rows are synthetic (invented
// players only), per the privacy tiers: real roster rows never enter git.
import { describe, expect, test } from "bun:test";
import {
  countsSql,
  missingSql,
  formatCounts,
  formatMissing,
} from "./lib/rsvp-status";
import { run, type RsvpStatusDeps } from "./rsvp-status";

const GAME = "2026-09-08";

describe("countsSql", () => {
  test("counts roster rows and this game's rsvps in one query", () => {
    const sql = countsSql(GAME);
    expect(sql).toContain("FROM roster");
    expect(sql).toContain("FROM rsvps");
    expect(sql).toContain("'2026-09-08'");
  });
  test("escapes a quote in the game string rather than splicing it", () => {
    expect(countsSql("20'26")).toContain("'20''26'");
  });
});

describe("missingSql", () => {
  test("left-joins rsvps onto roster so un-RSVP'd rows survive", () => {
    const sql = missingSql(GAME);
    expect(sql).toContain("LEFT JOIN");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("'2026-09-08'");
  });
});

describe("formatCounts", () => {
  test("reports both counts on their own lines", () => {
    const out = formatCounts({ roster_n: 18, rsvps_n: 2 }, GAME);
    expect(out).toContain("roster: 18 rows");
    expect(out).toContain("rsvps for 2026-09-08: 2");
  });
  test("an empty roster gets a loud warning pointing at the seed", () => {
    const out = formatCounts({ roster_n: 0, rsvps_n: 2 }, GAME);
    expect(out).toContain("roster: 0 rows");
    expect(out).toContain("WARNING");
    expect(out).toContain("seed");
  });
  test("a seeded roster gets no warning", () => {
    expect(formatCounts({ roster_n: 18, rsvps_n: 0 }, GAME)).not.toContain("WARNING");
  });
});

describe("formatMissing", () => {
  test("empty roster refuses: an empty list must not read as everyone RSVP'd", () => {
    const out = formatMissing([], 0, GAME);
    expect(out).toContain("roster is empty");
    expect(out).not.toContain("everyone");
  });
  test("seeded roster with no missing rows says everyone has RSVP'd", () => {
    const out = formatMissing([], 18, GAME);
    expect(out).toContain("everyone");
  });
  test("missing rows list handle and email, one per line", () => {
    const out = formatMissing(
      [
        { handle: "gene", email: "gene@example.com" },
        { handle: "fern", email: "fern@example.com" },
      ],
      18,
      GAME
    );
    expect(out).toContain("gene  gene@example.com");
    expect(out).toContain("fern  fern@example.com");
    expect(out).toContain("2 of 18");
  });
});

// In-memory deps: records the SQL run() sends to d1 and the lines it prints.
function recorder(results: unknown[]) {
  const calls: string[] = [];
  const printed: string[] = [];
  const deps: RsvpStatusDeps = {
    d1: async (sql: string) => {
      calls.push(sql);
      return { results };
    },
    readGames: () => ({ nextGame: { date: GAME } }),
    print: (s: string) => printed.push(s),
  };
  return { calls, printed, deps };
}

describe("run", () => {
  test("default verb queries counts for nextGame and prints the report", async () => {
    const { calls, printed, deps } = recorder([{ roster_n: 0, rsvps_n: 2 }]);
    await run([], deps);
    expect(calls[0]).toContain("FROM roster");
    expect(calls[0]).toContain("'2026-09-08'");
    expect(printed.join("\n")).toContain("roster: 0 rows");
  });
  test("--missing runs both queries and refuses on an empty roster", async () => {
    const seen: string[] = [];
    const printed: string[] = [];
    const deps: RsvpStatusDeps = {
      d1: async (sql: string) => {
        seen.push(sql);
        // first call: counts; second call: missing rows
        return seen.length === 1
          ? { results: [{ roster_n: 0, rsvps_n: 0 }] }
          : { results: [] };
      },
      readGames: () => ({ nextGame: { date: GAME } }),
      print: (s: string) => printed.push(s),
    };
    await run(["--missing"], deps);
    expect(printed.join("\n")).toContain("roster is empty");
  });
  test("--game overrides the games.json date", async () => {
    const { calls, deps } = recorder([{ roster_n: 1, rsvps_n: 0 }]);
    await run(["--game", "2026-10-13"], deps);
    expect(calls[0]).toContain("'2026-10-13'");
  });
  test("a malformed --game date halts before any query", async () => {
    const { calls, deps } = recorder([]);
    await expect(run(["--game", "next-tuesday"], deps)).rejects.toThrow(/YYYY-MM-DD/);
    expect(calls.length).toBe(0);
  });
});
