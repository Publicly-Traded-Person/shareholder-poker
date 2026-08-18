import { describe, expect, test } from "bun:test";
import { buildChipRace } from "./chip-race";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();

describe("buildChipRace", () => {
  const html = buildChipRace(csv, { date: "2026-01-01", startingStack: 5000 });
  test("is a self-contained document with one polyline per player", () => {
    expect(html).toStartWith("<!doctype html>");
    expect((html.match(/<polyline/g) || []).length).toBe(3);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });
  test("titles the game date and shows the entry count", () => {
    expect(html).toContain("2026-01-01");
    expect(html).toContain("3 entries");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
});
