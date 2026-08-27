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

// Cloudflare Pages Function entry point for GET requests on this route.
// Takes the Pages Functions context ({ params, env }); params.token and
// params.variant come straight from the URL segments, so both are treated as
// untrusted input. Returns a 200 PNG Response on success or a 404 Response
// on any failure (unknown/expired token, unlisted variant, missing object) -
// the 404 is deliberately the SAME response shape in every failure case so a
// prober cannot distinguish "wrong variant" from "token never existed."
// Throws nothing: env lookups here are Cloudflare bindings, not expected to
// reject under normal operation.
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
