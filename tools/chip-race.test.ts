// Tests for the chip-race fragment builder and the marker injector. Uses the
// synthetic fixture log (invented players only; real logs never enter the
// repo). Run: bun test tools/chip-race.test.ts
import { describe, expect, test } from "bun:test";
import { buildChipRaceFragment, injectFragment, MARK_START, MARK_END } from "./chip-race";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();

describe("buildChipRaceFragment", () => {
  const frag = buildChipRaceFragment(csv, { date: "2026-01-01", startingStack: 5000 });
  test("is a bare figure fragment, not a document", () => {
    expect(frag).toStartWith('<figure class="chip-race">');
    expect(frag).not.toContain("<!doctype");
    expect(frag).not.toContain("<head>");
    expect(frag).not.toContain("http://");
    expect(frag).not.toContain("https://");
  });
  test("draws one polyline and one legend key per player", () => {
    expect((frag.match(/<polyline/g) || []).length).toBe(3);
    expect((frag.match(/class="key"/g) || []).length).toBe(3);
    expect(frag).toContain('class="chip-legend"');
  });
  test("states the date, entries, and hands in the meta line", () => {
    expect(frag).toContain("Chip race: 2026-01-01. 3 entries, 3 hands.");
  });
  test("contains no em dash", () => {
    expect(frag).not.toContain("—");
  });
});

describe("injectFragment", () => {
  const frag = buildChipRaceFragment(csv, { date: "2026-01-01", startingStack: 5000 });
  const shell = `<p>before</p>\n${MARK_START}\nold content\n${MARK_END}\n<p>after</p>`;
  test("replaces everything between the markers and keeps the rest", () => {
    const out = injectFragment(shell, frag);
    expect(out).toContain("<p>before</p>");
    expect(out).toContain("<p>after</p>");
    expect(out).toContain('class="chip-race"');
    expect(out).not.toContain("old content");
  });
  test("is idempotent: a second inject replaces, never appends", () => {
    const once = injectFragment(shell, frag);
    const twice = injectFragment(once, frag);
    expect((twice.match(/class="chip-race"/g) || []).length).toBe(1);
  });
  test("halts on a page without exactly one marker pair", () => {
    expect(() => injectFragment("<p>no markers</p>", frag)).toThrow(/marker pair/);
    expect(() => injectFragment(shell + MARK_START + MARK_END, frag)).toThrow(/marker pair/);
  });
});
