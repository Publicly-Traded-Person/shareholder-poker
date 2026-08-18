import { describe, expect, test } from "bun:test";
import { resolveSlug, UnknownHandleError, type Player } from "./slugs";

const players: Player[] = [
  { slug: "chris-ganz", name: "Chris Ganz", aka: ["LEWD", "ccml415"] },
  { slug: "webvee", name: "Gene", aka: ["webvee", "Webvee"] },
];

describe("resolveSlug", () => {
  test("resolves any aka to the slug", () => {
    expect(resolveSlug("LEWD", players)).toBe("chris-ganz");
    expect(resolveSlug("ccml415", players)).toBe("chris-ganz");
  });
  test("is case-insensitive", () => {
    expect(resolveSlug("lewd", players)).toBe("chris-ganz");
    expect(resolveSlug("WEBVEE", players)).toBe("webvee");
  });
  test("throws UnknownHandleError naming the handle, never invents a player", () => {
    expect(() => resolveSlug("mystery99", players)).toThrow(UnknownHandleError);
    expect(() => resolveSlug("mystery99", players)).toThrow(/mystery99/);
  });
});
