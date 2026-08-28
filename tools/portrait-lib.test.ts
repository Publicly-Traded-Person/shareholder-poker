// Tests for the portrait consent helpers and (in later tasks, appended below)
// the three portrait Functions. Mirrors tools/rsvp-lib.test.ts: plain JS
// modules imported straight into bun:test, hostile stubs for the runtime.
// All fixture players are SYNTHETIC (repo privacy rule).
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the Pages Function runtime
import {
  randomToken, isValidToken, toSqlUtc, isExpired,
  latestAnswer, parseVariants, escapeHtml, ordinal, monthName,
  pngDims, addVariant, PANEL_W, PANEL_H,
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
// ORDER BY rowid ASC); the LAST VALID row wins, full stop. answered_at is
// never consulted for ordering (see latestAnswer's own why-comment: two
// writers on two clocks means the timestamp cannot be trusted to agree with
// true append order).
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
  // Clock skew: the POST Function and the CLI's revoke stamp answered_at from
  // two different clocks, so a row inserted LATER can carry an EARLIER
  // timestamp than the row before it. Ordering by answered_at would let that
  // skewed approve outlive a decline that was actually the last word; this
  // is exactly the bug the REDIRECT to insertion-order-only closes.
  test("an earlier-stamped decline after an approval still resolves to declined", () => {
    const r = latestAnswer([row("approved", "a", "2026-09-05 10:00:00"),
                            row("declined", null, "2026-09-01 10:00:00")]);
    expect(r).toEqual({ answer: "declined", variant: null, answeredAt: "2026-09-01 10:00:00" });
  });
  // Re-arms the CHECK-set guard against the insertion-order flip above: the
  // existing "ignores rows with answers outside the CHECK set" test puts its
  // invalid row FIRST, so it stays green even if the validity filter in
  // latestAnswer were deleted (the last row is already the valid one). These
  // two put the invalid answer in the position that actually exercises the
  // guard: last, and alone.
  test("an unrecognized answer in the last slot never becomes current", () => {
    const r = latestAnswer([row("approved", "a", "2026-09-01 10:00:00"),
                            row("maybe", "a", "2026-09-02 10:00:00")]);
    expect(r?.answer).toBe("approved");
  });
  test("a list of only invalid answers has no current answer", () => {
    expect(latestAnswer([row("maybe", "a", "2026-09-01 10:00:00")])).toBe(null);
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
// `metal` is optional because the column is nullable and because asks staged
// before the ALTER TABLE migration simply do not have one; the page treats a
// missing or unrecognized metal as "no upload block" rather than guessing a
// palette (halt, never guess).
export type AskRow = { token: string; handle: string; set_slug: string; variants: string;
                       expires_at: string; email?: string; metal?: string };
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

// Minimal real PNG header: 8-byte signature, IHDR length + type, then
// big-endian width and height. 620 = 0x026C, 236 = 0xEC. Shared by the
// helper tests below and the upload endpoint tests.
export const pngHeader = (w: number, h: number) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

// True once Task 1's dither module lands in the integrated tree. Guards the
// cross-module constants-sync test below so this task's own tests are green
// standalone in this worktree (site/portrait-dither.js does not exist here
// yet) and the sync check arms itself automatically once both tasks merge.
const ditherModuleExists = await Bun.file(
  new URL("../site/portrait-dither.js", import.meta.url),
).exists();

describe("pngDims / addVariant / panel constants", () => {
  test("panel constants are the fixed art-panel size", () => {
    expect(PANEL_W).toBe(620);
    expect(PANEL_H).toBe(236);
  });
  test.if(ditherModuleExists)("panel constants match the dither module's", async () => {
    // @ts-ignore - browser-shared module
    const dither = await import("../site/portrait-dither.js");
    expect(PANEL_W).toBe(dither.PANEL_W);
    expect(PANEL_H).toBe(dither.PANEL_H);
  });
  test("reads dimensions from a real header", () => {
    expect(pngDims(pngHeader(620, 236))).toEqual({ w: 620, h: 236 });
    expect(pngDims(pngHeader(10, 10))).toEqual({ w: 10, h: 10 });
  });
  test("rejects junk without throwing", () => {
    expect(pngDims(new Uint8Array(0))).toBe(null);
    expect(pngDims(new Uint8Array(23))).toBe(null);
    const notPng = pngHeader(620, 236); notPng[0] = 0x00;
    expect(pngDims(notPng)).toBe(null);
    const notIhdr = pngHeader(620, 236); notIhdr[12] = 0x4a;
    expect(pngDims(notIhdr)).toBe(null);
  });
  test("addVariant appends once and never mangles", () => {
    expect(addVariant('["a","b"]', "self")).toBe('["a","b","self"]');
    expect(addVariant('["a","b","self"]', "self")).toBe('["a","b","self"]');
    expect(addVariant("not json", "self")).toBe(null);
    expect(addVariant("[]", "self")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Task 6: GET /portrait/<token>, the server-rendered consent page.
// Appended below the shared stubs; nothing above this line is touched (Task 5
// appends its own block for the JSON surfaces). Import declarations are
// hoisted, so this one sits with its block rather than at the top of the file.
// @ts-ignore - plain JS Pages Function, imported straight into bun:test
import { onRequestGet as portraitPage } from "../functions/portrait/[token].js";

describe("GET /portrait/<token>", () => {
  // Stands in for the committed site/data/games.json. SYNTHETIC roster only:
  // no real player ever appears in a committed fixture (repo privacy rule).
  //
  // `entries` is deliberately 3 against only 2 result rows, mirroring the real
  // file: site/data/games.json ships the 2026-08 game as 8 entries over 7 rows
  // and 2026-07 as 9 over 6. A fixture where the two happened to match would
  // pass whether the page read `entries` (correct, and what tools/render.ts
  // publishes) or `results.length` (wrong), so the mismatch is the only thing
  // making the entrant-count assertion below mean anything.
  const FIXTURE_DATA = {
    players: [{ slug: "gene-t", name: "Gene T.", aka: ["genet"] }],
    games: [{
      date: "2026-08-11",
      hands: 100,
      entries: 3,
      cardSet: "2026-08",
      results: [
        { slug: "gene-t", handle: "genet", finish: 2, payout: 0, rebuys: 0, trophies: [] },
        { slug: "rosa-p", handle: "rosap", finish: 1, payout: 10, rebuys: 0, trophies: [] },
      ],
    }],
  };

  const EM_DASH = "—";
  const MONOGRAM_LINE =
    "Turning it down keeps the monogram card you already have. " +
    "The photo stays out and the card stays yours.";

  // Wraps makePortraitEnv rather than changing it: the factory is shared with
  // Task 5, which has no ASSETS binding to speak of.
  function pageEnv(asks: AskRow[], data: unknown = FIXTURE_DATA) {
    const made = makePortraitEnv(asks);
    (made.env as any).ASSETS = { fetch: async () => new Response(JSON.stringify(data)) };
    return made;
  }

  const pageRequest = () => new Request(`https://poker.kmikeym.com/portrait/${TOKEN}`);

  async function render(asks: AskRow[], token: string = TOKEN, data: unknown = FIXTURE_DATA) {
    const { env } = pageEnv(asks, data);
    const res = await portraitPage({ request: pageRequest(), params: { token }, env });
    return { res, html: await res.text() };
  }

  // The three headers are the whole privacy posture of this surface: never
  // cached, never indexed, and identical for a hit and a miss.
  const expectPrivateHeaders = (res: Response) => {
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  };

  test("an unknown token renders a 404 HTML page with the private headers", async () => {
    const { res, html } = await render([ASK], "f".repeat(32));
    expect(res.status).toBe(404);
    expectPrivateHeaders(res);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain("genet");
  });

  test("a malformed token 404s without touching the database", async () => {
    const { res } = await render([ASK], "../../etc/passwd");
    expect(res.status).toBe(404);
    expectPrivateHeaders(res);
  });

  // 404, never 403: a probe must not be able to tell a real token from a dead
  // one, so the expired body is byte-identical to the unknown-token body.
  test("an expired ask 404s with the same body as an unknown token", async () => {
    const expired = { ...ASK, expires_at: PAST };
    const gone = await render([expired]);
    const unknown = await render([], "f".repeat(32));
    expect(gone.res.status).toBe(404);
    expectPrivateHeaders(gone.res);
    expect(gone.html).toBe(unknown.html);
  });

  test("a live ask renders the card, the pickers, the stats and both actions", async () => {
    const { res, html } = await render([ASK]);
    expect(res.status).toBe(200);
    expectPrivateHeaders(res);
    expect(html).toContain("Gene T.");
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/a"`);
    expect(html).toContain('data-variant="a"');
    expect(html).toContain('data-variant="b"');
    expect(html).toContain("Use this one");
    expect(html).toContain("None of these");
    expect(html).toContain(MONOGRAM_LINE);
    // The entrant count is games.json `entries` (3), never the number of
    // result rows (2). A player reading "of 2" here while /games/2026-08-11/
    // says "8 entries" is the site contradicting itself on the one page whose
    // whole job is earning trust, so both halves are asserted.
    expect(html).toContain("2nd of 3");
    expect(html).not.toContain("2nd of 2");
    expect(html).toContain("100 hands");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  test("an existing approval renders as state, with that crop preselected", async () => {
    const { env, answers } = pageEnv([ASK]);
    answers.push({ token: TOKEN, answer: "approved", variant: "b",
                   answered_at: "2026-09-01 10:00:00" });
    const res = await portraitPage({ request: pageRequest(), params: { token: TOKEN }, env });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("You approved");
    expect(html).toContain('data-variant="b" aria-pressed="true"');
    expect(html).toContain('data-variant="a" aria-pressed="false"');
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/b"`);
  });

  test("no email address reaches the page, not even from the ask row", async () => {
    const { html } = await render([ASK]);
    expect(html).not.toContain("@");
    expect(html).not.toContain("leak@example.com");
    expect(html).not.toContain("example.com");
  });

  // Consent is asked for, never sold: the lime CTA belongs to RSVP only.
  test("both actions are btn-secondary and no lime CTA appears", async () => {
    const { html } = await render([ASK]);
    expect(html).not.toContain("btn-primary");
    expect(html).toContain('id="approve" class="btn-secondary"');
    expect(html).toContain('id="decline" class="btn-secondary"');
  });

  test("copy rules hold in runtime-rendered HTML too", async () => {
    const { html } = await render([ASK]);
    expect(html).not.toContain(EM_DASH);
    expect(/experiment/i.test(html)).toBe(false);
  });

  // A forwarded link must not become a side door into an unannounced set.
  test("the page links nowhere into the site", async () => {
    const { html } = await render([ASK]);
    expect(/<a href="\//.test(html)).toBe(false);
    expect(html).not.toContain("<a ");
  });

  test("a set missing from games.json renders the ask without a stats line", async () => {
    const noSet = { ...FIXTURE_DATA, games: [{ ...FIXTURE_DATA.games[0], cardSet: "2026-07" }] };
    const { res, html } = await render([ASK], TOKEN, noSet);
    expect(res.status).toBe(200);
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/a"`);
    expect(html).toContain("Use this one");
    expect(html).toContain("None of these");
    expect(html).not.toContain("Those are the numbers on the card");
    expect(html).not.toContain(" hands");
  });

  test("a player missing from the set results renders without a stats line", async () => {
    const noPlayer = {
      ...FIXTURE_DATA,
      games: [{ ...FIXTURE_DATA.games[0], results: [FIXTURE_DATA.games[0].results[1]] }],
    };
    const { res, html } = await render([ASK], TOKEN, noPlayer);
    expect(res.status).toBe(200);
    expect(html).toContain("Use this one");
    expect(html).not.toContain("Those are the numbers on the card");
    expect(html).not.toContain(" hands");
    expect(html).not.toContain("rosap");
  });

  // Halt, never guess, applied to the stats line: every number it prints has
  // to be in the record. Substituting `results.length` for a missing `entries`
  // would publish a count that contradicts /standings/ and the game page, and
  // a missing `hands` or `finish` would print "undefined" at a player. In both
  // cases the line is dropped whole, and the consent ask still works.
  test("a game with no entries count renders the ask without a stats line", async () => {
    const { entries, ...gameWithoutEntries } = FIXTURE_DATA.games[0];
    const data = { ...FIXTURE_DATA, games: [gameWithoutEntries] };
    const { res, html } = await render([ASK], TOKEN, data);
    expect(res.status).toBe(200);
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/a"`);
    expect(html).toContain("Use this one");
    expect(html).toContain("None of these");
    expect(html).not.toContain("Those are the numbers on the card");
    expect(html).not.toContain("2nd of");
    expect(html).not.toContain(" hands");
  });

  test("a game with no hand count renders the ask without a stats line", async () => {
    const { hands, ...gameWithoutHands } = FIXTURE_DATA.games[0];
    const data = { ...FIXTURE_DATA, games: [gameWithoutHands] };
    const { res, html } = await render([ASK], TOKEN, data);
    expect(res.status).toBe(200);
    expect(html).toContain("Use this one");
    expect(html).not.toContain("Those are the numbers on the card");
    expect(html).not.toContain("undefined");
  });

  test("a result with no finish position renders the ask without a stats line", async () => {
    const { finish, ...rowWithoutFinish } = FIXTURE_DATA.games[0].results[0];
    const data = {
      ...FIXTURE_DATA,
      games: [{ ...FIXTURE_DATA.games[0],
                results: [rowWithoutFinish, FIXTURE_DATA.games[0].results[1]] }],
    };
    const { res, html } = await render([ASK], TOKEN, data);
    expect(res.status).toBe(200);
    expect(html).toContain("Use this one");
    expect(html).not.toContain("Those are the numbers on the card");
    expect(html).not.toContain("undefined");
  });

  // Halt, never guess: a malformed variants column serves no image at all.
  test("an ask with a malformed variants column 404s", async () => {
    const bad = { ...ASK, variants: "not json" };
    const { res } = await render([bad]);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Task 5: the two API Functions (image streaming + answer recording), served
// at GET /api/portrait/<token>/img/<variant> and POST /api/portrait/<token>.
// Appended below the shared stubs and Task 6's page block; import
// declarations are hoisted, so these sit with their block rather than at the
// top of the file.
// @ts-ignore - plain JS module, Cloudflare Pages parameter filename
import { onRequestGet as imgOnRequestGet } from "../functions/api/portrait/[token]/img/[variant].js";
// @ts-ignore - plain JS module, Cloudflare Pages parameter filename
import { onRequestPost as answerOnRequestPost } from "../functions/api/portrait/[token].js";

// Every response body, on every branch of both handlers, must never contain
// "@" - the no-email boundary (spec s3, ASK carries a fake email precisely to
// catch a handler that echoes a row through unfiltered).
async function expectNoEmail(res: Response) {
  const text = await res.clone().text();
  expect(text.includes("@")).toBe(false);
}

describe("GET /api/portrait/<token>/img/<variant>", () => {
  const get = (token: string, variant: string, env: any) =>
    imgOnRequestGet({ params: { token, variant }, env } as any);

  test("unknown token 404s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await get("f".repeat(32), "a", env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("invalid token shape 404s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await get("not-a-token", "a", env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  // STOCKS THE BUCKET with the exact object this request would otherwise be
  // served, on purpose: without an object present the stub bucket is empty
  // and the handler 404s at the missing-object check no matter what, which
  // would leave the expiry guard free to be deleted with this test still
  // green. With the object present, expiry is the only thing that can
  // produce the 404 - the single highest-stakes guard in this feature, since
  // this endpoint is the only path by which an unconsented face reaches a
  // browser (spec s4).
  test("expired ask 404s", async () => {
    const { env } = makePortraitEnv([{ ...ASK, expires_at: PAST }],
      { [`asks/${ASK.set_slug}/${ASK.handle}/a.png`]: "PNG_STUB_BYTES" });
    const res = await get(TOKEN, "a", env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  // The next two tests also STOCK THE BUCKET with the very object the request
  // asks for, on purpose. Without it the stub bucket is empty and the handler
  // 404s at the missing-object check no matter what, so the variant guard
  // under test could be deleted and these would still pass. With the object
  // present the ask-level guard is the only thing that can produce the 404.
  test("variant not in the ask 404s", async () => {
    const { env } = makePortraitEnv([ASK], { "asks/2026-08/genet/z.png": "PNG_STUB_BYTES" });
    const res = await get(TOKEN, "z", env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("malformed variants column 404s (halt, never guess)", async () => {
    const { env } = makePortraitEnv([{ ...ASK, variants: "not json" }],
      { "asks/2026-08/genet/a.png": "PNG_STUB_BYTES" });
    const res = await get(TOKEN, "a", env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("missing R2 object 404s", async () => {
    const { env } = makePortraitEnv([ASK], {});
    const res = await get(TOKEN, "a", env);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    await expectNoEmail(res);
  });

  test("happy path streams the stub PNG body untouched", async () => {
    const key = `asks/${ASK.set_slug}/${ASK.handle}/a.png`;
    const { env } = makePortraitEnv([ASK], { [key]: "PNG_STUB_BYTES" });
    const res = await get(TOKEN, "a", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await res.clone().text()).toBe("PNG_STUB_BYTES");
    await expectNoEmail(res);
  });
});

describe("POST /api/portrait/<token>", () => {
  const post = (token: string, rawBody: string, env: any) =>
    answerOnRequestPost({
      request: new Request(`https://poker.kmikeym.com/api/portrait/${token}`,
        { method: "POST", body: rawBody }),
      params: { token },
      env,
    } as any);

  test("invalid token shape 404s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post("not-a-token", JSON.stringify({ answer: "declined" }), env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("unknown token 404s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post("f".repeat(32), JSON.stringify({ answer: "declined" }), env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("expired ask 404s", async () => {
    const { env } = makePortraitEnv([{ ...ASK, expires_at: PAST }]);
    const res = await post(TOKEN, JSON.stringify({ answer: "declined" }), env);
    expect(res.status).toBe(404);
    await expectNoEmail(res);
  });

  test("non-JSON body 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, "not json", env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  // Every other body test above builds a real Request with an in-memory
  // string, and reading that body never rejects - so none of them exercise
  // the try/catch around request.text() in the handler. Only a stub whose
  // text() itself throws (an aborted upload, a malformed transfer encoding)
  // reaches that branch. Without the catch this would blow out as an
  // unhandled 500 instead of the same 400 bad-body response every other
  // malformed-body case gets, and the handler's own header comment already
  // promises this behavior (comments are normative in this repo).
  test("a request whose body stream rejects still 400s as a bad body", async () => {
    const { env, answers } = makePortraitEnv([ASK]);
    const badRequest = { text: async () => { throw new Error("aborted"); } };
    const res = await answerOnRequestPost(
      { request: badRequest as any, params: { token: TOKEN }, env } as any);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "bad body" });
    await expectNoEmail(res);
    expect(answers.length).toBe(0);
  });

  test("body over 1024 bytes 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const big = JSON.stringify({ answer: "declined", pad: "x".repeat(1100) });
    expect(big.length).toBeGreaterThan(1024);
    const res = await post(TOKEN, big, env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  test("answer outside the allowed set 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "maybe" }), env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  test("approved without a variant 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "approved" }), env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  test("approved with a variant outside the ask 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "approved", variant: "z" }), env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  test("declined with a variant 400s", async () => {
    const { env } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "declined", variant: "a" }), env);
    expect(res.status).toBe(400);
    await expectNoEmail(res);
  });

  // Same halt-don't-guess posture as the image endpoint: a malformed variants
  // column must stop the request BEFORE the insert, on both answers. Without
  // the handler's parseVariants guard a decline would silently record a row
  // against an ask nobody can read, so this asserts no side effect as well as
  // the 404.
  test("malformed variants column 404s and records nothing", async () => {
    const bad = [{ ...ASK, variants: "not json" }];
    const declined = makePortraitEnv(bad);
    const resDeclined = await post(TOKEN, JSON.stringify({ answer: "declined" }), declined.env);
    expect(resDeclined.status).toBe(404);
    await expectNoEmail(resDeclined);
    expect(declined.answers.length).toBe(0);

    const approved = makePortraitEnv(bad);
    const resApproved = await post(TOKEN, JSON.stringify({ answer: "approved", variant: "a" }), approved.env);
    expect(resApproved.status).toBe(404);
    await expectNoEmail(resApproved);
    expect(approved.answers.length).toBe(0);
  });

  test("approved happy path records exactly one row and returns it", async () => {
    const { env, answers } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "approved", variant: "b" }), env);
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ ok: true, answer: "approved", variant: "b" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    await expectNoEmail(res);
    expect(answers.length).toBe(1);
    expect(answers[0].variant).toBe("b");
    expect(answers[0].answered_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("declined happy path records a row with variant null", async () => {
    const { env, answers } = makePortraitEnv([ASK]);
    const res = await post(TOKEN, JSON.stringify({ answer: "declined" }), env);
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ ok: true, answer: "declined", variant: null });
    await expectNoEmail(res);
    expect(answers.length).toBe(1);
    expect(answers[0].variant).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Task 4: POST /api/portrait/<token>/upload, the self-serve upload endpoint.
// Uploading a browser-composited panel IS approving (self-upload spec s4):
// the R2 put, the variants column update, and the approved/self ledger row
// all happen inside one handler, because a stored-but-unconsented state must
// never exist. Appended below Task 5's block; import declarations are
// hoisted, so this one sits with its block rather than at the top of the file.
// @ts-ignore - plain JS Pages Function, Cloudflare parameter filename
import { onRequestPost as uploadOnRequestPost } from "../functions/api/portrait/[token]/upload.js";

describe("POST /api/portrait/<token>/upload", () => {
  // A richer stub than makePortraitEnv on purpose: the upload handler needs an
  // UPDATE recorder (for the variants column), an R2 put recorder, and an
  // ASSETS flag read, which the shared factory deliberately lacks. Do NOT
  // fold this into makePortraitEnv - Task 5's block above depends on that
  // factory staying exactly as it is.
  function makeUploadEnv(asks: AskRow[], flag: unknown = { portraitUploads: true }) {
    const answers: AnswerRow[] = [];
    const updates: { variants: string; token: string }[] = [];
    const puts: { key: string; size: number }[] = [];
    const db = {
      prepare(sql: string) {
        let args: any[] = [];
        const stmt = {
          bind(...a: any[]) { args = a; return stmt; },
          async first() {
            if (!sql.includes("FROM portrait_asks")) throw new Error(`unexpected first(): ${sql}`);
            return asks.find((r) => r.token === args[0]) ?? null;
          },
          async run() {
            if (sql.includes("UPDATE portrait_asks SET variants")) {
              updates.push({ variants: args[0], token: args[1] });
              return { success: true };
            }
            if (sql.includes("INSERT INTO portrait_answers")) {
              answers.push({ token: args[0], answer: "approved", variant: "self", answered_at: args[1] });
              return { success: true };
            }
            throw new Error(`unexpected run(): ${sql}`);
          },
          async all() { throw new Error(`unexpected all(): ${sql}`); },
        };
        return stmt;
      },
    };
    const bucket = { async put(key: string, bytes: Uint8Array) { puts.push({ key, size: bytes.byteLength }); } };
    const assets = {
      async fetch() {
        if (flag === "throw") throw new Error("assets down");
        return new Response(JSON.stringify(flag));
      },
    };
    return { env: { POKER_RSVP_DB: db, POKER_PORTRAITS: bucket, ASSETS: assets }, answers, updates, puts };
  }
  const pngBody = (w: number, h: number, pad = 100) => {
    const head = pngHeader(w, h); // file-scope fixture, Task 3's describe block
    const b = new Uint8Array(head.length + pad);
    b.set(head);
    return b;
  };
  const uploadReq = (body: Uint8Array | string) =>
    new Request(`https://poker.example/api/portrait/${TOKEN}/upload`, {
      method: "POST", headers: { "Content-Type": "image/png" }, body,
    });

  // JSON-response privacy headers, distinct from GET /portrait's HTML-page
  // check above (no Content-Type: text/html assertion here).
  const expectPrivateHeaders = (res: Response) => {
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  };

  const expectNoSideEffects = (made: ReturnType<typeof makeUploadEnv>) => {
    expect(made.puts.length).toBe(0);
    expect(made.updates.length).toBe(0);
    expect(made.answers.length).toBe(0);
  };

  const post = (token: string, body: Uint8Array | string, env: any) =>
    uploadOnRequestPost({ request: uploadReq(body), params: { token }, env } as any);

  test("invalid token shape 404s", async () => {
    const made = makeUploadEnv([ASK]);
    const res = await post("not-a-token", pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("unknown token 404s", async () => {
    const made = makeUploadEnv([ASK]);
    const res = await post("f".repeat(32), pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("expired ask 404s", async () => {
    const made = makeUploadEnv([{ ...ASK, expires_at: PAST }]);
    const res = await post(TOKEN, pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("flag off (portraitUploads: false) 404s", async () => {
    const made = makeUploadEnv([ASK], { portraitUploads: false });
    const res = await post(TOKEN, pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("flag missing from games.json 404s", async () => {
    const made = makeUploadEnv([ASK], {});
    const res = await post(TOKEN, pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  // The flag read fails CLOSED: an ASSETS fetch that throws must read as
  // "uploads are off", never as an unhandled error that might leak a 500 with
  // a stack trace (self-upload spec s8).
  test("an ASSETS read failure 404s (fails closed)", async () => {
    const made = makeUploadEnv([ASK], "throw");
    const res = await post(TOKEN, pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("a body over 262144 bytes 400s", async () => {
    const made = makeUploadEnv([ASK]);
    const big = new Uint8Array(262144 + 1);
    const res = await post(TOKEN, big, made.env);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "too large" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("an empty body 400s", async () => {
    const made = makeUploadEnv([ASK]);
    const res = await post(TOKEN, new Uint8Array(0), made.env);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "bad body" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("non-PNG bytes 400s as a bad image", async () => {
    const made = makeUploadEnv([ASK]);
    const junk = new Uint8Array(200).fill(7);
    const res = await post(TOKEN, junk, made.env);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "bad image" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("a PNG with the wrong width 400s as a bad image", async () => {
    const made = makeUploadEnv([ASK]);
    const res = await post(TOKEN, pngBody(619, PANEL_H), made.env);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "bad image" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("a PNG with the wrong height 400s as a bad image", async () => {
    const made = makeUploadEnv([ASK]);
    const res = await post(TOKEN, pngBody(PANEL_W, 235), made.env);
    expect(res.status).toBe(400);
    expect(await res.clone().json()).toEqual({ error: "bad image" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  // Halt, never guess: same posture as the other two portrait handlers. A
  // malformed variants column must stop the request before the R2 put or
  // either write, never be silently repaired.
  test("a malformed variants column 404s and records nothing", async () => {
    const made = makeUploadEnv([{ ...ASK, variants: "not json" }]);
    const res = await post(TOKEN, pngBody(PANEL_W, PANEL_H), made.env);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "not found" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expectNoSideEffects(made);
  });

  test("the happy path stores the panel, updates variants, and appends approved/self", async () => {
    const made = makeUploadEnv([ASK]);
    const body = pngBody(PANEL_W, PANEL_H);
    const res = await post(TOKEN, body, made.env);
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ ok: true, answer: "approved", variant: "self" });
    expectPrivateHeaders(res);
    await expectNoEmail(res);
    expect(made.puts).toEqual([{ key: "asks/2026-08/genet/self.png", size: body.byteLength }]);
    expect(made.updates).toEqual([{ variants: '["a","b","self"]', token: TOKEN }]);
    expect(made.answers.length).toBe(1);
    expect(made.answers[0].token).toBe(TOKEN);
    expect(made.answers[0].answer).toBe("approved");
    expect(made.answers[0].variant).toBe("self");
    expect(made.answers[0].answered_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // A player is free to re-upload (a better lighting take, a retake). Each
  // upload is its own approval event in the ledger, but the variants column
  // - a set, not a log - never grows a duplicate "self" entry.
  test("re-uploading records a second put and a second answer row, variants stay deduped", async () => {
    const made = makeUploadEnv([ASK]);
    const body = pngBody(PANEL_W, PANEL_H);
    await post(TOKEN, body, made.env);
    const res = await post(TOKEN, body, made.env);
    expect(res.status).toBe(200);
    expect(made.puts.length).toBe(2);
    expect(made.updates.length).toBe(2);
    expect(made.updates[1]).toEqual({ variants: '["a","b","self"]', token: TOKEN });
    expect(made.answers.length).toBe(2);
    expect(made.answers[1].answer).toBe("approved");
    expect(made.answers[1].variant).toBe("self");
  });
});

// Task 5: the self-upload block on GET /portrait/<token>. Appended below the
// blocks above; nothing above this line is touched except the shared AskRow
// type, which gained an optional `metal` field. The page module is already
// imported as `portraitPage` with its own block and import declarations are
// hoisted, so this block reuses that binding rather than importing twice.
//
// What is under test is a three-way AND: the block renders only when the
// games.json flag is on, the ask carries one of the four real rarity metals,
// and the ask is live. Each leg gets its own case, because any leg failing
// OPEN would put an upload surface on a page that was never configured for
// one.
describe("GET /portrait/<token> upload block", () => {
  // Same SYNTHETIC roster as the page block above (no real player ever appears
  // in a committed fixture, repo privacy rule), plus the one root flag the
  // page reads out of site/data/games.json.
  const FIXTURE_DATA = {
    portraitUploads: true,
    players: [{ slug: "gene-t", name: "Gene T.", aka: ["genet"] }],
    games: [{
      date: "2026-08-11",
      hands: 100,
      entries: 3,
      cardSet: "2026-08",
      results: [
        { slug: "gene-t", handle: "genet", finish: 2, payout: 0, rebuys: 0, trophies: [] },
        { slug: "rosa-p", handle: "rosap", finish: 1, payout: 10, rebuys: 0, trophies: [] },
      ],
    }],
  };

  // Every string the upload block is responsible for putting on the page: the
  // offer, the file input, the approve button, the dither module URL, and the
  // promise about where the pixels go. Asserted as a set so a case that turns
  // the block OFF has to lose all six, not just the one a test happened to
  // name.
  const UPLOAD_MARKERS = [
    "Or use a different photo",
    'id="photo-in"',
    'accept="image/*"',
    'id="use-photo"',
    "/portrait-dither.js",
    "It never leaves your device",
  ];

  const PANEL_CAPTION = "Your art panel; the printed card carries it in the art slot.";
  const EM_DASH = "—";

  // Wraps makePortraitEnv the same way the page block above does: the shared
  // factory has no ASSETS binding, and this surface needs one.
  function uploadEnv(asks: AskRow[], data: unknown = FIXTURE_DATA) {
    const made = makePortraitEnv(asks);
    (made.env as any).ASSETS = { fetch: async () => new Response(JSON.stringify(data)) };
    return made;
  }

  const pageRequest = () => new Request(`https://poker.kmikeym.com/portrait/${TOKEN}`);

  async function renderWith(env: any) {
    const res = await portraitPage({ request: pageRequest(), params: { token: TOKEN }, env });
    return { res, html: await res.text() };
  }

  async function render(asks: AskRow[], data: unknown = FIXTURE_DATA) {
    return renderWith(uploadEnv(asks, data).env);
  }

  const expectBlockAbsent = (html: string) => {
    for (const marker of UPLOAD_MARKERS) expect(html).not.toContain(marker);
  };

  const COPPER_ASK: AskRow = { ...ASK, metal: "copper" };
  const SELF_ASK: AskRow = { ...COPPER_ASK, variants: '["a","b","self"]' };

  test("flag on, a real metal and a live ask render the whole block", async () => {
    const { res, html } = await render([COPPER_ASK]);
    expect(res.status).toBe(200);
    for (const marker of UPLOAD_MARKERS) expect(html).toContain(marker);
  });

  // The block cannot render without a metal: composePanel throws on an unknown
  // ramp, and guessing one would put a palette the card does not use in front
  // of the person being asked to consent to it.
  test("an ask with no metal renders the page without the block", async () => {
    const { res, html } = await render([ASK]);
    expect(res.status).toBe(200);
    expectBlockAbsent(html);
    // The staged-crop flow is complete on its own; only the block is gone.
    expect(html).toContain("Use this one");
    expect(html).toContain("None of these");
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/a"`);
  });

  test("an ask with a metal outside the four ramps renders no block", async () => {
    const { res, html } = await render([{ ...ASK, metal: "chrome" }]);
    expect(res.status).toBe(200);
    expectBlockAbsent(html);
    expect(html).toContain("Use this one");
  });

  test("the flag off renders no block even with a real metal", async () => {
    const { res, html } = await render([COPPER_ASK], { ...FIXTURE_DATA, portraitUploads: false });
    expect(res.status).toBe(200);
    expectBlockAbsent(html);
    expect(html).toContain("Use this one");
  });

  // Fail CLOSED (spec s8): if the flag cannot be read, uploads are off. The
  // page still renders, because the consent ask is the point and a dead asset
  // fetch must not take it down with it.
  test("a games.json read failure leaves uploads off and still renders the page", async () => {
    const { env } = makePortraitEnv([COPPER_ASK]);
    (env as any).ASSETS = { fetch: async () => { throw new Error("asset store unreachable"); } };
    const { res, html } = await renderWith(env);
    expect(res.status).toBe(200);
    expectBlockAbsent(html);
    expect(html).toContain("Use this one");
    expect(html).toContain("None of these");
  });

  // `self` is an ordinary variant everywhere downstream, but it is a person's
  // own photo, not a crop someone staged for them, so the picker says so.
  test("a self variant reads as Your photo in the picker, never Crop SELF", async () => {
    const { html } = await render([SELF_ASK]);
    expect(html).toContain("Your photo");
    expect(html).not.toContain("Crop SELF");
    expect(html).toContain("Crop A");
    expect(html).toContain("Crop B");
  });

  // Display rule (spec s4): staged variants are whole cards, `self` is an art
  // panel. The page shows the panel at panel proportions and says so, rather
  // than faking a full-card composite it cannot make truthfully.
  test("self selected shows the panel figure with its caption visible", async () => {
    const { env, answers } = uploadEnv([SELF_ASK]);
    answers.push({ token: TOKEN, answer: "approved", variant: "self",
                   answered_at: "2026-09-01 10:00:00" });
    const { res, html } = await renderWith(env);
    expect(res.status).toBe(200);
    expect(html).toContain('<figure class="card-shot card-shot--panel">');
    expect(html).toContain(`<figcaption id="panel-note" class="fine">${PANEL_CAPTION}</figcaption>`);
  });

  test("a staged crop selected keeps the card figure and hides the caption", async () => {
    const { env, answers } = uploadEnv([SELF_ASK]);
    answers.push({ token: TOKEN, answer: "approved", variant: "b",
                   answered_at: "2026-09-01 10:00:00" });
    const { res, html } = await renderWith(env);
    expect(res.status).toBe(200);
    expect(html).toContain('<figure class="card-shot">');
    expect(html).not.toContain("card-shot--panel\">");
    expect(html).toContain(
      `<figcaption id="panel-note" class="fine" hidden>${PANEL_CAPTION}</figcaption>`);
  });

  // The block adds copy and a second script to a page whose copy rules are
  // load-bearing, so they are re-asserted with the block ON. ASK carries a
  // fake email precisely so an "@" anywhere in the output fails loudly.
  test("copy, privacy and brand rules hold with the block rendered", async () => {
    const { html } = await render([SELF_ASK]);
    expect(html).not.toContain(EM_DASH);
    expect(/experiment/i.test(html)).toBe(false);
    expect(html).not.toContain("btn-primary");
    expect(html).not.toContain("@");
    expect(/<a href="\//.test(html)).toBe(false);
  });

  // The runbook promises that flipping portraitUploads off only stops NEW
  // uploads: a panel a player already approved keeps serving and keeps
  // printing (consent given does not evaporate). No prior test pairs the
  // flag being off with an ask that already has an approved self answer, so
  // this pins that exact combination: flag off, real metal, self approved.
  test("the flag off still serves an already-approved self answer", async () => {
    const { env, answers } = uploadEnv([SELF_ASK], { ...FIXTURE_DATA, portraitUploads: false });
    answers.push({ token: TOKEN, answer: "approved", variant: "self",
                   answered_at: "2026-09-01 10:00:00" });
    const { res, html } = await renderWith(env);
    expect(res.status).toBe(200);
    expect(html).toContain(`src="/api/portrait/${TOKEN}/img/self"`);
    expect(html).toContain("Your photo");
    expect(html).toContain("You approved crop SELF on 2026-09-01");
    // Consent already on record is not a reason to offer a NEW upload: the
    // flag is off, so the whole block (input, button, dither script, copy)
    // must be gone, same bar as every other block-absent case above.
    expectBlockAbsent(html);
  });
});
