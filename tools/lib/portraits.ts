// Pure core of tools/portrait-asks.ts: no filesystem, network, or D1/R2 I/O
// happens in this file. It validates Charlie's candidates/ handoff (manifest
// + PNG directory listing) against the known roster, builds the R2 upload
// plan, and renders the SQL the CLI hands to wrangler. Kept pure so the
// halt-before-any-side-effect posture (never guess, never partially stage)
// is exercised directly by bun test, without a live D1/R2 to fake.
//
// Sits in the consent-staging step of the flow: Charlie exports candidate
// renders into candidates/<set_slug>/, tools/portrait-asks.ts (Task 4) calls
// into this module first and only proceeds to R2/D1 writes if validation
// passes. Spec docs/superpowers/specs/2026-08-26-portrait-consent-pages-design.md s9.
//
// Exercised by: bun test tools/portraits.test.ts (and bun test tools overall).

import type { GamesData } from "./standings";

// One player's staged variant set for one month's card release, after
// validateCandidates has confirmed the manifest and the PNG directory agree.
export type CandidateSet = {
  setSlug: string;
  players: { handle: string; variants: string[] }[];
};

// A single upsert target the CLI passes through askUpsertSql.
type AskUpsert = {
  token: string;
  handle: string;
  setSlug: string;
  variants: string[];
  createdAt: string;
  expiresAt: string;
};

// One row as read back from statusSql / pruneSelectSql. Loosely typed since
// it is whatever wrangler's JSON output hands back; callers only touch the
// fields named here.
type StatusRow = {
  handle: string;
  set_slug: string;
  variants: string;
  answer: string | null;
  variant: string | null;
  answered_at: string | null;
  expires_at: string;
  token: string;
};

type PruneRow = { set_slug: string; handle: string; variants: string };

const SET_SLUG_RE = /^\d{4}-\d{2}$/;
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const VARIANT_RE = /^[a-z0-9]{1,8}$/;

// Every handle this roster already recognizes: the union of each player's
// aka list and every handle that has ever appeared in a played game's
// results. Exact match, case-sensitive: handles are identities, and
// treating "ROSA99" and "rosa99" as the same handle would be guessing which
// one is real.
export function knownHandles(data: GamesData): Set<string> {
  const known = new Set<string>();
  for (const p of data.players) {
    for (const a of p.aka) known.add(a);
  }
  for (const g of data.games) {
    for (const r of g.results) known.add(r.handle);
  }
  return known;
}

// Validates Charlie's candidates/<set_slug>/ handoff: the manifest object
// against the known roster, and the manifest's declared variants against the
// PNG files actually present. Collects EVERY problem before throwing, so a
// bad handoff can be fixed in one editing pass instead of one failure at a
// time (repo halt-don't-guess posture, same as publish-game's checks).
//
// Throws Error with every problem, one per line, prefixed
// "refusing to stage:\n  ". Never partially validates: any problem means the
// whole candidate set is rejected and nothing is staged.
export function validateCandidates(
  manifest: unknown,
  pngRelPaths: string[],
  known: Set<string>
): CandidateSet {
  const problems: string[] = [];

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("refusing to stage:\n  manifest is not an object");
  }
  const m = manifest as Record<string, unknown>;

  const setSlug = m.set_slug;
  if (typeof setSlug !== "string" || !SET_SLUG_RE.test(setSlug)) {
    problems.push(`set_slug must match YYYY-MM, got ${JSON.stringify(setSlug)}`);
  }

  const rawPlayers = m.players;
  if (!Array.isArray(rawPlayers)) {
    problems.push("players must be an array");
  }

  const players: { handle: string; variants: string[] }[] = [];
  const seenHandles = new Set<string>();
  const expectedPngs = new Set<string>();

  if (Array.isArray(rawPlayers)) {
    for (const p of rawPlayers) {
      if (typeof p !== "object" || p === null) {
        problems.push(`player entry is not an object: ${JSON.stringify(p)}`);
        continue;
      }
      const handle = (p as Record<string, unknown>).handle;
      const variants = (p as Record<string, unknown>).variants;

      if (typeof handle !== "string" || !HANDLE_RE.test(handle)) {
        problems.push(`invalid handle shape: ${JSON.stringify(handle)}`);
        continue;
      }
      if (!known.has(handle)) {
        problems.push(`unknown handle "${handle}" (add the player to games.json first; never guess)`);
        continue;
      }
      if (seenHandles.has(handle)) {
        problems.push(`duplicate handle "${handle}"`);
        continue;
      }
      seenHandles.add(handle);

      if (!Array.isArray(variants) || variants.length === 0) {
        problems.push(`player "${handle}" has no variants`);
        continue;
      }
      const seenVariants = new Set<string>();
      let variantsOk = true;
      for (const v of variants) {
        if (typeof v !== "string" || !VARIANT_RE.test(v)) {
          problems.push(`player "${handle}" has an invalid variant id: ${JSON.stringify(v)}`);
          variantsOk = false;
          continue;
        }
        if (seenVariants.has(v)) {
          problems.push(`player "${handle}" has a duplicate variant "${v}"`);
          variantsOk = false;
          continue;
        }
        seenVariants.add(v);
      }
      if (!variantsOk) continue;

      players.push({ handle, variants: [...variants] as string[] });
      for (const v of variants as string[]) {
        expectedPngs.add(`${handle}/${v}.png`);
      }
    }
  }

  // Compare the expected PNG set (derived from a manifest that validated
  // above) against what is actually on disk. Every mismatch is named
  // individually so Charlie can fix the directory in one pass.
  const givenPngs = new Set(pngRelPaths);
  for (const expected of expectedPngs) {
    if (!givenPngs.has(expected)) {
      problems.push(`missing PNG for staged variant: ${expected}`);
    }
  }
  for (const given of givenPngs) {
    if (!expectedPngs.has(given)) {
      problems.push(`PNG with no manifest entry: ${given}`);
    }
  }

  if (problems.length > 0) {
    throw new Error("refusing to stage:\n  " + problems.join("\n  "));
  }

  return { setSlug: setSlug as string, players };
}

// Maps a validated candidate set to the file-to-R2-key pairs the CLI uploads.
// Bucket layout is asks/<set_slug>/<handle>/<variant>.png (matches the R2 key
// the image Function reads at serve time — keep these two in sync).
export function uploadPlan(set: CandidateSet): { local: string; key: string }[] {
  const plan: { local: string; key: string }[] = [];
  for (const p of set.players) {
    for (const v of p.variants) {
      const local = `${p.handle}/${v}.png`;
      plan.push({ local, key: `asks/${set.setSlug}/${local}` });
    }
  }
  return plan;
}

// SQL string literal quoting: wraps in single quotes and doubles any
// embedded single quote. Every value passed through this has already gone
// through validateCandidates' character-class checks (handles, set slugs,
// variant ids, tokens are all restricted charsets) or is a fixed-shape
// timestamp from toSqlUtc, so injection is not reachable here — this is the
// belt worn on top of that already-narrow surface, not the only defense.
export function sq(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// Builds the upsert that stages (or re-stages) one player's ask. Re-staging
// a player who was already staged this month REPLACES their row and rotates
// the token: this is deliberate (spec s9) so a previously shared link goes
// dead the moment a new one is issued, rather than both links staying live.
export function askUpsertSql(a: AskUpsert): string {
  return (
    "INSERT INTO portrait_asks (token, handle, set_slug, variants, created_at, expires_at) " +
    `VALUES (${sq(a.token)}, ${sq(a.handle)}, ${sq(a.setSlug)}, ${sq(JSON.stringify(a.variants))}, ${sq(a.createdAt)}, ${sq(a.expiresAt)}) ` +
    "ON CONFLICT(handle, set_slug) DO UPDATE SET " +
    "token = excluded.token, variants = excluded.variants, " +
    "created_at = excluded.created_at, expires_at = excluded.expires_at"
  );
}

// Records a decline for whichever ask currently exists for this handle and
// set, by looking the token up rather than being handed one: revoke never
// invents or is trusted with a token, it can only act on an ask that is
// already on file. Inserts zero rows when no such ask exists; the CLI
// (Task 4) checks the reported change count and halts rather than silently
// no-op'ing, so Charlie learns immediately if the handle/set was wrong.
export function revokeInsertSql(handle: string, setSlug: string, nowStr: string): string {
  return (
    "INSERT INTO portrait_answers (token, answer, variant, answered_at) " +
    `SELECT token, 'declined', NULL, ${sq(nowStr)} FROM portrait_asks ` +
    `WHERE handle = ${sq(handle)} AND set_slug = ${sq(setSlug)}`
  );
}

// Builds the status query: one row per ask, joined to its latest answer (if
// any) via a correlated subquery that mirrors latestAnswer's own tie-break
// (answered_at DESC, then rowid DESC so a same-second flip resolves to the
// later insertion). Filters to one set when setSlug is given; omits the
// WHERE clause entirely otherwise so `--status` with no `--set` covers every
// set ever staged.
export function statusSql(setSlug?: string): string {
  const where = setSlug ? `WHERE a.set_slug = ${sq(setSlug)}\n` : "";
  return (
    "SELECT a.token, a.handle, a.set_slug, a.variants, a.expires_at,\n" +
    "       w.answer, w.variant, w.answered_at\n" +
    "FROM portrait_asks a\n" +
    "LEFT JOIN portrait_answers w ON w.rowid = (\n" +
    "  SELECT w2.rowid FROM portrait_answers w2 WHERE w2.token = a.token\n" +
    "  ORDER BY w2.answered_at DESC, w2.rowid DESC LIMIT 1)\n" +
    where +
    "ORDER BY a.handle"
  );
}

// Renders one printable line per status row for the CLI's --status output.
// Deliberately never prints the token column even though statusSql selects
// it: the query stays reusable (a future caller might need the token), but
// printing it here would put live capability URLs into terminal scrollback
// and shell history, which is exactly the kind of exposure the token model
// is supposed to prevent.
export function formatStatusRows(rows: StatusRow[]): string {
  return rows
    .map((r) => {
      const variants = parseVariantsForDisplay(r.variants);
      const answerText =
        r.answer === "approved"
          ? `approved (${r.variant ?? ""})`
          : r.answer === "declined"
            ? "declined"
            : "no answer yet";
      const when = r.answered_at ?? "";
      return [
        r.handle,
        r.set_slug,
        `[${variants.join(",")}]`,
        answerText,
        when,
        `expires ${r.expires_at.slice(0, 10)}`,
      ]
        .filter((part) => part !== "")
        .join("  ");
    })
    .join("\n");
}

// Best-effort variant list for display only (never used for a security
// decision - that is parseVariants in functions/api/_portrait.js). Falls
// back to the raw string if it does not parse, so a malformed row still
// prints something Charlie can act on instead of crashing the report.
function parseVariantsForDisplay(json: string): string[] {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v.map(String);
  } catch {
    // fall through
  }
  return [json];
}

// Selects every ask whose expiry is at or before now, for --prune. Uses <=
// (not <) so an ask expiring in this exact second is pruned now rather than
// on the next run - matching isExpired's not-strictly-in-the-future rule in
// functions/api/_portrait.js.
export function pruneSelectSql(nowStr: string): string {
  return `SELECT token, handle, set_slug, variants FROM portrait_asks WHERE expires_at <= ${sq(nowStr)}`;
}

// Expands each expired ask row into the R2 keys that back it, so --prune can
// delete the objects along with (elsewhere) the D1 rows. One row can expand
// to multiple keys since a single ask can carry several variants.
export function pruneKeys(rows: PruneRow[]): string[] {
  const keys: string[] = [];
  for (const r of rows) {
    let variants: unknown;
    try {
      variants = JSON.parse(r.variants);
    } catch {
      continue;
    }
    if (!Array.isArray(variants)) continue;
    for (const v of variants) {
      keys.push(`asks/${r.set_slug}/${r.handle}/${String(v)}.png`);
    }
  }
  return keys;
}

// The consent link shown to a player, built from a freshly minted token.
// Always points at the production host: staging links are meant to be sent
// to real people, never at a --local wrangler dev server.
export function linkFor(token: string): string {
  return `https://poker.kmikeym.com/portrait/${token}`;
}
