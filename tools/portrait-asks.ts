// Stages Charlie's candidates/<set_slug>/ handoff (a manifest.json plus
// rendered <handle>/<variant>.png card renders) into the private
// poker-portraits R2 bucket and the portrait_asks / portrait_answers D1
// tables, then prints one consent link per staged player. Also fetches a
// player's self-uploaded panel back out of the bucket for the print step
// (--pull): unlike a staged crop, a self-upload only ever exists in R2, so
// the print flow needs a way to pull it back down. Sits in the monthly flow
// right after munger's ccg/stage-candidates.sh (Charlie's side) and before
// Mike sends any link to a player. Full runbook: the "Portrait consent"
// section of docs/publishing.md.
//
// Usage:
//   bun tools/portrait-asks.ts <candidates-dir> [--local]
//   bun tools/portrait-asks.ts --status [--set YYYY-MM] [--local]
//   bun tools/portrait-asks.ts --revoke <handle> --set YYYY-MM [--local]
//   bun tools/portrait-asks.ts --prune [--local]
//   bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM [--out <path>] [--local]
//
// --local runs every wrangler call against local dev state (`wrangler d1
// execute --local` / `wrangler r2 object ... --local`) instead of
// production, for rehearsal before touching anything real.

import { readFileSync, readdirSync } from "node:fs";
import { randomToken, toSqlUtc } from "../functions/api/_portrait.js";
import {
  knownHandles,
  validateCandidates,
  uploadPlan,
  askUpsertSql,
  revokeInsertSql,
  statusSql,
  formatStatusRows,
  pruneSelectSql,
  pruneKeys,
  linkFor,
  type CandidateSet,
} from "./lib/portraits";
import type { GamesData } from "./lib/standings";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

// Resolved against this file's own module URL, not the process cwd: Charlie
// (or a cron job, or a test) may invoke `bun tools/portrait-asks.ts` from
// anywhere, and a cwd-relative "site/data/games.json" throws ENOENT the
// moment the working directory isn't the repo root. Anchoring to
// import.meta.url makes the path absolute and correct regardless of where
// the process was launched from - the same pattern tools/*.test.ts already
// uses to reach site/ from tools/.
const GAMES_JSON_URL = new URL("../site/data/games.json", import.meta.url);

// The seam between the five verbs below and the outside world: wrangler
// subprocess calls, the current time, stdout, and the reads over the
// candidates directory and the committed roster. Every exported verb takes
// this object instead of touching Bun/process/fs directly, so bun test can
// exercise every branch - including the halt-before-any-side-effect ordering
// on a bad manifest - with an in-memory recorder and no real D1/R2/wrangler
// or filesystem in the loop.
//
// `r2get` exists only for `pull`: it is the one direction none of
// stage/status/revoke/prune ever needed - fetching a self-uploaded panel
// back OUT of the bucket, for the print step, into a local file.
//
// `readGames` is one field beyond the plan's originally enumerated deps
// shape (d1, r2put, r2delete, now, print, readDir, readManifest). It exists
// because validateCandidates needs a known-handles set drawn from the real
// roster (site/data/games.json), and that file's real committed rows are
// real players - exactly the fixture data the repo privacy rule (committed
// test fixtures are synthetic, invented players only) forbids a test from
// depending on. Without this field, exercising stage()'s handle-validation
// path in a test would mean either hardcoding a real player's handle into
// tools/portrait-asks.test.ts, or having stage() read the live file directly
// and hoping today's real roster happens to contain a usable fixture -
// both worse than adding one injectable read. Production wiring reads the
// real file (see realDeps below); it never writes it (games.json stays
// read-only for this feature, same as every other portrait tool).
export type PortraitDeps = {
  d1(sql: string): { results: any[]; changes: number } | Promise<{ results: any[]; changes: number }>;
  r2put(key: string, file: string): void | Promise<void>;
  r2delete(key: string): void | Promise<void>;
  r2get(key: string, outPath: string): void | Promise<void>;
  now(): Date;
  print(line: string): void;
  readDir(dir: string): string[];
  readManifest(dir: string): unknown;
  readGames(): GamesData;
};

// Validates Charlie's candidates/<dir> handoff, and only on a clean pass
// uploads every PNG, upserts one portrait_asks row per player (a fresh,
// unguessable token each run), and prints "<handle>  <link>" once per
// player. Throws (via validateCandidates) before a single r2put or d1 call
// when the manifest disagrees with the roster or the PNG directory: staging
// is all-or-nothing, never partial, so a bad handoff never leaves half a
// month's asks live. Expiry is 60 days from deps.now(); an ask that nobody
// answers simply goes stale and 404s (functions/api/_portrait.js isExpired).
export async function stage(dir: string, deps: PortraitDeps): Promise<void> {
  const manifest = deps.readManifest(dir);
  const pngRelPaths = deps.readDir(dir);
  const known = knownHandles(deps.readGames());
  const set: CandidateSet = validateCandidates(manifest, pngRelPaths, known);

  for (const { local, key } of uploadPlan(set)) {
    await deps.r2put(key, `${dir}/${local}`);
  }

  const createdAt = toSqlUtc(deps.now());
  const expiresAt = toSqlUtc(new Date(deps.now().getTime() + SIXTY_DAYS_MS));

  for (const player of set.players) {
    const token = randomToken();
    await deps.d1(
      askUpsertSql({
        token,
        handle: player.handle,
        setSlug: set.setSlug,
        variants: player.variants,
        metal: player.metal,
        createdAt,
        expiresAt,
      })
    );
    deps.print(`${player.handle}  ${linkFor(token)}`);
  }
}

// Prints one line per staged ask (formatStatusRows), optionally filtered to
// a single set. Read-only: never writes D1 or R2. Returns nothing; throws
// only if deps.d1 itself throws (a wrangler failure, surfaced verbatim so
// Charlie can debug from the stderr wrangler printed).
export async function status(opts: { set?: string }, deps: PortraitDeps): Promise<void> {
  const { results } = await deps.d1(statusSql(opts.set));
  deps.print(formatStatusRows(results));
}

// Appends a declined row for whichever ask currently exists for this handle
// and set. Throws when d1 reports zero rows changed: revoke never invents an
// ask to decline, so "no ask exists" must stop the run loudly rather than
// silently no-op, or Charlie could believe a photo was pulled when nothing
// was ever staged for that handle/set in the first place.
export async function revoke(handle: string, set: string, deps: PortraitDeps): Promise<void> {
  const nowStr = toSqlUtc(deps.now());
  const { changes } = await deps.d1(revokeInsertSql(handle, set, nowStr));
  if (changes === 0) {
    throw new Error(
      `no ask exists for handle "${handle}" in set ${set}; nothing to revoke (check the handle and --set)`
    );
  }
  deps.print(`revoked: ${handle} declined for ${set}`);
}

// Deletes the R2 objects backing every ask whose expires_at is now in the
// past (pruneSelectSql / pruneKeys). Deliberately leaves the portrait_asks /
// portrait_answers rows in D1 untouched - they are already inert (isExpired
// makes them 404 everywhere) and the answers ledger is append-only by design
// (spec s5), so this only ever removes the now-unreachable image bytes,
// never the consent history. Prints "nothing expired" and performs no
// deletes when the expired selection is empty.
//
// One deliberate exception to "delete everything expired": an expired ask
// whose CURRENT answer is approved/self keeps its self key. That panel
// exists nowhere but R2 (unlike a staged crop, which also sits in Charlie's
// candidates/ directory), so an automated sweep silently destroying it would
// destroy the only copy of art a player explicitly consented to - consented
// one-of-one art is never silently deletable (Mike, 2026-08-28; see
// pruneKeys' own comment for the full reasoning, including why a DECLINED
// self-upload does not get this protection). Each kept key is printed on its
// own line so Charlie sees it and can `wrangler r2 object delete` it by hand
// later if they are genuinely done with it.
export async function prune(deps: PortraitDeps): Promise<void> {
  const nowStr = toSqlUtc(deps.now());
  const { results } = await deps.d1(pruneSelectSql(nowStr));
  if (results.length === 0) {
    deps.print("nothing expired");
    return;
  }
  const { toDelete, toKeep } = pruneKeys(results);
  for (const key of toDelete) {
    await deps.r2delete(key);
  }
  for (const key of toKeep) {
    deps.print(
      `kept: ${key} (approved self panel; pull it for the print render, then delete it deliberately with wrangler if you are done with it)`
    );
  }
  deps.print(`pruned ${toDelete.length} portrait file(s) from ${results.length} expired ask(s)`);
}

// Fetches a player's self-uploaded panel back out of R2 for the print step.
// A staged crop already sits in Charlie's candidates/ directory, but a
// self-upload (functions/api/portrait/[token]/upload.js) only ever lives in
// the poker-portraits bucket, so the print flow needs a way to pull it back
// down onto disk. Resolves the current answer through statusSql - the exact
// same query and rowid-append-order resolution status uses (see statusSql's
// own comment for why answered_at can't be trusted here) - so this can never
// disagree with what `--status` or the consent page itself report as
// current. Writes to `out` if given, else `<handle>-self.png`.
//
// Throws (halt, never guess) when: no ask exists for this handle in this
// set; the latest answer is declined or not yet given; or the latest
// approval is a staged crop rather than a self-upload (that art is already
// on disk under candidates/, so pulling makes no sense and would silently
// overwrite the wrong thing). Also throws if deps.r2get itself throws (a
// wrangler failure, surfaced verbatim so Charlie can debug from wrangler's
// own stderr).
export async function pull(
  handle: string,
  set: string,
  out: string | undefined,
  deps: PortraitDeps
): Promise<void> {
  const { results } = await deps.d1(statusSql(set));
  const row = (results as { handle: string; answer: string | null; variant: string | null }[]).find(
    (r) => r.handle === handle
  );
  if (!row) {
    throw new Error(
      `no ask exists for handle "${handle}" in set ${set}; nothing to pull (check the handle and --set)`
    );
  }
  if (row.answer !== "approved") {
    throw new Error(
      row.answer === "declined"
        ? `${handle} declined for ${set}; nothing to pull`
        : `${handle} has not answered yet for ${set}; nothing to pull`
    );
  }
  if (row.variant !== "self") {
    throw new Error(
      `${handle}'s approved variant for ${set} is ${JSON.stringify(row.variant)}, a staged crop ` +
        "already on disk under candidates/; --pull only fetches a self-uploaded photo"
    );
  }

  const outPath = out ?? `${handle}-self.png`;
  await deps.r2get(`asks/${set}/${handle}/self.png`, outPath);
  deps.print(`pulled ${handle}'s self-upload panel to ${outPath}`);
}

// Builds the real (non-test) deps: every D1/R2 call shells out to wrangler
// with Bun.spawnSync, scoped to --local or --remote by the CLI's --local
// flag. A nonzero wrangler exit throws with wrangler's own stderr verbatim,
// on purpose: Charlie debugs a failed stage from that text, and inventing a
// friendlier message here would just hide the actual wrangler error.
function realDeps(local: boolean): PortraitDeps {
  const scope = local ? "--local" : "--remote";

  const run = (args: string[]): string => {
    const proc = Bun.spawnSync(["npx", "wrangler", ...args]);
    if (proc.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(proc.stderr) || `wrangler ${args.join(" ")} failed`);
    }
    return new TextDecoder().decode(proc.stdout);
  };

  return {
    d1(sql: string) {
      const stdout = run(["d1", "execute", "poker-rsvp-db", scope, "--json", "--command", sql]);
      const out = JSON.parse(stdout);
      const first = Array.isArray(out) ? out[0] : out;
      return { results: first?.results ?? [], changes: first?.meta?.changes ?? 0 };
    },
    r2put(key: string, file: string) {
      run(["r2", "object", "put", `poker-portraits/${key}`, "--file", file, "--content-type", "image/png", scope]);
    },
    r2delete(key: string) {
      run(["r2", "object", "delete", `poker-portraits/${key}`, scope]);
    },
    r2get(key: string, outPath: string) {
      run(["r2", "object", "get", `poker-portraits/${key}`, "--file", outPath, scope]);
    },
    now: () => new Date(),
    print: (line: string) => console.log(line),
    // One level of subdirectories under dir (each named for a handle),
    // returning "<handle>/<file>.png" relative paths - the shape
    // validateCandidates and uploadPlan both expect.
    readDir(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const file of readdirSync(`${dir}/${entry.name}`)) {
          if (file.toLowerCase().endsWith(".png")) out.push(`${entry.name}/${file}`);
        }
      }
      return out;
    },
    readManifest(dir: string): unknown {
      return JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
    },
    // Read-only per this feature's global constraint: never written here.
    // Path is repo-relative via GAMES_JSON_URL (see above), not cwd-relative.
    readGames(): GamesData {
      return JSON.parse(readFileSync(GAMES_JSON_URL, "utf8"));
    },
  };
}

const USAGE = [
  "usage:",
  "  bun tools/portrait-asks.ts <candidates-dir> [--local]",
  "  bun tools/portrait-asks.ts --status [--set YYYY-MM] [--local]",
  "  bun tools/portrait-asks.ts --revoke <handle> --set YYYY-MM [--local]",
  "  bun tools/portrait-asks.ts --prune [--local]",
  "  bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM [--out <path>] [--local]",
].join("\n");

const KNOWN_FLAGS = new Set(["--local", "--status", "--set", "--revoke", "--prune", "--pull", "--out"]);

// CLI entry point: parses argv into one of the five verbs above and runs it
// against real (wrangler-backed) deps. An unknown flag or a missing required
// argument prints usage and exits 1 without attempting any wrangler call;
// a verb that throws (validation failure, revoke-with-no-ask, pull-with-
// nothing-to-pull, a wrangler error) prints that error's message and exits 1.
export async function main(argv: string[]): Promise<void> {
  for (const a of argv) {
    if (a.startsWith("--") && !KNOWN_FLAGS.has(a)) {
      console.error(`unknown flag: ${a}\n\n${USAGE}`);
      process.exit(1);
    }
  }

  const flagValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const local = argv.includes("--local");
  const deps = realDeps(local);

  try {
    if (argv.includes("--status")) {
      await status({ set: flagValue("--set") }, deps);
    } else if (argv.includes("--revoke")) {
      const handle = flagValue("--revoke");
      const set = flagValue("--set");
      if (!handle || !set) {
        console.error(USAGE);
        process.exit(1);
        return;
      }
      await revoke(handle, set, deps);
    } else if (argv.includes("--prune")) {
      await prune(deps);
    } else if (argv.includes("--pull")) {
      const handle = flagValue("--pull");
      const set = flagValue("--set");
      if (!handle || !set) {
        console.error(USAGE);
        process.exit(1);
        return;
      }
      await pull(handle, set, flagValue("--out"), deps);
    } else {
      const dir = argv.find((a) => !a.startsWith("--"));
      if (!dir) {
        console.error(USAGE);
        process.exit(1);
        return;
      }
      await stage(dir, deps);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
