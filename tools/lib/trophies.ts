// The trophy registry and the one function that reads it against a player's
// record: trophyCase(). This is the whole trophy model (design spec
// 2026-09-02-player-pages-trophies-hope-coin-design.md §4) — the shelf on
// standings, the case on a player page, and the locked-tile grid all call
// the same function, so they cannot disagree about what a player has
// earned.
//
// The one design rule this file exists to protect: a trophy is one registry
// entry and nothing else. Adding a trophy means adding one entry to
// TROPHIES below and nothing more; every page that shows trophies reads
// this list, so a new entry appears everywhere at once. Never add a
// trophy's name, look, or rule anywhere else in the codebase.
//
// Pure module: no clock, no I/O, no reads of games.json itself. Every
// function here takes its data as an argument, which is what lets the test
// file build synthetic players and games instead of reading the real site
// data.
//
// Run: never directly. bun test tools/lib/trophies.test.ts exercises it.

import type { Game, GameResult, GamesData } from "./standings";

// The drawn mark a trophy renders as. `shape` picks the SVG in
// tools/render.ts; `metal` picks its accent color AND its place in display
// order (foil, then sapphire, then copper, then pewter — see displayOrder
// below). Kept as its own type because a future render task needs to name
// both halves without reaching into Trophy.
export type Look = {
  shape: "gem" | "skull" | "coin" | "shield" | "ribbon";
  metal: "foil" | "sapphire" | "copper" | "pewter";
};

// What trophyCase() hands back for one earned trophy: the id it matches
// back to a registry entry, every date the player earned it (oldest first,
// so "most recent" is always the last element), and how many times. A
// judged trophy's count is how many of the player's results carry its id; a
// derived trophy's count is whatever its own rule below says a "count"
// means for that trophy (wins, stops, best streak — the registry entries
// say which).
export type Earned = { id: string; dates: string[]; count: number };

// A derived trophy's test. Takes the whole GamesData (not just Game[])
// because one rule (hope-coin) needs hopeCoin.history, which lives beside
// games, not inside them; returns the Earned record when the slug qualifies
// and null when it does not. Never throws: a rule that cannot find the
// player simply returns null, the same as a rule that finds nothing to
// award.
export type DerivedRule = (data: GamesData, slug: string) => Earned | null;

// One row of the trophy case. `kind: "judged"` trophies are the ones a
// human records on a result at publish time (results.json carries the id
// verbatim). Task 4 of this plan adds the publish-game.ts halt on an id
// that is not one of these six — that check does not exist yet, so as of
// this file nothing stops a typo'd id from reaching results.json; do not
// read this comment as a present-tense guarantee. `kind: "derived"`
// trophies carry a `rule` instead and are computed fresh from the record
// every time trophyCase runs. A judged entry never carries a rule (there is
// nothing to derive) and a derived entry always does (there is nothing else
// that could tell trophyCase when it is earned).
export type Trophy = {
  id: string; // kebab-case; the literal string results.json carries for judged ids
  name: string;
  earn: string; // one line, an instruction ("Win a game."); what a locked tile shows
  kind: "judged" | "derived";
  look: Look;
  rule?: DerivedRule;
};

// gather() is the shared shape behind every "some of this player's results
// matched a simple predicate" rule (champion, podium, cashed, clean-night,
// comeback). Takes the data, the slug, and a per-result test; returns the
// dates (oldest first) of every one of the slug's own results that passed,
// and the count of how many did. Filtering to `r.slug === slug` before
// applying the predicate is the part a careless rule gets wrong — without
// it a rule would credit a player with a trophy another player's result
// earned in the same game.
function gather(
  data: GamesData,
  slug: string,
  pred: (result: GameResult, game: Game) => boolean
): { dates: string[]; count: number } {
  const dates: string[] = [];
  for (const game of data.games) {
    for (const result of game.results) {
      if (result.slug === slug && pred(result, game)) dates.push(game.date);
    }
  }
  dates.sort(); // ISO "YYYY-MM-DD" strings sort lexicographically = chronologically
  return { dates, count: dates.length };
}

// Builds a DerivedRule out of gather() for the common case where "earned"
// means "one or more of the player's results matched" and "count" means
// "how many did". Takes the trophy's own id (so the returned Earned is
// self-labelled) and the per-result predicate; returns null when nothing
// matched. The real invariant this protects is narrower than "dates is
// never empty": count is never 0. Every trophy built here always has at
// least one match backing its count, so dates (each match's own date) is
// never empty either. The Hope Coin is the one trophy in this file that is
// NOT built with fromResults and can be earned with an empty dates list —
// a holder whose only stop predates anyone recording a `from` still has
// count 1 — so a render layer reading Earned must not assume dates.length
// tracks count; it must read count for "how many" and dates only for
// "which ones are dated".
function fromResults(id: string, pred: (result: GameResult, game: Game) => boolean): DerivedRule {
  return (data, slug) => {
    const { dates, count } = gather(data, slug, pred);
    return count === 0 ? null : { id, dates, count };
  };
}

// The Hope Coin trophy's rule. It reads hopeCoin.history instead of
// results.json — the reason this trophy is "derived" rather than "judged"
// even though a human is the one who records a handoff — so a past holder
// keeps the award with their own dates forever, not just while they hold
// the coin. Takes the data and slug; returns null when the slug never
// appears as a stop's holder (including when history is absent entirely,
// treated as an empty list per the spec's rollout note: the list may not
// exist yet and that is not an error).
//
// A stop with no `from` (only ever the very first stop, when nobody
// remembers exactly when it started) still counts toward `count` — the
// player genuinely held the coin — but contributes no entry to `dates`,
// because inventing a date for it would put a false date on a page.
const hopeCoinRule: DerivedRule = (data, slug) => {
  const stops = (data.hopeCoin.history ?? []).filter((stop) => stop.holder === slug);
  if (stops.length === 0) return null;
  const dates = stops
    .map((stop) => stop.from)
    .filter((from): from is string => from !== undefined)
    .sort();
  return { id: "hope-coin", dates, count: stops.length };
};

// The Regular trophy's rule: three or more CONSECUTIVE games on the whole
// spine (data.games, every player's games, not just this slug's) where the
// slug appears. "Consecutive" means back-to-back entries once every game on
// the spine is laid out in date order — a game the slug skipped breaks the
// streak even though it is still a streak of the slug's own attendance
// gaps. Takes the data and slug; returns null when the slug's longest run
// never reaches three, and otherwise the dates of that single longest run
// (oldest first) with count equal to its length — the "best streak", so a
// four-game run earlier in the record beats a two-game run later even
// though the two-game run is more recent.
const regularRule: DerivedRule = (data, slug) => {
  const spine = [...data.games].sort((a, b) => a.date.localeCompare(b.date));
  let bestRun: Game[] = [];
  let currentRun: Game[] = [];
  for (const game of spine) {
    const played = game.results.some((r) => r.slug === slug);
    if (played) {
      currentRun = [...currentRun, game];
      if (currentRun.length > bestRun.length) bestRun = currentRun;
    } else {
      currentRun = [];
    }
  }
  if (bestRun.length < 3) return null;
  return { id: "regular", dates: bestRun.map((g) => g.date), count: bestRun.length };
};

// The Founder's Table trophy's rule: played in the game dated the literal
// string "2026-07-14", the first game on the data spine. Pinned to that
// exact date rather than "the earliest game on the spine" on purpose — the
// spec calls this out because a later backfill of an older season (2020,
// tracked on #3) must never make an already-awarded Founder's Table move to
// a different game or a different set of players. Takes the data and slug;
// returns null when the slug has no result in that game.
const foundersTableRule: DerivedRule = fromResults(
  "founders-table",
  (_result, game) => game.date === "2026-07-14"
);

// The Bubble trophy's rule: finished exactly one place worse than the last
// paid spot. "Paid spots" is read from the game itself (how many of its own
// results have payout above zero) rather than from `entries`, because
// `entries` counts every buy-in including rebuys and would put the bubble
// in the wrong place on a night with rebuys. Takes the data and slug;
// returns null when the slug never finished one-out on any game.
//
// A game with zero paid spots (paidSpots === 0) must never award this: the
// guard below is not defensive filler, it is load-bearing. Without it,
// `finish === paidSpots + 1` matches finish 1 — the outright winner — on
// any game where nobody was recorded as paid. That is a real path, not a
// hypothetical: the 2020 season is a live backfill item (see
// backfillPending in games.json) and README.md notes its buy-ins and
// winnings are not shown, so a backfilled 2020 game could legitimately
// carry payout: 0 on every result. Awarding The Bubble to that game's
// champion would be inventing an award nobody earned.
const theBubbleRule: DerivedRule = fromResults("the-bubble", (result, game) => {
  const paidSpots = game.results.filter((r) => r.payout > 0).length;
  if (paidSpots === 0) return false; // no paid spots: there is no bubble to be on
  return result.finish === paidSpots + 1;
});

// The registry. This is the single list the design rule (top of file)
// protects: one entry per trophy, and every page that shows a trophy reads
// this array through trophyCase() rather than knowing about a trophy on its
// own. Order here is NOT display order (see displayOrder below) — it is
// simply judged trophies first, then derived, in the order Mike specified
// them, which keeps a diff that adds one trophy to a small, obvious insert.
//
// To add a trophy: add one entry. A judged trophy needs id, name, earn, and
// look; a derived trophy needs those plus a rule. Run the suite — the
// registry test in trophies.test.ts rejects a malformed entry (missing
// field, wrong shape/metal, a rule on a judged entry, or a missing rule on
// a derived one) before it can reach a page.
export const TROPHIES: Trophy[] = [
  // Judged: a human records these ids on a result in results.json at
  // publish time (docs/publishing.md). Task 4 of this plan is what makes
  // publish-game.ts halt on an id that is not one of these six, the same
  // way it already halts on an unknown handle — that halt is not built yet,
  // so today nothing but this comment stops a bad id from reaching
  // results.json. Never guess an id into existence there or here.
  {
    id: "hope-slayer",
    name: "Hope Slayer",
    earn: "Eliminate the Hope Coin holder.",
    kind: "judged",
    look: { shape: "skull", metal: "foil" },
  },
  {
    id: "two-seven-showdown",
    name: "2-7 Showdown",
    earn: "Reach showdown holding 7-2 with five or more players at the table.",
    kind: "judged",
    look: { shape: "shield", metal: "sapphire" },
  },
  {
    id: "final-countdown",
    name: "The Final Countdown",
    earn: "Hold 7-2 on the tournament's final hand.",
    kind: "judged",
    look: { shape: "shield", metal: "sapphire" },
  },
  {
    id: "cain-and-abel",
    name: "Cain and Abel",
    earn: "Knock out Gene.",
    kind: "judged",
    look: { shape: "shield", metal: "sapphire" },
  },
  {
    id: "abel-stands",
    name: "Abel Stands",
    earn: "Win the tournament as Gene, never knocked out, not even during the rebuy window.",
    kind: "judged",
    look: { shape: "shield", metal: "sapphire" },
  },
  {
    id: "kevin-deuce",
    name: "Kevin Deuce",
    earn: "Be first to win an announced showdown holding unsuited king-two.",
    kind: "judged",
    look: { shape: "shield", metal: "sapphire" },
  },
  // Derived: computed fresh from the record every time trophyCase runs.
  // Nothing records these directly; the rule beside each one is the only
  // place that decides whether it is earned.
  {
    id: "champion",
    name: "Champion",
    earn: "Win a game.",
    kind: "derived",
    look: { shape: "gem", metal: "foil" },
    rule: fromResults("champion", (result) => result.finish === 1),
  },
  {
    id: "hope-coin",
    name: "The Hope Coin",
    earn: "Take the Hope Coin.",
    kind: "derived",
    look: { shape: "coin", metal: "foil" },
    rule: hopeCoinRule,
  },
  {
    id: "podium",
    name: "Podium",
    earn: "Finish in the top three.",
    kind: "derived",
    look: { shape: "gem", metal: "copper" },
    rule: fromResults("podium", (result) => result.finish <= 3),
  },
  {
    id: "cashed",
    name: "Cashed",
    earn: "Finish in the money.",
    kind: "derived",
    look: { shape: "ribbon", metal: "copper" },
    rule: fromResults("cashed", (result) => result.payout > 0),
  },
  {
    id: "clean-night",
    name: "Clean Night",
    earn: "Cash without rebuying.",
    kind: "derived",
    look: { shape: "ribbon", metal: "copper" },
    rule: fromResults("clean-night", (result) => result.payout > 0 && result.rebuys === 0),
  },
  {
    id: "comeback",
    name: "Comeback",
    earn: "Cash after rebuying.",
    kind: "derived",
    look: { shape: "ribbon", metal: "copper" },
    rule: fromResults("comeback", (result) => result.payout > 0 && result.rebuys >= 1),
  },
  {
    id: "regular",
    name: "Regular",
    earn: "Play three games in a row.",
    kind: "derived",
    look: { shape: "ribbon", metal: "pewter" },
    rule: regularRule,
  },
  {
    id: "founders-table",
    name: "Founder's Table",
    earn: "Play at the founding table.",
    kind: "derived",
    look: { shape: "ribbon", metal: "pewter" },
    rule: foundersTableRule,
  },
  {
    id: "the-bubble",
    name: "The Bubble",
    earn: "Finish one place out of the money.",
    kind: "derived",
    look: { shape: "ribbon", metal: "pewter" },
    rule: theBubbleRule,
  },
];

// The order every page actually shows trophies in: TROPHIES stably sorted
// by metal (foil, sapphire, copper, pewter), keeping registry order within
// a metal. A plain Array.sort() is enough because JS sort is stable, so two
// entries of the same metal never swap relative to each other; that
// stability is what makes "registry array order within a metal" true
// without any extra bookkeeping here.
const METAL_RANK: Record<Look["metal"], number> = { foil: 0, sapphire: 1, copper: 2, pewter: 3 };
function displayOrder(): Trophy[] {
  return [...TROPHIES].sort((a, b) => METAL_RANK[a.look.metal] - METAL_RANK[b.look.metal]);
}

// The one function every page that shows trophies calls. Takes the parsed
// games.json and a player's slug; returns every trophy that slug has
// earned (judged ids their own results carry, plus every derived rule that
// matches) and every trophy they have not, both in display order. Throws
// nothing: a slug with no games at all simply earns none and has the full
// registry locked.
//
// Why one function: the standings shelf, the player page's case, and the
// locked-tile grid all call this instead of each re-implementing "what has
// this player earned" — so they can never disagree about it.
export function trophyCase(data: GamesData, slug: string): { earned: Earned[]; locked: Trophy[] } {
  const earned: Earned[] = [];
  const locked: Trophy[] = [];
  for (const trophy of displayOrder()) {
    const result =
      trophy.kind === "judged" ? judgedEarned(data, slug, trophy.id) : trophy.rule!(data, slug);
    if (result) earned.push(result);
    else locked.push(trophy);
  }
  return { earned, locked };
}

// A judged trophy's own "rule": every one of the slug's own results that
// carries this exact id in its `trophies` array. Takes the data, the slug,
// and the id; returns null when none of the slug's results carry it. Kept
// separate from the derived rules above because a judged id has no
// DerivedRule of its own — it is read straight off results.json — but
// trophyCase needs the same { dates, count } shape either way.
function judgedEarned(data: GamesData, slug: string, id: string): Earned | null {
  const { dates, count } = gather(data, slug, (result) => result.trophies.includes(id));
  return count === 0 ? null : { id, dates, count };
}
