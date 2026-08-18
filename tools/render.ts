// Renders the derived pages (standings, games index) as full committed HTML.
// Run: bun tools/render.ts   (reads site/data/games.json, writes site/*/index.html)
import { deriveStandings, type GamesData } from "./lib/standings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// footerTone is the background class for the closing footer band. Bands must
// alternate light/dark with no two of the same tone touching (brand rule), so
// the caller passes whichever tone opposes its own last section.
function page(title: string, body: string, footerTone: "band-light" | "band-dark" = "band-dark"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | K5M Shareholder Poker</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav class="band-dark" style="padding:1rem 1.25rem;">
  <div class="band-inner"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></div>
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
  const skulls = Object.entries(s.hopeCoin.skulls)
    .map(([slug, n]) => `<li>${esc(nameOf.get(slug) ?? slug)}: <span class="stat">${n} of 3</span> skulls</li>`)
    .join("\n      ");
  const rows = s.rows.map((r, i) => `      <tr class="finish-${i + 1}">
        <td>${esc(r.name)}</td>
        <td class="num">${r.games}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.cashes}</td>
        <td class="num">${r.bestFinish}</td>
        <td class="num">$${r.totalPayout}</td>
        <td class="num">${r.rebuys}</td>
      </tr>`).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Standings</h1>
    <div class="table-scroll"><table class="ledger">
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Cashes</th><th>Best</th><th>Won</th><th>Rebuys</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
  </div>
</section>
<section class="band-dark">
  <div class="band-inner">
    <h2 class="display">🪙 The Hope Coin</h2>
    <p><strong>${esc(holderName)}</strong> holds the Coin (since ${s.hopeCoin.since}). Three kills on the holder takes it.</p>
    <ul>
      ${skulls}
    </ul>
  </div>
</section>`;
  return page("Standings", body, "band-light");
}

export function renderGamesIndex(data: GamesData): string {
  const nameOf = new Map(data.players.map(p => [p.slug, p.name]));
  const items = [...data.games].sort((a, b) => b.date.localeCompare(a.date)).map(g => {
    const winner = g.results.find(r => r.finish === 1)!;
    return `    <li>
      <a href="/games/${g.date}/">${g.date}</a>:
      <strong>${esc(nameOf.get(winner.slug) ?? winner.slug)}</strong> won
      (<span class="stat">${g.entries} entries · $${g.pot} pot · ${g.hands} hands</span>)
    </li>`;
  }).join("\n");
  const body = `
<section class="band-light">
  <div class="band-inner">
    <h1 class="display">Games</h1>
    <p>Second Tuesday of every month, 7pm PT. Next: <strong>${data.nextGame.date}</strong>.</p>
    <ul>
${items}
    </ul>
  </div>
</section>`;
  return page("Games", body);
}

if (import.meta.main) {
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log("rendered site/standings/index.html and site/games/index.html");
}
