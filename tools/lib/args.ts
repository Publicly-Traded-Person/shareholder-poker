// Command-line argument helpers shared by the publish tools
// (tools/publish-game.ts, tools/chip-race.ts). Both take N log paths as bare
// arguments followed by --flag value pairs, e.g.
//   bun tools/chip-race.ts t1.csv t2.csv --date 2026-09-08 --inject page.html
// A multi-table tournament exports one log per table, which is why the
// tools take a list rather than a single path (docs/publishing.md, step 1).

// The bare arguments, in order: every argument that is neither a --flag nor
// the value directly after one. Returns [] when only flags were given.
export function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) { i++; continue; }
    out.push(args[i]);
  }
  return out;
}

// The value after the named flag (e.g. flag(args, "--date")), or undefined
// when the flag is absent.
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
