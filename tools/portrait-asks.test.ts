// Tests for the portrait-asks CLI's five verbs (stage, status, revoke,
// prune, pull), exercised entirely through injected deps so nothing here
// touches a real filesystem, D1, R2, or wrangler subprocess - only main()'s
// untested glue (argv parsing, the real wrangler-backed deps, process.exit)
// is left outside this file, same split as tools/publish-game.ts /
// prepareGame. All fixture players are SYNTHETIC (repo privacy rule):
// "genet" and "rosap" are invented handles, never a real player.
import { describe, expect, test } from "bun:test";
import { stage, status, revoke, prune, pull, type PortraitDeps } from "./portrait-asks";
import { toSqlUtc } from "../functions/api/_portrait.js";
import type { GamesData } from "./lib/standings";

const NOW = new Date("2026-08-27T00:00:00Z");

const GAMES: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00 PM" },
  hopeCoin: { holder: "genet", since: "2026-08-11" },
  players: [
    { slug: "gene-t", name: "Gene T.", aka: ["genet"] },
    { slug: "rosa-p", name: "Rosa P.", aka: ["rosap"] },
  ],
  games: [
    {
      date: "2026-08-11",
      hands: 100,
      startingStack: 5000,
      buyIn: 50,
      entries: 2,
      pot: 100,
      cardSet: "2026-08",
      results: [
        { slug: "gene-t", handle: "genet", finish: 1, payout: 100, rebuys: 0, trophies: [] },
        { slug: "rosa-p", handle: "rosap", finish: 2, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
  ],
} as unknown as GamesData;

// A recorder deps factory: every call is appended to `calls` so a test can
// assert both the return value AND the exact side effects (or absence of
// them) a verb produced. `overrides` replaces individual fields wholesale -
// tests that override d1/r2put/r2delete lose that field's call recording,
// which is fine because those tests assert through other channels instead.
function makeDeps(overrides: Partial<PortraitDeps> = {}): {
  deps: PortraitDeps;
  calls: {
    d1: string[];
    r2put: [string, string][];
    r2delete: string[];
    r2get: [string, string][];
    printed: string[];
  };
} {
  const calls = {
    d1: [] as string[],
    r2put: [] as [string, string][],
    r2delete: [] as string[],
    r2get: [] as [string, string][],
    printed: [] as string[],
  };
  const deps: PortraitDeps = {
    d1: (sql: string) => {
      calls.d1.push(sql);
      return { results: [], changes: 0 };
    },
    r2put: (key: string, file: string) => {
      calls.r2put.push([key, file]);
    },
    r2delete: (key: string) => {
      calls.r2delete.push(key);
    },
    r2get: (key: string, outPath: string) => {
      calls.r2get.push([key, outPath]);
    },
    now: () => NOW,
    print: (line: string) => {
      calls.printed.push(line);
    },
    readDir: () => ["genet/a.png", "genet/b.png", "rosap/a.png"],
    readManifest: () => ({
      set_slug: "2026-08",
      players: [
        { handle: "genet", variants: ["a", "b"], metal: "copper" },
        { handle: "rosap", variants: ["a"], metal: "pewter" },
      ],
    }),
    readGames: () => GAMES,
    ...overrides,
  };
  return { deps, calls };
}

describe("stage", () => {
  test("validates before any side effect: a bad manifest records zero r2put/d1 calls", async () => {
    const { deps, calls } = makeDeps({
      readManifest: () => ({ set_slug: "2026-08", players: [{ handle: "stranger", variants: ["a"] }] }),
      readDir: () => ["stranger/a.png"],
    });
    await expect(stage("candidates/2026-08", deps)).rejects.toThrow(/unknown handle "stranger"/);
    expect(calls.r2put).toEqual([]);
    expect(calls.d1).toEqual([]);
    expect(calls.printed).toEqual([]);
  });

  test("happy path uploads every file, upserts one ask per player, prints one link per player", async () => {
    const { deps, calls } = makeDeps();
    await stage("candidates/2026-08", deps);

    expect(calls.r2put).toEqual([
      ["asks/2026-08/genet/a.png", "candidates/2026-08/genet/a.png"],
      ["asks/2026-08/genet/b.png", "candidates/2026-08/genet/b.png"],
      ["asks/2026-08/rosap/a.png", "candidates/2026-08/rosap/a.png"],
    ]);

    expect(calls.d1.length).toBe(2); // one upsert per player, not per variant
    expect(calls.d1[0]).toContain("INSERT INTO portrait_asks");
    expect(calls.d1[0]).toContain("'genet'");
    expect(calls.d1[0]).toContain("'copper'"); // genet's metal from the manifest fixture
    expect(calls.d1[1]).toContain("'rosap'");
    expect(calls.d1[1]).toContain("'pewter'"); // rosap's metal from the manifest fixture

    expect(calls.printed.length).toBe(2);
    expect(calls.printed[0]).toMatch(/^genet\s+https:\/\/poker\.kmikeym\.com\/portrait\/[0-9a-f]{32}$/);
    expect(calls.printed[1]).toMatch(/^rosap\s+https:\/\/poker\.kmikeym\.com\/portrait\/[0-9a-f]{32}$/);

    // Every player gets a distinct, freshly minted token (never reused).
    const tokenOf = (line: string) => line.split("/portrait/")[1];
    expect(tokenOf(calls.printed[0])).not.toBe(tokenOf(calls.printed[1]));
  });

  test("expiry is 60 days after now() in SQL shape", async () => {
    const { deps, calls } = makeDeps();
    await stage("candidates/2026-08", deps);
    // Computed independently from the shared toSqlUtc helper rather than a
    // hand-counted calendar date, so a date-math slip can't hide behind a
    // matching hardcoded string on both sides.
    const expectedExpiry = toSqlUtc(new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000));
    expect(calls.d1[0]).toContain(`'${expectedExpiry}'`);
    expect(calls.d1[0]).toContain(`'${toSqlUtc(NOW)}'`); // created_at
  });
});

describe("revoke", () => {
  test("halts when d1 reports changes === 0, naming the handle, the set, and 'no ask exists'", async () => {
    const { deps } = makeDeps({ d1: () => ({ results: [], changes: 0 }) });
    await expect(revoke("genet", "2026-08", deps)).rejects.toThrow(/genet/);
    await expect(revoke("genet", "2026-08", deps)).rejects.toThrow(/2026-08/);
    await expect(revoke("genet", "2026-08", deps)).rejects.toThrow(/no ask exists/);
  });

  test("succeeds and prints a confirmation when an ask existed", async () => {
    const { deps, calls } = makeDeps({ d1: () => ({ results: [], changes: 1 }) });
    await revoke("genet", "2026-08", deps);
    expect(calls.printed.length).toBe(1);
    expect(calls.printed[0]).toContain("genet");
    expect(calls.printed[0]).toContain("2026-08");
  });
});

describe("status", () => {
  test("prints formatStatusRows output for the query results", async () => {
    const rows = [
      {
        handle: "genet",
        set_slug: "2026-08",
        variants: '["a","b"]',
        answer: "approved",
        variant: "b",
        answered_at: "2026-09-01 10:00:00",
        expires_at: "2026-10-26 10:00:00",
        token: "c".repeat(32),
      },
      {
        handle: "rosap",
        set_slug: "2026-08",
        variants: '["a"]',
        answer: null,
        variant: null,
        answered_at: null,
        expires_at: "2026-10-26 10:00:00",
        token: "d".repeat(32),
      },
    ];
    const { deps, calls } = makeDeps({ d1: () => ({ results: rows, changes: 0 }) });
    await status({}, deps);
    expect(calls.printed.length).toBe(1);
    expect(calls.printed[0]).toContain("genet");
    expect(calls.printed[0]).toContain("approved (b)");
    expect(calls.printed[0]).toContain("no answer yet");
    // Never leak a capability token into the terminal (same boundary as
    // formatStatusRows itself).
    expect(calls.printed[0]).not.toContain("c".repeat(32));
    expect(calls.printed[0]).not.toContain("d".repeat(32));
  });

  test("passes the --set filter through to the query", async () => {
    const { deps, calls } = makeDeps({
      d1: (sql: string) => {
        calls.d1.push(sql);
        return { results: [], changes: 0 };
      },
    });
    await status({ set: "2026-08" }, deps);
    expect(calls.d1[0]).toContain("a.set_slug = '2026-08'");
  });
});

describe("prune", () => {
  test("deletes exactly pruneKeys of the expired selection and prints a count", async () => {
    const rows = [{ set_slug: "2026-08", handle: "genet", variants: '["a","b"]', answer: null, variant: null }];
    const { deps, calls } = makeDeps({ d1: () => ({ results: rows, changes: 0 }) });
    await prune(deps);
    expect(calls.r2delete).toEqual(["asks/2026-08/genet/a.png", "asks/2026-08/genet/b.png"]);
    expect(calls.printed.length).toBe(1);
    expect(calls.printed[0]).toContain("2");
    expect(calls.printed[0]).toContain("1 expired ask");
  });

  test("prints 'nothing expired' and deletes nothing when the selection is empty", async () => {
    const { deps, calls } = makeDeps({ d1: () => ({ results: [], changes: 0 }) });
    await prune(deps);
    expect(calls.r2delete).toEqual([]);
    expect(calls.printed).toEqual(["nothing expired"]);
  });

  // REDIRECT (2026-08-28): --prune must never silently destroy a consented
  // self-upload, since it exists nowhere but R2. This pins that the kept key
  // is reported to Charlie and never handed to r2delete.
  test("keeps an approved self panel: prints the kept line, never calls r2delete for it", async () => {
    const rows = [
      { set_slug: "2026-08", handle: "genet", variants: '["a","self"]', answer: "approved", variant: "self" },
    ];
    const { deps, calls } = makeDeps({ d1: () => ({ results: rows, changes: 0 }) });
    await prune(deps);
    expect(calls.r2delete).toEqual(["asks/2026-08/genet/a.png"]);
    expect(calls.r2delete).not.toContain("asks/2026-08/genet/self.png");
    expect(calls.printed.length).toBe(2);
    expect(calls.printed[0]).toBe(
      "kept: asks/2026-08/genet/self.png (approved self panel; pull it for the print render, then delete it deliberately with wrangler if you are done with it)"
    );
    expect(calls.printed[1]).toContain("1 portrait file");
    expect(calls.printed[1]).toContain("1 expired ask");
  });

  test("a declined self panel deletes along with everything else for that ask (no consent behind it)", async () => {
    const rows = [
      { set_slug: "2026-08", handle: "genet", variants: '["a","self"]', answer: "declined", variant: null },
    ];
    const { deps, calls } = makeDeps({ d1: () => ({ results: rows, changes: 0 }) });
    await prune(deps);
    expect(calls.r2delete).toEqual(["asks/2026-08/genet/a.png", "asks/2026-08/genet/self.png"]);
    expect(calls.printed).toEqual(["pruned 2 portrait file(s) from 1 expired ask(s)"]);
  });
});

// One statusSql-shaped row, as the fake d1 below returns it. `answer` and
// `variant` are the fields pull() actually branches on; the rest just have
// to be present so the row looks like a real statusSql result.
function statusRow(overrides: Partial<{
  handle: string; answer: string | null; variant: string | null;
}> = {}) {
  return {
    handle: "genet",
    set_slug: "2026-08",
    variants: '["a","b","self"]',
    answer: null,
    variant: null,
    answered_at: null,
    expires_at: "2026-10-26 10:00:00",
    token: "a".repeat(32),
    ...overrides,
  };
}

describe("pull", () => {
  test("halts naming both handle and set when no ask exists for that handle", async () => {
    const { deps } = makeDeps({ d1: () => ({ results: [], changes: 0 }) });
    await expect(pull("genet", "2026-08", undefined, deps)).rejects.toThrow(/genet/);
    await expect(pull("genet", "2026-08", undefined, deps)).rejects.toThrow(/2026-08/);
  });

  test("halts saying declined when the latest answer is a decline", async () => {
    const { deps } = makeDeps({
      d1: () => ({ results: [statusRow({ answer: "declined" })], changes: 0 }),
    });
    await expect(pull("genet", "2026-08", undefined, deps)).rejects.toThrow(/declined/);
  });

  test("halts naming the variant when the latest approval is a staged crop, not self", async () => {
    const { deps } = makeDeps({
      d1: () => ({ results: [statusRow({ answer: "approved", variant: "b" })], changes: 0 }),
    });
    await expect(pull("genet", "2026-08", undefined, deps)).rejects.toThrow(/"b"/);
  });

  test("fetches the self panel to a default filename and prints one confirmation line", async () => {
    const { deps, calls } = makeDeps({
      d1: () => ({ results: [statusRow({ answer: "approved", variant: "self" })], changes: 0 }),
    });
    await pull("genet", "2026-08", undefined, deps);
    expect(calls.r2get).toEqual([["asks/2026-08/genet/self.png", "genet-self.png"]]);
    expect(calls.printed.length).toBe(1);
    expect(calls.printed[0]).toContain("genet");
  });

  test("honors --out for the destination path", async () => {
    const { deps, calls } = makeDeps({
      d1: () => ({ results: [statusRow({ answer: "approved", variant: "self" })], changes: 0 }),
    });
    await pull("genet", "2026-08", "out/genet.png", deps);
    expect(calls.r2get).toEqual([["asks/2026-08/genet/self.png", "out/genet.png"]]);
  });

  test("resolves through statusSql, matching the append-order rule status uses", async () => {
    const { deps, calls } = makeDeps({
      d1: (sql: string) => {
        calls.d1.push(sql);
        return { results: [statusRow({ answer: "approved", variant: "self" })], changes: 0 };
      },
    });
    await pull("genet", "2026-08", undefined, deps);
    expect(calls.d1.length).toBe(1);
    expect(calls.d1[0]).toContain("ORDER BY w2.rowid DESC");
    expect(calls.d1[0]).toContain("a.set_slug = '2026-08'");
  });
});
