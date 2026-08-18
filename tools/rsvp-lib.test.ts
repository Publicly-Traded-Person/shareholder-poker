import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import { validEmail, cleanDisplayName, resolveDisplay } from "../functions/api/_lib.js";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import { onRequestGet, onRequestPost } from "../functions/api/rsvp.js";

describe("validEmail", () => {
  test("accepts ordinary addresses", () => {
    expect(validEmail("gene@example.com")).toBe(true);
  });
  test("rejects junk", () => {
    expect(validEmail("not-an-email")).toBe(false);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("")).toBe(false);
  });
  test("rejects non-strings without throwing", () => {
    expect(validEmail(null)).toBe(false);
    expect(validEmail(undefined)).toBe(false);
    expect(validEmail(12345)).toBe(false);
    expect(validEmail({ email: "gene@example.com" })).toBe(false);
    expect(validEmail(["gene@example.com"])).toBe(false);
  });
  test("rejects whitespace and doubled separators", () => {
    expect(validEmail("gene @example.com")).toBe(false);
    expect(validEmail("gene@ example.com")).toBe(false);
    expect(validEmail("gene@@example.com")).toBe(false);
    expect(validEmail("gene@example.c")).toBe(false);
  });
  test("accepts a two-letter TLD", () => {
    expect(validEmail("gene@example.co")).toBe(true);
  });
});

describe("cleanDisplayName", () => {
  test("trims and caps length", () => {
    expect(cleanDisplayName("  bg  ")).toBe("bg");
    expect(cleanDisplayName("x".repeat(60)).length).toBe(40);
  });
  test("strips angle brackets", () => {
    expect(cleanDisplayName("<script>bg</script>")).toBe("scriptbg/script");
  });
  test("returns an empty string for missing input", () => {
    expect(cleanDisplayName(null)).toBe("");
    expect(cleanDisplayName(undefined)).toBe("");
    expect(cleanDisplayName("")).toBe("");
    expect(cleanDisplayName("   ")).toBe("");
  });
  test("coerces non-string input", () => {
    expect(cleanDisplayName(42)).toBe("42");
  });
});

describe("resolveDisplay", () => {
  const roster = [{ email: "beau@example.com", handle: "bg" }];
  test("prefers the roster handle for known emails", () => {
    expect(resolveDisplay("beau@example.com", "whatever", roster)).toBe("bg");
  });
  test("falls back to the provided name", () => {
    expect(resolveDisplay("new@example.com", "The Newcomer", roster)).toBe("The Newcomer");
  });
  test("falls back to the email local-part when no name is provided", () => {
    expect(resolveDisplay("drew@example.com", "", roster)).toBe("drew");
  });
  test("matches roster emails case-insensitively", () => {
    expect(resolveDisplay("BEAU@Example.COM", "whatever", roster)).toBe("bg");
  });
  test("cleans the provided name before using it", () => {
    expect(resolveDisplay("new@example.com", "  <b>Newcomer</b>  ", roster)).toBe("bNewcomer/b");
  });
  test("falls back to the local-part when the provided name is only whitespace", () => {
    expect(resolveDisplay("drew@example.com", "   ", roster)).toBe("drew");
  });
  test("never returns a full email address", () => {
    expect(resolveDisplay("drew@example.com", "", [])).toBe("drew");
  });
});

// --- HTTP contract ------------------------------------------------------
// A deliberately hostile D1 stub: the rsvps SELECT hands back FULL rows,
// emails included, so any handler that echoed a row straight through would
// leak. The GET body must still carry names only (spec section 3).

type RsvpRow = { email: string; display_name: string; game: string };

function makeEnv(rosterRows: { email: string; handle: string }[] = []) {
  const rows: RsvpRow[] = [];
  const db = {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt = {
        bind(...a: any[]) {
          args = a;
          return stmt;
        },
        async all() {
          if (sql.includes("FROM roster")) return { results: rosterRows };
          if (sql.includes("FROM rsvps")) {
            return { results: rows.filter((r) => r.game === args[0]) };
          }
          throw new Error(`unexpected read SQL: ${sql}`);
        },
        async run() {
          if (!sql.includes("INSERT INTO rsvps")) throw new Error(`unexpected write SQL: ${sql}`);
          const [email, display_name, game] = args;
          const hit = rows.find((r) => r.email === email && r.game === game);
          if (hit) hit.display_name = display_name;
          else rows.push({ email, display_name, game });
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return { env: { POKER_RSVP_DB: db }, rows };
}

const postReq = (body: unknown, raw?: string) =>
  new Request("https://poker.example/api/rsvp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw === undefined ? JSON.stringify(body) : raw,
  });

const getReq = (query: string) => new Request(`https://poker.example/api/rsvp${query}`);

describe("POST /api/rsvp", () => {
  test("records an RSVP and answers {ok: true}", async () => {
    const { env, rows } = makeEnv();
    const res = await onRequestPost({
      request: postReq({ email: "Tester@Example.com", displayName: "Tester", game: "2026-09-08" }),
      env,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
    expect(rows).toEqual([
      { email: "tester@example.com", display_name: "Tester", game: "2026-09-08" },
    ]);
  });

  test("shows the roster handle instead of the typed name for known players", async () => {
    const { env, rows } = makeEnv([{ email: "beau@example.com", handle: "bg" }]);
    await onRequestPost({
      request: postReq({ email: "beau@example.com", displayName: "Some Other Name", game: "2026-09-08" }),
      env,
    });
    expect(rows[0]!.display_name).toBe("bg");
  });

  test("upserts: one row per email per game, latest name wins", async () => {
    const { env, rows } = makeEnv();
    const game = "2026-09-08";
    await onRequestPost({ request: postReq({ email: "a@example.com", displayName: "First", game }), env });
    await onRequestPost({ request: postReq({ email: "a@example.com", displayName: "Second", game }), env });
    expect(rows).toEqual([{ email: "a@example.com", display_name: "Second", game }]);
  });

  test("stores a placeholder rather than an empty display name", async () => {
    const { env, rows } = makeEnv([{ email: "ghost@example.com", handle: "<>" }]);
    await onRequestPost({
      request: postReq({ email: "ghost@example.com", displayName: "", game: "2026-09-08" }),
      env,
    });
    expect(rows[0]!.display_name).toBe("player");
  });

  test("rejects a bad email with 400 and a readable message", async () => {
    const { env, rows } = makeEnv();
    const res = await onRequestPost({
      request: postReq({ email: "nope", displayName: "x", game: "2026-09-08" }),
      env,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That email does not look right." });
    expect(rows).toEqual([]);
  });

  test("rejects a bad or missing game date with 400", async () => {
    const { env } = makeEnv();
    for (const game of ["2026-9-8", "next tuesday", "", undefined]) {
      const res = await onRequestPost({
        request: postReq({ email: "a@example.com", displayName: "x", game }),
        env,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad game" });
    }
  });

  test("rejects a body that is not JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await onRequestPost({ request: postReq(null, "not json at all"), env });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad body" });
  });

  test("rejects a JSON body that is not an object with 400", async () => {
    const { env } = makeEnv();
    const res = await onRequestPost({ request: postReq(null, "null"), env });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That email does not look right." });
  });
});

describe("GET /api/rsvp", () => {
  test("returns the count and names for a game, never an email", async () => {
    const { env } = makeEnv([{ email: "beau@example.com", handle: "bg" }]);
    await onRequestPost({
      request: postReq({ email: "beau@example.com", displayName: "ignored", game: "2026-09-08" }),
      env,
    });
    await onRequestPost({
      request: postReq({ email: "drew@example.com", displayName: "", game: "2026-09-08" }),
      env,
    });
    const res = await onRequestGet({ request: getReq("?game=2026-09-08"), env });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("@");
    expect(JSON.parse(text)).toEqual({ count: 2, names: ["bg", "drew"] });
  });

  test("scopes to the requested game", async () => {
    const { env } = makeEnv();
    await onRequestPost({ request: postReq({ email: "a@example.com", displayName: "A", game: "2026-09-08" }), env });
    await onRequestPost({ request: postReq({ email: "b@example.com", displayName: "B", game: "2026-10-13" }), env });
    const res = await onRequestGet({ request: getReq("?game=2026-10-13"), env });
    expect(await res.json()).toEqual({ count: 1, names: ["B"] });
  });

  test("returns an empty roll for a game nobody has answered", async () => {
    const { env } = makeEnv();
    const res = await onRequestGet({ request: getReq("?game=2026-12-01"), env });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0, names: [] });
  });

  test("rejects a bad or missing game with 400", async () => {
    const { env } = makeEnv();
    for (const query of ["", "?game=", "?game=2026-9-8", "?game=all"]) {
      const res = await onRequestGet({ request: getReq(query), env });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad game" });
    }
  });
});
