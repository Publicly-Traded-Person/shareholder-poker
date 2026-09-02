# Portrait Consent Pages Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each player gets a private capability URL showing their own rendered card; they approve a portrait crop or decline it, and the answer lands in an append-only D1 ledger.

**Architecture:** Three Pages Functions (`/portrait/<token>` page, `POST /api/portrait/<token>` answer, `GET /api/portrait/<token>/img/<variant>` image) backed by two new D1 tables and a private R2 bucket (`poker-portraits`, §14 resolved to R2). One Bun CLI (`tools/portrait-asks.ts`) ingests Charlie's `candidates/` directory (manifest + whole-card PNGs), uploads to R2, upserts asks, prints links. Pure logic lives in `functions/api/_portrait.js` (runtime-shared, mirrors `_lib.js`) and `tools/lib/portraits.ts`, both exercised directly by `bun test`.

**Tech Stack:** Cloudflare Pages Functions (plain JS), D1 (`poker-rsvp-db`), R2, Bun + TypeScript tools, `bun:test`. Wrangler is shelled out to for all remote state; no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-portrait-consent-pages-design.md` (in PR #18; also readable at `origin/charlie/portrait-consent-spec`). §14 decision: **R2, upheld by Nova** (real candidate files measured 152 to 549KB, up to 4.6x the spec's estimate; base64-in-D1 pollutes the one human-legible database and hides state instead of removing it).

**Acceptance:** suite — committed bun test suite plus per-task review; no seal requested.

## Global Constraints

- Privacy (site spec §3, consent spec §3): no email address ever appears in a response body, a new table, tool output, or a test fixture. New tables key on `handle`.
- Candidate portrait PNGs NEVER enter this repo's git tree. Committed fixtures are synthetic: invented players only (never `kmikeym`, `LEWD`, `bg`, `spladow`, `amaxwell`, `nickmershon`, `MoHDI_Drew`, `Webvee`, or any real player name).
- Tokens: 32 lowercase hex chars from `crypto.getRandomValues`, never derived from the handle.
- Unknown and expired tokens return 404, never 403. Responses on `/portrait/*` and `/api/portrait/*` carry `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` (Pages `_headers` does not apply to Function responses, so the Functions set these themselves).
- Copy rules (apply to runtime-rendered HTML too): no em dashes, the word "experiment" never appears, dignity rule on every player mention, names are First + last initial, **no lime CTA on the consent page** (use `.btn-secondary` only; `.btn-primary` must not appear).
- The consent page links nowhere into poker.kmikeym.com (no nav, no footer links): a shared link must not become a side door into an unannounced set.
- Validation halts, never guesses (`publish-game` posture): unknown handle, variant without PNG, PNG without manifest entry all stop the run before any side effect.
- Every file opens with a header comment (what it is, where it sits, how to run or where served); every exported function gets a what/returns/throws comment with the why behind each invariant (repo rule, Mike 2026-08-18).
- `site/data/games.json` is read-only for this feature. Generated pages (`site/standings/`, `site/games/index.html`) are not touched.
- Never push to `main` (every push deploys). `bun test tools` green before any commit.

---

### Task 1: Schema, R2 binding, and headers config

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `site/schema.sql`
- Modify: `wrangler.toml`
- Modify: `site/_headers`
- Test: `tools/portrait-schema.test.ts`

**Interfaces:**
- Produces: D1 tables `portrait_asks(token, handle, set_slug, variants, created_at, expires_at)` and `portrait_answers(token, answer, variant, answered_at)`; wrangler binding `POKER_PORTRAITS` for bucket `poker-portraits`.

- [ ] **Step 1: Write the failing drift-guard test** at `tools/portrait-schema.test.ts`:

```ts
// Guards site/schema.sql against silent loss of the portrait consent tables.
// schema.sql is hand-maintained; these assertions fail loudly if a future
// edit drops a constraint the consent flow depends on (spec 2026-08-26 s5).
import { describe, expect, test } from "bun:test";

const schema = await Bun.file(new URL("../site/schema.sql", import.meta.url)).text();

describe("portrait consent schema", () => {
  test("portrait_asks exists with the enumeration guards", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS portrait_asks");
    expect(schema).toContain("UNIQUE(handle, set_slug)");
    expect(schema).toContain("expires_at");
  });
  test("portrait_answers is append-only shaped with the CHECK", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS portrait_answers");
    expect(schema).toContain("CHECK (answer IN ('approved','declined'))");
    expect(schema).toContain("portrait_answers_token_time");
  });
  test("no email column in either portrait table", () => {
    // Column defs start a line with two spaces then the name; comments start
    // with "--" and may mention the word email while explaining the boundary.
    const portraitPart = schema.slice(schema.indexOf("portrait_asks"));
    expect(/\n\s+email\s/.test(portraitPart)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`bun test tools/portrait-schema.test.ts`): schema.sql lacks the tables.

- [ ] **Step 3: Append to `site/schema.sql`** (verbatim; the comments are load-bearing per repo rules):

```sql
-- Portrait consent (spec docs/superpowers/specs/2026-08-26-portrait-consent-pages-design.md).
-- One ask per player per set. Created by tools/portrait-asks.ts, never by hand.
CREATE TABLE IF NOT EXISTS portrait_asks (
  token      TEXT PRIMARY KEY,     -- 32 hex, random. NOT derived from handle:
                                   -- a derivable token makes the roster enumerable.
  handle     TEXT NOT NULL,        -- keys on handle, never email: roster already
                                   -- maps email to handle; a second email home
                                   -- would be a second door through the boundary.
  set_slug   TEXT NOT NULL,        -- 'YYYY-MM', matches site/cards/<set_slug>/
  variants   TEXT NOT NULL,        -- JSON array of variant ids; array order IS display order
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,        -- 60 days out; an expired ask 404s, same as unknown
  UNIQUE(handle, set_slug)         -- re-staging a player replaces their ask (new token,
                                   -- so a previously shared link goes dead)
);

-- APPEND-ONLY. The latest row for a token is the current answer.
-- Deliberately not an UPDATE: a player who approves in September and changes
-- their mind in March must be able to withdraw, and withdrawal must not erase
-- the fact that consent was once given. Consent has a history and the schema
-- holds it. Read with: ORDER BY answered_at DESC, rowid DESC LIMIT 1.
CREATE TABLE IF NOT EXISTS portrait_answers (
  token       TEXT NOT NULL,
  answer      TEXT NOT NULL CHECK (answer IN ('approved','declined')),
  variant     TEXT,                -- chosen variant id when approved; NULL when declined
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS portrait_answers_token_time
  ON portrait_answers (token, answered_at DESC);
```

- [ ] **Step 4: Append to `wrangler.toml`**:

```toml
# Candidate card portraits, Tier 2b (portrait consent spec s3): PRIVATE bucket.
# Holds rendered candidate cards only (never source photos), one object per
# player per variant at asks/<set_slug>/<handle>/<variant>.png. Never public,
# never in git; every read goes through functions/api/portrait/.../img/.
[[r2_buckets]]
binding = "POKER_PORTRAITS"
bucket_name = "poker-portraits"
```

- [ ] **Step 5: Append to `site/_headers`**:

```
# Portrait consent capability URLs. NOTE: Pages applies _headers to static
# assets only, so the Functions set X-Robots-Tag on their own responses;
# these entries cover any future static file that lands under these paths.
/portrait/*
  X-Robots-Tag: noindex, nofollow
/api/portrait/*
  X-Robots-Tag: noindex, nofollow
```

- [ ] **Step 6: Run the test, expect PASS**, then run the whole suite (`bun test tools`) to confirm nothing else broke.
- [ ] **Step 7: Commit** (`config: portrait consent tables, R2 binding, noindex headers`).

---

### Task 2: Pure consent helpers (`_portrait.js`)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `functions/api/_portrait.js`
- Test: `tools/portrait-lib.test.ts`

**Interfaces:**
- Produces: `randomToken(): string`, `isValidToken(s): boolean`, `toSqlUtc(date: Date): string`, `isExpired(expiresAt, nowStr): boolean`, `latestAnswer(rows): {answer, variant, answeredAt} | null`, `parseVariants(json): string[] | null`, `escapeHtml(s): string`, `ordinal(n): string`, `monthName(setSlug): string`. Also, file-scope in `tools/portrait-lib.test.ts` for Tasks 5 and 6 to build on (do not rename): `makePortraitEnv(asks, objects?)`, `TOKEN`, `FUTURE`, `PAST`, `ASK`.

**Parallelization rationale:** the hostile-stub factory the handler tests need is defined here, in the test file's creating task, so Tasks 5 and 6 append their describe blocks against a fixed fixture contract and stay parallel to each other.

This task is the consent-withdrawal logic. Spec §10: a bug here is an ethical problem, not a display problem. Exact code, every step.

- [ ] **Step 1: Write the failing tests** at `tools/portrait-lib.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect FAIL** (module does not exist): `bun test tools/portrait-lib.test.ts`
- [ ] **Step 3: Implement `functions/api/_portrait.js`**:

```js
// Pure helpers for the portrait consent surfaces: /portrait/<token> and the
// two /api/portrait/... Functions. Kept dependency-free and runtime-agnostic
// so bun test can exercise them directly, mirroring _lib.js. Served nowhere;
// imported by the Functions in functions/portrait/ and functions/api/portrait/.

// 32 lowercase hex chars from crypto.getRandomValues. NEVER derived from the
// handle: a derivable token makes the whole roster enumerable from one link
// (spec s4). Returns a fresh token every call.
export function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// True only for the exact shape randomToken emits. Anything else (uppercase,
// wrong length, path traversal junk) is rejected before it reaches SQL or R2.
export function isValidToken(s) {
  return typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
}

// The one place the SQLite datetime('now') shape ("YYYY-MM-DD HH:MM:SS", UTC)
// is produced. Every expiry comparison is lexicographic on this fixed shape,
// which only works if writer and reader share a single formatter.
export function toSqlUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Expired when the deadline is not strictly in the future. Fails CLOSED: a
// missing or malformed expires_at reads as expired, because serving an
// unconsented face on a broken row is the worse error (spec s8).
export function isExpired(expiresAt, nowStr) {
  return !(typeof expiresAt === "string" && expiresAt > nowStr);
}

// The current answer is the LATEST valid row; ties on answered_at (a
// same-second change of mind) resolve to the later insertion, so callers must
// pass rows in insertion order (SELECT ... ORDER BY rowid ASC). A declined
// row never carries a variant out. A bug here is an ethical problem, not a
// display problem (spec s10), which is why this is pure and heavily tested.
export function latestAnswer(rows) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  let bestIdx = -1;
  rows.forEach((r, i) => {
    if (!r || (r.answer !== "approved" && r.answer !== "declined")) return;
    const later =
      best === null ||
      r.answered_at > best.answered_at ||
      (r.answered_at === best.answered_at && i > bestIdx);
    if (later) { best = r; bestIdx = i; }
  });
  if (best === null) return null;
  return {
    answer: best.answer,
    variant: best.answer === "approved" ? (best.variant ?? null) : null,
    answeredAt: best.answered_at,
  };
}

// Parses the portrait_asks.variants column. Returns the id array, or null on
// any deviation so the caller can 404 rather than guess: a malformed ask must
// never serve an image (halt-don't-guess, same posture as publish-game).
export function parseVariants(json) {
  let v;
  try { v = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(v) || v.length === 0) return null;
  if (!v.every((x) => typeof x === "string" && /^[a-z0-9]{1,8}$/.test(x))) return null;
  return v;
}

// Minimal HTML escaping for the server-rendered page. Player names come from
// committed games.json (trusted), but escaping is unconditional anyway.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// English ordinal for a finish position (1st, 2nd, 3rd, 11th...).
export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

// "2026-08" to "August 2026", for page copy. Fixed English month table so the
// output never depends on runtime locale.
export function monthName(setSlug) {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const [y, m] = String(setSlug).split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
```

- [ ] **Step 4: Run, expect PASS**: `bun test tools/portrait-lib.test.ts`
- [ ] **Step 5: Commit** (`feat: pure portrait consent helpers, TDD`).

---

### Task 3: Manifest validation and SQL core (`tools/lib/portraits.ts`)

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `tools/lib/portraits.ts`
- Test: `tools/portraits.test.ts`

**Interfaces:**
- Consumes: `GamesData` type from `tools/lib/standings.ts` (exists on main; shape: `{ players: {slug, name, aka: string[]}[], games: {date, hands, cardSet, results: {slug, handle, finish, ...}[]}[] }`).
- Produces: `type CandidateSet = { setSlug: string; players: { handle: string; variants: string[] }[] }`; `knownHandles(data): Set<string>`; `validateCandidates(manifest: unknown, pngRelPaths: string[], known: Set<string>): CandidateSet` (throws Error listing EVERY problem); `uploadPlan(set): { local: string; key: string }[]`; `sq(s: string): string`; `askUpsertSql(a: {token, handle, setSlug, variants, createdAt, expiresAt}): string`; `revokeInsertSql(handle: string, setSlug: string, nowStr: string): string`; `statusSql(setSlug?: string): string`; `formatStatusRows(rows): string`; `pruneSelectSql(nowStr): string`; `pruneKeys(rows): string[]`; `linkFor(token): string`.

**Parallelization rationale:** the tool core and the runtime helpers (Task 2) share no symbols; fixing both contracts in the Interfaces blocks lets Tasks 2 and 3 build in parallel and is how a good engineer would split pure-tool from pure-runtime anyway.

Halt logic gets exact code (adversarial review). Validation collects **all** problems into one thrown Error, so Charlie fixes the manifest once, not once per run.

- [ ] **Step 1: Write the failing tests** at `tools/portraits.test.ts` (synthetic players only):

```ts
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
    expect(sql).toContain("ORDER BY w2.answered_at DESC, w2.rowid DESC");
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
```

- [ ] **Step 2: Run, expect FAIL**: `bun test tools/portraits.test.ts`
- [ ] **Step 3: Implement `tools/lib/portraits.ts`**. File header comment: what it is (pure core of `tools/portrait-asks.ts`, no I/O), where it sits (consent staging, spec 2026-08-26 §9), how it is exercised (`bun test tools/portraits.test.ts`). Implementation notes that carry information:
  - `knownHandles`: union over `data.players[].aka` and `data.games[].results[].handle`. Exact match, case-sensitive: handles are identities, and guessing case is inventing a player.
  - `validateCandidates`: collect every problem into a `problems: string[]`; on any, `throw new Error("refusing to stage:\n  " + problems.join("\n  "))`. Checks, in order: manifest is an object with string `set_slug` matching `/^\d{4}-\d{2}$/` and array `players`; each player has a handle matching `/^[A-Za-z0-9_.-]{1,32}$/` AND present in `known` (message: `unknown handle "X" (add the player to games.json first; never guess)`); no duplicate handles; each variants array nonempty, each id matching `/^[a-z0-9]{1,8}$/`, no duplicates; expected PNG set (`<handle>/<variant>.png`) equals the given `pngRelPaths` set, with each missing file and each orphan file named individually.
  - `sq`: `"'" + s.replace(/'/g, "''") + "'"`. All builders run AFTER validation constrained every value to safe character classes; `sq` is the belt on top.
  - `askUpsertSql`: single statement, `ON CONFLICT(handle, set_slug) DO UPDATE SET token = excluded.token, variants = excluded.variants, created_at = excluded.created_at, expires_at = excluded.expires_at` (comment: token rotation on re-stage is deliberate, it kills previously shared links).
  - `revokeInsertSql`: `INSERT INTO portrait_answers (token, answer, variant, answered_at) SELECT token, 'declined', NULL, '<now>' FROM portrait_asks WHERE handle = '<h>' AND set_slug = '<s>'` (comment: inserts zero rows when no ask exists; the CLI asserts on the changes count and halts).
  - `statusSql`: correlated-rowid latest-answer join, exactly:

    ```sql
    SELECT a.token, a.handle, a.set_slug, a.variants, a.expires_at,
           w.answer, w.variant, w.answered_at
    FROM portrait_asks a
    LEFT JOIN portrait_answers w ON w.rowid = (
      SELECT w2.rowid FROM portrait_answers w2 WHERE w2.token = a.token
      ORDER BY w2.answered_at DESC, w2.rowid DESC LIMIT 1)
    WHERE a.set_slug = '<slug>'   -- clause omitted entirely when no slug given
    ORDER BY a.handle
    ```
  - `formatStatusRows`: one line per row: `genet          2026-08  [a,b]  approved (b)  2026-09-01 10:00:00  expires 2026-10-26`; `no answer yet` when `answer` is null; declined rows print `declined`. Never prints `token` even though the query selects it (the CLI needs it for nothing today; selecting it keeps the query reusable, printing it would put capability URLs in scrollback).
  - `pruneSelectSql(nowStr)`: `SELECT token, handle, set_slug, variants FROM portrait_asks WHERE expires_at <= '<now>'`; `pruneKeys` expands each row's variants to bucket keys.
- [ ] **Step 4: Run, expect PASS**, then `bun test tools` for the suite.
- [ ] **Step 5: Commit** (`feat: portrait staging pure core: validate, plan, SQL`).

---

### Task 4: The CLI (`tools/portrait-asks.ts`)

**Type:** implementation
**Depends-on:** 2, 3

**Files:**
- Create: `tools/portrait-asks.ts`
- Test: `tools/portrait-asks.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `toSqlUtc` from `functions/api/_portrait.js` (Task 2); everything `tools/lib/portraits.ts` produces (Task 3).
- Produces: CLI `bun tools/portrait-asks.ts <dir> [--local]` | `--status [--set YYYY-MM] [--local]` | `--revoke <handle> --set YYYY-MM [--local]` | `--prune [--local]`; exported `stage(dir, deps)`, `status(opts, deps)`, `revoke(handle, set, deps)`, `prune(deps)` where `deps = { d1(sql): {results, changes}, r2put(key, file): void, r2delete(key): void, now(): Date, print(line): void, readDir(dir): string[], readManifest(dir): unknown }` (`readDir` returns PNG paths relative to the dir; the last two let tests avoid the filesystem entirely).

File header comment: what it is (stages Charlie's `candidates/` handoff into R2 + D1 and prints one consent link per player), where it sits in the flow (after `stage-candidates.sh` in munger, before Mike sends links; runbook section "Portrait consent" in `docs/publishing.md`), how to run (the four commands, with `--local` explained as "wrangler dev state, for rehearsal").

- [ ] **Step 1: Write failing tests** for the four verbs with injected fake `deps` (a recorder object). Cover: `stage` validates BEFORE any side effect (a bad manifest records zero `r2put`/`d1` calls); happy path uploads every file with `--content-type` handled by the runner, upserts one ask per player, prints exactly one `https://poker.kmikeym.com/portrait/<32hex>` line per player; expiry is 60 days after `now()` in SQL shape; `revoke` halts (throws) when `d1` reports `changes === 0` (message names the handle and set and says no ask exists); `status` prints `formatStatusRows` output; `prune` deletes exactly `pruneKeys` of the expired selection and prints a count, and prints `nothing expired` when the selection is empty. Fixtures: synthetic manifest + PNG paths via a temp dir under `Bun.env.TMPDIR ?? "/tmp"` created with unique suffix per test (concurrency-safe), or pass a `readDir` dep instead of touching disk; prefer the `readDir` dep (`deps.readDir(dir): string[]` returning relative PNG paths, `deps.readManifest(dir): unknown`) so tests never touch the filesystem.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `main()` guarded by `import.meta.main`. Real deps shell out with `Bun.spawnSync`:
  - `d1(sql)`: `npx wrangler d1 execute poker-rsvp-db (--local|--remote) --json --command <sql>`; parse stdout JSON, return `{ results: out[0].results, changes: out[0].meta?.changes ?? 0 }`; on nonzero exit, throw with wrangler's stderr verbatim (Charlie debugs from it).
  - `r2put(key, file)`: `npx wrangler r2 object put poker-portraits/<key> --file <file> --content-type image/png (--local|--remote)`.
  - `r2delete(key)`: `npx wrangler r2 object delete poker-portraits/<key> (--local|--remote)`.
  - `stage` order: read manifest + dir, `validateCandidates` (halts here, before any write), then per player: token = `randomToken()`, upload that player's PNGs, upsert ask, print `handle  link` line. Expiry: `toSqlUtc(new Date(now().getTime() + 60 * 86400 * 1000))`.
  - Unknown flags or a missing required arg print usage and exit 1.
- [ ] **Step 4: Run, expect PASS**; run `bun test tools`.
- [ ] **Step 5: Commit** (`feat: portrait-asks CLI: stage, status, revoke, prune`).

---

### Task 5: The two API Functions (image + answer)

**Type:** implementation
**Depends-on:** 2
**Review:** adversarial
**Commutes:** `tools/portrait-lib.test.ts`

**Files:**
- Create: functions/api/portrait/[token]/img/[variant].js
- Create: functions/api/portrait/[token].js
- Modify: `tools/portrait-lib.test.ts`

(The two Create paths are literal Cloudflare Pages parameter filenames, brackets included, not globs; they are unbackticked so the plan compiler does not read them as globs. Each is created by exactly this one task.)

**Interfaces:**
- Consumes: `isValidToken`, `isExpired`, `toSqlUtc`, `parseVariants` from `functions/api/_portrait.js` (Task 2).
- Produces: `GET /api/portrait/<token>/img/<variant>` (PNG or 404), `POST /api/portrait/<token>` (JSON `{ok, answer, variant}` or 400/404). Both send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.

**Parallelization rationale:** the API pair and the HTML page (Task 6) both consume only Task 2's helpers and never each other; splitting them is the natural seam between JSON surface and rendered surface, and both append tests to the shared portrait test module (declared Commutes).

- [ ] **Step 1: Append failing handler tests** to `tools/portrait-lib.test.ts`, in a new describe block after the file's existing content. Use the shared `makePortraitEnv`, `TOKEN`, `FUTURE`, `PAST`, and `ASK` that Task 2 defined at file scope in this same file (they exist already; do not redefine or rename them). An expired-ask row is `{ ...ASK, expires_at: PAST }`.

  Image tests (`onRequestGet` from `../functions/api/portrait/[token]/img/[variant].js`, importable with a string path): unknown token 404; expired ask 404; variant not in ask 404; malformed variants column 404; missing R2 object 404; happy path 200 with `Content-Type: image/png`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, body text equal to the stub object string. Answer tests (`onRequestPost` from `../functions/api/portrait/[token].js`): invalid token shape 404; unknown token 404; expired 404; non-JSON body 400; body over 1024 bytes 400; `answer: "maybe"` 400; approved without variant 400; approved with variant outside ask 400; declined with a variant 400; approved happy path 200, `{ok: true, answer: "approved", variant: "b"}`, appends exactly one row with `variant: "b"` and an answered_at matching `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`; declined happy path row has `variant: null`; **every** response body from both handlers (all cases above) never contains `"@"` (the no-email boundary, checked with `expect((await res.clone().text()).includes("@")).toBe(false)` folded into a helper).

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `functions/api/portrait/[token]/img/[variant].js`**:

```js
// Streams ONE candidate card PNG from the private R2 bucket. This is the only
// path by which an unconsented face reaches a browser (spec s4), so every
// request re-validates the token against a live, unexpired ask, and every
// miss of any kind is the same 404 (probing must learn nothing, spec s8).
// Served at GET /api/portrait/<token>/img/<variant> on poker.kmikeym.com.
import { isValidToken, isExpired, toSqlUtc, parseVariants } from "../../../_portrait.js";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function onRequestGet({ params, env }) {
  const token = params.token;
  const variant = String(params.variant ?? "");
  if (!isValidToken(token) || !/^[a-z0-9]{1,8}$/.test(variant)) return notFound();

  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return notFound();

  const variants = parseVariants(ask.variants);
  if (!variants || !variants.includes(variant)) return notFound();

  const obj = await env.POKER_PORTRAITS.get(`asks/${ask.set_slug}/${ask.handle}/${variant}.png`);
  if (!obj) return notFound();
  return new Response(obj.body, {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "image/png" },
  });
}
```

- [ ] **Step 4: Implement `functions/api/portrait/[token].js`**:

```js
// Records a consent answer: approve with a variant, or decline. APPEND-ONLY
// by design (spec s5): withdrawal must not erase that consent was once given,
// so this handler only ever INSERTs. The GET page and the image endpoint
// resolve "current answer" as the latest row. Served at
// POST /api/portrait/<token> on poker.kmikeym.com.
import { isValidToken, isExpired, toSqlUtc, parseVariants } from "../_portrait.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: HEADERS });

export async function onRequestPost({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return json({ error: "not found" }, 404);

  // Body cap before parsing: the whole valid payload is two short fields.
  const raw = await request.text();
  if (raw.length > 1024) return json({ error: "bad body" }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad body" }, 400); }

  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return json({ error: "not found" }, 404);

  const { answer, variant } = body || {};
  if (answer !== "approved" && answer !== "declined") return json({ error: "bad answer" }, 400);
  const variants = parseVariants(ask.variants);
  if (!variants) return json({ error: "not found" }, 404);
  if (answer === "approved" && !variants.includes(variant)) return json({ error: "bad variant" }, 400);
  if (answer === "declined" && variant != null) return json({ error: "bad variant" }, 400);

  await env.POKER_RSVP_DB
    .prepare("INSERT INTO portrait_answers (token, answer, variant, answered_at) VALUES (?, ?, ?, ?)")
    .bind(token, answer, answer === "approved" ? variant : null, toSqlUtc(new Date())).run();

  return json({ ok: true, answer, variant: answer === "approved" ? variant : null });
}
```

- [ ] **Step 5: Run, expect PASS**; run `bun test tools`.
- [ ] **Step 6: Commit** (`feat: portrait image and answer Functions`).

---

### Task 6: The consent page Function

**Type:** implementation
**Depends-on:** 2
**Review:** adversarial
**Commutes:** `tools/portrait-lib.test.ts`

**Files:**
- Create: functions/portrait/[token].js
- Modify: `tools/portrait-lib.test.ts`

(The Create path is a literal Cloudflare Pages parameter filename, brackets included, not a glob; unbackticked so the plan compiler does not read it as one. Created by exactly this one task.)

**Interfaces:**
- Consumes: `isValidToken`, `isExpired`, `toSqlUtc`, `parseVariants`, `latestAnswer`, `escapeHtml`, `ordinal`, `monthName` from `functions/api/_portrait.js` (Task 2). Runtime: `env.ASSETS.fetch(new URL("/data/games.json", request.url))` for stats (Pages serves `site/` as ASSETS); `env.POKER_RSVP_DB`.
- Produces: `GET /portrait/<token>`: server-rendered approval page (200) or plain 404 page.

**Parallelization rationale:** consumes only Task 2's helpers, independent of Task 5's JSON surface; appends its own describe block to the shared test module (declared Commutes).

Page requirements (spec §7), restated as testable facts: card `<img>` for the current variant; one labeled picker button per variant when there is more than one; stats line from games.json (finish as ordinal, entrant count, hands, game date); actions "Use this one" and "None of these" as `.btn-secondary` (never `.btn-primary`, no lime); the line "Turning it down keeps the monogram card you already have. The photo stays out and the card stays yours."; existing answer renders as state with the offer to change it; no `<a href` pointing into the site; `meta name="robots"` noindex plus the two response headers; no em dash and no "experiment" anywhere in the HTML; player named as First + last initial from `players[].name`.

- [ ] **Step 1: Append failing page tests** to `tools/portrait-lib.test.ts`, in a new describe block `"GET /portrait/<token>"`. Build on `makePortraitEnv`, `TOKEN`, `PAST`, and `ASK` from the file-scope stubs Task 2 defined in this same file, **plus** an ASSETS stub added to the returned env by this block (do not modify the factory: wrap it, `const { env, answers } = makePortraitEnv(...); (env as any).ASSETS = { fetch: async () => new Response(JSON.stringify(FIXTURE_DATA)) };`). `FIXTURE_DATA` is synthetic: players `[{ slug: "gene-t", name: "Gene T.", aka: ["genet"] }]`, one game `{ date: "2026-08-11", hands: 100, cardSet: "2026-08", results: [{ slug: "gene-t", handle: "genet", finish: 2, payout: 0, rebuys: 0, trophies: [] }, { slug: "rosa-p", handle: "rosap", finish: 1, payout: 10, rebuys: 0, trophies: [] }] }`. Tests: unknown token renders 404 status with `text/html` and no-store + noindex headers; expired ask 404; happy path 200 containing `Gene T.`, `src="/api/portrait/${TOKEN}/img/a"`, a picker control per variant (`data-variant="a"` and `data-variant="b"`), `Use this one`, `None of these`, the monogram line verbatim, `2nd of 2` and `100 hands`; page with an existing approved answer (seed by pushing `{ token: TOKEN, answer: "approved", variant: "b", answered_at: "2026-09-01 10:00:00" }` onto the factory's returned `answers` array before the request) contains `You approved` and `data-variant="b"` marked selected (`aria-pressed="true"`); no `@` in the HTML; no `btn-primary`; no em dash character and no `experiment` (case-insensitive) in the HTML; no `<a href="/` other than none at all (assert `/<a href="\//.test(html)` is false); when games.json lacks the game or the player, the page still renders 200 with the card and actions but WITHOUT the stats line (never invent a number).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `functions/portrait/[token].js`**:

```js
// The portrait approval page (spec s7): a player's private capability URL
// showing their own rendered card with their real stats, and two buttons.
// Server-rendered HTML, no build step, brand system via /styles.css. Links
// NOWHERE into the site: a forwarded link must not become a side door into
// an unannounced set. Served at GET /portrait/<token> on poker.kmikeym.com.
import {
  isValidToken, isExpired, toSqlUtc, parseVariants,
  latestAnswer, escapeHtml, ordinal, monthName,
} from "../api/_portrait.js";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

// Same body for unknown and expired: probing must learn nothing (spec s8).
const notFound = () =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Not found</title></head><body><p>This link is not active. If Mike sent it to you, ask him for a fresh one.</p></body></html>`,
    { status: 404, headers: HEADERS });

// Pulls the player's real game line out of the committed public games.json.
// Returns null when the set or the player is missing; the page then simply
// omits the stats line. Never invent a number (repo invariant).
function statsFor(data, setSlug, handle) {
  const game = (data.games || []).find((g) => g.cardSet === setSlug);
  const result = game && (game.results || []).find((r) => r.handle === handle);
  if (!game || !result) return null;
  const player = (data.players || []).find(
    (p) => p.slug === result.slug || (p.aka || []).includes(handle));
  return {
    name: player ? player.name : handle,
    finish: result.finish,
    entrants: game.results.length,
    hands: game.hands,
    date: game.date,
  };
}

export async function onRequestGet({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return notFound();

  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return notFound();
  const variants = parseVariants(ask.variants);
  if (!variants) return notFound();

  const { results: answerRows } = await env.POKER_RSVP_DB
    .prepare("SELECT answer, variant, answered_at FROM portrait_answers WHERE token = ? ORDER BY rowid ASC")
    .bind(token).all();
  const current = latestAnswer(answerRows);

  let stats = null;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/games.json", request.url));
    stats = statsFor(await res.json(), ask.set_slug, ask.handle);
  } catch { /* stats stay null; the consent ask still works without them */ }

  const name = escapeHtml(stats ? stats.name : ask.handle);
  const setName = escapeHtml(monthName(ask.set_slug));
  const selected =
    current && current.answer === "approved" && variants.includes(current.variant)
      ? current.variant : variants[0];
  const img = (v) => `/api/portrait/${token}/img/${v}`;

  const pickerRow = variants.length < 2 ? "" : `
      <div class="picker" role="group" aria-label="Crop options">
        ${variants.map((v) => `<button type="button" class="btn-secondary variant-pick"
          data-variant="${v}" aria-pressed="${v === selected}">Crop ${v.toUpperCase()}</button>`).join("\n        ")}
      </div>`;

  const statsLine = stats === null ? "" : `
      <p class="stat">${escapeHtml(stats.date)}: finished ${ordinal(stats.finish)} of ${stats.entrants}, ${stats.hands} hands. Those are the numbers on the card.</p>`;

  const stateLine =
    current === null
      ? `This card ships only if you say yes. No answer means it stays the monogram.`
      : current.answer === "approved"
        ? `You approved crop ${escapeHtml(String(current.variant).toUpperCase())} on ${escapeHtml(current.answeredAt.slice(0, 10))}. You can change this any time before the set prints.`
        : `You turned the photo down on ${escapeHtml(current.answeredAt.slice(0, 10))}. You can change this any time before the set prints.`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Your ${setName} card</title>
<link rel="stylesheet" href="/styles.css">
<style>
  /* Page-scoped layout only; palette and buttons come from /styles.css. */
  .portrait-page { max-width: 40rem; margin: 0 auto; }
  .portrait-page .card-shot { margin: 1.5rem 0; }
  .portrait-page .card-shot img { display: block; width: min(100%, 22rem); margin: 0 auto; border-radius: 12px; }
  .picker { display: flex; gap: .6rem; justify-content: center; flex-wrap: wrap; margin: 1rem 0; }
  .picker .variant-pick[aria-pressed="true"] { border-color: var(--sapphire); color: var(--sapphire); }
  .actions { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; margin: 1.75rem 0 .75rem; }
  .state { text-align: center; color: var(--muted-ink); }
  .fine { color: var(--muted-ink); font-size: .95rem; }
</style>
</head>
<body>
<main class="band-light portrait-page">
  <p class="stat">K5M Shareholder Poker, the ${setName} set</p>
  <h1>Your card, ${name}</h1>
  <p>Your table card for the ${setName} set is below, exactly as it would print,
  with your photo on it. Pick the crop you like best, or turn the photo down.
  Nothing ships until you say so.</p>
  <figure class="card-shot"><img id="card-img" src="${img(selected)}" alt="Your ${setName} player card"></figure>
  ${pickerRow}
  ${statsLine}
  <div class="actions">
    <button type="button" id="approve" class="btn-secondary">Use this one</button>
    <button type="button" id="decline" class="btn-secondary">None of these</button>
  </div>
  <p class="state" id="state">${stateLine}</p>
  <p class="fine">Turning it down keeps the monogram card you already have. The photo stays out and the card stays yours.</p>
  <noscript><p class="fine">This page needs JavaScript to record your answer. Tell Mike directly instead; that works too.</p></noscript>
</main>
<script>
  var selected = ${JSON.stringify(selected)};
  var img = document.getElementById("card-img");
  var state = document.getElementById("state");
  document.querySelectorAll(".variant-pick").forEach(function (b) {
    b.addEventListener("click", function () {
      selected = b.dataset.variant;
      img.src = "/api/portrait/${token}/img/" + selected;
      document.querySelectorAll(".variant-pick").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
    });
  });
  function send(payload, doneText) {
    fetch("/api/portrait/${token}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      state.textContent = r.ok ? doneText : "That did not go through. Try again, or just tell Mike.";
    }).catch(function () {
      state.textContent = "That did not go through. Try again, or just tell Mike.";
    });
  }
  document.getElementById("approve").addEventListener("click", function () {
    send({ answer: "approved", variant: selected },
      "Approved, crop " + selected.toUpperCase() + ". You can change this any time before the set prints.");
  });
  document.getElementById("decline").addEventListener("click", function () {
    send({ answer: "declined" },
      "Noted, the photo stays out. You can change this any time before the set prints.");
  });
</script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: HEADERS });
}
```

  (Copy above is a working draft; §11 step 5 hands the copy pass to Charlie inside the implementation PR. Any copy change must keep the tested literals in sync with the test block, or update both in the same commit.)
- [ ] **Step 4: Run, expect PASS**; run `bun test tools`.
- [ ] **Step 5: Commit** (`feat: portrait consent page Function`).

---

### Task 7: The runbook section

**Type:** implementation
**Depends-on:** 4, 5, 6

**Files:**
- Modify: `docs/publishing.md`

**Interfaces:**
- Consumes: the CLI verbs exactly as Task 4 produces them.

Append after the "## Cards (per set, still manual by design)" section (before "## Reminder export"), this content (adjust only if the CLI's actual flags diverged, and then say so in the commit message):

```markdown
## Portrait consent (per set, Tier 2b)

Card portraits ship only with the player's yes, given on a private page that
shows their actual card. Charlie stages the images; the tool does the rest.

1. In munger, run `ccg/stage-candidates.sh` (Charlie's side). It produces
   `candidates/` with a `manifest.json` and `<handle>/<variant>.png` whole-card
   renders. Source photos never leave munger's gitignored `photos-raw/`.
2. From this repo:
   `bun tools/portrait-asks.ts <path-to-candidates>`
   It validates the manifest against `games.json` handles (unknown handle
   halts, same as publish-game: fix the input, never the check), uploads the
   PNGs to the private `poker-portraits` R2 bucket, writes one ask per player
   into D1, and prints one link per player.
3. Hand the printed links to Mike. Sending them is HIS call and is held
   separately from any merge (they soft-reveal the set to the people on it).
4. Check answers any time: `bun tools/portrait-asks.ts --status --set YYYY-MM`.
   No admin page exists on purpose.
5. If a player asks in person to take their photo down:
   `bun tools/portrait-asks.ts --revoke <handle> --set YYYY-MM`
   That appends a declined row. It never deletes history: the ledger keeps
   the fact that consent was once given, and the latest row wins.
6. Asks die on their own 60 days after staging (the link 404s). After a set
   is settled, `bun tools/portrait-asks.ts --prune` deletes the now
   unreachable candidate PNGs of expired asks from the bucket, so faces
   without a yes do not sit in storage forever.

Rehearsal: add `--local` to any command to run against `wrangler pages dev`
state instead of production. Nothing in this flow touches git: candidate
images live only in R2, answers live only in D1.
```

- [ ] **Step: run `bun test tools`** (site copy tests must stay green; this file is docs, not site copy, but the suite is the gate before any commit), **commit** (`docs: portrait consent runbook section`).

---

### Task 8: Suite and drift gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7

**Files:**
- Test: `tools/`

Run and require green, in order:

1. `bun test tools` (whole suite, no skips).
2. `bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html` (generated pages untouched).
3. `git diff --exit-code site/data/games.json` (read-only invariant held).

---

### Task 9: Infra + live rehearsal with Mike's real candidates

**Type:** manual
**Depends-on:** 8

**Files:**
- Test: (none; operator actions against wrangler and the local dev server)

Run by Nova after the merge gate, before the PR is handed to Mike. Mike's own staged candidates are the test data (his call, 2026-08-27): `/Users/kmikeym/Agenting/The Investor Relations/munger/ccg/launch-sept-2026/candidates/`.

1. `npx wrangler r2 bucket list` to confirm R2 is enabled on the account; if it errors, STOP and tell Mike R2 needs the one-time dashboard enable (fleet rule: never substitute a different architecture for a dashboard step).
2. `npx wrangler r2 bucket create poker-portraits` (idempotent check first with the list).
3. Local rehearsal end to end:
   - `npx wrangler d1 execute poker-rsvp-db --local --file site/schema.sql`
   - `bun tools/portrait-asks.ts "<candidates dir>" --local`
   - `npx wrangler pages dev site` and open the printed `/portrait/<token>` path against the local server (swap the host for `localhost:8788`); click through: variant switch, approve, reload shows approved state, decline flips it, image URL with a wrong variant 404s.
   - `bun tools/portrait-asks.ts --status --set 2026-08 --local` shows the answer trail.
4. Remote staging (real): `npx wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql`, then `bun tools/portrait-asks.ts "<candidates dir>"`. Record Mike's printed link privately (paste to Mike in chat, never into any committed file or PR body: it is a capability URL).
5. The remote link only serves once the Functions deploy (merge, or the PR's preview deployment). Verify on the preview URL when the PR is up.

---

### Task 10: Branch, PR, and the held sends

**Type:** release
**Depends-on:** 9

**Files:**
- Test: (none)

1. Push the integration branch (`nova/portrait-consent`), open a PR to `main`. Never push `main` directly (it deploys).
2. PR body: what shipped, the §14 decision (R2, with the measured-size argument), the one addition beyond the spec's command table (`--prune`, with its §3 rationale) flagged for Charlie's veto, the note that `_headers` does not cover Function responses so the Functions self-set `X-Robots-Tag`, and an explicit request for Charlie's copy pass on the page strings (spec §11 step 5). State plainly: **merge on Mike's go; sends stay held regardless of merge (spec §13)**.
3. Comment the §14 review on PR #18 so the spec thread carries the decision.
4. Merge is Mike's. After merge, verify Mike's live link renders on poker.kmikeym.com, then BBS note to Charlie (his half of the seam is now consumed downstream).

---

## Operator smoke

- do: Open the `/portrait/<token>` link Nova handed you privately, on your phone.
  see: Your Founder card with the dithered photo, crop buttons A B C, and the two gray buttons. No lime anywhere, no nav bar, no links to the rest of the site.
- do: Tap a different crop, then "Use this one", then reload the page.
  see: The page comes back already showing "You approved crop ..." with the crop you picked selected.
- do: Change the last character of the token in the URL and load it.
  see: A plain "This link is not active" page, nothing about whose link it almost was.
- do: Run `bun tools/portrait-asks.ts --status --set 2026-08`.
  see: One line: kmikeym, the variants, your answer, the timestamp. No token printed.
- do: Google `site:poker.kmikeym.com portrait` in a few days.
  see: Nothing indexed.
