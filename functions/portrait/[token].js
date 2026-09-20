// The portrait approval page (spec s7): a player's private capability URL
// showing their own rendered card with their real stats, and two buttons.
// Server-rendered HTML, no build step, brand system via /styles.css. Links
// NOWHERE into the site: a forwarded link must not become a side door into
// an unannounced set. Served at GET /portrait/<token> on poker.kmikeym.com.
//
// It also carries the SELF-UPLOAD BLOCK, which renders only when three things
// are true at once: the `portraitUploads` flag in site/data/games.json is on,
// the ask row carries one of the four rarity metals, and the ask is live. The
// block's whole point is where the pixels are processed: the photo is decoded,
// cropped, dithered and duotoned IN THE PLAYER'S OWN TAB by /portrait-dither.js
// (loaded as a module), and the only thing that ever leaves the device is the
// finished 620x236 PNG art panel, POSTed to /api/portrait/<token>/upload when
// the player taps "Use this photo". The raw photograph never reaches any
// server, which is the promise the block's own copy makes to the player.
// The approval wording (state line, approve-button success text) is
// self-aware: a `self` variant is the player's own photo, not a crop someone
// staged for them, so both strings say "photo" rather than "crop SELF".
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

// True only for a real, finite number. A count that is missing, null, or a
// string means the record does not actually say what happened, and the page
// drops the whole stats line rather than printing a placeholder or a guess.
const isCount = (n) => typeof n === "number" && Number.isFinite(n);

// Pulls the player's real game line out of the committed public games.json.
// The page prints only the player's name from it now (the stats line went on
// 2026-09-20, one page one job); the count checks stay so a half-filled row
// still reads as "not there" rather than as data. Never invent a number
// (repo invariant), which on this page is also the whole point: it exists to
// earn one person's trust, so a number it cannot source it does not show.
//
// The entrant count is `entries`, NOT `results.length`. A game can seat more
// players than it lists result rows for (site/data/games.json ships 2026-08 as
// 8 entries over 7 rows, 2026-07 as 9 over 6), and `entries` is what
// tools/render.ts publishes on /standings/ and the game pages. Counting rows
// here would tell a player "finished 3rd of 7" while /games/2026-08-11/ says
// "8 entries" a click away.
function statsFor(data, setSlug, handle) {
  const game = (data.games || []).find((g) => g.cardSet === setSlug);
  const result = game && (game.results || []).find((r) => r.handle === handle);
  if (!game || !result) return null;
  if (!isCount(game.entries) || !isCount(game.hands) || !isCount(result.finish)) return null;
  const player = (data.players || []).find(
    (p) => p.slug === result.slug || (p.aka || []).includes(handle));
  return {
    name: player ? player.name : handle,
    finish: result.finish,
    entrants: game.entries,
    hands: game.hands,
    date: game.date,
  };
}

// The card that already prints for this player, named by the data rather than
// derived from finish and handle: a guessed filename is a broken image on the
// one page that has to earn a player's trust. Separate from statsFor on
// purpose: statsFor returns null when any COUNT it prints is not a finite
// number, and a missing hands count must drop the stats line, not the card.
// Null when the set, the player, or the card block is missing. Safe to show:
// `cardSet` only appears on a game after that set's page exists
// (docs/publishing.md, pinned by the data suite), so a result reachable here
// is art that is already public. Rendered as an <img>, never a link, so the
// page still leads nowhere (spec s7).
function cardFileFor(data, setSlug, handle) {
  const game = (data.games || []).find((g) => g.cardSet === setSlug);
  const result = game && (game.results || []).find((r) => r.handle === handle);
  const file = result && result.card && result.card.file;
  return typeof file === "string" && file.length > 0 ? file : null;
}

// The art slot's rectangle on that card, [x, y, w, h] in the PNG's pixels,
// recorded in games.json when the set is minted (munger/ccg/measure-art.mjs).
// It is what lets the page draw an uploaded panel INTO the real card rather
// than show the panel on its own. Null unless all four are finite numbers;
// the page then falls back to the bare panel, which is honest if worse.
function cardArtFor(data, setSlug, handle) {
  const game = (data.games || []).find((g) => g.cardSet === setSlug);
  const result = game && (game.results || []).find((r) => r.handle === handle);
  const art = result && result.card && result.card.art;
  return Array.isArray(art) && art.length === 4 && art.every((n) => typeof n === "number" && Number.isFinite(n))
    ? art : null;
}

// Renders the consent page for one ask.
// Takes the Pages Function context ({ request, params, env }); `params.token`
// is the capability token from the URL. Returns a 200 HTML Response with the
// card, the crop pickers, the two actions and (when configured) the
// self-upload block, or the shared 404 page when the token is malformed,
// unknown, expired, or its ask row is malformed. Throws only if D1 itself
// fails; a games.json read failure is swallowed so the consent ask still
// works, just without the stats line and with uploads off.
export async function onRequestGet({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return notFound();

  // `metal` exists in production only after the one-time
  // `ALTER TABLE portrait_asks ADD COLUMN metal TEXT` migration; the runbook
  // in docs/publishing.md owns running it before this code deploys.
  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at, metal FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return notFound();
  const variants = parseVariants(ask.variants);
  if (!variants) return notFound();

  const { results: answerRows } = await env.POKER_RSVP_DB
    .prepare("SELECT answer, variant, answered_at FROM portrait_answers WHERE token = ? ORDER BY rowid ASC")
    .bind(token).all();
  const current = latestAnswer(answerRows);

  let stats = null;
  let cardFile = null;
  let cardArt = null;
  let uploadsOn = false;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/games.json", request.url));
    const data = await res.json();
    stats = statsFor(data, ask.set_slug, ask.handle);
    cardFile = cardFileFor(data, ask.set_slug, ask.handle);
    cardArt = cardArtFor(data, ask.set_slug, ask.handle);
    // Fail CLOSED: any read failure leaves uploads off. The block simply
    // does not render; a capability URL never narrates its own config.
    uploadsOn = data.portraitUploads === true;
  } catch { /* stats stay null, uploads stay off; the consent ask still works */ }

  // The four rarity metals, duplicated from site/portrait-dither.js METALS
  // keys on purpose: this Function cannot import a site/ asset without
  // leaning on bundler behavior nothing else relies on.
  const METAL_NAMES = ["foil", "sapphire", "copper", "pewter"];
  const canUpload = uploadsOn && METAL_NAMES.includes(ask.metal);

  const name = escapeHtml(stats ? stats.name : ask.handle);
  const setName = escapeHtml(monthName(ask.set_slug));

  // An upload-only ask (variants []) has no staged art to show or approve:
  // the page leads with the upload block instead, and the card figure plus
  // the approve button render only once something exists to approve. After
  // an upload the reload comes back through the hasArt path with `self` in
  // the list, so this branch is only ever the BEFORE state.
  const hasArt = variants.length > 0;
  const manyCrops = variants.length > 1;
  // The only answer that changes the page is an approval of something that
  // is actually in the list. A decline is not a state the page shows any
  // more (Mike, 2026-09-20: "there should be no decline!!! that's not a
  // choice they need to make"); a player who never uploads has said no.
  const approved = current !== null && current.answer === "approved"
    && hasArt && variants.includes(current.variant);
  const selected = hasArt ? (approved ? current.variant : variants[0]) : null;
  const img = (v) => `/api/portrait/${token}/img/${v}`;

  // Display rule (spec s4): the staged crops are whole cards, `self` is the
  // bare art panel. The page shows the panel at panel proportions and says so
  // in one caption line rather than faking a full-card composite it cannot
  // make truthfully.
  const isPanel = selected === "self";

  // One page, one job (Mike, 2026-09-20). Three jobs exist:
  //   ask      nothing staged: here is your card, upload an image
  //   pick     crops staged: pick one
  //   done     approved: your image is in, the card updates soon
  // Nothing else renders. No stats, no standing-rule line, no fine print, no
  // decline, no change-your-mind section. What is not on the page is not a
  // decision the player has to make.
  const pickerRow = approved || variants.length < 2 ? "" : `
      <div class="picker" role="group" aria-label="Crop options">
        ${variants.map((v) => `<button type="button" class="btn-secondary variant-pick"
          data-variant="${v}" aria-pressed="${v === selected}">${v === "self" ? "Your photo" : `Crop ${v.toUpperCase()}`}</button>`).join("\n        ")}
      </div>`;

  const uploadLead = "Select \"Choose File\" and upload an image. Some people use a photo, but it can be anything!";
  // The upload block belongs to the ask only: a page with staged crops has
  // one job, and an approved page has none. When uploads are not configured
  // it renders nothing and the page never says why (spec s4): a capability
  // URL should not narrate its own configuration to whoever is holding it.
  const showUpload = canUpload && !hasArt;
  const uploadBlock = !showUpload ? "" : `
  <div class="upload-block">
    <p class="fine">${uploadLead}</p>
    <input type="file" id="photo-in" accept="image/*">
    <div id="composer" hidden>
      <canvas id="preview" width="620" height="236"></canvas>
      <label class="fine">Zoom <input type="range" id="zoom" min="0.05" max="4" step="0.01"></label>
      <p class="fine">Drag the picture to frame it. The face reads best on the left.</p>
      <button type="button" id="use-photo" class="btn-secondary">Use this image</button>
    </div>
  </div>`;

  // The companion script, also conditional. It is a module because
  // /portrait-dither.js is one. Everything it does with the photograph happens
  // in the player's tab; the only network call it makes carries the finished
  // 620x236 panel. Reloading on success is deliberate: the reloaded page shows
  // the server's truth (self selected, approved state), which is simpler and
  // more honest than mirroring that state client-side.
  const uploadScript = !showUpload ? "" : `
<script type="module">
  import { composePanel } from "/portrait-dither.js";
  const metal = ${JSON.stringify(ask.metal)};
  const input = document.getElementById("photo-in");
  const composer = document.getElementById("composer");
  const preview = document.getElementById("preview");
  const zoom = document.getElementById("zoom");
  const ctx = preview.getContext("2d");
  let src = null;
  let view = { scale: 1, ox: 0, oy: 0 };

  function render() {
    if (!src) return;
    const panel = composePanel(src, view, metal);
    ctx.putImageData(new ImageData(panel.data, panel.width, panel.height), 0, 0);
  }

  input.addEventListener("change", async function () {
    const file = input.files && input.files[0];
    if (!file) return;
    // The photo is decoded and processed HERE, in this tab, and nowhere
    // else. imageOrientation un-lies phone EXIF rotation.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const off = document.createElement("canvas");
    off.width = bmp.width; off.height = bmp.height;
    const octx = off.getContext("2d");
    octx.drawImage(bmp, 0, 0);
    src = octx.getImageData(0, 0, bmp.width, bmp.height);
    const fit = Math.max(620 / src.width, 236 / src.height);
    view = { scale: fit, ox: (src.width - 620 / fit) / 2, oy: (src.height - 236 / fit) / 2 };
    zoom.min = String(Math.min(fit, 0.05));
    zoom.value = String(fit);
    composer.hidden = false;
    render();
  });

  zoom.addEventListener("input", function () {
    view.scale = Number(zoom.value);
    render();
  });

  let drag = null;
  preview.addEventListener("pointerdown", function (e) {
    drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener("pointermove", function (e) {
    if (!drag) return;
    const cssScale = preview.getBoundingClientRect().width / 620;
    view.ox = drag.ox - (e.clientX - drag.x) / cssScale / view.scale;
    view.oy = drag.oy - (e.clientY - drag.y) / cssScale / view.scale;
    render();
  });
  preview.addEventListener("pointerup", function () { drag = null; });

  document.getElementById("use-photo").addEventListener("click", function () {
    preview.toBlob(function (blob) {
      fetch("/api/portrait/${token}/upload", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      }).then(function (r) {
        if (r.ok) { location.reload(); return; }
        document.getElementById("state").textContent =
          "That did not go through. Try again, or just tell Mike.";
      }).catch(function () {
        document.getElementById("state").textContent =
          "That did not go through. Try again, or just tell Mike.";
      });
    }, "image/png");
  });
</script>`;

  // Three intros for three states. The upload-only page never pretends art
  // exists, and when uploads are off it says something neutral rather than
  // rendering a dead end; "nothing is staged" is true in every configuration
  // that reaches it, so the line narrates the ask, not the config (spec s4).
  // The card the player already has. Before this, a player with nothing staged
  // got a page headed "Your card" that showed no card. The set's own design
  // says the card is the pitch.
  const cardUrl = cardFile
    ? `/cards/${encodeURIComponent(ask.set_slug)}/assets/${encodeURIComponent(cardFile)}`
    : null;
  const monogramCard = !hasArt ? cardUrl : null;
  // The full card with the player's own panel drawn in (Mike, 2026-09-20:
  // "what happened to the FULL CARD?"). Only `self` needs it: staged crops
  // are already whole cards. Drawn in the browser from two public images,
  // the card PNG and the panel, at the slot recorded in games.json. Without
  // a card or a rectangle the page shows the bare panel, as before.
  const composite = isPanel && cardUrl && cardArt ? { card: cardUrl, art: cardArt } : null;

  // Copy in Mike's register (For Review, 2026-09-20): one short line per job.
  const intro = approved
    ? `<p>Your image is in!</p>`
    : hasArt
      ? (manyCrops ? `<p>Pick the one you like!</p>` : `<p>Your photo, on your card!</p>`)
      : canUpload
        ? (monogramCard
          ? `<p>That is your card from the ${setName} set.</p>
  <p>You can now upload a photo!</p>`
          : `<p>You can now upload a photo to your ${setName} card!</p>`)
        : `<p>Nothing is staged on your ${setName} card right now. If you were
  expecting to add a photo here, tell Mike.</p>`;

  // "Your card has no art!" is Mike's line. It is true for every card an
  // upload-only ask can reach only because the mint rule forbids a new ask
  // for a player with a standing panel (munger/ccg/portraits-approved/
  // README.md); the page cannot check the ledger itself.
  const caption = approved
    ? "Your card will be updated soon."
    : isPanel ? "Your photo, as it goes on the card." : "";
  const figureBlock = !hasArt
    ? (monogramCard
      ? `<figure class="card-shot"><img src="${monogramCard}" alt="Your ${setName} player card, with no art yet"><figcaption class="fine">Your card has no art!</figcaption></figure>`
      : "")
    : composite
      // A canvas the size of the card, painted by the script below. The <img>
      // keeps its id so the crop-swap script is unchanged, and stays as the
      // fallback if either image fails to load.
      ? `<figure class="card-shot"><canvas id="card-composite" style="display:none"></canvas><img id="card-img" src="${img(selected)}" alt="Your ${setName} player card">${caption ? `<figcaption class="fine">${caption}</figcaption>` : ""}</figure>`
      : `<figure class="card-shot${isPanel ? " card-shot--panel" : ""}"><img id="card-img" src="${img(selected)}" alt="Your ${setName} player card">${caption ? `<figcaption class="fine">${caption}</figcaption>` : ""}</figure>`;

  // Paints the player's panel into their real card. Both images are same-
  // origin, so the canvas stays clean. The panel is 620x236 and the slot is
  // narrower (object-fit: cover on the sheet), so it is centred and cropped
  // the same way the sheet does it. If anything fails to load the <img> is
  // left showing and the canvas never appears.
  const compositeScript = !composite ? "" : `
<script>
  (function () {
    var c = document.getElementById("card-composite");
    var i = document.getElementById("card-img");
    var art = ${JSON.stringify(composite.art)};
    var card = new Image(), panel = new Image();
    var left = 2;
    function done() {
      if (--left) return;
      c.width = card.naturalWidth; c.height = card.naturalHeight;
      var ctx = c.getContext("2d");
      ctx.drawImage(card, 0, 0);
      var x = art[0], y = art[1], w = art[2], h = art[3];
      var s = Math.max(w / panel.naturalWidth, h / panel.naturalHeight);
      var pw = panel.naturalWidth * s, ph = panel.naturalHeight * s;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(panel, x + (w - pw) / 2, y + (h - ph) / 2, pw, ph);
      ctx.restore();
      c.style.display = "block"; i.style.display = "none";
    }
    card.onload = done; panel.onload = done;
    card.src = ${JSON.stringify(composite.card)};
    panel.src = i.src;
  })();
</script>`;

  // One button, on the pick page only. Approving nothing is not a thing, and
  // an approved page has nothing left to press.
  const approveButton = hasArt && !approved
    ? `<div class="actions"><button type="button" id="approve" class="btn-secondary">Use this one</button></div>`
    : "";

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
  .portrait-page .card-shot img, .portrait-page .card-shot canvas { display: block; width: min(100%, 22rem); margin: 0 auto; border-radius: 12px; }
  /* The panel is 620x236 art, not a 22rem-wide card, so it fills the column.
     Scoped under .portrait-page so it OUTWEIGHS the card rule above; the
     bare .card-shot--panel img selector would lose on specificity and the
     panel would silently render at card width. */
  .portrait-page .card-shot--panel img { width: 100%; border-radius: 8px; }
  .upload-block { margin: 1.5rem 0; text-align: center; }
  .upload-block label { display: block; margin: .5rem 0; }
  /* touch-action: none so a drag across the preview frames the photo instead
     of scrolling the page out from under the player's thumb. */
  #preview { width: 100%; max-width: 620px; border-radius: 8px; touch-action: none; }
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
  ${intro}
  ${figureBlock}
  ${pickerRow}
  ${approveButton}
  ${uploadBlock}
  <p class="state" id="state"></p>
  ${approved ? "" : `<noscript><p class="fine">This page needs JavaScript to record your answer. Tell Mike directly instead; that works too.</p></noscript>`}
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
  // Null-guarded: only the pick page renders the button. On success the page
  // reloads into the done state, the server's truth, the same way the upload
  // path does.
  var approveBtn = document.getElementById("approve");
  if (approveBtn) approveBtn.addEventListener("click", function () {
    fetch("/api/portrait/${token}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "approved", variant: selected }),
    }).then(function (r) {
      if (r.ok) { location.reload(); return; }
      state.textContent = "That did not go through. Try again, or just tell Mike.";
    }).catch(function () {
      state.textContent = "That did not go through. Try again, or just tell Mike.";
    });
  });
</script>${compositeScript}${uploadScript}
</body>
</html>`;
  return new Response(html, { status: 200, headers: HEADERS });
}
