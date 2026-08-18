// RSVP endpoint. POST records an RSVP (one per email per game, upsert).
// GET returns {count, names} for a game. The GET path NEVER returns emails;
// that constraint is the privacy boundary (spec section 3), not a style choice.
import { validEmail, cleanDisplayName, resolveDisplay } from "./_lib.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const GAME_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const game = new URL(request.url).searchParams.get("game") || "";
  if (!GAME_RE.test(game)) return json({ error: "bad game" }, 400);
  const { results } = await env.POKER_RSVP_DB
    .prepare("SELECT display_name FROM rsvps WHERE game = ? ORDER BY created_at")
    .bind(game).all();
  return json({ count: results.length, names: results.map(r => r.display_name) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  const { email, displayName, game } = body || {};
  if (!validEmail(email)) return json({ error: "That email does not look right." }, 400);
  if (!GAME_RE.test(String(game || ""))) return json({ error: "bad game" }, 400);

  const { results: roster } = await env.POKER_RSVP_DB
    .prepare("SELECT email, handle FROM roster").all();
  const display = resolveDisplay(email, displayName, roster);

  await env.POKER_RSVP_DB
    .prepare(`INSERT INTO rsvps (email, display_name, game) VALUES (?, ?, ?)
              ON CONFLICT(email, game) DO UPDATE SET display_name = excluded.display_name`)
    .bind(email.toLowerCase(), cleanDisplayName(display) || "player", game).run();

  return json({ ok: true });
}
