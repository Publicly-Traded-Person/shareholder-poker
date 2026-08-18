// One-command game publish (spec section 6, ratchet pass 1).
// Usage: bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json
// results.json: [{handle, finish, payout, rebuys, trophies}]  (the human-judged part)
// The log stays OUTSIDE the repo; only derived public data is written.
import { parseRows, stackSnapshots, handCount, entryCount } from "./lib/pokernow";
import { resolveSlug } from "./lib/slugs";
import { renderStandings, renderGamesIndex } from "./render";
import { buildChipRace } from "./chip-race";
import type { Game, GamesData } from "./lib/standings";

export type ResultInput = { handle: string; finish: number; payout: number; rebuys: number; trophies: string[] };

export function prepareGame(
  csv: string, results: ResultInput[], data: GamesData,
  opts: { date: string; buyIn: number; startingStack?: number }
): Game {
  if (data.games.some(g => g.date === opts.date)) {
    throw new Error(`game ${opts.date} already exists in games.json`);
  }
  const startingStack = opts.startingStack ?? 5000;
  const rows = parseRows(csv);
  const snaps = stackSnapshots(rows);
  const final = snaps[snaps.length - 1].stacks;
  const entries = entryCount(final, startingStack);           // throws ChipConservationError
  const declared = results.length + results.reduce((n, r) => n + r.rebuys, 0);
  if (declared !== entries) {
    throw new Error(
      `entries mismatch: chip conservation says ${entries}, results.json declares ${declared} ` +
      `(players ${results.length} + rebuys ${declared - results.length}). Fix results.json; do not publish.`
    );
  }
  return {
    date: opts.date,
    hands: handCount(rows),
    startingStack,
    buyIn: opts.buyIn,
    entries,
    pot: entries * opts.buyIn,
    results: results
      .map(r => ({ ...r, slug: resolveSlug(r.handle, data.players) }))  // throws UnknownHandleError
      .sort((a, b) => a.finish - b.finish),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const date = flag("--date");
  const resultsPath = flag("--results");
  if (!args[0] || !date || !resultsPath) {
    console.error("usage: bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json [--buyin 50] [--start 5000]");
    process.exit(1);
  }
  const csv = await Bun.file(args[0]).text();
  const results = JSON.parse(await Bun.file(resultsPath).text()) as ResultInput[];
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;

  const game = prepareGame(csv, results, data, {
    date, buyIn: Number(flag("--buyin") ?? 50), startingStack: Number(flag("--start") ?? 5000),
  });

  data.games.push(game);
  await Bun.write("site/data/games.json", JSON.stringify(data, null, 2) + "\n");
  await Bun.write(`site/games/${date}/chip-race.html`, buildChipRace(csv, { date, startingStack: game.startingStack }));
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  console.log(`published ${date}: ${game.entries} entries, $${game.pot} pot, ${game.hands} hands.`);
  console.log(`NEXT (manual): write site/games/${date}/index.html narrative, update nextGame in games.json, review diff, get Mike's go, push.`);
}
