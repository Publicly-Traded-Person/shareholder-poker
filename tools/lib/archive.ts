// The shape of site/data/archive.json (ArchiveData) and its one validator,
// validateArchive. This is the data module for the archive page (spec
// docs/superpowers/specs/2026-09-05-archive-page-design.md, #39): every
// game the club played before the data spine begins in July 2026, back to
// 2020, where the notes give only a podium, a bounty list, and sometimes an
// entrant count, never the payouts or chip counts games.json carries.
// tools/render.ts's entry point reads site/data/archive.json into this
// shape and calls validateArchive on it BEFORE it writes a single page, so
// a bad archive file halts the whole run rather than publishing a wrong
// one; renderArchive in that same file then turns the validated data into
// site/archive/index.html.
//
// Pure module: no clock, no I/O. validateArchive takes the parsed
// archive.json plus the parsed games.json and either returns or throws; it
// never mutates either argument.
//
// Run: never directly. bun test tools/lib/archive.test.ts exercises it in
// isolation with synthetic fixtures (invented names, invented slugs, per
// the repo's privacy rule for committed test data).

import type { GamesData } from "./standings";

// The five bounty kinds the club has ever recorded on a pre-spine game, and
// nothing else - the vocabulary lives here and only here (spec §3.1). One
// player, `name`, and optionally the `handle` and `slug` every other
// archive entry can carry; a bounty adds `kind` on top, which
// BOUNTY_NAMES below turns into the word the page prints.
export type BountyKind = "hope-slayer" | "cain" | "seven-deuce" | "bubble" | "kevin-deuce";

// One name on an archive game: a podium finisher or a bounty holder.
// `handle` and `slug` are both optional and mean different things - a
// `handle` is how the notes named the player (a bot's own name, a poker
// site handle), while a `slug` is only present when that name also has a
// result on the spine (validateArchive's rule b) and is what the page uses
// to link to /player/<slug>/. A name can carry a slug with no handle, a
// handle with no slug, both, or neither.
export type ArchiveEntry = { name: string; handle?: string; slug?: string };

// A podium finisher, `place` 1 through 3. Two entries can share `place: 1`
// - a chop - and the game's `note` says so in words (spec §3, the March 10
// 2026 example); nothing else on the shape distinguishes a chop from an
// ordinary podium.
export type ArchivePodiumEntry = ArchiveEntry & { place: 1 | 2 | 3 };

// A bounty holder for one of the five BountyKind kinds. One player may hold
// more than one bounty in a single game - two separate ArchiveBounty
// entries, not a list of kinds on one entry - because the site prints each
// bounty as its own line.
export type ArchiveBounty = ArchiveEntry & { kind: BountyKind };

// One game the club played before the spine. `date` is the only field the
// notes always have; every other field is optional or may be empty because
// the notes recorded less as the club got older (see the type's own field
// comments for what "absent" means for each).
export type ArchiveGame = {
  date: string;                    // YYYY-MM-DD, unique across the whole file, before the spine's first game
  entrants?: number;                // integer of at least one; absent when the notes do not say a count
  podium: ArchivePodiumEntry[];     // up to three; may be empty (some nights have no recorded result); places non-decreasing
  bounties: ArchiveBounty[];        // may be empty
  note?: string;                    // one line; the place a chop, or any other wrinkle, gets explained
};

// One season's worth of pre-spine games, oldest-to-newest inside `games`
// (the renderer orders seasons themselves newest-first, but that is a
// rendering choice, not a rule this file enforces). `id` is a stable key
// (matches nothing else on the site) used only to tell two seasons apart
// and to name one in an error message; `title` is what the page prints.
// `note` is optional, one line, and is site copy exactly like a game's own
// `note` (spec §3.2, §4.3): it is checked by the same em-dash rule (h) and
// "experiment" rule (i) below, naming this season's `id` on failure, since
// a season note has no single game of its own to name instead.
export type ArchiveSeason = { id: string; title: string; note?: string; games: ArchiveGame[] };

// The whole file: one non-empty list of seasons, each with a non-empty
// games list (rule j below) - a season nobody has typed a game into yet
// simply is not in the file.
export type ArchiveData = { seasons: ArchiveSeason[] };

// The display name for each BountyKind, exactly five entries and no more
// (M1). These match tools/lib/trophies.ts's own display names for the same
// five ideas on purpose - "Hope Slayer" means the same thing whether it is
// a drawn trophy on a spine game or a word on an archive one - but this
// file must never import that registry: the registry lists what a spine
// game can award, and nothing an archive game lists was actually earned in
// that sense, so the two lists are kept independent even though their
// words agree.
export const BOUNTY_NAMES: Record<BountyKind, string> = {
  "hope-slayer": "Hope Slayer",
  cain: "Cain and Abel",
  "seven-deuce": "2-7 Showdown",
  bubble: "The Bubble",
  "kevin-deuce": "Kevin Deuce",
};

// The site's First L. name pattern (docs/brand.md), the same expression
// tools/data.test.ts applies to games.json: a capitalized first name,
// optionally followed by a space and a capitalized initial with a period.
// Rule (a) below allows one exception on top of this pattern: a handle
// used as the display name, when the entry's own `handle` equals its
// `name` exactly (the bot "K5M Guy", say, which is nobody's first name).
const NAME_PATTERN = /^[A-Z][a-z]+( [A-Z]\.)?$/;

// True when `entry.name` is a name validateArchive will accept: either it
// reads like a real First L. name, or the entry is honest that its display
// name is really just its handle (M4). Kept as its own function only so
// the rule reads as one sentence in both rule (a) and the em-dash check
// below, which needs to know an entry passed the name rule via the handle
// exception before it can blame an em dash inside that same string on a
// different rule.
function nameIsAcceptable(entry: ArchiveEntry): boolean {
  return NAME_PATTERN.test(entry.name) || entry.handle === entry.name;
}

// Every slug with at least one result somewhere on the spine, and no other
// slug - the same rule tools/render.ts's playerSlugs() computes, reimplemented
// here rather than imported because tools/render.ts imports this file's own
// directory (tools/lib), and importing it back would be a cycle. Used only
// by rule (b) below, to tell a real player's slug from a stray one.
function spineSlugs(games: GamesData): Set<string> {
  const slugs = new Set<string>();
  for (const game of games.games) {
    for (const result of game.results) slugs.add(result.slug);
  }
  return slugs;
}

// Checks archive end to end against the rules in spec §3.2 and throws an
// Error describing exactly which game or season is wrong and why, or
// returns nothing if the whole file is sound. Takes the parsed
// archive.json (`archive`) and the parsed games.json (`games`) - it needs
// the spine both to know which slugs actually have a page (rule b) and to
// know the earliest date the archive must stay before (rule e). Returns
// void: success is "did not throw".
//
// The checks run in the order below and this function throws on the very
// first one that fails, so two broken games in one file only ever report
// the earlier rule's problem first - fix that, run again, and the next
// rule's problem (if any) surfaces on its own. Each check is a full pass
// over every season and game before the next check begins, which is what
// makes that ordering exact regardless of which season or game the failure
// is actually in.
//
// (a) name: every name on every podium and bounty entry, in every game,
//     either matches the First L. pattern or is honest that it is really a
//     handle (nameIsAcceptable above; M4's exceptions live there). Checked
//     first because every later rule that reads a `name` (the distinct
//     count in c, the em dash check in h) assumes the name it is looking
//     at is already a name the site will actually print.
// (b) slug: every `slug` on every entry names a player with at least one
//     result on the spine (spineSlugs above). A slug for nobody's page
//     would link the archive to a 404.
// (c) entrants: when a game states `entrants`, it is never smaller than
//     the number of distinct `name` strings on that game's podium - a
//     turnout count that contradicts its own podium is not a real count.
// (d) date: no date appears on two games anywhere in the file. Checked
//     before (e) because a duplicate is a data-entry mistake independent
//     of where either copy falls relative to the spine, and deserves its
//     own message rather than being reported as an out-of-range date.
// (e) date range: every game's date is strictly before the earliest game
//     on the spine (`min(games.games[].date)`) - the archive is
//     specifically the games before the record, so a game dated on or
//     after the spine's first game belongs in games.json, not here.
// (f) bounty kind: every bounty's `kind` is one of the five keys of
//     BOUNTY_NAMES. Checked with `kind in BOUNTY_NAMES` rather than a
//     separately maintained list, so the vocabulary never has two
//     different sources of truth.
// (g) podium shape: a podium is at most three entries (spec §3.1: "a list
//     of up to three entries"), every place is 1, 2, or 3, and a game's
//     places never decrease from one podium entry to the next (two entries
//     can share a place - a chop - but a 2 can never come before a 1).
// (h) em dash: no name, no game note, no season note, and no season title
//     contains U+2014, matching the no-em-dash rule the rest of the site's
//     copy already follows (tools/lib/hope-coin.ts's route-name check does
//     the same thing for a different field). A name that only passes rule
//     (a) through its handle exception is still checked here - a handle
//     can itself contain an em dash even though it always equals its own
//     name. A season's `note` is checked here too (see ArchiveSeason's own
//     comment): the spec treats it as site copy exactly like a game's.
// (i) experiment: no game note and no season note contains the word
//     "experiment" (case insensitive, matching the site-wide grep in
//     docs/brand.md) - site copy never calls what the club does an
//     experiment, and a season note is site copy same as a game's.
// (j) structure: `seasons` is non-empty, every season's `games` list is
//     non-empty, and no two seasons share an `id`. Checked last because
//     nothing else in this function can fail without at least one season
//     holding at least one game to look at - by the time this file's
//     seasons and games are actually well formed enough to check anything
//     else, this is the one remaining way the file itself can still be
//     malformed.
//
// Throws: Error, naming the offending game by its `date`, or, for a fault
// that belongs to a season rather than any one game inside it (an em dash
// or the word "experiment" in a season's title or note, an empty games
// list, a repeated id), naming that season's `id` - matching the
// refuse-and-name voice of
// tools/lib/hope-coin.ts's validateCoinHistory: this message is what
// Charlie reads when a typed-up game refuses to pass, so it says what is
// wrong and where, not just that something is wrong.
export function validateArchive(archive: ArchiveData, games: GamesData): void {
  const knownSlugs = spineSlugs(games);

  // The earliest spine game's date (min(games.games[].date)), for rule (e).
  // Left undefined only if games.games itself is empty, which never
  // happens against the real site data; rule (e) simply cannot fire
  // without a date to compare against, so an empty spine here just means
  // that one rule is silently unenforceable rather than a crash.
  let earliestSpineDate: string | undefined;
  for (const game of games.games) {
    if (earliestSpineDate === undefined || game.date < earliestSpineDate) {
      earliestSpineDate = game.date;
    }
  }

  // (a) name.
  for (const season of archive.seasons) {
    for (const game of season.games) {
      for (const entry of [...game.podium, ...game.bounties]) {
        if (!nameIsAcceptable(entry)) {
          throw new Error(
            `Archive game ${game.date} has a name "${entry.name}" that is neither "First L." style nor ` +
            `equal to its own "handle". Fix the name to First L. form, or add "handle" equal to "name" ` +
            `if this entry really is a handle standing in for a name.`
          );
        }
      }
    }
  }

  // (b) slug.
  for (const season of archive.seasons) {
    for (const game of season.games) {
      for (const entry of [...game.podium, ...game.bounties]) {
        if (entry.slug !== undefined && !knownSlugs.has(entry.slug)) {
          throw new Error(
            `Archive game ${game.date} links slug "${entry.slug}", which has no result anywhere on the ` +
            `spine (games.json). Fix the slug, or remove it if this player never played a spine game - ` +
            `their name still prints, just without a link.`
          );
        }
      }
    }
  }

  // (c) entrants vs. distinct podium names.
  for (const season of archive.seasons) {
    for (const game of season.games) {
      if (game.entrants !== undefined) {
        const distinctPodiumNames = new Set(game.podium.map((p) => p.name)).size;
        if (game.entrants < distinctPodiumNames) {
          throw new Error(
            `Archive game ${game.date} has "entrants": ${game.entrants}, but its podium names ` +
            `${distinctPodiumNames} distinct players. entrants can never be fewer than the podium it ` +
            `backs. Fix the count, or fix the podium.`
          );
        }
      }
    }
  }

  // (d) duplicate dates, across the whole file.
  {
    const seenDates = new Set<string>();
    for (const season of archive.seasons) {
      for (const game of season.games) {
        if (seenDates.has(game.date)) {
          throw new Error(
            `Archive date ${game.date} appears on two different games. Every game's date must be unique ` +
            `across the whole file. Fix whichever game has the wrong date.`
          );
        }
        seenDates.add(game.date);
      }
    }
  }

  // (e) date range: strictly before the spine's earliest game.
  if (earliestSpineDate !== undefined) {
    for (const season of archive.seasons) {
      for (const game of season.games) {
        if (game.date >= earliestSpineDate) {
          throw new Error(
            `Archive game ${game.date} is not before the spine's earliest game (${earliestSpineDate}). ` +
            `The archive only holds games from before the record began; a game on or after that date ` +
            `belongs in games.json, not here.`
          );
        }
      }
    }
  }

  // (f) bounty kind.
  for (const season of archive.seasons) {
    for (const game of season.games) {
      for (const bounty of game.bounties) {
        if (!(bounty.kind in BOUNTY_NAMES)) {
          throw new Error(
            `Archive game ${game.date} has a bounty "kind" of "${bounty.kind}", which is not one of the ` +
            `five recognized kinds (${Object.keys(BOUNTY_NAMES).join(", ")}). Fix the kind, or add it to ` +
            `BOUNTY_NAMES if the club has genuinely started recording a new one.`
          );
        }
      }
    }
  }

  // (g) podium shape: at most three entries, place in range, places
  // non-decreasing.
  for (const season of archive.seasons) {
    for (const game of season.games) {
      if (game.podium.length > 3) {
        throw new Error(
          `Archive game ${game.date} has a podium of ${game.podium.length} entries. A podium is at most ` +
          `three (1st through 3rd): trim it to its top three, or move any extra name to "bounties" if ` +
          `that is what it really is.`
        );
      }
      let lastPlace = 0;
      for (const entry of game.podium) {
        if (entry.place < 1 || entry.place > 3) {
          throw new Error(
            `Archive game ${game.date} has a podium "place" of ${entry.place}, outside 1 to 3. A podium ` +
            `is 1st through 3rd, no more. Fix the place, or remove the entry if there is no third place.`
          );
        }
        if (entry.place < lastPlace) {
          throw new Error(
            `Archive game ${game.date} has podium places out of order: a ${lastPlace} is followed by a ` +
            `${entry.place}. Places must be non-decreasing (two entries may share a place for a chop, ` +
            `but a place may never drop back down). Reorder the podium.`
          );
        }
        lastPlace = entry.place;
      }
    }
  }

  // (h) em dash, in a name, a game note, a season note, or a season title.
  for (const season of archive.seasons) {
    if (season.title.includes("\u2014")) {
      throw new Error(
        `Archive season "${season.id}" has an em dash in its title "${season.title}". Site copy never ` +
        `uses one: use a comma, "to", or rewrite the title.`
      );
    }
    if (season.note !== undefined && season.note.includes("\u2014")) {
      throw new Error(
        `Archive season "${season.id}" has an em dash in its note "${season.note}". Site copy never ` +
        `uses one: use a comma, "to", or rewrite the note.`
      );
    }
    for (const game of season.games) {
      for (const entry of [...game.podium, ...game.bounties]) {
        if (entry.name.includes("\u2014")) {
          throw new Error(
            `Archive game ${game.date} has a name "${entry.name}" containing an em dash. Site copy never ` +
            `uses one: use a comma, "to", or rewrite the name.`
          );
        }
      }
      if (game.note !== undefined && game.note.includes("\u2014")) {
        throw new Error(
          `Archive game ${game.date} has an em dash in its note "${game.note}". Site copy never uses ` +
          `one: use a comma, "to", or rewrite the note.`
        );
      }
    }
  }

  // (i) the word "experiment", case insensitive (matching the site-wide
  // grep -i rule in docs/brand.md), in a game note or a season note.
  for (const season of archive.seasons) {
    if (season.note !== undefined && season.note.toLowerCase().includes("experiment")) {
      throw new Error(
        `Archive season "${season.id}" has the word "experiment" in its note "${season.note}". The word ` +
        `never appears in site copy (docs/brand.md): rewrite the note without it.`
      );
    }
    for (const game of season.games) {
      if (game.note !== undefined && game.note.toLowerCase().includes("experiment")) {
        throw new Error(
          `Archive game ${game.date} has the word "experiment" in its note "${game.note}". The word never ` +
          `appears in site copy (docs/brand.md): rewrite the note without it.`
        );
      }
    }
  }

  // (j) structure: non-empty seasons, non-empty games per season, unique
  // season ids.
  if (archive.seasons.length === 0) {
    throw new Error(
      `Archive has no seasons at all. A file with nothing in it is not a valid archive: add at least one ` +
      `season with at least one game, or do not ship the file yet.`
    );
  }
  const seenSeasonIds = new Set<string>();
  for (const season of archive.seasons) {
    if (season.games.length === 0) {
      throw new Error(
        `Archive season "${season.id}" has an empty "games" list. A season with nothing recorded in it ` +
        `should not be in the file yet: add its first game, or remove the season.`
      );
    }
    if (seenSeasonIds.has(season.id)) {
      throw new Error(
        `Archive has two seasons with the id "${season.id}". Every season's id must be unique across the ` +
        `file: rename one of them.`
      );
    }
    seenSeasonIds.add(season.id);
  }
}
