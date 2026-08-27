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

// The current answer is the LAST VALID row in insertion order (callers must
// pass rows from SELECT ... ORDER BY rowid ASC), full stop -- answered_at is
// never consulted for ordering. This is deliberate: portrait_answers has two
// writers on two different clocks (the POST Function's request-time clock
// and the CLI revoke's operator-machine clock), so answered_at can disagree
// with true append order. Picking the row with the latest timestamp would
// let an earlier decline lose to a later approve whose clock happened to run
// fast (or the reverse), silently reviving a withdrawn consent. Insertion
// order (rowid) is the one thing both writers agree on, because SQLite
// assigns it in write order regardless of either clock. A declined row never
// carries a variant out. A bug here is an ethical problem, not a display
// problem (spec s10), which is why this is pure and heavily tested.
export function latestAnswer(rows) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    if (r && (r.answer === "approved" || r.answer === "declined")) best = r;
  }
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
