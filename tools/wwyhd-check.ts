// `bun tools/wwyhd-check.ts <file.json> [file2.json ...]`: the command
// Charlie runs on a new "What Would You Have Done?" hand file before opening
// its PR (spec §5 step 3, docs/publishing.md). It validates each file against
// site/data/games.json and then replays the file's recorded line through the
// engine, so a file whose real line does not produce the log's stacks is
// caught at the desk rather than on the live site.
//
// Where it sits in the publish flow: after step 2 (writing the file), before
// step 4 (the PR). The same two functions run inside `bun test tools` over
// every committed file, so passing here and passing the suite mean the same
// thing.
//
// Output: one `ok <id>` line per file on stdout, in the order given. Exit 0
// when every file passes, 1 with the reason on stderr at the FIRST file that
// does not (the `ok` lines already printed say how far it got), and 2 with a
// usage line when no files were named. Two failure codes rather than one
// because "you typed the command wrong" and "the file is wrong" are different
// problems and only the second one means stop and reread the log.
//
// It reads site/data/games.json relative to its own working directory, the
// same way tools/render.ts does, so it must be run from the repo root.

import { readFileSync } from "node:fs";
import { positionals } from "./lib/args";
import type { GamesData } from "./lib/standings";
import { checkHandFile, validateHandFile } from "./lib/wwyhd";

const USAGE = "usage: bun tools/wwyhd-check.ts <hand-file.json> [hand-file2.json ...]";

/**
 * The whole tool, as a function, so its exit codes are testable and so
 * nothing has to race a `process.exit` against a pipe that has not flushed.
 *
 * Takes the command-line arguments after the script name, and the two sinks
 * to print through (`process.stdout`/`process.stderr` in the real run).
 * Returns the exit code: 2 when no file was named, 1 at the first file that
 * fails to validate or to replay, 0 when every named file passed. Throws
 * nothing: every failure, including an unreadable games.json or unparseable
 * hand file, comes back as a printed reason and a code.
 *
 * Why it stops at the first bad file instead of reporting all of them: the
 * files are checked in the order given and each `ok` line is printed as it
 * passes, so the output already says exactly which file to open. A tool that
 * kept going would bury that line under the noise of a second file whose
 * problem is usually the same problem.
 */
export function main(argv: string[], out: (line: string) => void, err: (line: string) => void): number {
  const paths = positionals(argv);
  if (!paths.length) {
    err(USAGE);
    return 2;
  }

  let data: GamesData;
  try {
    data = JSON.parse(readFileSync("site/data/games.json", "utf8")) as GamesData;
  } catch (error) {
    err(`could not read site/data/games.json from ${process.cwd()}: ${(error as Error).message}`);
    return 1;
  }

  for (const path of paths) {
    try {
      const hand = validateHandFile(JSON.parse(readFileSync(path, "utf8")), data);
      checkHandFile(hand);
      out(`ok ${hand.id}`);
    } catch (error) {
      err(`${path}: ${(error as Error).message}`);
      return 1;
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(
    process.argv.slice(2),
    (line) => console.log(line),
    (line) => console.error(line),
  );
}
