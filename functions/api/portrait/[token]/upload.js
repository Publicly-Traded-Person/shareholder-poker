// Accepts ONE small finished art panel and records the approval it implies.
// Served at POST /api/portrait/<token>/upload on poker.kmikeym.com. The raw
// photograph never reaches this endpoint (self-upload spec s2): the browser
// dithers and composes locally, and what arrives is the exact 620x236 PNG
// the player saw. Uploading IS approving (s4): the art store, the variants
// update, and the approved/self ledger row happen in one handler, because a
// stored-but-unconsented state must not exist.
import {
  isValidToken, isExpired, toSqlUtc, pngDims, addVariant, PANEL_W, PANEL_H,
} from "../../_portrait.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: HEADERS });

// A legitimate panel runs ~100 to 200KB; anything larger is not ours.
const MAX_BYTES = 262144;

// Cloudflare Pages Function entry point for POST requests on this route.
// Takes the Pages Functions context ({ request, params, env }); params.token
// comes straight from the URL segment and the request body is raw
// image/png bytes, so both are treated as untrusted input. Returns 404 on
// unknown/expired/flag-off/malformed-ask (all indistinguishable from the
// outside, spec s8), 400 on oversize/bad-body/bad-image, and 200
// {ok, answer: "approved", variant: "self"} on success after the R2 put,
// the portrait_asks.variants update, and the portrait_answers append all
// complete. Throws nothing: every failure path returns a Response instead,
// because an unhandled throw here would be a 500 with a stack trace on a
// surface that must never leak internals to a probing request.
export async function onRequestPost({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return json({ error: "not found" }, 404);

  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return json({ error: "not found" }, 404);

  // Flag gate, AFTER the ask gate so flag-off and no-ask are the same 404,
  // and failing CLOSED on any read failure: on this surface the safe answer
  // to "am I allowed?" is always no (self-upload spec s8). The flag being
  // off is not an error state the outside world gets to observe.
  let uploadsOn = false;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/games.json", request.url));
    uploadsOn = (await res.json()).portraitUploads === true;
  } catch { uploadsOn = false; }
  if (!uploadsOn) return json({ error: "not found" }, 404);

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return json({ error: "too large" }, 400);
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); }
  catch { return json({ error: "bad body" }, 400); }
  if (bytes.byteLength === 0) return json({ error: "bad body" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "too large" }, 400);

  // Magic bytes + exact panel dimensions. The dimension check doubles as a
  // cheap authenticity guard: only our compositor naturally emits 620x236.
  // Deeper content inspection would be theater (spec s8): the object is
  // consented by its uploader, served only behind this same token, and
  // reviewed by Mike before any card prints.
  const dims = pngDims(bytes);
  if (!dims || dims.w !== PANEL_W || dims.h !== PANEL_H) return json({ error: "bad image" }, 400);

  const variants = addVariant(ask.variants, "self");
  if (variants === null) return json({ error: "not found" }, 404); // malformed ask: never guess

  await env.POKER_PORTRAITS.put(`asks/${ask.set_slug}/${ask.handle}/self.png`, bytes);
  await env.POKER_RSVP_DB
    .prepare("UPDATE portrait_asks SET variants = ? WHERE token = ?")
    .bind(variants, token).run();
  await env.POKER_RSVP_DB
    .prepare("INSERT INTO portrait_answers (token, answer, variant, answered_at) VALUES (?, 'approved', 'self', ?)")
    .bind(token, toSqlUtc(new Date())).run();

  return json({ ok: true, answer: "approved", variant: "self" });
}
