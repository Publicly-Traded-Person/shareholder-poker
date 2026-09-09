// One-command game publish (spec section 6, ratchet pass 1).
// Usage: bun tools/publish-game.ts <log1.csv> [log2.csv ...] --date YYYY-MM-DD --results results.json
// results.json: [{handle, finish, payout, rebuys, trophies}]  (the human-judged part)
// A multi-table tournament (10+ players) exports one log per table; pass all
// of them (docs/publishing.md, step 1). One log is the ordinary game.
// The logs stay OUTSIDE the repo; only derived public data is written.
import { mergeLogs, stackSnapshots, handCount, entryCount } from "./lib/pokernow";
import { resolveSlug } from "./lib/slugs";
import { renderStandings, renderGamesIndex } from "./render";
import { TROPHIES } from "./lib/trophies";
import type { Game, GamesData } from "./lib/standings";
import { positionals, flag } from "./lib/args";

export type ResultInput = { handle: string; finish: number; payout: number; rebuys: number; trophies: string[] };

// Derives the game record from every table's log plus the judged results.
// Takes the logs' CSV text (one per table), the parsed results.json, the
// current games.json, and the game's date, buy-in, and starting stack.
// Returns the Game to append. Throws, naming the fix, on: a date already
// published; final stacks that do not divide by the starting stack; declared
// entries (players + rebuys) that disagree with chip conservation; finishes
// that are not dense 1..N; payouts that do not sum to the pot; an unknown
// trophy id or one recorded on a player it does not belong to; a handle
// (in results.json OR in a log) that games.json does not know; and a set
// of players in results.json that differs from the set seen at the tables.
export function prepareGame(
  csvs: string[], results: ResultInput[], data: GamesData,
  opts: { date: string; buyIn: number; startingStack?: number }
): Game {
  if (data.games.some(g => g.date === opts.date)) {
    throw new Error(`game ${opts.date} already exists in games.json`);
  }
  const startingStack = opts.startingStack ?? 5000;
  const { rows } = mergeLogs(csvs);
  const snaps = stackSnapshots(rows);
  // The last snapshot on the merged timeline is the final table's last hand,
  // where every chip in play has ended up, so conservation still holds
  // across N tables.
  const final = snaps[snaps.length - 1].stacks;
  const entries = entryCount(final, startingStack);           // throws ChipConservationError
  const declared = results.length + results.reduce((n, r) => n + r.rebuys, 0);
  if (declared !== entries) {
    throw new Error(
      `entries mismatch: chip conservation says ${entries}, results.json declares ${declared} ` +
      `(players ${results.length} + rebuys ${declared - results.length}). Fix results.json; do not publish.`
    );
  }

  // Finishes must be dense 1..N with no gaps or duplicates, or render.ts's
  // g.results.find(r => r.finish === 1)! throws an opaque TypeError (a gap)
  // or silently picks the wrong player (a duplicate).
  const finishes = results.map(r => r.finish).slice().sort((a, b) => a - b);
  const seen = new Set<number>();
  for (const f of finishes) {
    if (seen.has(f)) {
      throw new Error(`duplicate finish ${f} in results.json. Finishes must be 1..${results.length} with no repeats.`);
    }
    seen.add(f);
  }
  finishes.forEach((f, i) => {
    if (f !== i + 1) {
      throw new Error(
        `finish gap at position ${i + 1}: expected ${i + 1}, results.json has ${f}. ` +
        `Finishes must be dense 1..${results.length} with no gaps.`
      );
    }
  });

  // Payouts are exact splits of the pot (e.g. 315+135=450); a typo here
  // silently shorts or overpays a player, so refuse rather than publish it.
  const pot = entries * opts.buyIn;
  const totalPayout = results.reduce((n, r) => n + r.payout, 0);
  if (totalPayout !== pot) {
    throw new Error(
      `payout mismatch: results.json payouts sum to ${totalPayout} but the pot is ${pot} ` +
      `(${entries} entries x $${opts.buyIn}). Fix results.json; do not publish.`
    );
  }

  // Every judged trophy id in results.json must be one tools/lib/trophies.ts
  // actually defines. Without this, a typo'd id (e.g. "hope-slyer" for
  // "hope-slayer") would not error anywhere: trophyCase() simply finds no
  // registry entry matching it and awards nothing, so the player at the
  // table quietly loses a trophy they were given and nobody notices until
  // someone asks where it went. The lookup is built from TROPHIES itself,
  // never a second list of ids typed out here, because a second list is
  // exactly the kind of thing this registry exists to make unnecessary.
  const trophyById = new Map(TROPHIES.map(t => [t.id, t]));
  for (const r of results) {
    for (const id of r.trophies) {
      if (!trophyById.has(id)) {
        throw new Error(
          `unknown trophy id "${id}" on ${r.handle}'s result: tools/lib/trophies.ts has no entry ` +
          `for it. Fix results.json (or add the trophy to trophies.ts if it is genuinely new); do not publish.`
        );
      }
    }
  }

  // Handles resolve to slugs here, before the audience check below, because
  // that check compares slugs: a trophy marked `only` for one player
  // (Abel's Triumph is Gene's alone) recorded on anybody else is the same
  // kind of silent loss as an unknown id. trophyCase() hides an `only`
  // trophy from every other page, so the misfiled row would award a trophy
  // nobody could ever see. Refuse; fix results.json.
  const resolved = results.map(r => ({ ...r, slug: resolveSlug(r.handle, data.players) }));  // throws UnknownHandleError
  for (const r of resolved) {
    for (const id of r.trophies) {
      const only = trophyById.get(id)!.only;
      if (only !== undefined && only !== r.slug) {
        throw new Error(
          `trophy "${id}" belongs only to ${only}, but results.json records it on ${r.handle} (${r.slug}). ` +
          `Move it to the right row or remove it; do not publish.`
        );
      }
    }
  }

  // Everyone who sat at any table must have a row in results.json, and
  // nobody else may. Chip conservation cannot catch a missing player once
  // there is more than one table: a player who busted on a non-final table
  // is absent from the final stacks, and their entry can be quietly
  // absorbed by a rebuy count on someone else's row (2026-09-08: five
  // players never reached the final table). Compared as slugs, so a handle
  // spelled differently in results.json and the log still matches through
  // `aka`; a log handle games.json does not know halts here the same way an
  // unknown results.json handle does. Fix the input, never the check.
  const seated = new Set([...new Set(snaps.flatMap(s => Object.keys(s.stacks)))].map(h => resolveSlug(h, data.players)));
  const declaredSlugs = new Set(resolved.map(r => r.slug));
  const missing = [...seated].filter(s => !declaredSlugs.has(s));
  const extra = [...declaredSlugs].filter(s => !seated.has(s));
  if (missing.length || extra.length) {
    throw new Error(
      `player set mismatch between the logs and results.json: ` +
      (missing.length ? `seated but not in results.json: ${missing.join(", ")}. ` : "") +
      (extra.length ? `in results.json but never seated: ${extra.join(", ")}. ` : "") +
      `Every player at any table needs a row (and its rebuys on its own row). Fix results.json; do not publish.`
    );
  }

  return {
    date: opts.date,
    hands: handCount(rows),
    startingStack,
    buyIn: opts.buyIn,
    entries,
    pot,
    results: resolved.sort((a, b) => a.finish - b.finish),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const paths = positionals(args);
  const date = flag(args, "--date");
  const resultsPath = flag(args, "--results");
  if (!paths.length || !date || !resultsPath) {
    console.error("usage: bun tools/publish-game.ts <log1.csv> [log2.csv ...] --date YYYY-MM-DD --results results.json [--buyin 50] [--start 5000]");
    process.exit(1);
  }
  const csvs = await Promise.all(paths.map(p => Bun.file(p).text()));
  const results = JSON.parse(await Bun.file(resultsPath).text()) as ResultInput[];
  const data = JSON.parse(await Bun.file("site/data/games.json").text()) as GamesData;

  const game = prepareGame(csvs, results, data, {
    date, buyIn: Number(flag(args, "--buyin") ?? 50), startingStack: Number(flag(args, "--start") ?? 5000),
  });

  data.games.push(game);
  await Bun.write("site/data/games.json", JSON.stringify(data, null, 2) + "\n");
  await Bun.write("site/standings/index.html", renderStandings(data));
  await Bun.write("site/games/index.html", renderGamesIndex(data));
  const tables = paths.length === 1 ? "" : ` across ${paths.length} tables`;
  console.log(`published ${date}: ${game.entries} entries, $${game.pot} pot, ${game.hands} hands${tables}.`);
  console.log(`NEXT (manual): write site/games/${date}/index.html narrative (the shell carries CHIP-RACE markers), then\n  bun tools/chip-race.ts ${paths.join(" ")} --date ${date} --start ${game.startingStack} --inject site/games/${date}/index.html\nthen update nextGame in games.json, review diff, get Mike's go, push.`);
}
