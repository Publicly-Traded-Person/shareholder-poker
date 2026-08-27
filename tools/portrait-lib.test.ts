// Tests for the portrait consent helpers and (in later tasks, appended below)
// the three portrait Functions. Mirrors tools/rsvp-lib.test.ts: plain JS
// modules imported straight into bun:test, hostile stubs for the runtime.
// All fixture players are SYNTHETIC (repo privacy rule).
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import {
  randomToken, isValidToken, toSqlUtc, isExpired,
  latestAnswer, parseVariants, escapeHtml, ordinal, monthName,
} from "../functions/api/_portrait.js";

describe("randomToken", () => {
  test("is 32 lowercase hex and not constant", () => {
    const a = randomToken(), b = randomToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("isValidToken", () => {
  test("accepts exactly the token shape", () => {
    expect(isValidToken("a".repeat(32))).toBe(true);
  });
  test("rejects junk without throwing", () => {
    expect(isValidToken("A".repeat(32))).toBe(false);   // uppercase
    expect(isValidToken("a".repeat(31))).toBe(false);
    expect(isValidToken("a".repeat(33))).toBe(false);
    expect(isValidToken("../../etc/passwd")).toBe(false);
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(42)).toBe(false);
  });
});

describe("toSqlUtc / isExpired", () => {
  test("matches SQLite datetime('now') shape", () => {
    expect(toSqlUtc(new Date("2026-09-01T12:00:00Z"))).toBe("2026-09-01 12:00:00");
  });
  test("expired at and after the deadline, live before it", () => {
    expect(isExpired("2026-09-01 12:00:00", "2026-09-01 11:59:59")).toBe(false);
    expect(isExpired("2026-09-01 12:00:00", "2026-09-01 12:00:00")).toBe(true);
    expect(isExpired("2026-09-01 12:00:00", "2026-09-01 12:00:01")).toBe(true);
  });
  test("fails closed on garbage", () => {
    expect(isExpired(null, "2026-09-01 12:00:00")).toBe(true);
    expect(isExpired(undefined, "2026-09-01 12:00:00")).toBe(true);
    expect(isExpired(12345, "2026-09-01 12:00:00")).toBe(true);
  });
});

// The consent-withdrawal path. Rows arrive in INSERTION order (SELECT ...
// ORDER BY rowid ASC); ties on answered_at resolve to the later insertion.
describe("latestAnswer", () => {
  const row = (answer: string, variant: string | null, at: string) =>
    ({ answer, variant, answered_at: at });
  test("empty list means no answer yet", () => {
    expect(latestAnswer([])).toBe(null);
    expect(latestAnswer(undefined)).toBe(null);
  });
  test("approve then decline resolves to declined", () => {
    const r = latestAnswer([row("approved", "a", "2026-09-01 10:00:00"),
                            row("declined", null, "2026-09-02 10:00:00")]);
    expect(r).toEqual({ answer: "declined", variant: null, answeredAt: "2026-09-02 10:00:00" });
  });
  test("decline then approve resolves to approved", () => {
    const r = latestAnswer([row("declined", null, "2026-09-01 10:00:00"),
                            row("approved", "b", "2026-09-02 10:00:00")]);
    expect(r).toEqual({ answer: "approved", variant: "b", answeredAt: "2026-09-02 10:00:00" });
  });
  test("two approvals resolve to the later variant", () => {
    const r = latestAnswer([row("approved", "a", "2026-09-01 10:00:00"),
                            row("approved", "c", "2026-09-03 10:00:00")]);
    expect(r?.variant).toBe("c");
  });
  test("same-second flip resolves by insertion order", () => {
    const r = latestAnswer([row("approved", "a", "2026-09-01 10:00:00"),
                            row("declined", null, "2026-09-01 10:00:00")]);
    expect(r?.answer).toBe("declined");
  });
  test("a declined row never carries a variant out", () => {
    const r = latestAnswer([row("declined", "a", "2026-09-01 10:00:00")]);
    expect(r).toEqual({ answer: "declined", variant: null, answeredAt: "2026-09-01 10:00:00" });
  });
  test("ignores rows with answers outside the CHECK set", () => {
    const r = latestAnswer([row("maybe", "a", "2026-09-05 10:00:00"),
                            row("approved", "a", "2026-09-01 10:00:00")]);
    expect(r?.answer).toBe("approved");
  });
});

describe("parseVariants", () => {
  test("accepts a short id array and preserves order", () => {
    expect(parseVariants('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });
  test("returns null on anything else (caller 404s, never guesses)", () => {
    expect(parseVariants("not json")).toBe(null);
    expect(parseVariants("[]")).toBe(null);
    expect(parseVariants('["A"]')).toBe(null);          // uppercase id
    expect(parseVariants('["toolongid1"]')).toBe(null); // > 8 chars
    expect(parseVariants('[1,2]')).toBe(null);
    expect(parseVariants('{"a":1}')).toBe(null);
  });
});

describe("escapeHtml / ordinal / monthName", () => {
  test("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`))
      .toBe("&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;");
  });
  test("English ordinals including the teens", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
  });
  test("set slug to month name", () => {
    expect(monthName("2026-08")).toBe("August 2026");
    expect(monthName("2026-12")).toBe("December 2026");
  });
});

// --- Shared hostile stubs for the handler tests (Tasks 5 and 6 append their
// describe blocks below this line; the factory and constants are theirs to
// use and NOT to rename). The asks rows carry an email field that the real
// schema does not even have: any handler that echoed a row through would leak.
export type AskRow = { token: string; handle: string; set_slug: string; variants: string;
                       expires_at: string; email?: string };
export type AnswerRow = { token: string; answer: string; variant: string | null; answered_at: string };

export function makePortraitEnv(asks: AskRow[], objects: Record<string, string> = {}) {
  const answers: AnswerRow[] = [];
  const db = {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() {
          if (!sql.includes("FROM portrait_asks")) throw new Error(`unexpected first(): ${sql}`);
          return asks.find((r) => r.token === args[0]) ?? null;
        },
        async all() {
          if (!sql.includes("FROM portrait_answers")) throw new Error(`unexpected all(): ${sql}`);
          return { results: answers.filter((r) => r.token === args[0]) };
        },
        async run() {
          if (!sql.includes("INSERT INTO portrait_answers")) throw new Error(`unexpected run(): ${sql}`);
          const [token, answer, variant, answered_at] = args;
          answers.push({ token, answer, variant, answered_at });
          return { success: true };
        },
      };
      return stmt;
    },
  };
  const bucket = {
    async get(key: string) {
      if (!(key in objects)) return null;
      return { body: objects[key] };  // handlers must pass body through untouched
    },
  };
  return { env: { POKER_RSVP_DB: db, POKER_PORTRAITS: bucket }, answers };
}

export const TOKEN = "e".repeat(32);
export const FUTURE = "2099-01-01 00:00:00";
export const PAST = "2000-01-01 00:00:00";
export const ASK: AskRow = { token: TOKEN, handle: "genet", set_slug: "2026-08",
  variants: '["a","b"]', expires_at: FUTURE, email: "leak@example.com" };
