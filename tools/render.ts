// Renders the derived pages (standings, games index, player pages) as full
// committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import {
  deriveStandings, type GamesData, type Game, type GameResult, type CardRef, type HopeCoinStop,
} from "./lib/standings";
import { trophyCase, TROPHIES, displayOrder, type Trophy, type Look, type Earned } from "./lib/trophies";
import { odometer, formatMiles, tenureMonths, holderShares, monthIndex } from "./lib/hope-coin";

// HTML-escapes a string for use in text content OR inside a double-quoted
// attribute. Takes any string; returns it with & < > and " replaced by their
// entities; throws nothing. The double quote matters because page() feeds
// this into content="..." attributes (description, og:title): every caller
// today passes a literal, but the first non-literal must not be able to end
// the attribute early (issue #12). Exported for its unit test only.
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The record's span, derived rather than typed (issue #3). Takes the games
// data; returns one sentence naming the month the spine starts with (its
// earliest game, whatever order games.json lists them in) and, while
// data.backfillPending names seasons still missing, a second sentence listing
// them. Throws when there are no games: a standings page with no record is a
// data error, not a copy problem. Standings and the games index both print
// this so neither reads as an all-time claim.
//
// Why derived: this used to be a hardcoded "starts with July 2026" string,
// which a backfill of the 2020 season would have left on the page while
// displaying 2020 games. The earliest game cannot be wrong about itself, and
// backfillPending is the one place that knows a season is still missing;
// Charlie removes an entry in the same commit as the game it names.
export function recordQualifier(data: GamesData): string {
  const earliest = data.games.map(g => g.date).sort()[0];
  if (!earliest) throw new Error("recordQualifier: games.json has no games on the spine");
  const [y, m] = earliest.split("-").map(Number);
  const start = `This record starts with ${MONTHS[m - 1]} ${y}.`;
  const pending = (data.backfillPending ?? []).map(esc);
  if (pending.length === 0) return start;
  return `${start} Earlier seasons (${listWithAnd(pending)}) predate the data spine and are being backfilled.`;
}

// "a", "a and b", "a, b, and c" (Oxford comma, house style). Takes the
// items; returns the joined phrase; an empty list returns an empty string.
function listWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Inline SVG marks: rarity gems and the Hope Coin. Chrome is drawn, never
// emoji (design spec 2026-08-26 §7.3). Class names are the contract with
// site/styles.css (.mark rules); change both together or neither.
const GEM = (metal: "foil" | "sapphire" | "copper" | "pewter") =>
  `<svg class="mark mark--${metal}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z"/></svg>`;
const GEM_EMPTY =
  `<svg class="mark mark--empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z"/></svg>`;
const COIN =
  `<svg class="mark" viewBox="0 0 12 12" width="12" height="12" role="img" aria-label="Hope Coin"><circle class="coin-ring" cx="6" cy="6" r="5"/><circle class="coin-core" cx="6" cy="6" r="2.2"/></svg>`;
// Skull marks for the Hope Slayer tally (Mike, 2026-08-26: skulls should
// look like skulls, and drawn ones render the same on every platform where
// the emoji does not). Filled = a kill taken; outline = an open slot.
const SKULL =
  `<svg class="mark mark--skull" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1a4.3 4.3 0 0 0-4.3 4.3c0 1.6.9 3 2.3 3.7V11h4V9a4.3 4.3 0 0 0 2.3-3.7A4.3 4.3 0 0 0 6 1Z"/><circle class="socket" cx="4.4" cy="5.3" r=".95"/><circle class="socket" cx="7.6" cy="5.3" r=".95"/></svg>`;
const SKULL_EMPTY =
  `<svg class="mark mark--skull-empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.6a3.7 3.7 0 0 0-3.7 3.7c0 1.4.8 2.6 2 3.2v1.9h3.4V8.5a3.7 3.7 0 0 0 2-3.2A3.7 3.7 0 0 0 6 1.6Z"/></svg>`;
// The two trophy shapes added for player pages (Task 2's CSS contract:
// .mark--shield and .mark--ribbon carry geometry only, no fill of their own,
// so the same path draws every metal, exactly the way GEM's one path takes
// a metal argument). Each has its own dedicated _EMPTY sibling for the
// locked state, the same pattern GEM/GEM_EMPTY and SKULL/SKULL_EMPTY already
// use, and for the same reason: `.mark--empty` strokes at stroke-width 1.2,
// and a path that touches the viewBox edge loses half that stroke to
// clipping. SHIELD's flat top and point touch y=0 and y=12 exactly, so
// SHIELD_EMPTY is inset a full unit on every side, matching GEM_EMPTY's own
// 0..12 -> 1..11 inset. RIBBON is centered with margin to spare, but gets an
// inset sibling anyway for the same "locked reads as a smaller echo of
// earned" reason GEM_EMPTY is smaller than GEM.
//
// Review round 1 (Task 7): the shield's first draft was a symmetric hexagon,
// near-indistinguishable from GEM's diamond at 12px, which defeats telling
// marks apart at a glance once Task 9 puts several in one dense row. A flat
// top reads as a shield unmistakably. The ribbon's first draft was
// top-anchored (y 0..9 in the 12-tall box) rather than vertically centered
// like every other mark; it is centered here.
const SHIELD = (metal: Look["metal"]) =>
  `<svg class="mark mark--shield mark--${metal}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1 0 11 0 11 6.5 6 12 1 6.5Z"/></svg>`;
const SHIELD_EMPTY =
  `<svg class="mark mark--shield mark--empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 1 10 1 10 6.5 6 11 2 6.5Z"/></svg>`;
const RIBBON = (metal: Look["metal"]) =>
  `<svg class="mark mark--ribbon mark--${metal}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1.5 9 1.5 9 10.5 6 8.5 3 10.5Z"/></svg>`;
const RIBBON_EMPTY =
  `<svg class="mark mark--ribbon mark--empty" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2.5 8 2.5 8 9.5 6 8 4 9.5Z"/></svg>`;

// nav(current) renders the masthead links, marking the page's own link with
// aria-current so visitors can see where they are (styled in styles.css).
// Strict equality only: nav() carries no routing policy of its own about
// what a page outside the four sections "belongs under". A page whose own
// address isn't one of these four hrefs (a player page, the Hope Coin page)
// still wants exactly one link marked current, but that is an opinion for
// the caller to state explicitly - see page()'s `navCurrent` parameter
// below, which is how renderPlayer asks for Standings without changing what
// this function does or does to any future page (a game page, the archive
// page) that is also outside this list but should highlight something else.
const nav = (current: string) =>
  ([["/", "Home"], ["/games/", "Games"], ["/cards/", "Cards"], ["/standings/", "Standings"]] as const)
    .map(([href, label]) =>
      `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join(" · ");

// The share-image every page falls back to when it has no image of its own
// (July's foil champion card). A player page with no card yet, or a page
// that predates per-page images, all unfurl with this rather than nothing.
const DEFAULT_OG_IMAGE = "https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png";

// footerTone is the background class for the closing footer band. Bands must
// alternate light/dark with no two of the same tone touching (brand rule), so
// the caller passes whichever tone opposes its own last section. `current` is
// the page's own address: it becomes the absolute og:url, so a shared link
// unfurls pointing at this page rather than at whatever page the scraper
// guessed. `description` fills the meta/og description.
//
// `options` is everything a caller only sometimes needs to override, all of
// it optional (review round 2, Task 7: these used to be four trailing
// positional string parameters, which typechecks happily even when two of
// them are transposed at a call site - nothing about `string` stops
// `navCurrent` and `footerHref` from swapping past the compiler). Read this
// comment before adding a caller, not the call site you are copying from:
//
//   image      - the og:image. Defaults to DEFAULT_OG_IMAGE (July's foil
//                champion card), which is what every page rendered before
//                this option existed unfurled with, so omitting it keeps
//                that unchanged. Override when the page has its own picture
//                worth sharing (renderPlayer passes a player's newest card).
//   navCurrent - which of nav()'s four links gets aria-current. Defaults to
//                `current` itself, correct for any page that IS one of
//                those four sections (every caller before Task 7). A page
//                outside the four - a player page, the Hope Coin page -
//                still wants exactly one link marked, so it names that link
//                here explicitly rather than nav() guessing a routing
//                policy from `current`'s shape (round 1 found exactly that
//                guess baked into nav() itself, which would have silently
//                mis-highlighted Standings for any future page - a game
//                page, the archive page - that is also outside the four but
//                should highlight something else).
//   footerHref - the one footer link's target. Defaults to "/", today's
//                "back to the homepage" link on every existing page.
//   footerText - that link's visible text. Defaults to "poker.kmikeym.com".
//                A page whose brief calls for a specific footer link (the
//                player page's brief: "one link, to Standings") overrides
//                footerHref and footerText together.
//
// The two existing callers, renderStandings and renderGamesIndex, pass no
// fifth argument at all and are byte-identical to before this option
// existed - confirmed by the render drift check, which is the actual
// guard: those two pages are committed HTML this option must never move.
type PageOptions = {
  image?: string;
  navCurrent?: string;
  footerHref?: string;
  footerText?: string;
};

function page(
  title: string,
  body: string,
  footerTone: "band-light" | "band-dark",
  current: string,
  description: string,
  options: PageOptions = {}
): string {
  const {
    image = DEFAULT_OG_IMAGE,
    navCurrent = current,
    footerHref = "/",
    footerText = "poker.kmikeym.com",
  } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | K5M Shareholder Poker</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="${esc(title)} | K5M Shareholder Poker">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://poker.kmikeym.com${current}">
<meta property="og:type" content="website">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner">${nav(navCurrent)}</div>
</nav>
${body}
<footer class="${footerTone}" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat">Generated from the game record. <a href="${footerHref}">${esc(footerText)}</a></p></div>
</footer>
</body>
</html>
`;
}

// The standings row's own trophy shelf (task 9 of the 2026-09-02
// player-pages-trophies-hope-coin plan, spec §5.3): a dense run of the
// player's earned marks, in trophyCase's own display order, capped at six
// so one player's trophy count never grows a ledger row taller than its
// neighbors. Takes the `earned` list trophyCase() already returned for this
// slug - never recomputed here, per the one design rule at the top of
// tools/lib/trophies.ts ("a trophy is one registry entry and nothing
// else") - and returns the <span class="shelf"> markup for the Trophies
// cell. A player who has earned nothing gets back "": renderStandings
// always writes the <td> around whatever this returns, so an empty string
// is what keeps that cell present on the row but visibly empty, rather
// than this function inventing a "nothing yet" placeholder of its own.
//
// Draws marks with trophyMarkEarned, defined further down this file in the
// player-page section Task 7 built - reused rather than a second SVG
// switch, so a shelf mark and a trophy-case tile for the same trophy are
// always pixel-identical.
//
// Gives one shelf mark an accessible name (final fix wave, item 5): every
// shape trophyMarkEarned draws is `aria-hidden="true"` except the Coin
// (which already carries its own `role="img" aria-label="Hope Coin"` - see
// the COIN constant), because on a trophy-case tile the name already sits
// right next to the mark as visible `<h3>` text, so hiding the mark itself
// from a screen reader there loses nothing. The shelf has no such text: it
// is nothing but a dense run of marks, so the same aria-hidden marks that
// are harmless on a tile leave the standings Trophies column announcing as
// an empty cell under a header that is not empty. Takes the raw SVG string
// trophyMarkEarned already built and the trophy's own `name` from the
// registry - the actual name Charlie would read on that trophy's own tile,
// never re-derived or abbreviated here - and returns the same markup with
// an accessible name wired in, plus a `title` attribute either way (a
// native browser hover label for sighted visitors; still no visible
// legend, which is the site owner's design call, not this fix's).
//
// Two shapes, because the Coin already has an accessible name of its own:
//   - Every other shape: swap its `aria-hidden="true"` for
//     `role="img" aria-label="<name>" title="<name>"`, in the exact spot
//     aria-hidden held, which is why this leaves the leading
//     `<svg class="mark ...` prefix every mark starts with untouched (Task
//     9's own shelf tests count and order marks by matching that exact
//     prefix and the class names right after it; swapping a same-length
//     attribute is what keeps that markup shape intact instead of
//     reordering the tag's attributes and breaking those tests for a
//     reason that has nothing to do with what they are actually checking).
//   - The Coin: never overwrite its own aria-label with the registry's
//     longer "The Hope Coin" - a screen reader and a mouse hover
//     disagreeing about one mark's name would be worse than the gap this
//     fix closes. Only a matching `title` is added, read back off the
//     markup's own existing aria-label rather than off `name`.
function accessibleShelfMark(markup: string, name: string): string {
  const label = esc(name);
  if (markup.includes('aria-hidden="true"')) {
    return markup.replace('aria-hidden="true"', `role="img" aria-label="${label}" title="${label}"`);
  }
  const existingLabel = /aria-label="([^"]*)"/.exec(markup);
  const hoverLabel = existingLabel ? esc(existingLabel[1]!) : label;
  return markup.replace(">", ` title="${hoverLabel}">`);
}
const SHELF_CAP = 6;
function trophyShelf(earned: Earned[]): string {
  if (earned.length === 0) return "";
  const trophyById = new Map(TROPHIES.map((t) => [t.id, t]));
  const marks = earned.slice(0, SHELF_CAP).map((e) => {
    const trophy = trophyById.get(e.id);
    // trophyCase() only ever returns ids from its own registry, so this can
    // only fire if this file and lib/trophies.ts have drifted out of sync
    // with each other - never a data problem, always a code bug, hence
    // throw rather than silently dropping a mark off the shelf.
    if (!trophy) throw new Error(`trophyShelf: trophyCase returned an unknown trophy id "${e.id}"`);
    return accessibleShelfMark(trophyMarkEarned(trophy.look), trophy.name);
  }).join("");
  const overflow = earned.length - SHELF_CAP;
  const more = overflow > 0 ? `<span class="shelf-more">+${overflow}</span>` : "";
  return `<span class="shelf">${marks}${more}</span>`;
}

// The standings page's trophy legend (spec follow-up 2026-09-03): a quiet
// key beneath the ledger pairing every registry trophy's own mark with its
// name, in the exact order the shelf and the trophy case already draw them.
// Takes nothing - it reads TROPHIES through displayOrder() directly, never a
// second list of names or marks, because that is this repo's one design rule
// for trophies (tools/lib/trophies.ts header comment: "a trophy is one
// registry entry and nothing else"). Adding a trophy to the registry makes
// it appear here automatically; nothing about this function names a count
// or an id.
//
// Draws every mark EARNED (trophyMarkEarned, the same helper trophyShelf and
// the player-page trophy case both call - never a second SVG switch), never
// LOCKED: this legend explains what a shape and a metal mean, not whether
// any one player has earned it, so there is no "locked" reading to draw.
// Each mark stays aria-hidden (its default from trophyMarkEarned/the GEM,
// SKULL, SHIELD, RIBBON, and COIN constants) rather than routed through
// accessibleShelfMark like the shelf's own marks are: the trophy's name
// already sits right next to the mark as visible text in the same <li>, the
// identical reasoning accessibleShelfMark's own comment gives for leaving a
// trophy-case tile's mark aria-hidden, so hiding it again here from a screen
// reader loses nothing.
function trophyLegend(): string {
  const items = displayOrder()
    .map((trophy) => `<li>${trophyMarkEarned(trophy.look)} <span>${esc(trophy.name)}</span></li>`)
    .join("");
  return `<ul class="trophy-legend">${items}</ul>`;
}

// Renders the standings page in full: the Foil and Hope Coin tiles, then
// the ledger table with one row per player on `deriveStandings(data).rows`.
// Takes the parsed games.json; returns the complete HTML document (this is
// what Task 10 writes to the committed site/standings/index.html, and what
// the render drift check - `bun tools/render.ts && git diff --exit-code` on
// that file - compares against). Throws nothing of its own: an empty
// `data.games` list would fail earlier, inside `latest.results.find(...)!`
// below, which is deliberate - a standings page with no games at all is a
// data error, not a page this function should render blank.
//
// Two invariants worth knowing before touching this function again:
//
//   - Each row calls trophyCase(data, r.slug) itself, the same function the
//     player page's own trophy case calls (renderPlayer, further down this
//     file). This is not incidental: it is what guarantees the shelf here
//     and the case on /player/<slug>/ can never disagree about what a
//     player has earned, because both read the one registry through the
//     one function rather than each keeping its own count.
//   - The Trophies `<td>` is appended LAST in the row, after Rebuys, on
//     purpose - the brief for this column (task 9) is explicit that the
//     numeric columns (Games through Rebuys) stay together as one block,
//     so a reader scanning the table doesn't have a text column splitting
//     them. Add a future column after Trophies, not before it, unless a
//     later brief says otherwise.
//
// The trophy legend (spec follow-up 2026-09-03) sits beneath the closed
// table, not inside it: the Trophies column shows what THIS player earned
// (shelf, capped, dense), and the legend beneath explains what every mark
// on the whole page MEANS (uncapped, all fifteen). Built by trophyLegend()
// above, which reads the registry directly rather than this function
// passing it anything - the count on the legend tracks TROPHIES.length on
// its own, so a sixteenth trophy needs no edit here.
export function renderStandings(data: GamesData): string {
  const s = deriveStandings(data);
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const holderName = nameOf.get(s.hopeCoin.holder) ?? s.hopeCoin.holder;
  // The reigning champion is the winner of the most recent game on the spine.
  const latest = [...data.games].sort((a, b) => b.date.localeCompare(a.date))[0];
  const champ = latest.results.find(r => r.finish === 1)!;
  const champName = nameOf.get(champ.slug) ?? champ.slug;
  const skulls = Object.entries(s.hopeCoin.skulls)
    .map(([slug, n]) =>
      `<li>${esc(nameOf.get(slug) ?? slug)}: ${SKULL.repeat(n)}${SKULL_EMPTY.repeat(3 - n)} <span class="stat">${n} of 3</span> skulls</li>`)
    .join("\n          ");
  // Each row's name is now the way into that player's own page (task 9,
  // M1): the anchor wraps the name only, so the champion gem and Coin mark
  // that already followed the name keep sitting outside the link, exactly
  // where they were before this task touched this line.
  const rows = s.rows.map((r, i) => {
    const { earned } = trophyCase(data, r.slug);
    return `      <tr class="finish-${i + 1}">
        <td><a href="/player/${r.slug}/">${esc(r.name)}</a>${r.slug === champ.slug ? " " + GEM("foil") : ""}${r.slug === s.hopeCoin.holder ? " " + COIN : ""}</td>
        <td class="num">${r.games}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.cashes}</td>
        <td class="num">${r.bestFinish}</td>
        <td class="num">$${r.totalPayout}</td>
        <td class="num">${r.rebuys}</td>
        <td>${trophyShelf(earned)}</td>
      </tr>`;
  }).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Standings</h1>
    <p class="stat">${recordQualifier(data)}</p>
    <div class="tiles">
      <div class="tile tile--foil">
        <h3>The Foil</h3>
        <p><strong>${esc(champName)}</strong> ${GEM("foil")} holds the foil: won ${latest.date}.${latest.cardSet ? ` <a href="/cards/${latest.cardSet}/">The card set</a>.` : ""}</p>
      </div>
      <div class="tile">
        <h3><a href="/hope-coin/">The Hope Coin</a> ${COIN}</h3>
        <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
        <ul>
          ${skulls}
        </ul>
      </div>
    </div>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Won</th><th>Rebuys</th><th>Trophies</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
    ${trophyLegend()}
  </div>
</section>`;
  return page(
    "Standings", body, "band-dark", "/standings/",
    "Wins, cashes, payouts, and the Hope Coin race for every K5M Shareholder Poker game."
  );
}

// The standing schedule rule, as arithmetic: the second Tuesday of a month.
// Used ONLY for the season page's "upcoming" cards, which the page labels as
// schedule projections; nextGame in games.json stays the one authoritative
// date (a moved game changes nextGame, never this function).
export function secondTuesday(year: number, month: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((2 - firstDow + 7) % 7) + 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "2026-09-08" -> "Sept 8" for button copy; month names match rsvp.js.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}

// The season page (F1 schedule pattern, Mike 2026-08-26): every game a
// uniform card in chronological order; played games show the podium, the
// next game is the page's single felt-and-lime card, upcoming games are
// unopened packs projected from the standing rule.
export function renderGamesIndex(data: GamesData): string {
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));

  const played = [...data.games].sort((a, b) => a.date.localeCompare(b.date)).map(g => {
    const top3 = g.results.filter(r => r.finish <= 3).sort((a, b) => a.finish - b.finish);
    const podium = top3.map(r => {
      const payout = r.payout > 0 ? ` <span class="stat">$${r.payout}</span>` : "";
      const gem = r.finish === 1 ? " " + GEM("foil") : "";
      return `        <li><span class="stat">${r.finish}</span> ${esc(nameOf.get(r.slug) ?? r.slug)}${gem}${payout}</li>`;
    }).join("\n");
    const [, m] = g.date.split("-").map(Number);
    const cards = g.cardSet ? ` · <a href="/cards/${g.cardSet}/">The cards</a>` : "";
    return `    <li class="season-card">
      <p class="eyebrow">${MONTHS[m - 1]} · Played</p>
      <p class="season-date"><a href="/games/${g.date}/">${g.date}</a></p>
      <ol class="podium">
${podium}
      </ol>
      <p class="stat">${g.entries} entries · $${g.pot} pot · ${g.hands} hands</p>
      <p class="season-links"><a href="/games/${g.date}/">The game</a>${cards}</p>
    </li>`;
  }).join("\n");

  // Upcoming: the two months after the next game, per the standing rule.
  const [ny, nm] = data.nextGame.date.split("-").map(Number);
  const upcoming = [1, 2].map(k => {
    const y = ny + Math.floor((nm - 1 + k) / 12);
    const m = ((nm - 1 + k) % 12) + 1;
    const date = secondTuesday(y, m);
    return `    <li class="season-card season-card--upcoming">
      <p class="eyebrow">${MONTHS[m - 1]} · Upcoming</p>
      <p class="season-date">${date}</p>
      <span class="card-back">Unopened</span>
      <p class="stat">Second Tuesday, per the standing schedule.</p>
    </li>`;
  }).join("\n");

  const [, nextM] = data.nextGame.date.split("-").map(Number);
  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Games</h1>
    <p>Second Tuesday of every month, 7pm PT. One game, one set of cards, one line in the record.</p>
    <p class="stat">${recordQualifier(data)}</p>
    <ol class="season">
${played}
    <li class="season-card season-card--next">
      <p class="eyebrow">${MONTHS[nextM - 1]} · Next game</p>
      <p class="season-date">${data.nextGame.date}</p>
      <p>${data.nextGame.time}, cards on Poker Now, faces on Zoom. New players welcome.</p>
      <p><a class="btn-primary" href="/#rsvp-form">RSVP for ${shortDate(data.nextGame.date)}</a></p>
      <p class="season-links"><a href="/next-game.ics">Add to calendar</a></p>
    </li>
${upcoming}
    </ol>
  </div>
</section>`;
  return page(
    "Games", body, "band-dark", "/games/",
    "The season: every K5M Shareholder Poker game played, the next one, and what the schedule holds."
  );
}

// The next game as a calendar file, served at /next-game.ics and regenerated
// with the season page. Deterministic on purpose: DTSTAMP derives from the
// game date, never the wall clock, so the render drift check stays clean.
// 7pm Pacific, three hours (the site's own "How the night runs" numbers).
export function renderNextGameIcs(data: GamesData): string {
  const d = data.nextGame.date.replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//poker.kmikeym.com//EN",
    "BEGIN:VEVENT",
    `UID:poker-kmikeym-${data.nextGame.date}`,
    `DTSTAMP:${d}T000000Z`,
    `DTSTART;TZID=America/Los_Angeles:${d}T190000`,
    `DTEND;TZID=America/Los_Angeles:${d}T220000`,
    "SUMMARY:K5M Shareholder Poker",
    "DESCRIPTION:No-limit Hold'em. Cards on Poker Now\\, faces on Zoom. RSVP at poker.kmikeym.com.",
    "URL:https://poker.kmikeym.com/",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Player pages (spec 2026-09-02 §5.1). Every player who has played at least
// one game on the spine gets /player/<slug>/: their cards, their trophy
// case, their full game record, and a bio when Charlie has written one.
// Task 10 runs this against the real data and commits site/player/<slug>/
// for every slug playerSlugs() returns; this file only produces the string.

// The tier name a caption uses for a card's metal, matching the wording the
// set pages already use (Foil, Rare, Uncommon, Common). Kept local to this
// file rather than in lib/standings.ts because it is presentation, not data.
const TIER_NAME: Record<CardRef["metal"], string> = {
  foil: "Foil",
  sapphire: "Rare",
  copper: "Uncommon",
  pewter: "Common",
};

// Picks the drawn mark for an EARNED trophy tile: the shape from the
// registry's look.shape, coloured by look.metal. The switch is written to
// cover every member of Look["shape"] with no default fallthrough, so a
// future trophy shape added to tools/lib/trophies.ts without a matching case
// here is a compile error (the `never` assignment below fails to typecheck)
// rather than a silently blank tile on a live page.
function trophyMarkEarned(look: Look): string {
  switch (look.shape) {
    case "gem": return GEM(look.metal);
    case "coin": return COIN;
    case "skull": return SKULL;
    case "shield": return SHIELD(look.metal);
    case "ribbon": return RIBBON(look.metal);
    default: {
      const unreachable: never = look.shape;
      throw new Error(`trophyMarkEarned: unknown trophy shape "${unreachable}"`);
    }
  }
}

// Picks the drawn mark for a LOCKED trophy tile: the same shape, greyed via
// the shared .mark--empty outline (site/styles.css, Task 2), drawn from its
// own dedicated _EMPTY constant the same way GEM_EMPTY and SKULL_EMPTY are
// - not the earned path with a class swapped in, because several of these
// paths touch the viewBox edge and would clip half their stroke (see the
// SHIELD/RIBBON comment above).
//
// Coin has no dedicated locked art. Only one registry entry uses shape
// "coin" (the Hope Coin), and this falls back to GEM_EMPTY, the same grey
// diamond every other "not earned yet" mark on the site already draws. This
// is a judgment call made here, in Task 7, not a stand-in for a check some
// later task owns: nothing tests the exact shape a locked Hope Coin tile
// draws, and a future pass is free to give it its own empty-coin constant
// without touching this switch's other branches.
function trophyMarkLocked(look: Look): string {
  switch (look.shape) {
    case "gem": return GEM_EMPTY;
    case "coin": return GEM_EMPTY;
    case "skull": return SKULL_EMPTY;
    case "shield": return SHIELD_EMPTY;
    case "ribbon": return RIBBON_EMPTY;
    default: {
      const unreachable: never = look.shape;
      throw new Error(`trophyMarkLocked: unknown trophy shape "${unreachable}"`);
    }
  }
}

// The meta line under an earned trophy's name: "x3" when the player has
// earned it more than once (never "x1" - a first earning reads as just its
// date, per spec §5.1 step 3), then the most recent date, when there is one.
// Reads `count` for how many and `dates` only for which ones are dated,
// per trophies.ts's own contract on Earned: the Hope Coin can be earned with
// count 1 and an EMPTY dates array (a stop with no recorded `from` has no
// date to show), so this never infers a count from dates.length and never
// invents a placeholder date when dates is empty - an empty dates list just
// means the line has no date segment, not a blank date.
function earnedTrophyMeta(e: Earned): string {
  const parts: string[] = [];
  if (e.count > 1) parts.push(`x${e.count}`);
  if (e.dates.length > 0) parts.push(e.dates[e.dates.length - 1]!);
  return parts.join(" · ");
}

// One tile in the trophy case: the mark, then a .trophy-text block holding
// the trophy's name as an <h3>, its earn line as <p class="trophy-earn">,
// and, when there is one, `meta` (the earned count and latest date) as
// <p class="stat">. site/styles.css lays the tile out as mark + text block
// (`.trophy`, `.trophy-text`) and styles the lines through `.trophy h3`,
// `.trophy p`, `.trophy-earn`; keep that shape.
//
// The earn line shows on EVERY tile, earned or locked (2026-09-05, a visitor
// via Mike): before this, an earned tile carried only its count and date,
// so a player could see they held a trophy and still not know what it was
// for. A locked tile passes an empty `meta` and shows the earn line once.
function trophyTile(trophy: Trophy, meta: string, locked: boolean): string {
  const mark = locked ? trophyMarkLocked(trophy.look) : trophyMarkEarned(trophy.look);
  const metaLine = meta ? `\n          <p class="stat">${meta}</p>` : "";
  return `      <div class="trophy${locked ? " trophy--locked" : ""}">
        ${mark}
        <div class="trophy-text">
          <h3>${esc(trophy.name)}</h3>
          <p class="trophy-earn">${esc(trophy.earn)}</p>${metaLine}
        </div>
      </div>`;
}

// Every slug with at least one result somewhere on the spine, and no other
// slug. Derived from results rather than read off `players` because
// eligibility never lapses: games are never removed from the spine (house
// rule), so a player who has ever played keeps a page forever even if
// `players` is later reordered or annotated. A player added to the roster
// who has never played (a pre-spine Hope Coin holder, say) is correctly
// excluded - they get named on the coin page, not a page of their own.
export function playerSlugs(data: GamesData): string[] {
  const slugs = new Set<string>();
  for (const game of data.games) {
    for (const result of game.results) slugs.add(result.slug);
  }
  return [...slugs].sort();
}

// Renders one player's full page: heading and handles, their card gallery
// (newest set first, holo on the newest only when it is foil), their trophy
// case from trophyCase(), their complete game record with a totals row, and
// Charlie's bio when there is one. Takes the parsed games.json and a slug;
// returns the full document; throws when the slug is not on the roster at
// all (never render a page for an invented player).
export function renderPlayer(data: GamesData, slug: string): string {
  const player = data.players.find((p) => p.slug === slug);
  if (!player) throw new Error(`renderPlayer: no player on the roster with slug "${slug}"`);

  // Every game this player actually played, newest first. Both the gallery
  // and the ledger read from this one list so they can never disagree about
  // which games the player was in.
  const played: { game: Game; result: GameResult }[] = [];
  for (const game of data.games) {
    const result = game.results.find((r) => r.slug === slug);
    if (result) played.push({ game, result });
  }
  played.sort((a, b) => b.game.date.localeCompare(a.game.date));

  // Cards: the subset of `played` carrying a card, in the same newest-first
  // order. A game with a card must carry cardSet and cardSetName (spec
  // §3.1; tools/site.test.ts's card cross-check enforces this over the real
  // data); this throws rather than guessing either one so a malformed
  // fixture or a future data bug fails loudly instead of publishing a
  // broken link or a blank set name.
  const carded = played.filter((p) => p.result.card);
  const figures = carded.map(({ game, result }, i) => {
    const card = result.card!;
    if (!game.cardSet || !game.cardSetName) {
      throw new Error(
        `renderPlayer: ${slug}'s card for ${game.date} needs both cardSet and cardSetName on the game`
      );
    }
    // Holo is reserved for the single newest card, and only when it is foil
    // (spec §5.1 step 2 and the design's scarcity rule). The frame holds
    // ONLY the image: a figcaption inside a holo frame is washed out by the
    // glare layers (site/styles.css, .card-frame--holo comment; pinned by an
    // existing test in tools/site.test.ts), so the caption sits outside it
    // as its own .card-caption line, same as every other card frame.
    const holo = i === 0 && card.metal === "foil";
    const frameClass = holo ? "card-frame card-frame--holo shimmer" : "card-frame";
    const tier = TIER_NAME[card.metal];
    return `      <figure>
        <div class="${frameClass}"><img src="/cards/${game.cardSet}/assets/${card.file}" alt="${esc(tier)} card: ${esc(player.name)}, ${esc(card.title)}"></div>
        <figcaption class="card-caption">${esc(tier)} · ${esc(card.title)} · ${esc(game.cardSetName)}</figcaption>
      </figure>`;
  });
  // A player with no card yet shows no gallery and no placeholder (spec
  // §5.1 step 2) - the whole section, heading included, disappears rather
  // than showing an empty grid.
  const galleryHtml = figures.length > 0
    ? `<h2 class="rule-label">Cards</h2>
    <div class="card-gallery">
${figures.join("\n")}
    </div>`
    : "";
  // holo.js is the same script the card set pages already load (defer, so
  // it never blocks rendering); only load it when a holo frame is actually
  // on the page; an uncarded or non-foil-newest player pays nothing for it.
  const holoScript = carded.length > 0 && carded[0]!.result.card!.metal === "foil"
    ? "\n<script src=\"/holo.js\" defer></script>"
    : "";
  // card-zoom.js (2026-09-04, Mike): select a card, see it big. The same
  // static script the set pages load; every page with a gallery gets it, and
  // a player with no card pays nothing for it. tools/site.test.ts pins that
  // every committed page showing card frames loads it.
  const zoomScript = carded.length > 0
    ? "\n<script src=\"/card-zoom.js\" defer></script>"
    : "";

  // The trophy case: earned tiles (looked up by id back against the
  // registry for their name and look, since Earned carries only id/dates/
  // count) before locked tiles, both in the exact order trophyCase already
  // returns - this never recomputes or re-sorts that order.
  const { earned, locked } = trophyCase(data, slug);
  const trophyById = new Map(TROPHIES.map((t) => [t.id, t]));
  const trophyTiles = [
    ...earned.map((e) => {
      const trophy = trophyById.get(e.id);
      // trophyCase() only ever returns ids from its own registry, so this
      // can only fire if the two files drift out of sync with each other -
      // never a data problem, always a code bug, hence throw rather than
      // skip the tile.
      if (!trophy) throw new Error(`renderPlayer: trophyCase returned an unknown trophy id "${e.id}"`);
      return trophyTile(trophy, earnedTrophyMeta(e), false);
    }),
    ...locked.map((t) => trophyTile(t, "", true)),
  ].join("\n");

  // The record: one row per game played, newest first, linking the game
  // page, plus a totals row. Games the player missed contribute no row at
  // all - `played` already excludes them.
  const ledgerRows = played.map(({ game, result }) => `      <tr>
        <td><a href="/games/${game.date}/">${game.date}</a></td>
        <td class="num">${result.finish}</td>
        <td class="num">$${result.payout}</td>
        <td class="num">${result.rebuys}</td>
      </tr>`).join("\n");
  const totalPayout = played.reduce((sum, p) => sum + p.result.payout, 0);
  const totalRebuys = played.reduce((sum, p) => sum + p.result.rebuys, 0);
  const totalsRow = `      <tr class="ledger-total">
        <td>Total</td>
        <td class="num"></td>
        <td class="num">$${totalPayout}</td>
        <td class="num">${totalRebuys}</td>
      </tr>`;

  // Charlie's paragraph. Absent means no analysis block at all - not a
  // placeholder, not "no bio yet" copy (spec §3.4: the page says nothing
  // about its own absence).
  const bioHtml = player.bio ? `<p>${esc(player.bio)}</p>` : "";

  // og:image is the player's own newest card when they have one; page()'s
  // own default covers everyone else. Passing `undefined` (rather than
  // omitting the argument) still reaches page()'s default parameter, since
  // that only skips a value when it is exactly undefined.
  const newestCard = carded[0];
  const image = newestCard
    ? `https://poker.kmikeym.com/cards/${newestCard.game.cardSet}/assets/${newestCard.result.card!.file}`
    : undefined;

  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">${esc(player.name)}</h1>
    <p class="stat">Plays as ${listWithAnd(player.aka.map(esc))}</p>
    ${galleryHtml}
    <h2 class="rule-label">Trophy case</h2>
    <div class="trophy-case">
${trophyTiles}
    </div>
    <h2 class="rule-label">The record</h2>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Game</th><th>Finish</th><th>Payout</th><th>Rebuys</th></tr></thead>
      <tbody>
${ledgerRows}
${totalsRow}
      </tbody>
    </table></div>
    ${bioHtml}
  </div>
</section>${holoScript}${zoomScript}`;

  // navCurrent: the page's own address (`current`, above) drives og:url, but
  // a player page isn't one of nav()'s four sections, so Standings has to be
  // named explicitly here rather than guessed from the address's shape (see
  // page()'s PageOptions comment). footerHref/footerText: the brief's page
  // description is explicit that the foot holds one link, to Standings, not
  // the generic "poker.kmikeym.com" -> "/" every other page uses. Named
  // fields, not positional slots, so a future edit here cannot transpose
  // navCurrent and footerHref past the compiler the way four same-typed
  // trailing string parameters could (round 2 finding).
  return page(
    player.name, body, "band-dark", `/player/${slug}/`,
    `${player.name}'s cards, trophies, and full game record on K5M Shareholder Poker.`,
    { image, navCurrent: "/standings/", footerHref: "/standings/", footerText: "Standings" }
  );
}

// ---------------------------------------------------------------------------
// The Hope Coin's own page (spec 2026-09-02-player-pages-trophies-hope-coin
// §5.2, task 8 of that plan). One page: what the Coin is, who holds it now
// (the same tile standings already shows), and the journey - one row per
// stop in hopeCoin.history, oldest first. Task 10 runs this against the
// real data and commits site/hope-coin/index.html; this file only produces
// the string, the same split the Player pages section above documents.
//
// The real hopeCoin.history at ship time holds exactly one stop - nick-m,
// from 2026-04-14, no `to`, no `place` - so the live page is a one-stop
// journey. Everything below is written and tested against a three-stop
// fixture instead (tools/render.test.ts), because Mike intends to append
// the earlier stops later as a data-only change and this renderer has to
// already handle that history without a code change when he does.

// "2026-04-14" -> "April 2026": the spelled-out month/year format the
// journey below uses (M4 of the task brief). Deliberately not shortDate()'s
// abbreviated "Apr 14" a few lines up - that is RSVP button copy for a
// different page, and a coin handoff is remembered as "when", by month, not
// "which Tuesday".
function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// The date phrase for one journey row, given the whole history and this
// row's index so it can look at its neighbor. Takes the history array
// (not just the one stop) because the "before" case reads the NEXT stop's
// `from`, never a date of its own: nobody recorded when the very first
// stop began (see the HopeCoinStop comment in lib/standings.ts), so this
// borrows the date the stop AFTER it started rather than inventing one for
// itself. Returns the phrase, or "" for the one shape named below; never
// throws - a malformed chain (a `to` that does not match the next `from`,
// a non-first stop missing `from`) is tools/lib/hope-coin.ts's job to catch
// before this ever runs, not this function's.
//
// Three cases, checked in this order because a stop can match more than one
// shape below and the first match is the one that applies:
//   1. both `from` and `to` present: a closed stop, "<from> to <to>".
//   2. the last stop: still current, "since <from>".
//   3. the first stop, no `from`: "before <next stop's from>".
//
// One shape M4 does not name: a history with exactly ONE stop that has
// neither `from` nor a next stop to borrow one from - simultaneously first
// and last. tools/lib/hope-coin.ts's validateCoinHistory (rule 4, its
// "summary agreement" check) explicitly permits this exact shape ("the last
// stop is also the first and has no from at all"), so real data can reach
// this function in that state, not just a hypothetical type. No task names
// a check for what this combination should render, and inventing a date
// here would break the one rule this whole function exists to follow - so
// it renders no date phrase at all, the same way a missing `place` below
// renders no place element rather than a guessed one.
function hopeCoinStopDate(history: HopeCoinStop[], i: number): string {
  const stop = history[i]!;
  const isLast = i === history.length - 1;
  if (stop.from !== undefined && stop.to !== undefined) {
    return `${monthYear(stop.from)} to ${monthYear(stop.to)}`;
  }
  if (isLast) {
    return stop.from !== undefined ? `since ${monthYear(stop.from)}` : "";
  }
  const next = history[i + 1];
  return next?.from !== undefined ? `before ${monthYear(next.from)}` : "";
}

// coinHero renders the grid that opens the Hope Coin page (Task 5, #48,
// M1): the coin's own photograph, framed to a circle and captioned, beside
// the copy that used to open this page on its own - the display heading,
// the "what is the Coin" paragraph, and the holder-now tile (name, since
// date, skull tally, built from deriveStandings() exactly as renderStandings'
// own Hope Coin tile is, so the two pages can never disagree about a count).
// Takes the parsed games.json; returns the `<div class="cols">` markup only,
// not a whole page or section - renderHopeCoin wraps it in the page's first
// band-light section below. Exported on its own, per the task's Interface,
// so a test can check the grid's shape directly without also parsing
// everything else renderHopeCoin returns.
//
// Computes its own deriveStandings() call and name map rather than taking
// them as arguments: the function's whole contract is "takes the games
// data," and a cheap derive() call recomputed here costs nothing next to
// the alternative of a second, wider signature only this one caller would
// ever fill in. renderHopeCoin needs its own name map too (for the journey
// below, a different slug lookup entirely), so this is not new duplication,
// just the existing "recompute rather than thread a wide argument list"
// pattern the skull tally below has always used.
//
// The image itself: a black and silver card guard, showing the two of
// diamonds and the seven of clubs (Hope's own "hand with its own bounty"),
// ringed with the words the caption quotes. `coin.png` is 900 by 900,
// transparent outside the coin's own rim (Task 4), so `.coin-frame`'s
// border-radius: 50% is what actually makes it read as a disc rather than
// a square photo with round corners.
export function coinHero(data: GamesData): string {
  const s = deriveStandings(data);
  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));
  const holderName = nameOf.get(s.hopeCoin.holder) ?? s.hopeCoin.holder;

  // The skull tally: the same shape renderStandings' own Hope Coin tile
  // builds, from the exact same deriveStandings() map, so a visitor never
  // sees two different counts for the same slug on the two pages.
  const skulls = Object.entries(s.hopeCoin.skulls)
    .map(([slug, n]) =>
      `<li>${esc(nameOf.get(slug) ?? slug)}: ${SKULL.repeat(n)}${SKULL_EMPTY.repeat(3 - n)} <span class="stat">${n} of 3</span> skulls</li>`)
    .join("\n            ");

  return `<div class="cols">
      <figure class="coin-figure">
        <div class="coin-frame"><img src="/hope-coin/assets/coin.png" width="900" height="900" alt="a black and silver card guard showing the two of diamonds and the seven of clubs, ringed with the words It's not the cards, it's the player."></div>
        <figcaption class="stat">It's not the cards, it's the player. The coin shows 7-2, the hand with its own bounty.</figcaption>
      </figure>
      <div>
        <h1 class="display">The Hope Coin ${COIN}</h1>
        <p>The Hope Coin is the game's traveling trophy. It went to each season's champion until mid-2024, and since then it moves to whoever lands the third skull on the current holder.</p>
        <div class="tile">
          <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
          <ul>
            ${skulls}
          </ul>
        </div>
      </div>
    </div>`;
}

// odometerTiles renders the four stat tiles between coinHero()'s grid and
// "The journey" heading (Task 6, #48, M1, spec §6): a running mileage total
// in Beau's own count, the stop count, how many distinct places the Coin
// has actually been, and the single longest leg on record. Takes the
// parsed games.json; returns the `<div class="tiles tiles--4">` markup
// alone, the same "fragment only, not a section" contract coinHero() keeps
// (see that function's own comment) - renderHopeCoin splices this directly
// after coinHero()'s own markup, per M2 below.
//
// Computes its own history and name map from `data` rather than taking
// them as arguments: this is a second, independent read of the same chain
// renderHopeCoin's journey list also reads below, and the small
// duplication is cheaper than a wider signature only one caller would ever
// fill in (the same trade-off coinHero() itself already makes - see its
// own comment on recomputing deriveStandings() and its name map).
//
// The four tiles, always in this order:
//   Miles       - odometer()'s onRecord (Beau's own count, never a figure
//                 this function computes itself), captioned with how many
//                 legs after the first have no milesIn at all: "by Beau's
//                 count" alone when every leg is measured, "...plus one leg
//                 still unmeasured" for exactly one, "...plus N legs still
//                 unmeasured" for more - never "about" or "roughly," because
//                 every number here is either Beau's own figure or plainly
//                 marked as missing, not estimated.
//   Stops       - the plain stop count (history.length).
//   Places      - the number of distinct names the Coin has actually
//                 stopped at: every stop's own `place` EXCEPT one starting
//                 "On the road" (a stop mid-transit is not a place - see
//                 the HopeCoinStop comment in lib/standings.ts), unioned
//                 with every name in every stop's `route` (a route waypoint
//                 counts the same as a stop's own place - the Yukon is a
//                 place the Coin was, whether it is named as a stop or as a
//                 leg of one). A name appearing both ways (a stop's place
//                 that is also a route waypoint) counts once: this tile
//                 counts places, not lines of text that mention one.
//   Longest leg - the single largest figure on the whole chain, whichever
//                 stop and whichever field (`milesIn` or `milesHeld`) it
//                 came from - a stop's arrival leg and its own parked
//                 mileage are two different legs, never summed as one for
//                 this comparison - with the holder's display name, and
//                 ", on the road" appended only when that figure came from
//                 `milesHeld` (a stint the Coin spent traveling WHILE held,
//                 not the leg that brought it there).
//
// Throws nothing: an absent history renders every tile at zero (0 miles, 0
// stops, 0 places) and the Longest leg tile at "0 miles, " with no holder
// name, rather than guessing - the real chain always has stops before this
// ever ships, so this shape only matters for not crashing on a fixture that
// tries it.
export function odometerTiles(data: GamesData): string {
  const history = data.hopeCoin.history ?? [];
  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));
  const { onRecord, unmeasuredLegs } = odometer(history);

  const milesCaption =
    unmeasuredLegs === 0 ? "by Beau's count" :
    unmeasuredLegs === 1 ? "by Beau's count, plus one leg still unmeasured" :
    `by Beau's count, plus ${unmeasuredLegs} legs still unmeasured`;

  // Places: every stop's own place (skipping one that starts "On the
  // road" - mid-transit, not a place), union every name in every stop's
  // route. A Set is what actually does the deduplication: a name that is
  // both a stop's place and a route waypoint (the Yukon, say) lands in the
  // set once, the same as if it only appeared one of those two ways.
  const places = new Set<string>();
  for (const stop of history) {
    if (stop.place !== undefined && !stop.place.startsWith("On the road")) places.add(stop.place);
    for (const waypoint of stop.route ?? []) places.add(waypoint);
  }

  // Longest leg: the single largest figure on the chain, comparing a
  // stop's milesIn and its milesHeld as two separate candidates, never a
  // stop's own sum of the two (that sum is what the Miles tile's total is
  // for; this tile shows one leg, not one stop).
  let max = 0;
  let maxHolder = "";
  let maxIsHeld = false;
  for (const stop of history) {
    if (stop.milesIn !== undefined && stop.milesIn > max) {
      max = stop.milesIn;
      maxHolder = stop.holder;
      maxIsHeld = false;
    }
    if (stop.milesHeld !== undefined && stop.milesHeld > max) {
      max = stop.milesHeld;
      maxHolder = stop.holder;
      maxIsHeld = true;
    }
  }
  const maxName = esc(nameOf.get(maxHolder) ?? maxHolder);
  const onRoadSuffix = maxIsHeld ? ", on the road" : "";

  return `<div class="tiles tiles--4">
      <div class="tile">
        <h3>Miles</h3>
        <p class="stat">${formatMiles(onRecord)} miles on record</p>
        <p>${milesCaption}</p>
      </div>
      <div class="tile">
        <h3>Stops</h3>
        <p class="stat">${history.length}</p>
      </div>
      <div class="tile">
        <h3>Places</h3>
        <p class="stat">${places.size}</p>
      </div>
      <div class="tile">
        <h3>Longest leg</h3>
        <p class="stat">${formatMiles(max)} miles, ${maxName}${onRoadSuffix}</p>
      </div>
    </div>`;
}

// The sentence the one border tick carries after its place name (Task 7,
// #48, M3). A constant, not a literal typed twice, because routeLoop() both
// prints it and measures it: the frame has to be wide enough for the label
// it produces, and the two must never disagree about its length.
const BORDER_LABEL = ", the coin's one border crossing";

// The reference frame every loop's type size is quoted against: 540 viewBox
// units, which is `.route-loop`'s own max-width in site/styles.css, and the
// 11px `.route-tick text` sets there. A loop drawn in a wider viewBox is
// scaled DOWN by that CSS to fit the same 540px box, so a fixed 11-unit
// type size meant Beau's 850-unit Alaska loop printed its place names at
// seven pixels on a desktop and under four on a phone (whole-branch review
// finding 1, 2026-09-05). Emitting the size in user units as
// LOOP_REF_SIZE * width / LOOP_REF_WIDTH cancels that scaling exactly, so
// every loop on the page renders its names at the same size no matter how
// many places it carries.
const LOOP_REF_WIDTH = 540;
const LOOP_REF_SIZE = 11;
// A monospace face's advance is 0.6 of its size, which is all the character
// width any of this needs: the measurements below only decide how much room
// to leave and where a label may sit, so an estimate that runs a little
// wide is the safe direction and a wrong one shifts a label rather than
// breaking the drawing.
const CHAR_RATIO = 0.6;
// One character's width at the reference size, the unit the frame's own
// width is measured in below.
const REF_CHAR = LOOP_REF_SIZE * CHAR_RATIO;

// The widest of a set of route-loop labels, in viewBox units. Takes the
// label strings as they will actually read on screen (unescaped: a browser
// draws the "&" in "&amp;", not five characters) and the width of one
// character in the units being measured; returns the width of the longest
// label, or 0 for an empty list. Throws nothing.
//
// The per-character width is a parameter rather than a constant because
// the two callers measure in two different scales: the frame's width is
// decided before the type size is known, so it measures at REF_CHAR, while
// the label placement inside the finished frame measures at the size that
// frame actually emits.
function widestLabel(labels: string[], perChar: number): number {
  return labels.reduce((widest, label) => Math.max(widest, label.length * perChar), 0);
}

// routeLoop draws one stop's road trip as a loop hanging off the journey's
// line (Task 7, #48, spec §5): a thin pewter path leaving the stop and
// returning to it, one tick per place the Coin actually rode through, the
// place names beside the ticks, the stint's mileage inside the loop, and a
// small drawn flag on the one tick that crossed a border. Takes a single
// HopeCoinStop and, optionally, the holder's display name for the drawing's
// `<title>` (renderHopeCoin always passes it, from the same name map the
// rest of the journey list uses, so a slug never reaches the title; the
// no-name form exists for a caller that has only a stop in hand, and titles
// the drawing "Route: ..." rather than printing a slug). Returns the
// `<svg>` markup alone, which renderHopeCoin splices inside that stop's own
// `<li>` after its `how` sentence - or the empty string for a stop with no
// `route`, which is most of them, so the caller can splice the result
// unconditionally instead of branching.
// Throws nothing: a `route` never arrives without `milesHeld` (see the
// field's own comment in tools/lib/standings.ts), and a stop that somehow
// had one would draw "0 miles on the road" rather than crash, because a
// visible zero is a bug someone reports and a crash on publish night is not
// a bug Charlie can fix at 10pm.
//
// This is geometry, not a map. The ticks sit at even spacing whatever the
// real distances between the places, because the record carries ONE figure
// for the whole stint (`milesHeld`) and no per-leg distances at all:
// spacing the ticks by distance would mean inventing the numbers that
// spacing implies. Half the names run left to right along the loop's top
// edge and the rest run right to left along the bottom, so reading order
// follows the drive out and the drive back.
//
// The size: 90 viewBox units per tick, with the path inset 20 units at each
// end, so Beau's six-name and nine-name routes each get the same room per
// name and neither crowds its text. The svg carries no width or height
// attributes on purpose - `.route-loop` in site/styles.css sizes it, so one
// CSS change resizes every loop on the page and none of them can drift
// apart.
//
// The border flag is drawn (a small foil triangle inside the loop), never
// an emoji, and it keys on the place name containing "British Columbia":
// the Coin has crossed exactly one border, into Canada, and the place name
// is the only thing the record carries that says so. If the Coin ever
// crosses a second border, that becomes a field on the stop - a second
// hardcoded country name here would be a guess about data that does not
// exist yet.
export function routeLoop(stop: HopeCoinStop, holderName?: string): string {
  const route = stop.route;
  if (!route || route.length === 0) return "";

  // The labels, decided before the frame is: the border tick carries a
  // whole sentence, and the frame has to be wide enough to hold the longest
  // label on the route (see `width` below).
  const isBorder = (name: string) => name.includes("British Columbia");
  const labelText = (name: string) => name + (isBorder(name) ? BORDER_LABEL : "");

  // The frame. Width grows with the tick count (90 units each) so the
  // drawing gets wider, never denser, as a route gets longer; height is
  // fixed, because the loop is always one lane out and one lane back.
  //
  // The second term is the honest answer to "what if a label is wider than
  // the whole drawing": widen the drawing. An svg clips at its own viewBox,
  // so a label longer than the frame cannot be saved by moving it - every
  // position overflows one edge or the other. The alternative was breaking
  // the label onto a second <tspan> line, which would put markup inside the
  // one <text> element M3 reads as the tick's name and make the name harder
  // to check, not easier. Widening costs nothing: the loop is sized by CSS,
  // so a wider viewBox just draws the same loop at a slightly smaller scale.
  // Neither of Beau's two real routes triggers this (their frames are 580
  // and 850 units against a longest label near 350), so it changes nothing
  // on the page today and keeps a future short route with a long name from
  // losing its tail.
  const width = Math.max(90 * route.length + 40, Math.ceil(widestLabel(route.map(labelText), REF_CHAR) + 4));
  // The type size, in user units, so that CSS scaling it back to the
  // reference frame lands every loop's names at the same pixel size (see
  // LOOP_REF_WIDTH above). One decimal is as fine as an svg font size ever
  // needs and keeps the attribute readable in the committed page.
  const fontSize = Number(((LOOP_REF_SIZE * width) / LOOP_REF_WIDTH).toFixed(1));
  // One character at THAT size, which is what the label placement below
  // measures in: measuring the placement at the reference size instead
  // would drag every end label far further inside the frame than it needs
  // to be, away from the tick it names.
  const charWidth = fontSize * CHAR_RATIO;
  const height = 150;
  const left = 20;
  const right = width - 20;
  const top = 44;
  const bottom = 104;
  // The end caps are exact semicircles (the radius spans the full height
  // between the two edges), which is what makes the path read as a loop
  // drawn in one stroke rather than as a box with rounded corners.
  const rx = (bottom - top) / 2;
  // Ticks live only on the straight runs, never on a cap, so a name is
  // never labeling a curve.
  const runStart = left + rx;
  const runEnd = right - rx;

  const topCount = Math.ceil(route.length / 2);
  const bottomCount = route.length - topCount;
  const round = (n: number) => Number(n.toFixed(1));

  const ticks = route.map((name, i) => {
    const onTop = i < topCount;
    // The return leg reads right to left: the last name on the route is the
    // one closest to the stop the loop leaves from, which is where the
    // Coin came back to.
    const slot = onTop ? i : bottomCount - 1 - (i - topCount);
    const count = onTop ? topCount : bottomCount;
    const x = round(runStart + (runEnd - runStart) * ((slot + 0.5) / count));
    const y = onTop ? top : bottom;

    const border = isBorder(name);
    // Names sit outside the loop (above the top run, below the bottom run)
    // so they never collide with the path or with the mileage inside it.
    // The border tick's label carries a whole sentence, so it sits one row
    // further out than its neighbors rather than running through them.
    const labelY = onTop
      ? top - (border ? 26 : 12)
      : bottom + (border ? 29 : 15);
    // Keeping the label inside the frame: a label centered on a tick near
    // either end would run past the viewBox edge, and an svg clips there.
    // Every label is centered on its own tick and then slid back inside the
    // frame if it has to be - never re-anchored to an edge, which only
    // trades one overflow for the opposite one. The two clamps can never
    // fight each other: a label fills `charWidth * length` of the frame,
    // which is `length * 6.6 / 540` of it whatever the frame's width, so
    // anything under about eighty characters leaves room on both sides, and
    // `width` above is in any case never narrower than the longest label at
    // the reference size.
    const halfLabel = widestLabel([labelText(name)], charWidth) / 2;
    const labelX = round(Math.min(Math.max(x, 2 + halfLabel), width - 2 - halfLabel));
    // The flag points into the loop, where nothing else is drawn at this
    // end, rather than out into the name's own space.
    const flag = border
      ? (onTop
        ? `<path class="route-flag" d="M ${x} ${y + 2} L ${x + 11} ${y + 7} L ${x} ${y + 12} Z"/>`
        : `<path class="route-flag" d="M ${x} ${y - 2} L ${x + 11} ${y - 7} L ${x} ${y - 12} Z"/>`)
      : "";
    // The border sentence is appended outside esc() on purpose: it is this
    // file's own copy, not data, and esc() leaves the apostrophe alone
    // anyway (see its comment at the top of this file).
    const label = esc(name) + (border ? BORDER_LABEL : "");

    return `<g class="route-tick"><circle cx="${x}" cy="${y}" r="3.5"/>${flag}<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="${fontSize}">${label}</text></g>`;
  }).join("");

  const path = `<path class="route-loop-path" d="M ${runStart} ${top} H ${runEnd} A ${rx} ${rx} 0 0 1 ${runEnd} ${bottom} H ${runStart} A ${rx} ${rx} 0 0 1 ${runStart} ${top} Z"/>`;
  // The mileage sits inside the loop at its far end, the one part of the
  // drawing with empty room at every route length.
  const miles = `<text class="route-loop-miles" x="${right - rx - 6}" y="${(top + bottom) / 2 + 4}" text-anchor="end" font-size="${fontSize}">${formatMiles(stop.milesHeld ?? 0)} miles on the road</text>`;

  // The drawing's name, first child of the svg so a screen reader announces
  // it before anything drawn (the donut and the tenure strip both carry one
  // already; these two loops were the only untitled graphics on the page).
  // Built from the ends of the route, which is what a title can say without
  // repeating the whole list the places line beside the drawing already
  // prints. A one-place route names that place rather than saying "X to X".
  const ends = route.length > 1 ? `${route[0]} to ${route[route.length - 1]}` : route[0]!;
  const titleText = holderName ? `${holderName}'s route: ${ends}` : `Route: ${ends}`;
  const title = `<title>${esc(titleText)}</title>`;

  return `<svg class="route-loop" viewBox="0 0 ${width} ${height}">${title}${path}${ticks}${miles}</svg>`;
}

// The ink tints the non-current holders are drawn in, darkest first, in
// share order with the current holder skipped over (the current holder is
// foil, not a tint). Spelled as strings, not numbers, because these are
// written straight into `fill-opacity` attributes and the record of what
// the page prints should read the same here as it does in the markup:
// ".8", never "0.8". Seven values, the deepest ladder the eye can still
// tell apart on paper; a chain that ever grows an eighth non-current
// holder reuses the last value rather than inventing a fainter one nobody
// could see, so a stop is never dropped from the drawing.
const TENURE_TINTS = ["1", ".8", ".62", ".46", ".32", ".2", ".12"];

// The donut's geometry, in the viewBox units it is drawn in (the svg
// itself is sized by CSS, per `.coin-donut` in site/styles.css, so these
// numbers never change with the screen). The ring runs from radius 32 to
// 52 and the labels sit at 58, just outside it: labels beside the marks,
// never inside a wedge, so a thin slice's name is as readable as a fat
// one's.
//
// The box is 200 units TALL and as wide as the labels actually need, which
// is why the width is computed in holdersSection rather than fixed here.
// Round 1 review (2026-09-05): a fixed 200-wide box left a right-hand label
// forty-odd units before the edge, about eight characters, and every real
// label runs eleven to thirteen - so the edge clamp dragged them back on
// top of the ring, where a name in ink over a full-opacity ink arc is
// simply invisible. Widening the box is what actually fixes that; clamping
// harder only moves which label disappears.
const DONUT_HEIGHT = 200;
const DONUT_CY = 100;
const DONUT_R_OUT = 52;
const DONUT_R_IN = 32;
const DONUT_R_LABEL = 58;
// One character's advance in the donut's label face, in viewBox units:
// the monospace advance (0.6em) at the 8px size `.donut-label` sets. Used
// only to keep a long label from running off the edge of the drawing, the
// same estimate-and-clamp routeLoop() above already uses for its own place
// names, so a wrong guess shifts a label rather than breaking the picture.
const DONUT_CHAR = 4.8;
// One full line of clearance between two labels on the same side of the
// ring, in viewBox units: 1.2 lines at the 8px `.donut-label` face. Two
// thin slices next to each other would otherwise print their names on top
// of each other.
const DONUT_LABEL_GAP = 9.6;

// The tenure strip's geometry, in its own 600 by 48 viewBox: a 600-unit
// bar of segments with the January ticks and their years beneath it.
const STRIP_W = 600;
// Raised from 40 for legibility (whole-branch review finding 2,
// 2026-09-05): the strip draws around 340px wide on a desktop and on a
// phone alike, so its 11-unit years came out near six pixels. `.strip-tick`
// is now 19 units, and the box needs these eight extra units of height to
// seat that type under the bar.
const STRIP_H = 48;
const STRIP_BAR_TOP = 2;
const STRIP_BAR_HEIGHT = 20;

// Two decimals is as fine as any of these drawings needs, and it is what
// keeps a width of exactly one twelfth of the bar printing as "100" rather
// than "99.99999999999999" - a number Charlie would reasonably read as a
// bug in the month math when it is only floating point noise.
function round2(n: number): number {
  return Number(n.toFixed(2));
}

// A point on the donut at `radius` and `angle`, where angle is degrees
// clockwise from twelve o'clock (spec section 7.2: the donut starts at the
// top and runs clockwise, largest share first). Returns [x, y] in viewBox
// units, already rounded. Takes the ring's centre x, which depends on how
// wide the labels made the box; the centre y is always DONUT_CY. Screen y
// grows downward, which is why the cosine is subtracted rather than added.
function donutPoint(cx: number, radius: number, angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [round2(cx + radius * Math.sin(rad)), round2(DONUT_CY - radius * Math.cos(rad))];
}

// The `d` for one ring segment of the donut, from `a0` to `a1` degrees
// clockwise from twelve o'clock. Returns the path data alone, no element.
//
// A holder with the whole coin's life to themselves (one stop, or a chain
// where only one holder has any dated months at all) sweeps the full 360
// degrees, and a single SVG arc whose start and end points are the same
// point draws nothing at all - the one case that would silently render an
// empty donut. That case is drawn as two half arcs instead, outer ring
// clockwise and inner ring counter-clockwise so the nonzero fill rule
// punches the hole out of the middle.
function donutSegmentPath(cx: number, a0: number, a1: number): string {
  const [ox0, oy0] = donutPoint(cx, DONUT_R_OUT, a0);
  const [ix0, iy0] = donutPoint(cx, DONUT_R_IN, a0);
  if (a1 - a0 >= 359.99) {
    const [oxHalf, oyHalf] = donutPoint(cx, DONUT_R_OUT, a0 + 180);
    const [ixHalf, iyHalf] = donutPoint(cx, DONUT_R_IN, a0 + 180);
    return `M ${ox0} ${oy0} A ${DONUT_R_OUT} ${DONUT_R_OUT} 0 1 1 ${oxHalf} ${oyHalf} ` +
      `A ${DONUT_R_OUT} ${DONUT_R_OUT} 0 1 1 ${ox0} ${oy0} Z ` +
      `M ${ix0} ${iy0} A ${DONUT_R_IN} ${DONUT_R_IN} 0 1 0 ${ixHalf} ${iyHalf} ` +
      `A ${DONUT_R_IN} ${DONUT_R_IN} 0 1 0 ${ix0} ${iy0} Z`;
  }
  const [ox1, oy1] = donutPoint(cx, DONUT_R_OUT, a1);
  const [ix1, iy1] = donutPoint(cx, DONUT_R_IN, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${ox0} ${oy0} A ${DONUT_R_OUT} ${DONUT_R_OUT} 0 ${large} 1 ${ox1} ${oy1} ` +
    `L ${ix1} ${iy1} A ${DONUT_R_IN} ${DONUT_R_IN} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

// holdersSection renders the second section of the Hope Coin page (Task 8,
// #48, spec section 7): "Who has held it," three views of the same numbers
// side by side. The donut is each holder's share of the coin's recorded
// life, largest first from twelve o'clock. The strip is the same tenure
// laid out in time, one segment per stop in chain order, with a tick at
// every January it crosses. The legend table beside them states every
// figure in words, and doubles as the leaderboard.
//
// Takes the parsed games.json; returns the `<section class="band-dark">`
// markup, which renderHopeCoin below splices after its own band-light
// section (the tones alternate; see the footer note in that function).
//
// Returns the EMPTY STRING, not a section, when there is nothing dated to
// chart: no games on the spine to date the current stop against, or a
// history whose only stop has no `from` (the "before anyone kept records"
// shape, which tenureMonths deliberately produces no segment for), or a
// chain whose every stop changed hands inside a single month. Those are
// the same "splice it unconditionally, let the function decide" contract
// routeLoop() above keeps: the alternative is a heading over an empty
// drawing, which reads as a broken page rather than as an honest absence.
//
// Every number here comes from tenureMonths and holderShares in
// tools/lib/hope-coin.ts and none of it is recomputed: the whole reason
// that month math lives in one place is that these three graphics must
// never be able to disagree with each other about who held the Coin how
// long. The only arithmetic below is geometry.
//
// Color carries nothing on its own. The current holder's arc and segment
// are foil and everyone else is a tint of the page's ink, but the donut
// labels name every holder and their share, and the legend states all four
// figures as text, so the section reads the same to someone who cannot
// tell the foil from the ink.
//
// Throws nothing.
export function holdersSection(data: GamesData): string {
  const history = data.hopeCoin.history ?? [];
  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));

  // The latest game on the spine, by date - max(), never games[0] or the
  // last array entry, because games.json is not guaranteed sorted and the
  // caption below makes a claim about "as of" a specific game night.
  const latestGame = data.games.map((g) => g.date).sort().at(-1);
  if (latestGame === undefined) return "";

  const segments = tenureMonths(history, latestGame);
  const totalMonths = segments.reduce((sum, seg) => sum + seg.months, 0);
  if (segments.length === 0 || totalMonths === 0) return "";
  const shares = holderShares(segments);

  // The current holder is the last stop's, not data.hopeCoin.holder: the
  // two always agree (validateCoinHistory rule 4 refuses a chain where
  // they do not), and reading the chain keeps this function's drawing
  // sourced entirely from the same array every other number here comes
  // from.
  const current = history[history.length - 1]!.holder;

  // One fill per holder, assigned once and shared by that holder's donut
  // arc and every one of their strip segments - a holder who won the Coin
  // back must read as the same holder in both drawings, and two segments
  // of different shades would say the opposite.
  const fillOf = new Map<string, string>();
  let tint = 0;
  for (const share of shares) {
    if (share.holder === current) {
      fillOf.set(share.holder, `fill="var(--foil-deep)"`);
      continue;
    }
    fillOf.set(share.holder, `fill="var(--ink)" fill-opacity="${TENURE_TINTS[Math.min(tint, TENURE_TINTS.length - 1)]}"`);
    tint += 1;
  }

  // The donut. Angles are cut from `percent`, not from raw months, because
  // holderShares already guarantees the percents sum to exactly 100 - so
  // the arcs close the circle exactly, and the drawing and the legend can
  // never round to two different stories.
  //
  // How wide the box is: the labels decide. A label sits at radius 58 and
  // reads outward, so the furthest one can ever reach from the ring's
  // centre is 58 plus its own width, and the box has to be twice that (plus
  // a unit of air) for the clamp below never to fire and drag a label back
  // over the ring - which is exactly the bug the round 1 review caught. The
  // height stays 200 whatever the names are; only the width breathes.
  const labelTexts = shares.map((share) => `${nameOf.get(share.holder) ?? share.holder} ${share.percent}%`);
  const widestText = labelTexts.reduce((widest, text) => Math.max(widest, text.length * DONUT_CHAR), 0);
  const boxWidth = round2(Math.max(DONUT_HEIGHT, 2 * (DONUT_R_LABEL + widestText + 2)));
  const cx = round2(boxWidth / 2);

  let angle = 0;
  const arcs: string[] = [];
  const labels: { text: string; x: number; y: number; anchor: string }[] = [];
  for (const [i, share] of shares.entries()) {
    const sweep = (share.percent / 100) * 360;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const currentClass = share.holder === current ? " donut-arc--current" : "";
    arcs.push(`<path class="donut-arc${currentClass}" ${fillOf.get(share.holder)} d="${donutSegmentPath(cx, a0, a1)}"/>`);

    const text = labelTexts[i]!;
    const mid = (a0 + a1) / 2;
    const [lx, ly] = donutPoint(cx, DONUT_R_LABEL, mid);
    // Which side of the clock the label sits on decides which end of the
    // text touches the ring: a label on the right reads outward from the
    // ring, a label on the left reads inward to it. A label at the very
    // top or bottom straddles the center line and is simply centered.
    const across = Math.sin((mid * Math.PI) / 180);
    const anchor = across > 0.02 ? "start" : across < -0.02 ? "end" : "middle";
    // A last belt-and-braces clamp against the viewBox edges. With the box
    // sized to the widest label above this can no longer fire on any real
    // chain, and that is the point: the previous cut relied on it, and a
    // clamp that fires is a label pulled back over the ring.
    const width = text.length * DONUT_CHAR;
    const reach = anchor === "start" ? width : anchor === "end" ? 0 : width / 2;
    const back = anchor === "start" ? 0 : anchor === "end" ? width : width / 2;
    const x = round2(Math.min(Math.max(lx, back + 1), boxWidth - 1 - reach));
    labels.push({ text, x, y: ly, anchor });
  }

  // Two thin slices side by side put their labels within a few units of
  // each other, and at the 8px face `.donut-label` sets that is two lines
  // of type on top of each other - the real chain does exactly this at the
  // top of the ring, where the two shortest reigns sit next to one another.
  // Labels on the same side of the ring are pushed apart to a full line of
  // clearance, in the order they already run down the drawing, and the
  // whole column is slid back up if the pushing ran it off the bottom. Only
  // the vertical position moves: a label stays on its own arc's side and
  // keeps its own anchor, so it still reads as belonging to the slice it
  // names.
  for (const side of ["start", "end", "middle"]) {
    const column = labels.filter((l) => l.anchor === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < column.length; i++) {
      column[i]!.y = Math.max(column[i]!.y, column[i - 1]!.y + DONUT_LABEL_GAP);
    }
    const overflow = (column[column.length - 1]?.y ?? 0) - (DONUT_HEIGHT - 4);
    if (overflow > 0) for (const label of column) label.y = Math.max(round2(label.y - overflow), 8);
  }

  // Emitted in share order, the order they were built in, not the top-to-
  // bottom order the spreading above sorted them into: the donut's labels
  // read down the page in the same order as the legend's rows.
  const labelMarkup = labels
    .map((l) => `<text class="donut-label" x="${l.x}" y="${round2(l.y)}" text-anchor="${l.anchor}">${esc(l.text)}</text>`)
    .join("");

  // The strip: one segment per stop, in chain order, its width the stop's
  // share of the whole span. Widths are accumulated unrounded and only
  // rounded on the way out, so a dozen roundings cannot drift the last
  // segment off the end of the bar.
  const segs: string[] = [];
  let x = 0;
  for (const seg of segments) {
    const width = (seg.months / totalMonths) * STRIP_W;
    segs.push(
      `<rect class="strip-seg" x="${round2(x)}" y="${STRIP_BAR_TOP}" width="${round2(width)}" ` +
      `height="${STRIP_BAR_HEIGHT}" ${fillOf.get(seg.holder)}/>`
    );
    x += width;
  }

  // January ticks: one hairline and one year for every January the span
  // actually crosses, STRICTLY inside it. A January on either edge gets no
  // tick, because the edge is already the start or the end of the bar and
  // a tick there would be a second mark for something the drawing already
  // says - and, at the end, would date the bar a month past the game the
  // caption says it runs to.
  const firstMonth = monthIndex(segments[0]!.from);
  const lastMonth = monthIndex(segments[segments.length - 1]!.to);
  const ticks: string[] = [];
  for (let year = Number(segments[0]!.from.slice(0, 4)); year <= Number(segments[segments.length - 1]!.to.slice(0, 4)); year++) {
    const january = monthIndex(`${year}-01`);
    if (january <= firstMonth || january >= lastMonth) continue;
    const tx = round2(((january - firstMonth) / totalMonths) * STRIP_W);
    ticks.push(
      `<line class="strip-tick-line" x1="${tx}" y1="0" x2="${tx}" y2="${STRIP_BAR_TOP + STRIP_BAR_HEIGHT + 4}"/>` +
      `<text class="strip-tick" x="${tx}" y="${STRIP_H - 3}" text-anchor="middle">${year}</text>`
    );
  }

  const rows = shares.map((share) => {
    const name = esc(nameOf.get(share.holder) ?? share.holder);
    return `          <tr><td>${name}</td><td class="num">${share.reigns}</td><td class="num">${share.months}</td><td class="num">${share.percent}%</td></tr>`;
  }).join("\n");

  // The caption. "As of" a game night, never the clock: the current stop
  // has no end date, and the only honest thing to measure it to is the last
  // game the record actually holds (spec section 7.1).
  let caption = `Months, as of the ${monthYear(latestGame)} game.`;
  // A first stop with no `from` produces no segment at all (see
  // tenureMonths), so its months are missing from every figure on this
  // page. That absence is said out loud rather than left for a visitor to
  // notice: the alternative is a donut that quietly reads as the Coin's
  // whole life when it is not. Only said when the record can actually name
  // the place and the month it ended, which is the only shape this stop has
  // ever arrived in; with either missing there is no sentence to write that
  // would not be inventing half of it.
  const firstStop = history[0];
  if (firstStop !== undefined && firstStop.from === undefined && firstStop.place !== undefined && history[1]?.from !== undefined) {
    caption += ` The coin's time in ${esc(firstStop.place)} before ${monthYear(history[1]!.from!)} is not counted.`;
  }

  return `<section class="band-dark">
  <div class="band-inner">
    <h2 class="rule-label">Who has held it</h2>
    <p class="stat">${caption}</p>
    <div class="cols">
      <figure class="donut-figure">
        <svg class="coin-donut" viewBox="0 0 ${boxWidth} ${DONUT_HEIGHT}"><title>Each holder's share of the coin's recorded life</title>${arcs.join("")}${labelMarkup}</svg>
      </figure>
      <div>
        <svg class="tenure-strip" viewBox="0 0 ${STRIP_W} ${STRIP_H}"><title>Every stop in order, sized by the months it lasted</title>${segs.join("")}${ticks.join("")}</svg>
        <div class="table-scroll">
          <table class="tenure-legend">
            <thead><tr><th>Holder</th><th>Reigns</th><th>Months</th><th>Share</th></tr></thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

// Renders the Hope Coin's own page: the hero grid coinHero() builds (the
// coin's photo and the "what is the Coin" copy, side by side), the four
// odometer tiles odometerTiles() builds (Task 6, #48) directly beneath it,
// and the journey: one `.route-stop` per hopeCoin.history entry, oldest
// first, the last one marked `.route-stop--current`, with a `.route-leg`
// distance label of its own ahead of every stop after the first (Task 6,
// M3). While data.hopeCoin.historyPending is true, one more sentence lands
// under "The journey" heading, above the route, saying the record's
// earliest datable stop is not the Coin's actual first stop (see
// journeyIncompleteHtml below); the sentence is absent entirely once that
// flag is gone. Beneath all of that, in a second band-dark section, comes
// holdersSection()'s "Who has held it" (Task 8, #48): the donut, the tenure
// strip, and the legend table. Takes the parsed games.json; returns the
// full document.
// Throws nothing of its own: an absent history (the rollout state before
// any stops existed - see the comment on GamesData.hopeCoin.history)
// renders a journey with zero rows and no leg labels, and a malformed
// chain is caught upstream by validateCoinHistory, not here.
export function renderHopeCoin(data: GamesData): string {
  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));

  // The journey: oldest stop first, exactly as hopeCoin.history lists them
  // - never re-sorted, because a re-sort would silently paper over a chain
  // validateCoinHistory should have caught instead of rendering something
  // wrong. An absent history maps to an empty list, which renders zero rows.
  const history = data.hopeCoin.history ?? [];
  // Built as a flat array of `<li>` blocks, not a plain history.map(), so a
  // leg label (Task 6, #48, M3) can be pushed as ITS OWN separate <li>
  // ahead of every stop after the first, inside the same <ol> - one array
  // entry per <li> the page actually renders, in the exact order they
  // print: stop 1, leg, stop 2, leg, stop 3, and so on.
  const stopBlocks: string[] = [];
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];
    const isCurrent = i === history.length - 1;
    const name = esc(nameOf.get(stop.holder) ?? stop.holder);
    const dateText = hopeCoinStopDate(history, i);
    // A stop with no date phrase (the one unnamed shape above) gets no
    // <span> at all - an empty one would still be "inventing" a blank date
    // element for a case the spec never describes.
    const dateHtml = dateText ? ` <span class="stat">${esc(dateText)}</span>` : "";
    // A stop with no `place` gets no place element at all, not an empty one
    // and not "location unknown" copy - the task brief calls this out by
    // name, because either alternative would read as the site claiming to
    // know something it does not.
    const placeHtml = stop.place ? `\n        <p class="stat">${esc(stop.place)}</p>` : "";

    // The leg label (M3): the distance of the leg that brought THIS stop's
    // holder the Coin, printed just ahead of their own stop - never before
    // the first stop, which has no incoming leg to name (see the
    // HopeCoinStop comment in lib/standings.ts on why `milesIn` is absent
    // there). "unmeasured" - never a made-up figure, never "about" or
    // "roughly" - is exactly what a missing `milesIn` says: Beau does not
    // have a number for this leg, not that the leg was short.
    if (i > 0) {
      const legText = stop.milesIn !== undefined ? `${formatMiles(stop.milesIn)} miles` : "unmeasured";
      stopBlocks.push(`      <li class="route-leg"><span class="stat">${esc(legText)}</span></li>`);
    }

    // The stint loop (Task 7, #48): a stop whose holder drove the Coin
    // around gets that trip drawn inside its own <li>, under the sentence
    // that says what happened. routeLoop() returns "" for every other stop,
    // which is why this splices unconditionally rather than branching here.
    //
    // The loop is wrapped in .table-scroll, the same overflow-x container
    // every committed table on the site already uses (whole-branch review
    // finding 1, 2026-09-05): a phone pans a drawing held at a readable
    // size instead of shrinking its place names to four pixels, and the
    // page body itself still never scrolls sideways because the overflow
    // lives inside that box.
    const loop = routeLoop(stop, name);
    const loopHtml = loop ? `\n        <div class="table-scroll route-scroll">${loop}</div>` : "";

    // The same places, as text, right above the drawing. Nine of the
    // eighteen places the Coin has been used to exist nowhere on this page
    // except inside an SVG, which fails the site's own rule that every
    // chart also states its information in words (the plan's Global
    // Constraints, and docs/brand.md). Names only, in route order, joined
    // by commas: the border sentence stays on the drawing, where it labels
    // the one tick it belongs to.
    const routeText = stop.route?.length
      ? `\n        <p class="stat">${esc(stop.route.join(", "))}</p>`
      : "";

    stopBlocks.push(`      <li class="route-stop${isCurrent ? " route-stop--current" : ""}">
        <p><strong>${name}</strong>${dateHtml}</p>${placeHtml}
        <p>${esc(stop.how)}</p>${routeText}${loopHtml}
      </li>`);
  }
  const stops = stopBlocks.join("\n");

  // The incomplete-journey note (spec follow-up 2026-09-03). While
  // hopeCoin.historyPending is true, the earliest stop above is only the
  // earliest one anyone can currently date; the Coin itself is older, and
  // Mike is reconstructing the stops before it from memory. This sentence is
  // the ONLY thing that flag produces, and it is the whole reason the flag
  // exists rather than a sentence typed straight into this template: a typed
  // sentence would still be sitting here the day the history is finished,
  // the exact failure that had already happened once (a "The journey" page
  // showing a single stop with no hint anything was missing) and the exact
  // failure recordQualifier() was already built to prevent for the standings
  // "record starts with..." line via backfillPending (see that function's
  // own comment, top of this file). Never re-word this sentence here - it is
  // the owner's own copy, quoted verbatim - and never gate it on anything
  // but this one flag (not history.length, not whether a stop has a `from`):
  // the flag is Charlie's own signal that reconstruction is still in
  // progress, not something this renderer should infer from the chain's
  // shape. Falsy - absent (the default state, and the state once Charlie
  // deletes the field per docs/publishing.md rather than setting it false;
  // see the field's own comment on GamesData.hopeCoin in
  // tools/lib/standings.ts) - renders nothing at all, not even an empty
  // paragraph.
  const journeyIncompleteHtml = data.hopeCoin.historyPending
    ? `\n    <p class="stat">The journey starts with the stop the record can date. The Coin is older than that, and its earlier stops are being reconstructed.</p>`
    : "";

  const body = `
<section class="band-light">
  <div class="band-inner">
    ${coinHero(data)}
    ${odometerTiles(data)}
    <h2 class="rule-label">The journey</h2>${journeyIncompleteHtml}
    <ol class="route">
${stops}
    </ol>
  </div>
</section>
${holdersSection(data)}`;

  // navCurrent: the Hope Coin page isn't one of nav()'s four sections, so
  // Standings is named explicitly here rather than guessed from the
  // address's shape - the same reasoning renderPlayer's own call documents
  // above, on page()'s PageOptions comment.
  // image: the coin's own hero photo (Task 5, #48, M2), not whichever card
  // the current holder happens to have - a shared link to /hope-coin/ should
  // show the Coin, the same object the page is about, no matter who holds it
  // this month. It is a literal because it is the same image on every
  // render: the helper that used to pick a card for this option had no
  // other caller once this page stopped asking for one, and was deleted
  // with it (whole-branch review finding 3, 2026-09-05).
  // The footer band is band-light because holdersSection() above ends the
  // page on a band-dark section, and two adjacent bands never share a tone
  // (docs/brand.md).
  return page(
    "The Hope Coin", body, "band-light", "/hope-coin/",
    "Every stop the K5M Shareholder Poker Hope Coin has made, and who holds it now.",
    { navCurrent: "/standings/", image: "https://poker.kmikeym.com/hope-coin/assets/coin-og.png" }
  );
}

// The entry point: `bun tools/render.ts`, run from the repo root (see the
// header comment at the top of this file). Reads site/data/games.json
// relative to the process's own working directory - deliberately, not an
// absolute path baked in here - because Task 10's render-drift test (see
// tools/site.test.ts's "the generator, run into an empty directory"
// describe block) spawns this exact file as a subprocess with a temp
// directory as its cwd, so the same relative reads and writes land inside
// that temp tree instead of the real site/ when the test runs it.
//
// Writes, in order: the three pages that existed before Task 10 (standings,
// games index, ICS), then one site/player/<slug>/index.html per slug
// playerSlugs() returns, then site/hope-coin/index.html. `Bun.write` creates
// any parent directories that do not exist yet, so there is no separate
// mkdir step for site/player/<slug>/ the first time a slug is added.
//
// Render never DELETES a page. There is deliberately no step here that
// looks at what is already on disk under site/player/ and removes anything
// missing from today's playerSlugs() - eligibility never lapses, because
// games are never removed from the spine (house rule, restated in this
// file's player-pages header comment above). A slug that has ever played
// keeps its page forever.
if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  await Bun.write("site/next-game.ics", renderNextGameIcs(data));
  const slugs = playerSlugs(data);
  for (const slug of slugs) {
    await Bun.write(`site/player/${slug}/index.html`, renderPlayer(data, slug));
  }
  await Bun.write("site/hope-coin/index.html", renderHopeCoin(data));
  console.log(
    `rendered site/standings/index.html, site/games/index.html, site/next-game.ics, ` +
    `${slugs.length} player page(s) under site/player/, site/hope-coin/index.html`
  );
}
