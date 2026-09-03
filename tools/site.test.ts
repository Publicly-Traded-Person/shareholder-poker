// Invariants over the committed HTML in site/. These run against the REAL
// pages (not fixtures) so a bad edit fails the suite before it deploys.
// Sits beside the publish flow as a standing guard; run: bun test tools.
// Tasks add per-page describe blocks below the site-wide rules; keep new
// blocks additive and self-contained so they merge cleanly.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { CardRef, GamesData } from "./lib/standings";
import { playerSlugs } from "./render";

// Recursively lists every committed .html file under site/.
export function siteHtmlFiles(
  dir = new URL("../site", import.meta.url).pathname
): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...siteHtmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Reads one page as text; every page block below goes through this.
export const readPage = (p: string) => readFileSync(p, "utf8");

// Returns the text inside each <!-- ... --> block of an XML/SVG source, so a
// caller can check the XML comment rules against those interiors alone. Takes
// the raw file text; returns one string per comment, in document order (an
// empty array when there are no comments). Throws nothing: an unterminated
// comment yields the rest of the document, which fails the same checks a
// malformed comment would, so a truncated file cannot pass by accident.
export function commentInteriors(xml: string): string[] {
  const OPEN = "<!--";
  const CLOSE = "-->";
  const out: string[] = [];
  let i = xml.indexOf(OPEN);
  while (i !== -1) {
    const start = i + OPEN.length;
    const end = xml.indexOf(CLOSE, start);
    // Slice stops before CLOSE so the delimiter's own hyphens are not counted
    // as content; they are legal exactly where they close the comment.
    out.push(end === -1 ? xml.slice(start) : xml.slice(start, end));
    if (end === -1) break;
    i = xml.indexOf(OPEN, end + CLOSE.length);
  }
  return out;
}

describe("site-wide copy rules (the pre-merge greps, now permanent)", () => {
  const pages = siteHtmlFiles();
  // Accumulate-and-assert instead of a for-loop `expect` per page: a for-loop
  // assertion stops at the first failure and reports only true/false, not
  // which file broke. Filtering to the offending paths first means a failure
  // names the page, so Charlie does not have to bisect the site by hand.
  test("no em dash in any committed page", () => {
    expect(pages.filter((p) => readPage(p).includes("\u2014"))).toEqual([]);
  });
  test("the banned word never appears", () => {
    expect(
      pages.filter((p) => readPage(p).toLowerCase().includes("experiment"))
    ).toEqual([]);
  });
  // Every committed page must link the favicon with this exact tag. By the
  // time this task's REDIRECT lands, every page task (2, 4, 5, 6, 8) has
  // already merged its own favicon tag, so this is green on arrival; it is
  // here to catch the next new page that forgets it.
  test("every page carries the favicon tag", () => {
    expect(
      pages.filter(
        (p) =>
          !readPage(p).includes(
            '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
          )
      )
    ).toEqual([]);
  });
});

describe("utility pages carry the favicon", () => {
  // The standalone chip-race pages were folded into the game pages
  // (2026-08-26); their favicon coverage moved to the game-page shell tests.
  for (const rel of [
    "../site/404.html",
  ]) {
    test(rel, () =>
      expect(readPage(new URL(rel, import.meta.url).pathname)).toContain(
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
      ));
  }
});

// A standalone .svg is served as image/svg+xml and parsed by the browser's
// STRICT XML parser, not the forgiving HTML one. One well-formedness error and
// the icon simply never paints: no console error a visitor would see, no other
// test failing, just an empty tab. That silence is why this needs a guard.
// The rule that actually bit us (XML 1.0 section 2.5): the string "--" must
// never appear inside a comment, so the CSS variable names cannot be written
// with their leading hyphens in the header comment.
// Scope: this is a comment-rule check on the one SVG this repo ships, not a
// general XML validator; Bun has no DOMParser and the repo has no XML dep.
describe("favicon.svg is well-formed XML", () => {
  const faviconPath = new URL("../site/favicon.svg", import.meta.url).pathname;

  test("no comment contains a double hyphen", () => {
    const offenders = commentInteriors(readPage(faviconPath)).filter((c) =>
      c.includes("--")
    );
    expect(offenders).toEqual([]);
  });

  test("every comment is terminated", () => {
    const svg = readPage(faviconPath);
    expect(svg.split("<!--").length - 1).toBe(svg.split("-->").length - 1);
  });

  test("the spade still paints on felt", () => {
    const svg = readPage(faviconPath);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#101216"'); // felt
    expect(svg).toContain('fill="#c9a227"'); // foil
  });
});

// Task 4: home page invariants. Guards the design-pass rework of
// site/index.html (wide foil band, holo card, one lime button, unfurl tags).
describe("home page invariants", () => {
  const html = readPage(new URL("../site/index.html", import.meta.url).pathname);
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("exactly one lime button (brand: one lime action per page)", () =>
    expect(html.split("btn-primary").length - 1).toBe(1));
  test("marks Home current in the nav", () =>
    expect(html).toContain('<a href="/" aria-current="page">'));
  test("carries link-unfurl tags", () =>
    expect(html).toContain('property="og:image"'));
  test("loads the holo script", () =>
    expect(html).toContain('src="/holo.js"'));
  // Task 2 additions (2026-08-26 bounty/news/fan pass): the restructured
  // home page loads the runtime fact-filler, carries exactly two bounty
  // notices, runs its news tiles three-up, and opens with the card fan.
  test("loads the home facts script", () =>
    expect(html).toContain('src="/home-facts.js"'));
  test("posts exactly two bounty notices", () =>
    expect(html.split('class="notice ').length - 1).toBe(2));
  test("news band is the three-up tile band", () =>
    expect(html).toContain('tiles tiles--3'));
  test("hero carries the card fan", () =>
    expect(html).toContain('class="card-fan"'));
  // Cross-boundary invariant guard (2026-08-26 redirect): home-facts.js
  // restates tools/lib/standings.ts's skull tally in browser JS (site/ has
  // no build step, so it cannot import the Bun TypeScript module) and both
  // files match on the literal trophy string "hope-slayer" by convention,
  // not by any shared constant. Renaming the trophy in one file without the
  // other would silently empty the bounty board's skull tally while
  // standings kept counting correctly (or vice versa) — this test fails
  // loudly instead. If this ever needs to change, update both home-facts.js
  // and tools/lib/standings.ts in the same commit.
  test("home-facts.js still keys its skull tally off \"hope-slayer\"", () => {
    const facts = readPage(
      new URL("../site/home-facts.js", import.meta.url).pathname
    );
    expect(facts).toContain('"hope-slayer"');
  });

  // Task 9 (spec §5.3, M5): the Hope Coin section's closing button now
  // points at the Coin's own page instead of Standings. Line 82's separate
  // "Standings and trophies" button and the footer's Standings link are
  // untouched by this task and stay pointed at /standings/ - this test only
  // guards the one button this task was told to move.
  test("the Hope Coin section's closing button points at /hope-coin/, not Standings (M5)", () => {
    expect(html).toContain('href="/hope-coin/"');
    expect(html).not.toContain('href="/standings/">The full record');
    // Still exactly one lime button on the page (the RSVP CTA) - moving
    // this button used btn-secondary, same as before, so this never touched
    // the lime count, but the brief is explicit that the count stays 1.
    expect(html.split("btn-primary").length - 1).toBe(1);
  });
});

// Task 5: the set page (site/cards/2026-07/index.html) drops emoji chrome,
// the pack-rip gif, and boxed captions in favor of the shared .card-caption
// / .mark classes from Task 1 and the holo effect from Task 3.
describe("set page invariants (2026-07)", () => {
  const html = readPage(
    new URL("../site/cards/2026-07/index.html", import.meta.url).pathname
  );
  test("no emoji chrome", () => {
    for (const e of ["\u2728", "\u2b50", "\u25c6", "\u25cf", "\u{1FA99}"])
      expect(html).not.toContain(e);
  });
  test("captions are unboxed card-caption lines", () =>
    expect(html).toContain('class="card-caption"'));
  test("the pack rip gif is gone", () =>
    expect(html).not.toContain("pack-rip.gif"));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
});

// Task 6: /cards/ becomes a set gallery (six Set 1 thumbnails + a drawn
// "in production" card back for Set 2) instead of a plain bullet list.
describe("cards index gallery", () => {
  const html = readPage(
    new URL("../site/cards/index.html", import.meta.url).pathname
  );
  // Counts <img src="..."> tags specifically (not a bare substring match):
  // the og:image meta tag below also points into this same assets/ folder,
  // and a loose substring count would double-count it as a seventh thumbnail.
  test("shows all six Set 1 thumbnails", () =>
    expect(html.split('<img src="/cards/2026-07/assets/').length - 1).toBe(6));
  test("teases Set 2 with a drawn card back", () =>
    expect(html).toContain('class="card-back"'));
  test("links the favicon", () =>
    expect(html).toContain('href="/favicon.svg"'));
  test("marks Cards current in the nav", () =>
    expect(html).toContain('<a href="/cards/" aria-current="page">'));
  test("carries link-unfurl tags (promo week needs a working preview card)", () =>
    expect(html).toContain('property="og:image"'));
});

// Task 8: game pages get the shared shell (lens pills, stat-strip chip,
// notes-table variant, favicon) so docs/publishing.md can tell Charlie to
// copy the newest game page and get all of it for free.
describe("game page shells", () => {
  // Enumerated from the directory, not a list: the September page must get
  // every one of these checks the day it lands, without anyone editing here.
  for (const date of gameDates()) {
    const rel = `../site/games/${date}/index.html`;
    const html = readPage(new URL(rel, import.meta.url).pathname);
    test(`${rel} has the lens pills`, () =>
      expect(html).toContain('class="pills"'));
    test(`${rel} uses the notes table variant`, () =>
      expect(html).toContain("ledger ledger--notes"));
    test(`${rel} has the stat strip`, () =>
      expect(html).toContain("stat-strip"));
    test(`${rel} links the favicon`, () =>
      expect(html).toContain('href="/favicon.svg"'));
    test(`${rel} carries link-unfurl tags`, () =>
      expect(html).toContain('property="og:image"'));
    test(`${rel} embeds the chip race between injection markers`, () => {
      expect(html).toContain("CHIP-RACE:START");
      expect(html).toContain("CHIP-RACE:END");
      expect(html).toContain('class="chip-race"');
      expect(html).toContain('class="chip-legend"');
    });
    test(`${rel} pills link the in-page chart anchor, not a retired page`, () => {
      expect(html).toContain('href="#chip-race"');
      expect(html).not.toContain('href="chip-race.html"');
    });
  }
});

// ---------------------------------------------------------------------------
// Issue #12: the unfurl tags are hand-written chrome that references things
// which ship LATER (a card set is minted after the game page it belongs to),
// so nothing at write time can point at them and nothing at ship time looks.
// The August 2026 page went out with July's foil as its share image and the
// suite passed, because it only checked that an og:image tag existed. These
// blocks make each tag answer for its own page.

const SITE = new URL("../site/", import.meta.url).pathname;
const ORIGIN = "https://poker.kmikeym.com";

// Every game page directory under site/games/, by date. Shared by the shell
// block above and the unfurl block below.
function gameDates(): string[] {
  return readdirSync(join(SITE, "games")).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
}

// The content of one <meta property="..."> tag, or null when absent.
function metaProp(html: string, prop: string): string | null {
  const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
  return m ? m[1] : null;
}

describe("link-unfurl tags answer for their own page (#12)", () => {
  const data = JSON.parse(readFileSync(join(SITE, "data/games.json"), "utf8")) as GamesData;

  // og:url is per page. When Charlie copies the newest game page for a new
  // month (the runbook's instruction), a stale og:url would otherwise pass.
  for (const file of siteHtmlFiles()) {
    const html = readPage(file);
    if (!html.includes('property="og:url"')) continue;
    const rel = file.slice(SITE.length);
    const expected = `${ORIGIN}/${rel.replace(/index\.html$/, "")}`;
    test(`${rel} og:url is its own address`, () =>
      expect(metaProp(html, "og:url")).toBe(expected));
  }

  // A game page with a cardSet shares that set's art and links that set. The
  // og:image check is the one that fired for real; the pill check is the
  // same cause one step over (August shipped with no "The cards" pill, so
  // the set was unreachable from the game it was minted from).
  for (const date of gameDates()) {
    const cardSet = data.games.find((g) => g.date === date)?.cardSet;
    if (!cardSet) continue;
    const html = readPage(join(SITE, "games", date, "index.html"));
    test(`games/${date} shares its own set's card, never an older set's`, () =>
      expect(metaProp(html, "og:image")).toStartWith(`${ORIGIN}/cards/${cardSet}/`));
    test(`games/${date} links its own card set from the lens pills`, () =>
      expect(html).toContain(`href="/cards/${cardSet}/"`));
  }

  // The generated pages come from tools/render.ts page(); every hand-written
  // page carries og:type, so the generated ones should for symmetry.
  for (const rel of ["standings/index.html", "games/index.html"]) {
    test(`generated ${rel} carries og:type like the hand-written pages`, () =>
      expect(metaProp(readPage(join(SITE, rel)), "og:type")).toBe("website"));
  }
});

// The holo glare and rainbow layers (styles.css "Holo effect") cover the
// whole .card-frame--holo box. A figcaption inside that box would be washed
// out by both, so captions live outside the frame (the unboxed card-caption
// lines). Pinned so a captioned figure never quietly picks up the class.
describe("holo frames hold only the image (#12)", () => {
  for (const file of siteHtmlFiles()) {
    const html = readPage(file);
    const frames = [...html.matchAll(/<(figure|div) class="card-frame card-frame--holo[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];
    if (frames.length === 0) continue;
    test(`${file.slice(SITE.length)} holo frames contain no figcaption`, () => {
      for (const f of frames) expect(f[2]).not.toContain("<figcaption");
    });
  }
});

// The drawn-marks section of styles.css promises the -deep metal variants on
// light bands (3:1 floor for graphical objects). The empty gem's stroke was
// the one mark still on plain pewter, at about 2.95:1 on parchment.
describe("styles.css keeps its own contrast promise (#12)", () => {
  const css = readFileSync(join(SITE, "styles.css"), "utf8");
  test(".mark--empty strokes with the -deep pewter, like every other mark", () => {
    const rule = css.match(/\.mark--empty\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--pewter-deep)");
  });
});

// ---------------------------------------------------------------------------
// Task 5 (#27): the card cross-check. Every card asset under a set's
// assets/ folder must be claimed by exactly one result in games.json, and
// every card the record claims must point at a real file with a caption
// that actually reads that way on the set page. This is what would have
// caught a mistyped metal or a copy-pasted title before it shipped, and
// what will catch the next set if it's ever wrong.
describe("card cross-check: the record and the set pages agree (#27, Task 5)", () => {
  const data = JSON.parse(readFileSync(join(SITE, "data/games.json"), "utf8")) as GamesData;

  // The only four metals styles.css draws a mark for; a fifth here would be
  // a typo, not a new tier.
  const METALS: CardRef["metal"][] = ["foil", "sapphire", "copper", "pewter"];

  // Set-page tier labels, keyed by the metal that maps to them.
  const TIER_OF: Record<CardRef["metal"], string> = {
    foil: "Foil",
    sapphire: "Rare",
    copper: "Uncommon",
    pewter: "Common",
  };

  const nameOf = new Map(data.players.map((p) => [p.slug, p.name]));

  // Every game that has minted a set, narrowed so `cardSet` reads as a
  // plain string for the rest of this block instead of `string | undefined`.
  const cardGames = data.games.filter(
    (g): g is typeof g & { cardSet: string } => !!g.cardSet
  );

  // Composes the caption text exactly as a set page renders it (the SVG
  // mark is not part of this string; M3 only checks the text that follows
  // it): "<Tier> · <Name> · <Title>" with a middle dot and one space on
  // each side. Built from the data, never read off the page, so a wrong
  // metal or title in the record produces a string the page cannot
  // contain, rather than the other way round.
  function caption(card: CardRef, name: string): string {
    return `${TIER_OF[card.metal]} · ${name} · ${card.title}`;
  }

  // True only when the sorted asset filenames match the sorted card.file
  // values exactly: same count, same names in the same order once sorted.
  // Shared by leg (a), which runs it against the real data, and leg (b),
  // which runs it against a deliberately broken copy — the same function
  // has to say "match" for one and "no match" for the other, or neither
  // result means anything.
  function assetsMatchRecord(assetFiles: string[], cardFiles: string[]): boolean {
    const a = [...assetFiles].sort();
    const b = [...cardFiles].sort();
    return a.length === b.length && a.every((f, i) => f === b[i]);
  }

  for (const game of cardGames) {
    const assetsDir = join(SITE, "cards", game.cardSet, "assets");
    const assetFiles = readdirSync(assetsDir);
    const cardFiles = game.results.filter((r) => r.card).map((r) => r.card!.file);

    // [M1] (a): an asset claimed by no result, or claimed twice, breaks
    // this equality either way (extra file on one side, or a duplicate
    // collapsing the count on the other).
    test(`cards/${game.cardSet} assets/ matches games.json card.file exactly`, () => {
      expect(assetsMatchRecord(assetFiles, cardFiles)).toBe(true);
    });

    // [M1] (b): proves (a) isn't vacuously true. Delete one result's
    // `card` from a copy of this game and rerun the identical comparison;
    // the asset that card claimed is now unclaimed, so it must fail.
    // Never edit the real data here — only a structuredClone of it.
    test(`cards/${game.cardSet} comparison would catch an unclaimed asset`, () => {
      const broken = structuredClone(game);
      delete broken.results[0].card;
      const brokenCardFiles = broken.results.filter((r) => r.card).map((r) => r.card!.file);
      expect(assetsMatchRecord(assetFiles, brokenCardFiles)).toBe(false);
    });
  }

  // Every result that carries a card, across both sets, generated from the
  // parsed data rather than typed into this file — a card added next month
  // is covered automatically, with no test to remember to add.
  const cardedResults = cardGames.flatMap((game) =>
    game.results
      .filter((r): r is typeof r & { card: CardRef } => !!r.card)
      .map((result) => ({ game, result }))
  );

  for (const { game, result } of cardedResults) {
    const card = result.card;

    // [M2] (c): the file the record claims must exist under this set's own
    // assets folder (a card pointed at another set's file, or a typo,
    // fails here), and the metal must be one of the four the site knows
    // how to render.
    test(`${game.date} ${result.slug}: card.file exists and card.metal is valid`, () => {
      const filePath = join(SITE, "cards", game.cardSet, "assets", card.file);
      expect(() => statSync(filePath), `${result.slug}: ${card.file} does not exist`).not.toThrow();
      expect(METALS, `${result.slug}: metal "${card.metal}" is not one of foil/sapphire/copper/pewter`).toContain(
        card.metal
      );
    });

    // [M3] (d): the caption composed from this result's own data must
    // appear verbatim on its set's page. A wrong metal or title in the
    // record composes a string the page does not contain, and fails here
    // by slug and set rather than silently rendering something else.
    test(`${game.date} ${result.slug}: caption appears on cards/${game.cardSet}`, () => {
      const html = readPage(join(SITE, "cards", game.cardSet, "index.html"));
      const name = nameOf.get(result.slug);
      expect(name, `no players[] entry named for slug ${result.slug}`).toBeDefined();
      expect(html).toContain(caption(card, name!));
    });
  }

  // [M3] (e): the July champion's card, mutated one field at a time, to
  // prove leg (d) is actually reading the metal and the title rather than
  // matching on the name alone (which appears in every one of that
  // player's captions across every set).
  describe("the caption check reads the metal and the title, not just the name", () => {
    const julyGame = cardGames.find((g) => g.date === "2026-07-14")!;
    const julyHtml = readPage(join(SITE, "cards", julyGame.cardSet, "index.html"));
    const champion = julyGame.results.find((r) => r.slug === "chris-g")!;
    const championName = nameOf.get(champion.slug)!;

    test("wrong metal (Foil swapped for Common) is absent from the page", () => {
      const wrongMetal: CardRef = { ...champion.card!, metal: "pewter" };
      expect(julyHtml).not.toContain(caption(wrongMetal, championName));
    });

    test("wrong title (Champion swapped out) is absent from the page", () => {
      const wrongTitle: CardRef = { ...champion.card!, title: "Runner-up" };
      expect(julyHtml).not.toContain(caption(wrongTitle, championName));
    });
  });

  // [M3] (e2): the number of captions actually printed on a set page must
  // equal the number of carded results for that set's game — otherwise a
  // caption on the page could belong to nobody the record claims.
  for (const game of cardGames) {
    test(`cards/${game.cardSet} has exactly one card-caption per carded result`, () => {
      const html = readPage(join(SITE, "cards", game.cardSet, "index.html"));
      const captionCount = (html.match(/class="card-caption"/g) ?? []).length;
      const cardedCount = game.results.filter((r) => r.card).length;
      expect(captionCount).toBe(cardedCount);
    });
  }

  // [M4] (f): shared by the real-data pass below and the broken-copy test,
  // so the same rule is proven to both hold today and to be capable of
  // failing.
  function cardSetNameOk(game: { cardSet?: string; cardSetName?: string }): boolean {
    return !game.cardSet || (!!game.cardSetName && game.cardSetName.length > 0);
  }

  for (const game of data.games) {
    test(`${game.date}: cardSet implies cardSetName`, () => {
      expect(cardSetNameOk(game), `${game.date} has cardSet but no cardSetName`).toBe(true);
    });
  }

  test("a copy of a game with cardSetName deleted fails the same check", () => {
    const broken = { ...cardGames[0], cardSetName: undefined };
    expect(cardSetNameOk(broken)).toBe(false);
  });

  // [M4] (g): the two set names as they were read off the pages, verbatim.
  test('2026-07-14 cardSetName is "The Founder\'s Table"', () => {
    expect(data.games.find((g) => g.date === "2026-07-14")?.cardSetName).toBe("The Founder's Table");
  });

  test('2026-08-11 cardSetName is "Wire to Wire"', () => {
    expect(data.games.find((g) => g.date === "2026-08-11")?.cardSetName).toBe("Wire to Wire");
  });
});

// ---------------------------------------------------------------------------
// Task 10 (#27, 2026-09-02-player-pages-trophies-hope-coin plan; spec §6
// "Rendering and the drift check", §7 "Site invariants extend on their own").
//
// This task owns every generated file under site/player/<slug>/ and
// site/hope-coin/: it is the one place a stale generated page, or a page the
// generator no longer produces, can hide. The two checks that matter are
// different from each other on purpose:
//
//   - A `git diff --exit-code` after `bun tools/render.ts` (the M2 block
//     below) proves the committed bytes agree with whatever the generator
//     writes into the SAME tree it already lives in. It is the check
//     docs/publishing.md already calls "the pre-merge drift check".
//   - But that check alone cannot prove the generator is what PRODUCED a
//     page in the first place. A page Charlie (or a future task) wrote by
//     hand, that the generator never touches, ALSO leaves that diff clean
//     forever - nothing ever re-derives it to disagree. So the M1 block
//     below renders into a directory that starts completely empty, seeded
//     with nothing but a copy of site/data/games.json (the renderer's one
//     input). A committed page the generator never writes is simply absent
//     from that fresh tree, and the file-set comparison fails by name -
//     which a clean `git diff` on the real site/ tree cannot catch, because
//     there is nothing there for it to compare against.

// Recursively lists every FILE (not directory) under `dir`, full paths, in
// no particular order - the caller sorts. Returns [] for a directory that
// does not exist yet, so a completely-missing site/hope-coin/ (the failure
// this whole section exists to catch) produces an empty set to compare
// against the generated one, rather than throwing before the assertion runs.
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

// Both file lists made relative to their own root and sorted, so two trees
// rooted at different absolute paths (a temp dir vs. the committed site/)
// can be compared on name alone. "player/kmikeym/index.html", not the full
// path to either root.
function relSorted(root: string, files: string[]): string[] {
  return files.map((f) => f.slice(root.length + 1)).sort();
}

// True only when both relative-path lists are identical - same count, same
// names, once sorted. Extracted as its own function (rather than inlined in
// the test below) for the same reason tools/site.test.ts's card cross-check
// extracts `assetsMatchRecord`: the "would catch a missing page" test right
// below proves this exact comparison can return false, not just that the
// real data happens to make it return true today.
function fileSetsMatch(a: string[], b: string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((f, i) => f === sb[i]);
}

describe("the file-set comparison used below can actually fail (#27, Task 10)", () => {
  test("a page present on one side but not the other is caught", () => {
    const committed = ["kmikeym/index.html", "chris-g/index.html"];
    // As if the generator silently skipped a slug: chris-g's page never got
    // written, so the generated side is missing an entry the committed side
    // has.
    const generated = ["kmikeym/index.html"];
    expect(fileSetsMatch(committed, generated)).toBe(false);
  });
  test("identical sets in a different order still match", () => {
    expect(fileSetsMatch(["a", "b"], ["b", "a"])).toBe(true);
  });
});

describe("the generator, run into an empty directory, produces exactly what's committed (#27, Task 10, M1)", () => {
  let tempRoot: string;

  // Renders into a directory that starts completely empty apart from a
  // copied site/data/games.json (the renderer's one input) - `mkdtempSync`
  // guarantees the directory it hands back did not exist a moment ago, so
  // two `bun test tools` runs in flight on the same machine can never share
  // a path. tools/render.ts is spawned as its OWN process (matching the
  // real `bun tools/render.ts` Charlie runs), with `tempRoot` as that
  // process's working directory: render.ts reads and writes plain relative
  // paths ("site/data/games.json", "site/player/<slug>/index.html", ...)
  // resolved against its own cwd, so pointing that cwd at the temp root is
  // what makes every write land inside it instead of the real site/.
  // `process.execPath` (the bun binary currently running this suite) is
  // used instead of the bare string "bun" so this does not depend on PATH
  // resolution inside the child process.
  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "poker-render-drift-"));
    mkdirSync(join(tempRoot, "site", "data"), { recursive: true });
    copyFileSync(join(SITE, "data", "games.json"), join(tempRoot, "site", "data", "games.json"));
    const renderTs = join(SITE, "..", "tools", "render.ts");
    execFileSync(process.execPath, [renderTs], { cwd: tempRoot, stdio: "pipe" });
  });

  // Cleans up the temp tree unconditionally, success or failure, so a
  // broken run does not leave stray directories behind in the OS temp
  // folder every time this suite runs.
  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  for (const sub of ["player", "hope-coin"] as const) {
    test(`site/${sub}/: the generated file set matches the committed one`, () => {
      const committedRoot = join(SITE, sub);
      const generatedRoot = join(tempRoot, "site", sub);
      const committed = relSorted(committedRoot, filesUnder(committedRoot));
      const generated = relSorted(generatedRoot, filesUnder(generatedRoot));
      expect(
        fileSetsMatch(committed, generated),
        `committed: ${JSON.stringify(committed)}\ngenerated: ${JSON.stringify(generated)}`
      ).toBe(true);
    });

    test(`site/${sub}/: every generated file is byte-identical to its committed twin`, () => {
      const committedRoot = join(SITE, sub);
      const generatedRoot = join(tempRoot, "site", sub);
      const rels = relSorted(committedRoot, filesUnder(committedRoot));
      for (const rel of rels) {
        const committedBytes = readFileSync(join(committedRoot, rel), "utf8");
        const generatedBytes = readFileSync(join(generatedRoot, rel), "utf8");
        expect(generatedBytes, `${sub}/${rel} differs from the generator's output`).toBe(committedBytes);
      }
    });
  }
});

describe("running the real renderer leaves the generated paths clean (#27, Task 10, M2)", () => {
  // This is docs/publishing.md's "pre-merge drift check", finally an actual
  // test rather than a step Charlie has to remember to run by hand: it
  // regenerates the five paths render.ts owns, in place, against the real
  // committed site/data/games.json, then asks git whether anything moved.
  // Unlike the M1 block above, this exercises the REAL site/ tree - it is
  // what would catch a hand-edit to a generated page, or a data change
  // whose regeneration got skipped before commit.
  test("git status --porcelain reports no change under the five generated paths", () => {
    const repoRoot = join(SITE, "..");
    const renderTs = join(repoRoot, "tools", "render.ts");
    execFileSync(process.execPath, [renderTs], { cwd: repoRoot, stdio: "pipe" });
    const watched = [
      "site/standings/index.html",
      "site/games/index.html",
      "site/next-game.ics",
      "site/player/",
      "site/hope-coin/",
    ];
    const status = execFileSync("git", ["status", "--porcelain", "--", ...watched], {
      cwd: repoRoot,
    }).toString();
    expect(status, `git status --porcelain reported drift:\n${status}`).toBe("");
  });
});

describe("site/player/ holds exactly one page per spine slug, and no others (#27, Task 10, M3)", () => {
  const data = JSON.parse(readFileSync(join(SITE, "data/games.json"), "utf8")) as GamesData;
  // Derived from the data, never typed here - a player added to the record
  // with no game yet correctly gets no page, and a new spine slug is
  // covered automatically the day it plays its first game.
  const expectedSlugs = [...playerSlugs(data)].sort();

  test("directory names under site/player/ equal playerSlugs(data)", () => {
    const dirs = readdirSync(join(SITE, "player"))
      .filter((name) => statSync(join(SITE, "player", name)).isDirectory())
      .sort();
    expect(dirs).toEqual(expectedSlugs);
  });

  // One case per directory actually found on disk - not per slug the data
  // names - so a stray directory the generator does not produce still gets
  // its own case (and, per the check above, already fails the file-set
  // test), rather than silently never being iterated.
  const playerDirs = readdirSync(join(SITE, "player")).filter((name) =>
    statSync(join(SITE, "player", name)).isDirectory()
  );
  for (const slug of playerDirs) {
    test(`site/player/${slug}/ exists, links the favicon, and carries its own og:url and og:type=website`, () => {
      const pagePath = join(SITE, "player", slug, "index.html");
      expect(existsSync(pagePath), `site/player/${slug}/index.html is missing`).toBe(true);
      const html = readPage(pagePath);
      expect(html).toContain('href="/favicon.svg"');
      expect(metaProp(html, "og:url")).toBe(`${ORIGIN}/player/${slug}/`);
      expect(metaProp(html, "og:type")).toBe("website");
    });
  }
});

describe("site/hope-coin/index.html exists and carries its own unfurl tags (#27, Task 10, M4)", () => {
  const pagePath = join(SITE, "hope-coin", "index.html");
  test("exists, links the favicon, and carries its own og:url and og:type=website", () => {
    expect(existsSync(pagePath), "site/hope-coin/index.html is missing").toBe(true);
    const html = readPage(pagePath);
    expect(html).toContain('href="/favicon.svg"');
    expect(metaProp(html, "og:url")).toBe(`${ORIGIN}/hope-coin/`);
    expect(metaProp(html, "og:type")).toBe("website");
  });
});

describe("site/standings/index.html links every player on the spine and the Hope Coin page (#27, Task 10, M5)", () => {
  const data = JSON.parse(readFileSync(join(SITE, "data/games.json"), "utf8")) as GamesData;
  const slugs = playerSlugs(data);
  const html = readPage(join(SITE, "standings", "index.html"));

  // Iterates the slugs the data derives, not a typed list, so a player added
  // to the record with no link on standings fails here by name the day they
  // are added, rather than needing a matching edit to this test.
  for (const slug of slugs) {
    test(`links /player/${slug}/`, () => {
      expect(html).toContain(`href="/player/${slug}/"`);
    });
  }

  // The per-slug loop above only proves every spine slug has SOME link; it
  // would not notice an extra link to a slug that is not on the spine, or
  // one slug linked twice while another is missing (a duplicate href
  // collapses to one distinct entry, which quietly backfills the count a
  // missing player would otherwise have left short). Comparing the full
  // distinct set catches both.
  test("exactly one distinct /player/ link per spine slug (no extra, no duplicate standing in for a missing one)", () => {
    const hrefs = [...html.matchAll(/href="\/player\/([a-z0-9-]+)\/"/g)].map((m) => m[1]!);
    const distinct = [...new Set(hrefs)].sort();
    expect(distinct).toEqual([...slugs].sort());
  });

  test("links /hope-coin/", () => {
    expect(html).toContain('href="/hope-coin/"');
  });
});
