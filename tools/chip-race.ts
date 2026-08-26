// Chip-race chart from a PokerNow log, as a single self-contained HTML file.
// Run: bun tools/chip-race.ts <log.csv> --date YYYY-MM-DD --start 5000 --out out.html
import { parseRows, stackSnapshots, handCount, entryCount } from "./lib/pokernow";

const PALETTE = ["#c9a227", "#2b5d9e", "#b06c3f", "#8a8d91", "#5e8c61", "#9e2b5d", "#4a4e57"];

export function buildChipRace(csv: string, opts: { date: string; startingStack: number }): string {
  const rows = parseRows(csv);
  const snaps = stackSnapshots(rows);
  const hands = handCount(rows);
  const final = snaps[snaps.length - 1].stacks;
  const entries = entryCount(final, opts.startingStack);

  const players = [...new Set(snaps.flatMap(s => Object.keys(s.stacks)))];
  const maxChips = Math.max(...snaps.flatMap(s => Object.values(s.stacks)));
  const W = 720, H = 400, PAD = 40;
  const x = (hand: number) => PAD + (hand / Math.max(hands, 1)) * (W - 2 * PAD);
  const y = (chips: number) => H - PAD - (chips / maxChips) * (H - 2 * PAD);

  const lines = players.map((p, i) => {
    const pts = snaps
      .filter(s => p in s.stacks)
      .map(s => `${x(s.hand).toFixed(1)},${y(s.stacks[p]).toFixed(1)}`)
      .join(" ");
    return `  <polyline fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="2.5" points="${pts}"><title>${p}</title></polyline>`;
  }).join("\n");

  const legend = players.map((p, i) =>
    `<span style="color:${PALETTE[i % PALETTE.length]}; margin-right:1em; font-weight:700;">${p}</span>`
  ).join(" ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chip race ${opts.date}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="description" content="Chip race: ${opts.date}. ${entries} entries, ${hands} hands.">
<style>
  body { margin: 0; padding: 1rem; background: #1c1f26; color: #eceae2; font-family: -apple-system, sans-serif; }
  .wrap { overflow-x: auto; }
  svg { display: block; min-width: 560px; width: 100%; height: auto; }
  .meta { font-family: Menlo, monospace; font-size: .85em; color: #8a8d91; }
  nav a { color: #9dc3f0; }
</style>
</head>
<body>
<nav style="margin-bottom:1rem;"><a href="/">Home</a> · <a href="/games/">Games</a> · <a href="/cards/">Cards</a> · <a href="/standings/">Standings</a></nav>
<p class="meta">Chip race: ${opts.date}. ${entries} entries, ${hands} hands.</p>
<div class="wrap">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chip counts per player over ${hands} hands">
  <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#8a8d91"/>
  <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#8a8d91"/>
${lines}
</svg>
</div>
<p>${legend}</p>
</body>
</html>
`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const csv = await Bun.file(args[0]).text();
  const html = buildChipRace(csv, { date: flag("--date") ?? "unknown", startingStack: Number(flag("--start") ?? 5000) });
  const out = flag("--out") ?? "chip-race.html";
  await Bun.write(out, html);
  console.log(`wrote ${out}`);
}
