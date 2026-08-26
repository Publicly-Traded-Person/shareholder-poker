export type GameResult = {
  slug: string;
  handle: string;
  finish: number;
  payout: number;
  rebuys: number;
  trophies: string[];
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
  results: GameResult[];
};

export type GamesData = {
  nextGame: { date: string; time: string };
  hopeCoin: { holder: string; since: string };
  players: { slug: string; name: string; aka: string[] }[];
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
