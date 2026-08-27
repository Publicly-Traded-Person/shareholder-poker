// The portrait approval page (spec s7): a player's private capability URL
// showing their own rendered card with their real stats, and two buttons.
// Server-rendered HTML, no build step, brand system via /styles.css. Links
// NOWHERE into the site: a forwarded link must not become a side door into
// an unannounced set. Served at GET /portrait/<token> on poker.kmikeym.com.
import {
  isValidToken, isExpired, toSqlUtc, parseVariants,
  latestAnswer, escapeHtml, ordinal, monthName,
} from "../api/_portrait.js";

// Pages `_headers` does not apply to Function responses, so this surface sets
// its own: never cached anywhere, never indexed, on every reply including 404.
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

// Renders the consent page for one ask.
// Takes the Pages Function context ({ request, params, env }); `params.token`
// is the capability token from the URL. Returns a 200 HTML Response with the
// card, the crop pickers and the two actions, or the shared 404 page when the
// token is malformed, unknown, expired, or its ask row is malformed. Throws
// only if D1 itself fails; a games.json read failure is swallowed so the
// consent ask still works, just without the stats line.
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
