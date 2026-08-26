// Renders the derived pages (standings, games index) as full committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData } from "./lib/standings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
// the page's own nav href; `description` fills the meta/og description.
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
      `<li>${esc(nameOf.get(slug) ?? slug)}: ${GEM("copper").repeat(n)}${GEM_EMPTY.repeat(3 - n)} <span class="stat">${n} of 3</span> skulls</li>`)
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

export function renderGamesIndex(data: GamesData): string {
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const items = [...data.games].sort((a, b) => b.date.localeCompare(a.date)).map(g => {
    const winner = g.results.find(r => r.finish === 1)!;
    const cards = g.cardSet ? ` · <a href="/cards/${g.cardSet}/">The cards</a>` : "";
    return `    <li class="game-row">
      <span class="date"><a href="/games/${g.date}/">${g.date}</a></span>
      <span class="winner">${esc(nameOf.get(winner.slug) ?? winner.slug)} ${GEM("foil")} won</span>
      <span class="stat">${g.entries} entries · $${g.pot} pot · ${g.hands} hands</span>
      <span class="links"><a href="/games/${g.date}/">The game</a>${cards}</span>
    </li>`;
  }).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner band-inner--wide">
    <h1 class="display">Games</h1>
    <p>Second Tuesday of every month, 7pm PT. Next: <strong>${data.nextGame.date}</strong>.</p>
    <p class="stat">${RECORD_QUALIFIER}</p>
    <ul class="game-rows">
${items}
    </ul>
  </div>
</section>`;
  return page(
    "Games", body, "band-dark", "/games/",
    "Every K5M Shareholder Poker game, newest first: winners, pots, and hand counts."
  );
}

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log("rendered site/standings/index.html and site/games/index.html");
}
