// Invariants over the committed HTML in site/. These run against the REAL
// pages (not fixtures) so a bad edit fails the suite before it deploys.
// Sits beside the publish flow as a standing guard; run: bun test tools.
// Tasks add per-page describe blocks below the site-wide rules; keep new
// blocks additive and self-contained so they merge cleanly.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Recursively lists every committed .html file under site/.
export function siteHtmlFiles(
  dir = new URL("../site", import.meta.url).pathname
): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...siteHtmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Reads one page as text; every page block below goes through this.
export const readPage = (p: string) => readFileSync(p, "utf8");

// Returns the text inside each <!-- ... --> block of an XML/SVG source, so a
// caller can check the XML comment rules against those interiors alone. Takes
// the raw file text; returns one string per comment, in document order (an
// empty array when there are no comments). Throws nothing: an unterminated
// comment yields the rest of the document, which fails the same checks a
// malformed comment would, so a truncated file cannot pass by accident.
export function commentInteriors(xml: string): string[] {
  const OPEN = "<!--";
  const CLOSE = "-->";
  const out: string[] = [];
  let i = xml.indexOf(OPEN);
  while (i !== -1) {
    const start = i + OPEN.length;
    const end = xml.indexOf(CLOSE, start);
    // Slice stops before CLOSE so the delimiter's own hyphens are not counted
    // as content; they are legal exactly where they close the comment.
    out.push(end === -1 ? xml.slice(start) : xml.slice(start, end));
    if (end === -1) break;
    i = xml.indexOf(OPEN, end + CLOSE.length);
  }
  return out;
}

describe("site-wide copy rules (the pre-merge greps, now permanent)", () => {
  const pages = siteHtmlFiles();
  // Accumulate-and-assert instead of a for-loop `expect` per page: a for-loop
  // assertion stops at the first failure and reports only true/false, not
  // which file broke. Filtering to the offending paths first means a failure
  // names the page, so Charlie does not have to bisect the site by hand.
  test("no em dash in any committed page", () => {
    expect(pages.filter((p) => readPage(p).includes("\u2014"))).toEqual([]);
  });
  test("the banned word never appears", () => {
    expect(
      pages.filter((p) => readPage(p).toLowerCase().includes("experiment"))
    ).toEqual([]);
  });
  // Every committed page must link the favicon with this exact tag. By the
  // time this task's REDIRECT lands, every page task (2, 4, 5, 6, 8) has
  // already merged its own favicon tag, so this is green on arrival; it is
  // here to catch the next new page that forgets it.
  test("every page carries the favicon tag", () => {
    expect(
      pages.filter(
        (p) =>
          !readPage(p).includes(
            '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
          )
      )
    ).toEqual([]);
  });
});

describe("utility pages carry the favicon", () => {
  for (const rel of [
    "../site/404.html",
    "../site/games/2026-07-14/chip-race.html",
    "../site/games/2026-08-11/chip-race.html",
  ]) {
    test(rel, () =>
      expect(readPage(new URL(rel, import.meta.url).pathname)).toContain(
        'href="/favicon.svg"'
      ));
  }
});

// A standalone .svg is served as image/svg+xml and parsed by the browser's
// STRICT XML parser, not the forgiving HTML one. One well-formedness error and
// the icon simply never paints: no console error a visitor would see, no other
// test failing, just an empty tab. That silence is why this needs a guard.
// The rule that actually bit us (XML 1.0 section 2.5): the string "--" must
// never appear inside a comment, so the CSS variable names cannot be written
// with their leading hyphens in the header comment.
// Scope: this is a comment-rule check on the one SVG this repo ships, not a
// general XML validator; Bun has no DOMParser and the repo has no XML dep.
describe("favicon.svg is well-formed XML", () => {
  const faviconPath = new URL("../site/favicon.svg", import.meta.url).pathname;

  test("no comment contains a double hyphen", () => {
    const offenders = commentInteriors(readPage(faviconPath)).filter((c) =>
      c.includes("--")
    );
    expect(offenders).toEqual([]);
  });

  test("every comment is terminated", () => {
    const svg = readPage(faviconPath);
    expect(svg.split("<!--").length - 1).toBe(svg.split("-->").length - 1);
  });

  test("the spade still paints on felt", () => {
    const svg = readPage(faviconPath);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#101216"'); // felt
    expect(svg).toContain('fill="#c9a227"'); // foil
  });
});

// Task 4: home page invariants. Guards the design-pass rework of
// site/index.html (wide foil band, holo card, one lime button, unfurl tags).
describe("home page invariants", () => {
  const html = readPage(new URL("../site/index.html", import.meta.url).pathname);
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("exactly one lime button (brand: one lime action per page)", () =>
    expect(html.split("btn-primary").length - 1).toBe(1));
  test("marks Home current in the nav", () =>
    expect(html).toContain('<a href="/" aria-current="page">'));
  test("carries link-unfurl tags", () =>
    expect(html).toContain('property="og:image"'));
  test("loads the holo script", () =>
    expect(html).toContain('src="/holo.js"'));
});

// Task 5: the set page (site/cards/2026-07/index.html) drops emoji chrome,
// the pack-rip gif, and boxed captions in favor of the shared .card-caption
// / .mark classes from Task 1 and the holo effect from Task 3.
describe("set page invariants (2026-07)", () => {
  const html = readPage(
    new URL("../site/cards/2026-07/index.html", import.meta.url).pathname
  );
  test("no emoji chrome", () => {
    for (const e of ["\u2728", "\u2b50", "\u25c6", "\u25cf", "\u{1FA99}"])
      expect(html).not.toContain(e);
  });
  test("captions are unboxed card-caption lines", () =>
    expect(html).toContain('class="card-caption"'));
  test("the pack rip gif is gone", () =>
    expect(html).not.toContain("pack-rip.gif"));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
});

// Task 6: /cards/ becomes a set gallery (six Set 1 thumbnails + a drawn
// "in production" card back for Set 2) instead of a plain bullet list.
describe("cards index gallery", () => {
  const html = readPage(
    new URL("../site/cards/index.html", import.meta.url).pathname
  );
  test("shows all six Set 1 thumbnails", () =>
    expect(html.split("/cards/2026-07/assets/").length - 1).toBe(6));
  test("teases Set 2 with a drawn card back", () =>
    expect(html).toContain('class="card-back"'));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
});

// Task 8: game pages get the shared shell (lens pills, stat-strip chip,
// notes-table variant, favicon) so docs/publishing.md can tell Charlie to
// copy the newest game page and get all of it for free.
describe("game page shells", () => {
  for (const rel of [
    "../site/games/2026-07-14/index.html",
    "../site/games/2026-08-11/index.html",
  ]) {
    const html = readPage(new URL(rel, import.meta.url).pathname);
    test(`${rel} has the lens pills`, () =>
      expect(html).toContain('class="pills"'));
    test(`${rel} uses the notes table variant`, () =>
      expect(html).toContain("ledger ledger--notes"));
    test(`${rel} has the stat strip`, () =>
      expect(html).toContain("stat-strip"));
    test(`${rel} links the favicon`, () =>
      expect(html).toContain('href="/favicon.svg"'));
  }
});
