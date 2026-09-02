// The one wrangler subprocess wrapper shared by tools/portrait-asks.ts and
// tools/rsvp-status.ts (issue #34). Every D1 and R2 call either tool makes
// goes through runWrangler(), so the retry-once rule below applies to both
// and to any future tool that adopts it. Sits underneath the monthly flow
// rather than in it: nothing in docs/publishing.md invokes this directly.
//
// Why it exists (issue #34): three times on 2026-09-01 and 09-02, across
// both tools, wrangler exited nonzero with NOTHING on stderr and an
// immediate rerun succeeded. Each time the wrapper of the day printed only
// "wrangler ... failed", which gave Charlie no way to tell "hiccup, run it
// again" from "something is actually wrong". The rule here is narrow on
// purpose: a nonzero exit WITH stderr text is a real error (bad SQL, missing
// binding, expired login) and is thrown verbatim, first try, because
// wrangler's own words are what Charlie debugs from. Only a nonzero exit
// with EMPTY stderr is treated as transient and retried, exactly once.
//
// Run: never directly. bun test tools/lib/wrangler.test.ts exercises it.

// What one subprocess run produced. Kept as a plain object so the tests can
// script results without a real process in the loop.
export type SpawnResult = { exitCode: number; stdout: string; stderr: string };

// The seam to the outside world: how to spawn a process and where to say
// "retrying". Tools pass realWranglerDeps() (below); tests pass a recorder.
export type WranglerDeps = {
  spawn: (argv: string[]) => SpawnResult;
  warn: (line: string) => void;
};

// Runs `npx wrangler <args>` once, or twice if the first run failed silently.
// Takes the wrangler arguments (without "npx wrangler") and the deps;
// returns the successful run's stdout. Throws with wrangler's stderr
// verbatim on a real error (nonzero exit, stderr non-empty) without
// retrying. On a silent failure (nonzero exit, stderr empty) it warns via
// deps.warn and runs the same command one more time.
//
// The retry lives here, around ONE subprocess call, and never around a whole
// verb: rerunning all of `--stage-upload-only` after a half-applied batch
// would mint duplicate tokens, whereas rerunning one `d1 execute` that
// produced no output is safe (D1 applies a --command as one atomic batch, so
// it either landed, in which case the upsert is a no-op, or it did not).
export function runWrangler(args: string[], deps: WranglerDeps): string {
  const argv = ["npx", "wrangler", ...args];

  const first = deps.spawn(argv);
  if (first.exitCode === 0) return first.stdout;
  if (first.stderr.trim() !== "") throw new Error(first.stderr);

  deps.warn(`wrangler exited ${first.exitCode} with no output; retrying once`);
  const second = deps.spawn(argv);
  if (second.exitCode === 0) return second.stdout;
  throw new Error(
    `wrangler ${args.join(" ")} failed twice.\n` +
    `${describeAttempt(1, first)}\n${describeAttempt(2, second)}`
  );
}

// One line per attempt for the failed-twice message: exit code plus whatever
// the process actually said. stderr wins when present; otherwise the stdout
// tail, because in --json mode wrangler tends to report its error as JSON
// on STDOUT with stderr empty, which is very likely why the failures that
// prompted #34 looked silent. "no output" is spelled out so a blank attempt
// reads as a fact rather than a formatting accident.
function describeAttempt(n: number, r: SpawnResult): string {
  const said = r.stderr.trim() || r.stdout.trim();
  if (said === "") return `attempt ${n}: exit ${r.exitCode}, no output`;
  return `attempt ${n}: exit ${r.exitCode}\n${tail(said)}`;
}

// Last TAIL_LINES lines of a block of text, with a "..." marker when
// anything was dropped. A failed d1 execute can echo a whole result set;
// Charlie needs the error line at the bottom, not the scrollback.
const TAIL_LINES = 8;
function tail(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= TAIL_LINES) return text;
  return `...\n${lines.slice(-TAIL_LINES).join("\n")}`;
}

// The real deps: Bun.spawnSync for the process, stderr for the "retrying"
// line (stdout is reserved for each tool's report, and --status output is
// sometimes pasted into an issue). Takes nothing, returns a WranglerDeps.
// Kept as a function rather than a module-level constant so that importing
// this file never spawns anything: the tests import runWrangler and script
// their own spawn.
export function realWranglerDeps(): WranglerDeps {
  return {
    spawn: (argv) => {
      const proc = Bun.spawnSync(argv);
      const decode = (b: Uint8Array) => new TextDecoder().decode(b);
      return { exitCode: proc.exitCode, stdout: decode(proc.stdout), stderr: decode(proc.stderr) };
    },
    warn: (line) => console.error(line),
  };
}
