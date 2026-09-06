// Guards on the committed site/data/archive.json — the typed-up record of
// every game the club played BEFORE the data spine (site/data/games.json)
// begins on 2026-07-14: the 2020 PokerStars season, the 2025 season, and
// the four 2026 games that happened before the cards. Unlike
// tools/lib/archive.test.ts, which exercises validateArchive against
// synthetic fixtures, this file reads the REAL committed data file and the
// REAL README, so a mistyped date, a lost game, or a surname slipping into
// the repo fails the suite before it ships.
//
// The archive was typed once, by hand, from three sources that are NOT in
// this repo and never will be (a vault note and Mike's tracker hold real
// full names). That is exactly why these pins exist: nobody can re-derive
// the file from a source the repo contains, so the file itself is the
// record and the tests below are what stops it drifting.
//
// Run: bun test tools/archive.test.ts
import { describe, expect, test } from "bun:test";
import { validateArchive } from "./lib/archive";
import type { ArchiveData, ArchiveGame } from "./lib/archive";
import type { GamesData } from "./lib/standings";

const archiveText = await Bun.file(
  new URL("../site/data/archive.json", import.meta.url)
).text();
const archive = JSON.parse(archiveText) as ArchiveData;

const games = JSON.parse(
  await Bun.file(new URL("../site/data/games.json", import.meta.url)).text()
) as GamesData;

const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();

// The eight players who have a page on the site; only these eight ever
// carry a `slug` in the archive (M5). Everyone else in the archive played
// only pre-spine games, so their name prints without a link.
const SPINE_NAMES: Record<string, string> = {
  "Mike M.": "kmikeym",
  "Chris G.": "chris-g",
  "Nick M.": "nick-m",
  "Beau G.": "beau-g",
  "Amy M.": "amy-m",
  Gene: "webvee",
  "Thomas D.": "thomas-d",
  "Drew A.": "drew-a",
};

// Finds one game by date across every season. Throws rather than returning
// undefined so a spot-pin test below fails on the missing game with a
// readable message instead of on a property of `undefined`.
function gameOn(date: string): ArchiveGame {
  for (const season of archive.seasons) {
    for (const game of season.games) if (game.date === date) return game;
  }
  throw new Error(`No archive game dated ${date}`);
}

// Every podium entry and every bounty entry in the whole file, flattened,
// for the file-wide slug sweep (leg i).
function allEntries() {
  return archive.seasons.flatMap((s) =>
    s.games.flatMap((g) => [...g.podium, ...g.bounties])
  );
}

// (a) The validator the data module owns, run against the real pair of
// files: names, slugs, entrant counts, dates, bounty kinds, podium shape,
// em dashes, and the word "experiment", all checked at once [M1].
test("validateArchive accepts the committed archive against the committed spine", () => {
  expect(() => validateArchive(archive, games)).not.toThrow();
});

// (b) The three seasons, in file order, with the exact titles and notes the
// page prints. Charlie: if you add a season, this test is where its title
// and note get pinned [M2].
describe("seasons", () => {
  test("ids, titles, and notes are exactly the three the page prints", () => {
    expect(archive.seasons.map((s) => s.id)).toEqual(["2026-pre", "2025", "2020"]);
    expect(archive.seasons.map((s) => s.title)).toEqual([
      "2026, before the cards",
      "2025",
      "2020",
    ]);
    expect(archive.seasons.map((s) => s.note)).toEqual([
      "No result was recorded for January. May was a cash game, not a tournament.",
      "November was not recorded. December's result never reached the notes.",
      "PokerStars, twenty-dollar buy-ins, points seasons. These are the games the record holds.",
    ]);
  });
});

// (c) Every date in every season, element by element, so a missing game, an
// extra game, or a typo in one date fails here and names the season [M3].
describe("game dates", () => {
  const expected: Record<string, string[]> = {
    "2026-pre": ["2026-02-10", "2026-03-10", "2026-04-14", "2026-06-09"],
    "2025": [
      "2025-01-14",
      "2025-02-11",
      "2025-03-11",
      "2025-04-08",
      "2025-05-13",
      "2025-06-10",
      "2025-07-08",
      "2025-08-12",
      "2025-09-09",
      "2025-10-14",
    ],
    "2020": [
      "2020-04-21",
      "2020-04-23",
      "2020-05-06",
      "2020-05-12",
      "2020-05-22",
      "2020-05-26",
      "2020-06-09",
      "2020-06-16",
      "2020-06-23",
      "2020-06-30",
      "2020-07-07",
      "2020-07-14",
      "2020-07-21",
      "2020-07-28",
      "2020-08-04",
      "2020-08-11",
      "2020-08-18",
      "2020-08-25",
      "2020-09-01",
      "2020-09-08",
      "2020-09-15",
      "2020-09-22",
      "2020-09-29",
      "2020-10-06",
      "2020-10-13",
      "2020-10-20",
      "2020-10-27",
      "2020-11-04",
      "2020-11-10",
      "2020-11-17",
    ],
  };
  for (const [id, dates] of Object.entries(expected)) {
    test(`season ${id} holds exactly ${dates.length} games, on exactly those dates`, () => {
      const season = archive.seasons.find((s) => s.id === id);
      expect(season).toBeDefined();
      expect(season!.games.length).toBe(dates.length);
      expect(season!.games.map((g) => g.date).sort()).toEqual(dates);
    });
  }
});

// (d) through (h) are spot pins: one game per shape the archive has to be
// able to hold. Between them they cover a full three-name podium with a
// long bounty list, a game with handles, a chop, a podium with no third
// place, a two-name podium, and a night nobody scored [M4].

// (d) The busiest 2025 night: three podium places and six bounties,
// including one player holding two roles and a handle-only entry.
test("2025-01-14 is the January game, entrants and every bounty", () => {
  expect(gameOn("2025-01-14")).toEqual({
    date: "2025-01-14",
    entrants: 7,
    podium: [
      { place: 1, name: "Chris G.", slug: "chris-g" },
      { place: 2, name: "Josh B." },
      { place: 3, name: "Amy M.", slug: "amy-m" },
    ],
    bounties: [
      { kind: "hope-slayer", name: "Chris G.", slug: "chris-g" },
      { kind: "cain", name: "Josh B." },
      { kind: "bubble", name: "Mike M.", slug: "kmikeym" },
      { kind: "seven-deuce", name: "Matt W." },
      { kind: "seven-deuce", name: "Beau G.", slug: "beau-g" },
      { kind: "seven-deuce", name: "jfe", handle: "jfe" },
    ],
  });
});

// (e) The April 2026 game: the one archive game whose podium carries
// handles as well as slugs, plus a bounty holder with a handle and no page.
test("2026-04-14 keeps its handles alongside its slugs", () => {
  expect(gameOn("2026-04-14")).toEqual({
    date: "2026-04-14",
    entrants: 9,
    podium: [
      { place: 1, name: "Beau G.", handle: "bg", slug: "beau-g" },
      { place: 2, name: "Drew A.", handle: "MoHDI_Drew", slug: "drew-a" },
      { place: 3, name: "Mike M.", handle: "kmikeym", slug: "kmikeym" },
    ],
    bounties: [
      { kind: "bubble", name: "Michael Z.", handle: "pokermichi" },
      { kind: "hope-slayer", name: "Nick M.", handle: "nickmershon", slug: "nick-m" },
    ],
  });
});

// (f) The chop: two entries share place 1 and the note says so in words.
// No entrant count was recorded that night, so the key is absent entirely
// rather than zero or null (the page prints nothing at all for it).
test("2026-03-10 is a chop, with no entrant count", () => {
  const game = gameOn("2026-03-10");
  expect("entrants" in game).toBe(false);
  expect(game.podium).toEqual([
    { place: 1, name: "Beau G.", handle: "bg", slug: "beau-g" },
    { place: 1, name: "Matt W.", handle: "mawgators" },
  ]);
  expect(game.bounties).toEqual([]);
  expect(game.note).toBe("Beau G. and Matt W. chopped.");
});

// (g) June 2026: a plain three-name podium from the tracker, no handles,
// no bounties recorded.
test("2026-06-09 has seven entrants and its three podium names", () => {
  const game = gameOn("2026-06-09");
  expect(game.entrants).toBe(7);
  expect(game.podium).toEqual([
    { place: 1, name: "Nick M.", slug: "nick-m" },
    { place: 2, name: "Chris G.", slug: "chris-g" },
    { place: 3, name: "Beau G.", slug: "beau-g" },
  ]);
});

// (h) Three shapes from the 2020 season: the first game ever, a night that
// paid only two spots, and the finale nobody scored.
describe("2020 spot pins", () => {
  test("2020-04-21, the first game in the record", () => {
    const game = gameOn("2020-04-21");
    expect(game.entrants).toBe(6);
    expect(game.podium).toEqual([
      { place: 1, name: "Drew A.", slug: "drew-a" },
      { place: 2, name: "Gene", slug: "webvee" },
      { place: 3, name: "Beau G.", slug: "beau-g" },
    ]);
  });
  test("2020-11-04 paid two spots, so the podium has two entries", () => {
    const game = gameOn("2020-11-04");
    expect(game.entrants).toBe(6);
    expect(game.podium).toEqual([
      { place: 1, name: "Kevin L." },
      { place: 2, name: "Nick M.", slug: "nick-m" },
    ]);
  });
  test("2020-11-17 was played but never scored", () => {
    const game = gameOn("2020-11-17");
    expect(game.entrants).toBe(5);
    expect(game.podium).toEqual([]);
    expect(game.note).toBe("Result not recorded.");
  });
});

// (i) The slug rule, swept over the whole file: a slug only ever names one
// of the eight players with a page, every appearance of one of those eight
// names carries their slug (so no player silently loses their link), and
// the two roster-only players never get one, because they have no results
// on the spine and their page does not exist [M5].
describe("slugs", () => {
  test("every slug is one of the eight players with a page", () => {
    const slugs = new Set(allEntries().flatMap((e) => (e.slug ? [e.slug] : [])));
    expect([...slugs].sort()).toEqual(
      [...new Set(Object.values(SPINE_NAMES))].sort()
    );
  });
  test("every appearance of one of those eight names carries their slug", () => {
    for (const entry of allEntries()) {
      const expected = SPINE_NAMES[entry.name];
      if (expected !== undefined) expect(entry.slug).toBe(expected);
    }
  });
  test("Josh B. and Matt W. never carry a slug (no spine results, no page)", () => {
    for (const entry of allEntries()) {
      expect(entry.slug === "josh-b" || entry.slug === "matt-w").toBe(false);
    }
  });
});

// (j) Canonical JSON, the same rule games.json follows: the file is written
// through parse and stringify so a new game lands as a small diff Charlie
// can actually read in a PR [M6].
test("archive.json is in canonical two-space JSON with a trailing newline", () => {
  expect(archiveText).toBe(JSON.stringify(JSON.parse(archiveText), null, 2) + "\n");
});

// (k) The README keeps one link, not a second copy of the record. Its old
// thirty-row 2020 table now lives on the archive page, and nothing in the
// README may quietly grow back into a results table [M7].
describe("README archive section", () => {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l === "## Archive");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);

  test("the section is a heading, a sentence, and the archive link", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(section.join("\n").split("https://poker.kmikeym.com/archive/").length - 1).toBe(1);
    expect(section.filter((l) => l.startsWith("|"))).toEqual([]);
    expect(section.filter((l) => l.trim() !== "").length).toBeLessThanOrEqual(3);
  });
  test("no 2020 game is left in a table anywhere in the README", () => {
    expect(lines.filter((l) => l.startsWith("|") && l.includes("2020"))).toEqual([]);
    expect(readme.match(/2020-\d{2}-\d{2}/g)).toBe(null);
  });
});
