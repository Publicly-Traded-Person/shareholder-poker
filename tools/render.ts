// Renders the derived pages (standings, games index) as full committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData } from "./lib/standings";

// HTML-escapes a string for use in text content OR inside a double-quoted
// attribute. Takes any string; returns it with & < > and " replaced by their
// entities; throws nothing. The double quote matters because page() feeds
// this into content="..." attributes (description, og:title): every caller
// today passes a literal, but the first non-literal must not be able to end
// the attribute early (issue #12). Exported for its unit test only.
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The generated record starts with July 2026, the first game on the games.json
// data spine. Earlier seasons (2020, and April and June 2026) are real games,
// documented in README.md, that predate the spine and are being backfilled.
// Standings and the games index must say so, not read as an all-time claim.
const RECORD_QUALIFIER =
  "This record starts with July 2026. Earlier seasons (2020, and April and June 2026) predate the data spine and are being backfilled.";

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

// nav(current) renders the masthead links, marking the page's own link with
// aria-current so visitors can see where they are (styled in styles.css).
const nav = (current: string) =>
  ([["/", "Home"], ["/games/", "Games"], ["/cards/", "Cards"], ["/standings/", "Standings"]] as const)
    .map(([href, label]) =>
      `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join(" · ");

// footerTone is the background class for the closing footer band. Bands must
// alternate light/dark with no two of the same tone touching (brand rule), so
// the caller passes whichever tone opposes its own last section. `current` is
// the page's own nav href, used twice: it marks the nav link with aria-current
// and it becomes the absolute og:url, so a shared link unfurls pointing at this
// page rather than at whatever page the scraper guessed. `description` fills
// the meta/og description.
function page(
  title: string,
  body: string,
  footerTone: "band-light" | "band-dark",
  current: string,
  description: string
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
<meta property="og:image" content="https://poker.kmikeym.com/cards/2026-07/assets/card-1-lewd.png">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner">${nav(current)}</div>
</nav>
${body}
<footer class="${footerTone}" style="padding:1.5rem 1.25rem; text-align:center;">
  <div class="band-inner"><p class="stat">Generated from the game record. <a href="/">poker.kmikeym.com</a></p></div>
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
    <p class="stat">${RECORD_QUALIFIER}</p>
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
    <p class="stat">${RECORD_QUALIFIER}</p>
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

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  await Bun.write("site/next-game.ics", renderNextGameIcs(data));
  console.log("rendered site/standings/index.html, site/games/index.html, site/next-game.ics");
}
