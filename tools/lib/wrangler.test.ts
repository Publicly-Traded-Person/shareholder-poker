// Tests for tools/lib/wrangler.ts, the one wrangler subprocess wrapper both
// CLI tools share (issue #34). Every test injects a scripted spawn, so the
// suite never runs the real wrangler: what is under test is the
// retry-once decision and the error text Charlie would see, not wrangler.
//
// Run: bun test tools/lib/wrangler.test.ts

import { describe, expect, test } from "bun:test";
import { runWrangler, realWranglerDeps, type WranglerDeps, type SpawnResult } from "./wrangler";

// A spawn that returns the scripted results in order and records every
// argv it was handed, so a test can assert both what ran and how often.
function scripted(results: SpawnResult[]) {
  const calls: string[][] = [];
  const warnings: string[] = [];
  const deps: WranglerDeps = {
    spawn: (argv) => {
      calls.push(argv);
      const next = results.shift();
      if (!next) throw new Error(`spawn called more times than scripted (${calls.length})`);
      return next;
    },
    warn: (line) => warnings.push(line),
  };
  return { deps, calls, warnings };
}

const ok = (stdout: string): SpawnResult => ({ exitCode: 0, stdout, stderr: "" });

describe("runWrangler", () => {
  test("returns stdout on a clean exit, spawning npx wrangler exactly once", () => {
    const { deps, calls, warnings } = scripted([ok('[{"results":[]}]')]);

    const out = runWrangler(["d1", "execute", "poker-rsvp-db", "--remote"], deps);

    expect(out).toBe('[{"results":[]}]');
    expect(calls).toEqual([["npx", "wrangler", "d1", "execute", "poker-rsvp-db", "--remote"]]);
    expect(warnings).toEqual([]);
  });

  test("throws wrangler's own stderr verbatim on a nonzero exit with output, and does not retry", () => {
    const { deps, calls } = scripted([
      { exitCode: 1, stdout: "", stderr: "✘ [ERROR] no such table: nope" },
    ]);

    expect(() => runWrangler(["d1", "execute", "x"], deps)).toThrow("✘ [ERROR] no such table: nope");
    expect(calls.length).toBe(1);
  });

  test("retries once on a nonzero exit with empty stderr, says so, and returns the retry's stdout", () => {
    const { deps, calls, warnings } = scripted([
      { exitCode: 1, stdout: "", stderr: "" },
      ok("second time lucky"),
    ]);

    const out = runWrangler(["d1", "execute", "x"], deps);

    expect(out).toBe("second time lucky");
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/exited 1/);
    expect(warnings[0]).toMatch(/no output/);
    expect(warnings[0]).toMatch(/retrying once/);
  });
});

describe("runWrangler after two failures", () => {
  test("two silent failures throw the command, both exit codes, and both stdout tails", () => {
    // In --json mode wrangler tends to put its error on STDOUT as JSON, which
    // is the likeliest reason stderr was empty in the first place: so the
    // stdout tail is the actual evidence, not decoration.
    const { deps } = scripted([
      { exitCode: 1, stdout: '{"error":"first attempt said this"}', stderr: "" },
      { exitCode: 2, stdout: '{"error":"second attempt said that"}', stderr: "" },
    ]);

    let message = "";
    try {
      runWrangler(["d1", "execute", "poker-rsvp-db", "--remote"], deps);
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toMatch(/wrangler d1 execute poker-rsvp-db --remote/);
    expect(message).toMatch(/twice/);
    expect(message).toMatch(/attempt 1: exit 1/);
    expect(message).toMatch(/first attempt said this/);
    expect(message).toMatch(/attempt 2: exit 2/);
    expect(message).toMatch(/second attempt said that/);
  });

  test("a retry that fails with stderr surfaces that stderr, since it is now a real error", () => {
    const { deps } = scripted([
      { exitCode: 1, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "✘ [ERROR] Authentication error" },
    ]);

    expect(() => runWrangler(["d1", "execute", "x"], deps)).toThrow(/Authentication error/);
  });

  test("an attempt with nothing at all on either stream is reported as such, not as a blank line", () => {
    const { deps } = scripted([
      { exitCode: 1, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "   \n", stderr: "" },
    ]);

    expect(() => runWrangler(["r2", "object", "get", "k"], deps)).toThrow(/attempt 1: exit 1, no output/);
  });

  test("a long stdout is trimmed to its last lines so the message stays readable", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const { deps } = scripted([
      { exitCode: 1, stdout: lines.join("\n"), stderr: "" },
      { exitCode: 1, stdout: lines.join("\n"), stderr: "" },
    ]);

    let message = "";
    try {
      runWrangler(["d1", "execute", "x"], deps);
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toMatch(/line 40/);
    expect(message).not.toMatch(/line 1\n/);
    expect(message).toMatch(/\.\.\./);
  });
});

describe("realWranglerDeps", () => {
  // These run real processes, but harmless ones: the point is that the
  // exit code and both streams come back decoded the way runWrangler reads
  // them. Nothing here touches wrangler, D1, or R2.
  test("spawn returns exit code and decoded stdout for a clean command", () => {
    const r = realWranglerDeps().spawn(["echo", "hello from spawn"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello from spawn\n");
    expect(r.stderr).toBe("");
  });

  test("spawn returns a nonzero exit code and stderr text for a failing command", () => {
    const r = realWranglerDeps().spawn(["sh", "-c", "echo oops >&2; exit 3"]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toBe("oops\n");
  });
});
