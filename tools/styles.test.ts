// Guards on site/styles.css for the eleven classes task 2 of the
// player-pages/trophies/Hope Coin plan adds: a trophy case, a compact shelf
// of marks, a card gallery, and the Coin's route line (spec 2026-09-02 §4.3,
// §5, §7; docs/superpowers/plans/2026-09-02-player-pages-trophies-hope-coin.md
// task 2). Those eleven names are a contract with tasks 7, 8, and 9, which
// have not been written yet and emit the markup that reaches for them; this
// file is the only thing standing between "the name is spelled wrong" and
// that failing silently as dead CSS. Sits beside the one stylesheet-contrast
// block already in tools/site.test.ts (left where it is on purpose, per the
// task brief). Run: bun test tools.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CSS_PATH = new URL("../site/styles.css", import.meta.url).pathname;

// The eleven names task-2-brief.md fixes verbatim as the contract with the
// tasks that consume them. Do not add to, remove from, or respell this list
// without updating the brief and the tasks that read it.
const CLASSES = [
  "trophy-case",
  "trophy",
  "trophy--locked",
  "shelf",
  "shelf-more",
  "card-gallery",
  "route",
  "route-stop",
  "route-stop--current",
  "mark--shield",
  "mark--ribbon",
] as const;

// The six values M2 allows inside a fill: or stroke: declaration in any of
// the eleven blocks: the four -deep metals, --paper (the "hollow" fill a
// bead or an empty mark uses to show the line/stroke through it), and none.
// This is the exact contrast floor .mark--empty already keeps (see
// tools/site.test.ts's "styles.css keeps its own contrast promise" block) --
// the plain (non -deep) metals fail WCAG 1.4.11's 3:1 floor for graphical
// objects on the light bands, which is why that variant exists at all.
const ALLOWED_FILL_STROKE = new Set([
  "var(--foil-deep)",
  "var(--sapphire)",
  "var(--copper-deep)",
  "var(--pewter-deep)",
  "var(--paper)",
  "none",
]);

// Strips /* ... */ comments out of CSS text before any rule extraction runs.
// A class name written only inside a comment (leg b below) must never read
// as a real rule, so comments come out before rules() ever sees the text.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Splits (already comment-free) CSS text into its leaf-level rules --
// {selector, body} pairs whose body holds no nested braces. The regex only
// ever matches the innermost `{...}` on a given pass, so it walks straight
// through @media/@keyframes wrappers without parsing them as such: a rule
// nested inside `@media (min-width: 900px) { .foo { ... } }` comes out
// identically to a top-level `.foo { ... }`. Takes raw CSS text; returns
// every leaf rule in file order; throws nothing (an empty or rule-free
// string just yields an empty array).
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

// Escapes a class name for use inside a RegExp literal. The eleven names
// only ever contain letters and hyphens, but this guards the general case
// rather than assuming that stays true forever.
const escapeRe = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

// Every leaf rule (from `css`, already comment-free) whose selector list
// carries `cls` as a class token: a compound selector like ".trophy .mark"
// or ".trophy--locked p" counts, but a longer class never satisfies a
// shorter one's search (the lookahead stops the match at the next word or
// hyphen character, so ".trophy-case" can never stand in for "trophy").
// Takes the stylesheet text and one class name (without the leading dot);
// returns every matching rule, in file order (empty when none match).
function blocksFor(css: string, cls: string): { selector: string; body: string }[] {
  const token = new RegExp(`\\.${escapeRe(cls)}(?![\\w-])`);
  return rules(css).filter((r) => token.test(r.selector));
}

// Every fill:/stroke: declaration inside one rule body, as written (value
// trimmed) so a caller can name the exact offending text. The lookahead-free
// `fill|stroke` match requires an immediate colon, so `stroke-width: 1.2;`
// is correctly not read as a `stroke` declaration.
function fillsAndStrokes(body: string): { prop: string; value: string }[] {
  const out: { prop: string; value: string }[] = [];
  const re = /\b(fill|stroke)\s*:\s*([^;}]+);?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ prop: m[1], value: m[2].trim() });
  return out;
}

// Whether `text` reaches for the lime CTA custom property. Bare `--lime`
// (not just `var(--lime)`) counts, so a declaration that merely assigns
// through it is still caught.
const containsLime = (text: string): boolean => /--lime\b/.test(text);

// The union, across all eleven classes, of every rule block that matched
// any of them (deduplicated, since one rule can satisfy more than one class
// -- ".trophy--locked" also carries a "trophy--locked" match and nothing
// else, but a rule like ".route-stop--current::before" only ever matches
// its own class). This is "those blocks" that M2 and M3 are checked against.
function trophyRelatedBlocks(css: string): { selector: string; body: string }[] {
  const clean = stripComments(css);
  const seen = new Set<string>();
  const out: { selector: string; body: string }[] = [];
  for (const cls of CLASSES) {
    for (const r of blocksFor(clean, cls)) {
      const key = `${r.selector}|||${r.body}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
  }
  return out;
}

describe("the eleven fixed classes are real, non-empty rules (#27 task 2, M1)", () => {
  const clean = stripComments(readFileSync(CSS_PATH, "utf8"));
  // One case per class, named after the class, so a failure says which one
  // is missing rather than "some class is missing" (leg a).
  for (const cls of CLASSES) {
    test(cls, () => {
      const hasNonEmptyRule = blocksFor(clean, cls).some((r) => r.body.trim().length > 0);
      expect(hasNonEmptyRule).toBe(true);
    });
  }

  // Leg (b): a class named only inside a comment must not satisfy the
  // matcher above. Proven directly against the matcher, not the real file.
  test("a class named only in a comment does not satisfy the matcher", () => {
    const commentOnly = stripComments("/* .trophy-case */");
    expect(blocksFor(commentOnly, "trophy-case")).toEqual([]);
  });
});

describe("fill/stroke inside those blocks holds the .mark--empty contrast floor (#27 task 2, M2)", () => {
  const blocks = trophyRelatedBlocks(readFileSync(CSS_PATH, "utf8"));

  // Leg (c): every fill/stroke declaration across the real, matched blocks
  // resolves to one of the six allowed values. Collecting offenders into an
  // array (rather than asserting inside the loop) means a failure's diff
  // names the exact offending declaration instead of just "false !== true".
  test("every fill/stroke declaration in the real stylesheet is allowed", () => {
    const offenders = blocks.flatMap((r) =>
      fillsAndStrokes(r.body)
        .filter((d) => !ALLOWED_FILL_STROKE.has(d.value))
        .map((d) => `${r.selector} { ${d.prop}: ${d.value} }`)
    );
    expect(offenders).toEqual([]);
  });

  // Leg (d): the same predicate, run over a literal block that was never in
  // the real file, correctly flags a disallowed value. Proves the check
  // itself works rather than just proving today's stylesheet is clean.
  test("the predicate flags a disallowed value in a literal block", () => {
    const literal = rules(".trophy { fill: red; }")[0];
    const offenders = fillsAndStrokes(literal.body).filter((d) => !ALLOWED_FILL_STROKE.has(d.value));
    expect(offenders).toEqual([{ prop: "fill", value: "red" }]);
  });
});

describe("none of those blocks reaches for the lime CTA custom property (#27 task 2, M3)", () => {
  const blocks = trophyRelatedBlocks(readFileSync(CSS_PATH, "utf8"));

  // Leg (e): none of the real, matched blocks' text contains --lime.
  test("no trophy-related block in the real stylesheet references --lime", () => {
    const offenders = blocks.filter((r) => containsLime(r.body)).map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  // Leg (f): the same predicate, run over a literal block carrying --lime,
  // correctly reports it. Without this, a mis-spelled property name inside
  // containsLime (e.g. "--lim") would pass leg (e) vacuously forever.
  test("the predicate flags --lime in a literal block", () => {
    expect(containsLime(".trophy { color: var(--lime); }")).toBe(true);
  });
});
