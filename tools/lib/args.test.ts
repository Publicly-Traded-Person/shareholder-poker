import { describe, expect, test } from "bun:test";
import { positionals, flag } from "./args";

describe("positionals", () => {
  test("returns the bare arguments in order, skipping every flag and its value", () => {
    expect(positionals(["t1.csv", "t2.csv", "--date", "2026-09-08", "--inject", "page.html"]))
      .toEqual(["t1.csv", "t2.csv"]);
  });
  test("is empty when only flags were given", () => {
    expect(positionals(["--date", "2026-09-08"])).toEqual([]);
  });
});

describe("flag", () => {
  test("returns the value after the named flag, or undefined when absent", () => {
    expect(flag(["a.csv", "--date", "2026-09-08"], "--date")).toBe("2026-09-08");
    expect(flag(["a.csv"], "--date")).toBeUndefined();
  });
});
