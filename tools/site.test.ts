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

describe("site-wide copy rules (the pre-merge greps, now permanent)", () => {
  const pages = siteHtmlFiles();
  test("no em dash in any committed page", () => {
    for (const p of pages) expect(readPage(p)).not.toContain("\u2014");
  });
  test("the banned word never appears", () => {
    for (const p of pages)
      expect(readPage(p).toLowerCase()).not.toContain("experiment");
  });
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
