// The one place that says what `bun tools/render.ts` reads off disk, as a
// copy step: it seeds an empty temp tree with every INPUT the generator
// needs, so a render run pointed at that tree produces the same pages the
// committed site/ holds.
//
// Where it sits in the publish flow: beside the drift check, not on the
// publish path itself. tools/site.test.ts's "the generator, run into an
// empty directory" block spawns render.ts with a fresh `mkdtempSync`
// directory as its working directory and compares what comes out against
// what is committed. That comparison is only honest when the temp tree
// received EVERY input the real run has: a generator whose inputs grew by a
// directory (site/data/wwyhd/, the hand files behind the weekly puzzle)
// while the seeding step still copied two files by hand would render the
// puzzle pages into nothing and report the committed ones as drift.
//
// Why it is a module in tools/lib/ rather than a function inside the test
// file: the exam for this seeding step has to import it, and importing
// site.test.ts to reach a helper inside it would register that whole file's
// tests a second time.
//
// Run: never directly. `bun test tools` exercises it through the drift
// check, and through tools/wwyhd-pages.test.ts's own leg for it.
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The generator's two flat data files, both required: render.ts reads each
 *  one unconditionally and a missing one is a broken seed, not an empty
 *  render. Listed once so this module and its exam cannot drift apart. */
const DATA_FILES = ["games.json", "archive.json"] as const;

/** The one input directory. Absent at the moment this feature lands and
 *  present from the first committed puzzle onward, which is exactly why the
 *  copy below is conditional rather than assumed. */
const HANDS_DIR = "wwyhd";

/**
 * Copies the generator's inputs into a temp tree.
 *
 * Takes `tempRoot`, a directory that will become a render run's working
 * directory (it need not exist yet below itself: `site/data/` is created
 * here), and `siteDir`, the real `site/` directory the inputs are read
 * from. Returns nothing. Creates `tempRoot/site/data/games.json` and
 * `tempRoot/site/data/archive.json` always, and `tempRoot/site/data/wwyhd/`
 * with every file under it only when `siteDir/data/wwyhd/` exists. Throws
 * whatever `copyFileSync` throws when either data file is missing from
 * `siteDir/data/`, which is the loud failure a silently empty seed would
 * otherwise hide.
 *
 * Why the hand directory is conditional and the two files are not: at BASE
 * there is no site/data/wwyhd/ at all, and `cpSync` on a source that does
 * not exist throws. A seed that created an empty `wwyhd` directory anyway
 * would also be wrong in the other direction, because `loadHandFiles`
 * treats an absent directory and an empty one identically and a stray
 * directory in the temp tree is one more thing a reader has to rule out.
 *
 * Why it copies rather than symlinks: the render run must not be able to
 * write back through its inputs into the real site/, and a copy makes that
 * structurally impossible rather than merely unlikely.
 */
export function seedRenderInputs(tempRoot: string, siteDir: string): void {
  const dataDir = join(tempRoot, "site", "data");
  mkdirSync(dataDir, { recursive: true });
  for (const name of DATA_FILES) {
    copyFileSync(join(siteDir, "data", name), join(dataDir, name));
  }
  const hands = join(siteDir, "data", HANDS_DIR);
  if (existsSync(hands) && statSync(hands).isDirectory()) {
    cpSync(hands, join(dataDir, HANDS_DIR), { recursive: true });
  }
}
