// Tests for the portrait-asks pure core: manifest validation (halt, never
// guess), R2 upload planning, and the SQL the tool feeds wrangler.
import { describe, expect, test } from "bun:test";
import {
  knownHandles, validateCandidates, uploadPlan, sq, askUpsertSql,
  revokeInsertSql, statusSql, formatStatusRows, pruneSelectSql, pruneKeys, linkFor,
} from "./lib/portraits";
import type { GamesData } from "./lib/standings";

const DATA = {
  players: [
    { slug: "gene-t", name: "Gene T.", aka: ["genet"] },
    { slug: "rosa-p", name: "Rosa P.", aka: ["rosap", "ROSA99"] },
  ],
  games: [{
    date: "2026-08-11", hands: 100, cardSet: "2026-08",
    results: [
      { slug: "gene-t", handle: "genet", finish: 1, payout: 10, rebuys: 0, trophies: [] },
      { slug: "rosa-p", handle: "ROSA99", finish: 2, payout: 0, rebuys: 0, trophies: [] },
    ],
  }],
} as unknown as GamesData;

const MANIFEST = {
  set_slug: "2026-08",
  players: [{ handle: "genet", variants: ["a", "b"] }],
};
const PNGS = ["genet/a.png", "genet/b.png"];

describe("knownHandles", () => {
  test("unions players[].aka and games[].results[].handle", () => {
    const k = knownHandles(DATA);
    expect(k.has("genet")).toBe(true);
    expect(k.has("rosap")).toBe(true);
    expect(k.has("ROSA99")).toBe(true);
    expect(k.has("stranger")).toBe(false);
  });
});

describe("validateCandidates", () => {
  const known = knownHandles(DATA);
  test("accepts a matching manifest and directory", () => {
    expect(validateCandidates(MANIFEST, PNGS, known)).toEqual({
      setSlug: "2026-08",
      players: [{ handle: "genet", variants: ["a", "b"] }],
    });
  });
  test("halts on an unknown handle", () => {
    const m = { set_slug: "2026-08", players: [{ handle: "stranger", variants: ["a"] }] };
    expect(() => validateCandidates(m, ["stranger/a.png"], known))
      .toThrow(/unknown handle "stranger"/);
  });
  test("halts on a manifest variant with no PNG", () => {
    expect(() => validateCandidates(MANIFEST, ["genet/a.png"], known))
      .toThrow(/genet\/b\.png/);
  });
  test("halts on a PNG with no manifest entry", () => {
    expect(() => validateCandidates(MANIFEST, [...PNGS, "genet/c.png"], known))
      .toThrow(/genet\/c\.png/);
  });
  test("halts on a bad set slug, an empty variant list, and a duplicate handle, all in one error", () => {
    const m = {
      set_slug: "aug-2026",
      players: [
        { handle: "genet", variants: [] },
        { handle: "genet", variants: ["a"] },
      ],
    };
    const err = (() => { try { validateCandidates(m, ["genet/a.png"], known); return null; }
                         catch (e) { return e as Error; } })();
    expect(err).not.toBe(null);
    expect(err!.message).toMatch(/set_slug/);
    expect(err!.message).toMatch(/no variants/);
    expect(err!.message).toMatch(/duplicate handle/);
  });
  test("halts on a variant id outside [a-z0-9]{1,8}", () => {
    const m = { set_slug: "2026-08", players: [{ handle: "genet", variants: ["A"] }] };
    expect(() => validateCandidates(m, ["genet/A.png"], known)).toThrow(/variant/);
  });
  test("halts on a non-object manifest", () => {
    expect(() => validateCandidates(null, [], known)).toThrow(/manifest/);
  });
});

describe("uploadPlan / linkFor", () => {
  test("maps local files to bucket keys", () => {
    expect(uploadPlan({ setSlug: "2026-08", players: [{ handle: "genet", variants: ["a", "b"] }] }))
      .toEqual([
        { local: "genet/a.png", key: "asks/2026-08/genet/a.png" },
        { local: "genet/b.png", key: "asks/2026-08/genet/b.png" },
      ]);
  });
  test("links point at the production host", () => {
    expect(linkFor("f".repeat(32))).toBe(`https://poker.kmikeym.com/portrait/${"f".repeat(32)}`);
  });
});

describe("SQL builders", () => {
  test("sq doubles single quotes", () => {
    expect(sq("o'brien")).toBe("'o''brien'");
  });
  test("ask upsert replaces on (handle, set_slug) and rotates the token", () => {
    const sql = askUpsertSql({
      token: "a".repeat(32), handle: "genet", setSlug: "2026-08",
      variants: ["a", "b"], createdAt: "2026-08-27 10:00:00", expiresAt: "2026-10-26 10:00:00",
    });
    expect(sql).toContain("INSERT INTO portrait_asks");
    expect(sql).toContain("ON CONFLICT(handle, set_slug) DO UPDATE SET");
    expect(sql).toContain(`'${"a".repeat(32)}'`);
    expect(sql).toContain(`'["a","b"]'`);
    expect(sql).toContain("'2026-10-26 10:00:00'");
  });
  test("revoke appends a declined row via the ask lookup, never invents a token", () => {
    const sql = revokeInsertSql("genet", "2026-08", "2026-09-01 10:00:00");
    expect(sql).toContain("INSERT INTO portrait_answers");
    expect(sql).toContain("SELECT token, 'declined', NULL, '2026-09-01 10:00:00'");
    expect(sql).toContain("handle = 'genet'");
    expect(sql).toContain("set_slug = '2026-08'");
  });
  test("status resolves the latest answer per ask and filters by set", () => {
    const sql = statusSql("2026-08");
    // rowid-only, NOT answered_at: portrait_answers has two writers on two
    // clocks (the POST Function's request-time clock and the CLI revoke's
    // operator-machine clock), so this must match latestAnswer's insertion-
    // order resolution in functions/api/_portrait.js exactly, or --status
    // could show a different "current answer" than the page and API do.
    expect(sql).toContain("ORDER BY w2.rowid DESC");
    expect(sql).not.toContain("answered_at DESC");
    expect(sql).toContain("a.set_slug = '2026-08'");
    expect(statusSql()).not.toContain("WHERE a.set_slug");
  });
  test("prune selects only expired asks and maps their keys", () => {
    expect(pruneSelectSql("2026-09-01 10:00:00")).toContain("expires_at <= '2026-09-01 10:00:00'");
    expect(pruneKeys([{ set_slug: "2026-08", handle: "genet", variants: '["a","b"]' }]))
      .toEqual(["asks/2026-08/genet/a.png", "asks/2026-08/genet/b.png"]);
  });
});

describe("formatStatusRows", () => {
  test("prints handle, variants, answer, timestamp, and never a token", () => {
    const out = formatStatusRows([
      { handle: "genet", set_slug: "2026-08", variants: '["a","b"]',
        answer: "approved", variant: "b", answered_at: "2026-09-01 10:00:00",
        expires_at: "2026-10-26 10:00:00", token: "c".repeat(32) },
      { handle: "rosap", set_slug: "2026-08", variants: '["a"]',
        answer: null, variant: null, answered_at: null,
        expires_at: "2026-10-26 10:00:00", token: "d".repeat(32) },
    ]);
    expect(out).toContain("genet");
    expect(out).toContain("approved (b)");
    expect(out).toContain("no answer yet");
    expect(out).not.toContain("c".repeat(32));
    expect(out).not.toContain("d".repeat(32));
  });
});
