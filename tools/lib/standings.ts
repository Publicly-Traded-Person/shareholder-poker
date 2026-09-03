// The shape of site/data/games.json (GamesData) and the one function that
// turns it into a standings table (deriveStandings). This is the spine every
// other tool reads: publish-game.ts writes into this shape, render.ts reads
// it to draw /standings/ and /games/, and tools/lib/trophies.ts reads it to
// compute what each player has earned. Nothing here touches disk; callers
// hand in already-parsed JSON and get plain objects back.
//
// Run: never directly. bun test tools/lib/standings.test.ts exercises it.

// A card image credited to one result, once a set has been minted for its
// game. Takes no arguments (it is data, not a function); appears on
// GameResult.card. Optional because most historical results predate cards
// and a card is only added in the commit that ships its set page.
export type CardRef = {
  metal: "foil" | "sapphire" | "copper" | "pewter";
  file: string;   // filename under site/cards/<cardSet>/assets/
  title: string;  // the caption title as it reads on the set page
};

// One physical stop the Hope Coin has made, oldest stops first in
// GamesData.hopeCoin.history. `from` is absent only on the very first
// recorded stop (nobody remembers exactly when it started there); `to` is
// absent only on the last stop, because that one is still current. Never
// invent either date: an unknown boundary stays absent rather than guessed,
// because a wrong date on the coin page is worse than a gap.
export type HopeCoinStop = {
  holder: string;   // a slug in players; may be a slug with no games
  from?: string;    // absent only on the first stop, when nobody remembers
  to?: string;      // absent only on the last stop, which is current
  place?: string;   // optional; a place name, never coordinates
  how: string;      // one plain sentence
};

// A player on the roster. `bio` is Charlie's paragraph for the player page
// (site spec §privacy: it is written fresh for the page, never a private
// vault read); most players have none yet, so it is optional and its
// absence just means the page renders without that section.
export type Player = { slug: string; name: string; aka: string[]; bio?: string };

export type GameResult = {
  slug: string;
  handle: string;
  finish: number;
  payout: number;
  rebuys: number;
  trophies: string[];
  // The card minted for this result, once its set exists. Optional: a
  // result predating its set's card fill, or a set still in production,
  // simply has none, and the player page shows no gallery entry for it.
  card?: CardRef;
};

export type Game = {
  date: string;
  hands: number;
  startingStack: number;
  buyIn: number;
  entries: number;
  pot: number;
  // "YYYY-MM": that month's set page at /cards/<cardSet>/, once it exists.
  // Optional; games whose sets are still in production omit it.
  cardSet?: string;
  // The set's display name ("The Founder's Table"), for player pages to
  // name the set a card came from. A game with cardSet must have this too;
  // the "card cross-check" describe block in tools/site.test.ts (Task 5)
  // enforces the pair over every game in the real data, so a cardSet added
  // without a cardSetName now fails the suite. Optional here only so a
  // game without a set yet still typechecks.
  cardSetName?: string;
  results: GameResult[];
};

export type GamesData = {
  nextGame: { date: string; time: string };
  // Seasons that are real games but not yet on this spine, as they should
  // read on the page ("2020", "April 2026"). Drives the "being backfilled"
  // sentence in tools/render.ts recordQualifier(); remove an entry in the
  // same commit as the game it names. Absent or empty once nothing is
  // missing, and the sentence disappears with it.
  backfillPending?: string[];
  hopeCoin: {
    holder: string;
    since: string;
    // True while the Coin's stops before the earliest one hopeCoin.history
    // can date are still being reconstructed from memory (the Coin is older
    // than the record; see the HopeCoinStop comment above on why the first
    // stop may omit `from`). Mirrors backfillPending's own contract just
    // above on this type: drives one derived sentence on the Hope Coin page
    // (tools/render.ts renderHopeCoin) instead of anyone hand-typing it
    // there, so the sentence cannot survive on the page after the data it
    // describes has changed underneath it - the exact failure backfillPending
    // was built to prevent for the standings/games-index "record starts
    // with..." line (see recordQualifier's own comment in tools/render.ts).
    // Remove this field entirely - never just flip it to `false` - in the
    // same commit that appends the last recovered stop (docs/publishing.md,
    // "Hope Coin handoff"): an absent field is the one state a reader never
    // has to guess about, the same reason backfillPending's own entries are
    // deleted, not toggled, once a season is no longer missing.
    historyPending?: boolean;
    // Every handoff on record, oldest first. Optional and may be absent
    // entirely while Mike is still assembling the list (spec open question);
    // tools/lib/trophies.ts treats a missing history as an empty one rather
    // than throwing, so the hope-coin trophy simply has no past holders yet.
    history?: HopeCoinStop[];
  };
  players: Player[];
  games: Game[];
};

export type StandingRow = {
  slug: string;
  name: string;
  games: number;
  wins: number;
  cashes: number;
  bestFinish: number;
  totalPayout: number;
  rebuys: number;
  lastPlayed: string;
};

export type Standings = {
  rows: StandingRow[];
  hopeCoin: { holder: string; since: string; skulls: Record<string, number> };
};

// Folds every game on the spine into one row per player. Takes the parsed
// games.json; returns rows sorted wins-first (then cashes, then best finish,
// then name, so ties resolve the same way every render) plus the Hope Coin
// tile's skull tally. Throws nothing; a GamesData with no games returns an
// empty row list. Games are sorted by date before folding so lastPlayed and
// the skull tally reflect chronological order regardless of games.json's own
// array order.
export function deriveStandings(data: GamesData): Standings {
  const byId = new Map<string, StandingRow>();
  const skulls: Record<string, number> = {};
  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));

  for (const game of [...data.games].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const r of game.results) {
      const row = byId.get(r.slug) ?? {
        slug: r.slug,
        name: nameOf.get(r.slug) ?? r.slug,
        games: 0,
        wins: 0,
        cashes: 0,
        bestFinish: Infinity,
        totalPayout: 0,
        rebuys: 0,
        lastPlayed: "",
      };
      row.games++;
      if (r.finish === 1) row.wins++;
      if (r.payout > 0) row.cashes++;
      row.bestFinish = Math.min(row.bestFinish, r.finish);
      row.totalPayout += r.payout;
      row.rebuys += r.rebuys;
      row.lastPlayed = game.date;
      byId.set(r.slug, row);
      if (r.trophies.includes("hope-slayer")) skulls[r.slug] = (skulls[r.slug] ?? 0) + 1;
    }
  }

  const rows = [...byId.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.cashes - a.cashes ||
      a.bestFinish - b.bestFinish ||
      a.name.localeCompare(b.name)
  );
  return { rows, hopeCoin: { ...data.hopeCoin, skulls } };
}
