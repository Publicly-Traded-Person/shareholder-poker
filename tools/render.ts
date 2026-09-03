// Renders the derived pages (standings, games index, player pages) as full
// committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData, type Game, type GameResult, type CardRef } from "./lib/standings";
import { trophyCase, TROPHIES, type Trophy, type Look, type Earned } from "./lib/trophies";

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
// guessed. `description` fills the meta/og description. `image` is the
// og:image; it defaults to DEFAULT_OG_IMAGE so every existing caller (which
// never passed one) keeps its current unfurl image unchanged.
//
// `navCurrent` defaults to `current`, which is correct for every page that
// IS one of nav()'s four sections (today, every existing caller). A page
// that is not one of those four - a player page, the Hope Coin page - has
// its own `current` (for og:url) but still wants a specific nav link
// marked, so it passes `navCurrent` explicitly instead of nav() guessing a
// routing policy from `current`'s shape (review round 1, Task 7: the first
// draft put that guess inside nav() itself, which would have silently
// mis-highlighted Standings for any future page - a game page, the archive
// page - that is also outside the four but should highlight something
// else). `footerHref`/`footerText` work the same way for the one footer
// link, defaulting to today's "poker.kmikeym.com" pointing at "/" so every
// existing caller is unaffected; the player page's brief calls for a single
// Standings link there instead.
function page(
  title: string,
  body: string,
  footerTone: "band-light" | "band-dark",
  current: string,
  description: string,
  image: string = DEFAULT_OG_IMAGE,
  navCurrent: string = current,
  footerHref: string = "/",
  footerText: string = "poker.kmikeym.com"
): string {
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
  const rows = s.rows.map((r, i) => `      <tr class="finish-${i + 1}">
        <td>${esc(r.name)}${r.slug === champ.slug ? " " + GEM("foil") : ""}${r.slug === s.hopeCoin.holder ? " " + COIN : ""}</td>
        <td class="num">${r.games}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.cashes}</td>
        <td class="num">${r.bestFinish}</td>
        <td class="num">$${r.totalPayout}</td>
        <td class="num">${r.rebuys}</td>
      </tr>`).join("\n");
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
        <h3>The Hope Coin ${COIN}</h3>
        <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
        <ul>
          ${skulls}
        </ul>
      </div>
    </div>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Won</th><th>Rebuys</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
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

// One tile in the trophy case: the mark, the trophy's name as a bare <h3>,
// and `meta` as a bare <p>, both direct children of the .trophy element and
// nothing else - site/styles.css styles a trophy's name and meta line
// through exactly that shape (`.trophy h3`, `.trophy p`), so any other
// nesting renders the text unstyled.
function trophyTile(trophy: Trophy, meta: string, locked: boolean): string {
  const mark = locked ? trophyMarkLocked(trophy.look) : trophyMarkEarned(trophy.look);
  return `      <div class="trophy${locked ? " trophy--locked" : ""}">
        ${mark}
        <h3>${esc(trophy.name)}</h3>
        <p>${meta}</p>
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
    ...locked.map((t) => trophyTile(t, esc(t.earn), true)),
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
</section>${holoScript}`;

  // navCurrent: the page's own address (`current`, above) drives og:url, but
  // a player page isn't one of nav()'s four sections, so Standings has to be
  // named explicitly here rather than guessed from the address's shape (see
  // page()'s navCurrent comment). footerHref/footerText: the brief's page
  // description is explicit that the foot holds one link, to Standings, not
  // the generic "poker.kmikeym.com" -> "/" every other page uses.
  return page(
    player.name, body, "band-dark", `/player/${slug}/`,
    `${player.name}'s cards, trophies, and full game record on K5M Shareholder Poker.`,
    image, "/standings/", "/standings/", "Standings"
  );
}

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  await Bun.write("site/next-game.ics", renderNextGameIcs(data));
  console.log("rendered site/standings/index.html, site/games/index.html, site/next-game.ics");
}
