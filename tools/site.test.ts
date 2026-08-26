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
