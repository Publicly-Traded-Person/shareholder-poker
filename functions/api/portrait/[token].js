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

// Cloudflare Pages Function entry point for POST requests on this route.
// Takes the Pages Functions context ({ request, params, env }); params.token
// comes from the URL segment and the JSON body carries { answer, variant }.
// Returns a 200 JSON Response {ok, answer, variant} on a recorded answer, a
// 404 JSON Response for an unknown/expired/malformed-ask token (same shape
// as "never existed" - probing must learn nothing, spec s8), or a 400 JSON
// Response for a malformed or logically inconsistent request body. Throws
// nothing itself: request.text() and JSON.parse failures are caught inline
// so a bad body never surfaces as an unhandled 500 that could leak a stack
// trace. The 1024-byte cap runs before parsing, on the raw string, so an
// oversized body never reaches JSON.parse at all.
export async function onRequestPost({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return json({ error: "not found" }, 404);

  // Body cap before parsing: the whole valid payload is two short fields.
  // request.text() itself can reject (a client that aborts mid-upload, or a
  // malformed transfer encoding) - caught here so that counts as a bad body
  // too, not an unhandled 500 that could leak a stack trace to the caller.
  let raw;
  try { raw = await request.text(); } catch { return json({ error: "bad body" }, 400); }
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

  // Append-only insert: consent history is never overwritten or deleted, so
  // a later withdrawal can never be mistaken for "consent was never given."
  await env.POKER_RSVP_DB
    .prepare("INSERT INTO portrait_answers (token, answer, variant, answered_at) VALUES (?, ?, ?, ?)")
    .bind(token, answer, answer === "approved" ? variant : null, toSqlUtc(new Date())).run();

  return json({ ok: true, answer, variant: answer === "approved" ? variant : null });
}
