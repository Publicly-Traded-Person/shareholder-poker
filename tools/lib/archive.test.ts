// Tests for tools/lib/archive.ts: BOUNTY_NAMES and validateArchive, the
// shape and guard for the not-yet-written site/data/archive.json. Every
// fixture here is synthetic (invented names, invented slugs, invented
// dates) per the repo's privacy rule for committed test data; nothing here
// reads a real site/data file, because archive.json does not exist yet
// (a later task writes the first one and runs this validator against it).
//
// Run: bun test tools/lib/archive.test.ts

import { describe, expect, test } from "bun:test";
import { BOUNTY_NAMES, validateArchive } from "./archive";
import type { ArchiveData, ArchiveGame } from "./archive";
import type { GamesData } from "./standings";

// --- fixture builders ----------------------------------------------------

// One archive game with the two required fields defaulted to empty, so a
// test only has to spell out the field it actually cares about. `date` is
// always required since every rule below is named by it.
function game(overrides: Partial<ArchiveGame> & { date: string }): ArchiveGame {
  return { podium: [], bounties: [], ...overrides };
}

// Wraps a list of games into a single one-season ArchiveData. Good enough
// for every test below except the M2 fixture and the season-structure
// tests (l), which build their own seasons list to control season count,
// ids, and titles directly.
function archiveOf(...games: ArchiveGame[]): ArchiveData {
  return { seasons: [{ id: "test-season", title: "Test Season", games }] };
}

// A minimal GamesData spine: one game, dated 2026-07-01 (after every
// invented archive date below), carrying a result for each slug named in
// `slugs` and no others. This is the "minimal GamesData literal whose one
// game carries results for the slugs the fixture links" the brief calls
// for; tests that need no slug at all just call spine() with none.
function spine(...slugs: string[]): GamesData {
  return {
    nextGame: { date: "2099-01-01", time: "7:00pm PT" },
    hopeCoin: { holder: "nobody", since: "2026-07-01" },
    players: [],
    games: [
      {
        date: "2026-07-01",
        hands: 1,
        startingStack: 5000,
        buyIn: 40,
        entries: Math.max(slugs.length, 1),
        pot: 40,
        results: slugs.map((slug, i) => ({
          slug,
          handle: slug,
          finish: i + 1,
          payout: 0,
          rebuys: 0,
          trophies: [],
        })),
      },
    ],
  };
}

// The M2 fixture: a two-season archive that between its three games uses
// every field the type allows (see the comment on the test below for the
// checklist). Kept as a function, not a constant, so the mutation test in
// leg (b) can structuredClone it without worrying about a shared reference.
function fullFieldFixture(): ArchiveData {
  return {
    seasons: [
      {
        id: "founding-era",
        title: "The Founding Era",
        games: [
          game({
            date: "1999-03-01",
            entrants: 6, // present
            podium: [
              // podium of three, one slugged entry
              { place: 1, name: "Ada W.", handle: "adaw", slug: "ada-w" },
              { place: 2, name: "Bly R.", handle: "blyr" },
              { place: 3, name: "K5M Guy", handle: "K5M Guy" }, // handle-only entry
            ],
            bounties: [
              { kind: "hope-slayer", name: "Cy T.", handle: "cyt" },
              { kind: "cain", name: "Ada W.", handle: "adaw", slug: "ada-w" },
            ],
          }),
          game({
            date: "1999-04-01",
            // entrants absent
            podium: [], // empty podium
            bounties: [
              { kind: "seven-deuce", name: "Bly R.", handle: "blyr" },
              { kind: "bubble", name: "Cy T.", handle: "cyt" },
              { kind: "kevin-deuce", name: "Gene" }, // bare first name, no initial
            ],
          }),
        ],
      },
      {
        id: "second-era",
        title: "The Second Era",
        games: [
          game({
            date: "2000-01-01",
            entrants: 2,
            podium: [
              // chop: two entries at place 1
              { place: 1, name: "Ada W.", handle: "adaw", slug: "ada-w" },
              { place: 1, name: "Bly R.", handle: "blyr" },
            ],
            bounties: [],
          }),
        ],
      },
    ],
  };
}

describe("BOUNTY_NAMES", () => {
  // [a, M1] Pins the exact five-kind vocabulary. Written as a Set of
  // "kind:name" pairs, compared order-independently, per the brief ("in
  // any order"), plus a length check so a sixth key added anywhere still
  // fails even if it happens to sort after the five expected pairs.
  test("maps exactly the five recognized kinds to their display names", () => {
    const actual = new Set(Object.entries(BOUNTY_NAMES).map(([k, v]) => `${k}:${v}`));
    const expected = new Set([
      "hope-slayer:Hope Slayer",
      "cain:Cain and Abel",
      "seven-deuce:2-7 Showdown",
      "bubble:The Bubble",
      "kevin-deuce:Kevin Deuce",
    ]);
    expect(actual).toEqual(expected);
    expect(Object.keys(BOUNTY_NAMES).length).toBe(5);
  });
});

describe("validateArchive: M2 - the full-field fixture passes, and the pass is not vacuous", () => {
  // [b, M2] The fixture above touches every field the M2 checklist names:
  // entrants present (6, 2) and absent (1999-04-01); a podium of three
  // (1999-03-01); a chop of two entries at place 1 (2000-01-01); an empty
  // podium (1999-04-01); a slugged entry (ada-w, present with a matching
  // spine result); a handle-only entry ("K5M Guy"); and all five bounty
  // kinds spread across the two games that carry any. It must pass as is.
  test("the fixture returns without throwing", () => {
    expect(() => validateArchive(fullFieldFixture(), spine("ada-w"))).not.toThrow();
  });

  // The same fixture, mutated to lowercase one podium name with nothing
  // else changed, must throw. This is the check that the test above is
  // not vacuously passing on a validator that never actually looks at the
  // data (a validator that always returns would also pass the first test).
  test("the same fixture with one podium name corrupted to lowercase throws", () => {
    const corrupted = structuredClone(fullFieldFixture());
    corrupted.seasons[0].games[0].podium[0].name = "ada w.";
    expect(() => validateArchive(corrupted, spine("ada-w"))).toThrow();
  });
});

describe("validateArchive: M3 - the nine per-file rules, each isolated", () => {
  // [c] rule (a): a name failing the First L. pattern with no handle to
  // excuse it throws, naming the game's date.
  test("M3(a): a name failing the First L. pattern with no handle throws, naming the date", () => {
    const data = archiveOf(game({ date: "1999-05-01", podium: [{ place: 1, name: "ada w" }] }));
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-01/);
  });

  // [d] rule (b): a slug naming no result anywhere on the spine throws,
  // naming the date. The spine here does carry a result, just for a
  // different slug ("ada-w"), so the failure is specifically about
  // "nobody" being unknown, not about the spine being empty.
  test("M3(b): a slug naming no spine result throws, naming the date", () => {
    const data = archiveOf(
      game({ date: "1999-05-02", podium: [{ place: 1, name: "Ada W.", slug: "nobody" }] })
    );
    expect(() => validateArchive(data, spine("ada-w"))).toThrow(/1999-05-02/);
  });

  // [e] rule (c): entrants smaller than the podium's distinct name count
  // throws, naming the date.
  test("M3(c): entrants smaller than the podium's distinct names throws, naming the date", () => {
    const data = archiveOf(
      game({
        date: "1999-05-03",
        entrants: 2,
        podium: [
          { place: 1, name: "Ada W." },
          { place: 2, name: "Bly R." },
          { place: 3, name: "Cy T." },
        ],
      })
    );
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-03/);
  });

  // [f] rule (d): the same date on two games throws, naming it. Both
  // games are otherwise empty (no podium, no bounties) so only the
  // duplicate-date rule can be the one that fires.
  test("M3(d): the same date on two games throws, naming it", () => {
    const data = archiveOf(game({ date: "1999-05-04" }), game({ date: "1999-05-04" }));
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-04/);
  });

  // [g] rule (e): a game dated on or after the spine's earliest game
  // throws, naming it; the day before passes. spine()'s one game is
  // dated 2026-07-01, so that is the boundary under test.
  test("M3(e): a game dated on or after the spine's earliest game throws, naming it; the day before passes", () => {
    const onEarliest = archiveOf(game({ date: "2026-07-01" }));
    expect(() => validateArchive(onEarliest, spine())).toThrow(/2026-07-01/);

    const dayBefore = archiveOf(game({ date: "2026-06-30" }));
    expect(() => validateArchive(dayBefore, spine())).not.toThrow();
  });

  // [h] rule (f): a bounty kind outside the five recognized kinds throws,
  // naming the date. The kind is deliberately outside the BountyKind
  // union, so the fixture is built as a plain object and cast, the same
  // way tools/portraits.test.ts constructs deliberately-invalid fixtures.
  test("M3(f): a bounty kind outside the five recognized kinds throws, naming the date", () => {
    const data = {
      seasons: [
        {
          id: "test-season",
          title: "Test Season",
          games: [
            {
              date: "1999-05-05",
              podium: [],
              bounties: [{ kind: "chop", name: "Ada W." }],
            },
          ],
        },
      ],
    } as unknown as ArchiveData;
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-05/);
  });

  // [i] rule (g): podium places out of order, a place outside 1 to 3, or
  // more than three podium entries, each throw naming the date; a
  // legitimate three-entry chop still passes. The out-of-range place (4)
  // is outside the 1 | 2 | 3 union, so that fixture is built and cast the
  // same way as the bounty-kind test above.
  test("M3(g): podium places out of order, outside 1 to 3, or more than three entries, throw naming the date", () => {
    const outOfOrder = archiveOf(
      game({
        date: "1999-05-06",
        podium: [
          { place: 2, name: "Ada W." },
          { place: 1, name: "Bly R." },
        ],
      })
    );
    expect(() => validateArchive(outOfOrder, spine())).toThrow(/1999-05-06/);

    const outOfRange = {
      seasons: [
        {
          id: "test-season",
          title: "Test Season",
          games: [{ date: "1999-05-07", podium: [{ place: 4, name: "Ada W." }], bounties: [] }],
        },
      ],
    } as unknown as ArchiveData;
    expect(() => validateArchive(outOfRange, spine())).toThrow(/1999-05-07/);

    // Four entries, every place valid (1, 2, 3, 3) and non-decreasing:
    // only the too-many-entries check (spec §3.1's "up to three") can be
    // the one that fires here.
    const tooMany = archiveOf(
      game({
        date: "1999-05-19",
        podium: [
          { place: 1, name: "Ada W." },
          { place: 2, name: "Bly R." },
          { place: 3, name: "Cy T." },
          { place: 3, name: "Dee S." },
        ],
      })
    );
    expect(() => validateArchive(tooMany, spine())).toThrow(/1999-05-19/);

    // A three-entry chop at the top (two names sharing place 1, plus a
    // third place) is exactly the shape spec §3 describes for a chop and
    // must still pass: it is neither out of order nor over the limit.
    const chopAtTop = archiveOf(
      game({
        date: "1999-05-20",
        podium: [
          { place: 1, name: "Ada W." },
          { place: 1, name: "Bly R." },
          { place: 3, name: "Cy T." },
        ],
      })
    );
    expect(() => validateArchive(chopAtTop, spine())).not.toThrow();
  });

  // [j] rule (h): an em dash in a name, a game note, a season note, or a
  // season title, each throw. The name case gives the entry a handle
  // equal to its own (em-dash-carrying) name, so rule (a)'s handle
  // exception lets the name rule pass and the failure actually exercises
  // the em-dash rule rather than being caught earlier by the name-pattern
  // check. A season's `note` is site copy exactly like a game's own note
  // (spec §3.2, §4.3), so it is checked here too, naming the season's id
  // the same way the title case already does.
  test("M3(h): an em dash in a name, a game note, a season note, or a season title throws, naming the game or the season", () => {
    const inName = archiveOf(
      game({
        date: "1999-05-08",
        podium: [{ place: 1, name: "K5M—Guy", handle: "K5M—Guy" }],
      })
    );
    expect(() => validateArchive(inName, spine())).toThrow(/1999-05-08/);

    const inNote = archiveOf(game({ date: "1999-05-09", note: "Held at Ada—W.'s place." }));
    expect(() => validateArchive(inNote, spine())).toThrow(/1999-05-09/);

    const inTitle: ArchiveData = {
      seasons: [
        {
          id: "em-dash-season",
          title: "The 1999—Season",
          games: [game({ date: "1999-05-10" })],
        },
      ],
    };
    expect(() => validateArchive(inTitle, spine())).toThrow(/em-dash-season/);

    const inSeasonNote: ArchiveData = {
      seasons: [
        {
          id: "em-dash-note-season",
          title: "Test Season",
          note: "December's result never reached the notes—so this season has a gap.",
          games: [game({ date: "1999-05-17" })],
        },
      ],
    };
    expect(() => validateArchive(inSeasonNote, spine())).toThrow(/em-dash-note-season/);
  });

  // [k] rule (i): the word "experiment" in a game note or a season note
  // throws, naming the game's date or the season's id respectively.
  // Checked case-insensitively to match the site-wide `grep -i` rule in
  // docs/brand.md, so a capitalized "Experiment" is covered too.
  test('M3(i): the word "experiment" in a game note or a season note throws, naming the game or the season', () => {
    const data = archiveOf(
      game({ date: "1999-05-11", note: "This was an Experiment in scheduling." })
    );
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-11/);

    const inSeasonNote: ArchiveData = {
      seasons: [
        {
          id: "experiment-note-season",
          title: "Test Season",
          note: "This season was an experiment in scheduling.",
          games: [game({ date: "1999-05-18" })],
        },
      ],
    };
    expect(() => validateArchive(inSeasonNote, spine())).toThrow(/experiment-note-season/);
  });

  // [l] rule (j): an empty seasons list throws; a season with an empty
  // games list throws naming its id; two seasons sharing an id throw
  // naming it.
  test("M3(j): an empty seasons list, a season with no games, or a duplicate season id throws", () => {
    expect(() => validateArchive({ seasons: [] }, spine())).toThrow();

    const emptyGames: ArchiveData = {
      seasons: [{ id: "empty-season", title: "Empty Season", games: [] }],
    };
    expect(() => validateArchive(emptyGames, spine())).toThrow(/empty-season/);

    const dup: ArchiveData = {
      seasons: [
        { id: "2025", title: "First 2025", games: [game({ date: "1999-05-12" })] },
        { id: "2025", title: "Second 2025", games: [game({ date: "1999-05-13" })] },
      ],
    };
    expect(() => validateArchive(dup, spine())).toThrow(/2025/);
  });
});

describe("validateArchive: M4 - the name rule's two exceptions", () => {
  // [m] A bare first name with no initial passes; a display name equal to
  // its own handle passes; the same display name with no handle to excuse
  // it throws, naming the date.
  test('name: "Gene" with no initial passes', () => {
    const data = archiveOf(game({ date: "1999-05-14", podium: [{ place: 1, name: "Gene" }] }));
    expect(() => validateArchive(data, spine())).not.toThrow();
  });

  test('name: "K5M Guy" passes when handle: "K5M Guy" matches it exactly', () => {
    const data = archiveOf(
      game({ date: "1999-05-15", podium: [{ place: 1, name: "K5M Guy", handle: "K5M Guy" }] })
    );
    expect(() => validateArchive(data, spine())).not.toThrow();
  });

  test('name: "K5M Guy" with no handle throws, naming the date', () => {
    const data = archiveOf(game({ date: "1999-05-16", podium: [{ place: 1, name: "K5M Guy" }] }));
    expect(() => validateArchive(data, spine())).toThrow(/1999-05-16/);
  });
});
