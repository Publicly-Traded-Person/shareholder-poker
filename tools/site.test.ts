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
