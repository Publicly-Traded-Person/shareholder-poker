// The exam for Task 7 of the "What Would You Have Done?" plan: the two page
// renderers in tools/render.ts (`renderWwyhdHand`, `renderWwyhdIndex`), the
// render entry point's wwyhd writes, the seeding helper the render-drift
// check reads its inputs through (`seedRenderInputs` in
// tools/lib/render-inputs.ts), and the browser controller's one pure export
// (`lineVsReal` in site/wwyhd.js).
//
// Where it sits in the publish flow: step 4 of the weekly runbook (spec §5).
// Charlie commits a hand file under site/data/wwyhd/, runs `bun
// tools/render.ts`, and the generated pages under site/wwyhd/ are what a
// visitor opens. Everything here is checked against a synthetic roster and a
// synthetic hand built in this file; nothing reads the real site data.
//
// Run: `bun test tools/wwyhd-pages.test.ts`, or as part of `bun test tools`.
//
// HOW TO READ THIS FILE. Every `describe` names one Proof leg of Task 7 and
// the Machine clause it comes from, and every `test` inside it is one
// sentence of that leg. Nothing is pinned here that the task does not pin.
// The notes below record the places where the exam had to choose how to
// observe something, and why it chose that way. They are the same notes left
// on the kata issue.
//
// 1. THE EMBEDDED JSON IS SLICED OUT BEFORE THE CARD CHECKS. M1 asks for two
//    things that pull against each other on a naive read: "the seat's two
//    cards face up and no other player's cards", AND "the hand file embedded
//    as <script type="application/json" id="hand">". That embedded file
//    necessarily carries every player's holding, because the controller
//    builds the reveal state from it. So leg (a)'s face-up / not-shown
//    checks run against `withoutHandJson(html)` - the page with that one
//    script element removed - and the embedding check runs against the
//    script's own contents. Asserting the raw page never contains "Ah" would
//    contradict the clause that demands the JSON.
//
// 2. STACKS ARE MATCHED WITH OR WITHOUT THOUSANDS SEPARATORS. Leg (a) pins
//    "each stack", not its formatting, and this repo prints chip counts both
//    ways (bare in renderGamesIndex, grouped as "4,000" in a hand file's
//    result prose). `carriesNumber` accepts either spelling. The three seats
//    carry three DIFFERENT stacks so each one is separately observable: with
//    one shared stack a page printing a single number would pass three
//    assertions.
//
// 3. "BESIDE" IS ENCODED AS PROXIMITY. No clause pins the markup that puts a
//    handle next to a name, so leg (a)'s "each of three synthetic handles
//    beside its First L. name" is checked as: both strings occur in the
//    visible page, and their nearest occurrences sit within NEIGHBOURHOOD
//    characters of each other. A page that printed the three names in one
//    place and the three handles in another would fail, which is the thing
//    the clause is actually about.
//
// 4. THE DISPLAY NAME FIELD IS FOUND BY ATTRIBUTE VALUE. M1 asks for "an
//    email field and a display name field". The email one names itself
//    (`type="email"`). The other is observed as an input that is not the
//    email one and whose id / name / placeholder / aria-label VALUE mentions
//    "name", or whose id is the target of a <label for=...> whose text
//    mentions "name". Matching on values rather than on the raw tag text is
//    what keeps `name="email"` from counting as a display name field.
//
// 5. THE INDEX IS HANDED ITS HANDS OLDEST FIRST. M4 says renderWwyhdIndex
//    "lists every hand newest first", so the ordering is the renderer's job,
//    not the caller's. The exam passes the two hands in the opposite order
//    to make that assertion mean something.
//
// 6. LEG (d)'S "SAME COPY CHECKS AS (c)" IS READ AS THE COPY RULES: no em
//    dash, no "experiment", no btn-primary, alternating band tones, the
//    favicon link. Not the <script type="module" src="/wwyhd.js"> tag: a
//    script tag is not a copy rule, and the index is a static list that runs
//    no controller. An index that carries the tag anyway still passes.
//
// 7. "CARRIES EACH HAND'S game DATE" IS THE ISO STRING, which is how this
//    repo already prints a game date (renderGamesIndex writes `${g.date}`
//    raw and links /games/${g.date}/).
//
// 8. LEG (e)'S THREE SENTENCES ABOUT tools/site.test.ts's drift block are
//    pinned by the Proof's own three `Run:` lines, which grep that block for
//    the seedRenderInputs call, the "wwyhd" root and the absence of
//    copyFileSync. This exam does not re-grep another test file: an exam
//    proves its own claim through imports and calls.
//
// 9. EVERY NEW SURFACE IS LOADED WITH A DYNAMIC IMPORT inside the test that
//    needs it, so at BASE each leg reds on its own missing piece with a
//    message naming it, instead of one unresolved named import failing the
//    whole file before a single leg is read.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GamesData } from "./lib/standings";
import type { HandFile } from "./lib/wwyhd";

const TOOLS = import.meta.dir;
const REPO = join(TOOLS, "..");
const RENDER_TS = join(TOOLS, "render.ts");

// ---------------------------------------------------------------------------
// The synthetic record. Invented handles only (privacy, spec §3 and repo
// CLAUDE.md): alice, bob and carol, never a real player's handle, and no
// email address anywhere in this file's fixtures. The roster is shaped so
// tools/render.ts can render the whole site from it - one played game, a
// Hope Coin holder, three slugs - because leg (e) spawns the real entry
// point against it.
// ---------------------------------------------------------------------------
const DATA: GamesData = {
  nextGame: { date: "2026-10-13", time: "7:00pm PT" },
  hopeCoin: { holder: "alice-a", since: "2026-01-06" },
  players: [
    { slug: "alice-a", name: "Alice A.", aka: ["alice"] },
    { slug: "bob-b", name: "Bob B.", aka: ["bob"] },
    { slug: "carol-c", name: "Carol C.", aka: ["carol"] },
  ],
  games: [
    {
      date: "2026-01-06", hands: 100, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      results: [
        { slug: "alice-a", handle: "alice", finish: 1, payout: 105, rebuys: 0, trophies: [] },
        { slug: "bob-b", handle: "bob", finish: 2, payout: 45, rebuys: 0, trophies: [] },
        { slug: "carol-c", handle: "carol", finish: 3, payout: 0, rebuys: 0, trophies: [] },
      ],
    },
  ],
};

// The archive the render entry point validates before it writes anything
// (#39): one season, one game, dated before the spine's earliest game, every
// podium name in First L. form with a slug the spine knows. Present only so
// leg (e)'s spawn gets past validateArchive; nothing else reads it.
const ARCHIVE = {
  seasons: [
    {
      id: "season-2025",
      title: "Season 2025",
      games: [
        {
          date: "2025-01-07",
          podium: [
            { place: 1, name: "Alice A.", slug: "alice-a" },
            { place: 2, name: "Bob B.", slug: "bob-b" },
            { place: 3, name: "Carol C.", slug: "carol-c" },
          ],
          bounties: [],
        },
      ],
    },
  ],
};

// The synthetic puzzle. Three seats, three DIFFERENT stacks (note 2), the
// seat `bob` holding Qs Qc with `profile: null`, and the real line replaying
// cleanly through site/wwyhd-engine.js to these endStacks - so a renderer
// that runs checkHandFile over what it loads is no less happy with this file
// than one that only validates it.
const HAND: HandFile = {
  id: "2026-01-01-1",
  game: "2026-01-06",
  handNo: 14,
  title: "Bob three-bets with queens",
  setup: "Three handed at 100/200. Alice has the button and the biggest stack.",
  seat: "bob",
  blinds: { sb: 100, bb: 200, ante: 0 },
  dealer: "alice",
  players: [
    {
      handle: "alice", stack: 5300, cards: ["Ah", "Kd"], shown: true,
      profile: { vpip: 31, af: 2.1, allInRate: 0.3, foldToRaise: 44, callDown: 52 },
    },
    { handle: "bob", stack: 4200, cards: ["Qs", "Qc"], shown: true, profile: null },
    {
      handle: "carol", stack: 3100, cards: ["Jc", "Td"], shown: false,
      profile: { vpip: 24, af: 1.5, allInRate: 0.2, foldToRaise: 57, callDown: 36 },
    },
  ],
  board: ["Qh", "8s", "3c", "2h", "5d"],
  real: {
    actions: [
      { street: "PRE", handle: "alice", type: "raise", amount: 600 },
      { street: "PRE", handle: "bob", type: "raise", amount: 1800 },
      { street: "PRE", handle: "carol", type: "fold", amount: 0 },
      { street: "PRE", handle: "alice", type: "call", amount: 0 },
      { street: "FLOP", handle: "bob", type: "bet", amount: 1200 },
      { street: "FLOP", handle: "alice", type: "fold", amount: 0 },
    ],
    result:
      "Bob three-bet the queens, flopped a set and bet it. Alice let ace king go on the flop. " +
      "Carol was gone before the flop.",
    seatChips: 6200,
    endStacks: { alice: 3500, bob: 6200, carol: 2900 },
  },
  startChips: 4200,
  profileThrough: "2026-01-06",
  opens: "2026-01-13",
  closes: "2026-01-20",
};

// The second puzzle for leg (d)'s index: the SAME valid hand with a later
// `opens`, its own id, its own title and its own `game` date, so the two
// entries on the index are told apart by every field the leg names.
const HAND_LATER: HandFile = {
  ...HAND,
  id: "2026-02-03-1",
  game: "2026-02-03",
  title: "Carol defends the big blind",
  opens: "2026-02-10",
  closes: "2026-02-17",
};

/** The seat's own two cards, and the two cards of each opponent, read off the
 *  fixture rather than typed twice: a card changed above cannot leave a check
 *  below pointing at a card nobody holds. */
const SEAT_CARDS = HAND.players.find((p) => p.handle === HAND.seat)!.cards;
const OPPONENT_CARDS = HAND.players.filter((p) => p.handle !== HAND.seat).flatMap((p) => p.cards);

// ---------------------------------------------------------------------------
// Observation helpers. Each one is here because a clause pins WHAT the page
// says without pinning the markup that says it; the header note it implements
// is named in its comment.
// ---------------------------------------------------------------------------

/** M1's own spelling of the embedded hand's opening tag. Pinned verbatim
 *  because M1 spells it verbatim. */
const HAND_SCRIPT_OPEN = '<script type="application/json" id="hand">';

/** The text inside the embedded hand script. Takes the whole page; returns
 *  the JSON source between M1's opening tag and the next `</script>`. Throws
 *  when the page carries no such block, because every leg that calls this is
 *  already asserting the block exists and a silent "" would turn a missing
 *  embed into a confusing parse error instead. */
function handJson(html: string): string {
  const start = html.indexOf(HAND_SCRIPT_OPEN);
  if (start === -1) throw new Error(`the page carries no ${HAND_SCRIPT_OPEN} block`);
  const from = start + HAND_SCRIPT_OPEN.length;
  const end = html.indexOf("</script>", from);
  if (end === -1) throw new Error("the embedded hand script is never closed");
  return html.slice(from, end);
}

/** The page with the embedded hand script removed (header note 1). Takes the
 *  whole page; returns what a visitor can actually see, which is where "the
 *  seat's two cards face up and no other player's cards" is a question with
 *  an answer. Returns the page unchanged when there is no such block: the
 *  leg that demands the block fails on its own, and this one still reports
 *  honestly about what is on the page. */
function withoutHandJson(html: string): string {
  const start = html.indexOf(HAND_SCRIPT_OPEN);
  if (start === -1) return html;
  const end = html.indexOf("</script>", start);
  if (end === -1) return html.slice(0, start);
  return html.slice(0, start) + html.slice(end + "</script>".length);
}

/** True when `html` carries the number `n` as chips, written either bare
 *  ("4200") or grouped ("4,200") (header note 2). Takes the page text and a
 *  whole number; returns whether it appears as its own number rather than
 *  inside a longer run of digits, so a stack of 4200 is not "found" inside
 *  14200 or 42000. */
function carriesNumber(html: string, n: number): boolean {
  const bare = String(n);
  const grouped = bare.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return new RegExp(`(?<![\\d,])(${bare}|${grouped})(?![\\d])`).test(html);
}

/** How far apart a handle and its name may sit and still count as "beside"
 *  (header note 3). Generous on purpose: a seat's markup carries classes,
 *  a stack, two card spans and whitespace between the two strings on any
 *  reasonable layout, and the clause is about the two being in one place,
 *  not about the tags between them. */
const NEIGHBOURHOOD = 200;

/** The smallest gap between any occurrence of `a` and any occurrence of `b`
 *  in `html`, or Infinity when either never occurs. Takes the page text and
 *  two literal strings; returns the distance in characters. Order-blind: a
 *  page printing the name before the handle reads the same as one printing
 *  the handle first, because no clause pins which comes first. */
function nearestGap(html: string, a: string, b: string): number {
  const at = (needle: string) => {
    const out: number[] = [];
    for (let i = html.indexOf(needle); i !== -1; i = html.indexOf(needle, i + 1)) out.push(i);
    return out;
  };
  const as = at(a);
  const bs = at(b);
  if (as.length === 0 || bs.length === 0) return Infinity;
  let best = Infinity;
  for (const i of as) for (const j of bs) best = Math.min(best, Math.abs(i - j));
  return best;
}

/** Every `band-light` / `band-dark` class the page names, in document order.
 *  Takes the page text; returns the sequence M3's "bands whose classes
 *  alternate" is a statement about. `band-inner` does not match, so only the
 *  tones are counted. */
function bandSequence(html: string): string[] {
  return [...html.matchAll(/band-(light|dark)/g)].map((m) => m[0]);
}

/** Every `<input ...>` tag on the page, whole, in document order. */
function inputTags(html: string): string[] {
  return [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
}

/** One attribute's value off a tag, or "" when the tag does not carry it. */
function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m ? m[1]! : "";
}

/** Every `<label for="...">text</label>` on the page, as id -> label text.
 *  Used only by the display-name check (header note 4), so a field labelled
 *  in prose rather than named in its own attributes still counts. */
function labelTextById(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<label\b[^>]*\bfor="([^"]*)"[^>]*>([\s\S]*?)<\/label>/g)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** The copy rules M3 states, asserted over one page (header note 6). Takes
 *  the page text and a label naming which page it is, so a failure says
 *  whether the hand page or the index broke the rule. Returns nothing; every
 *  sentence is its own `expect`, so a page that breaks two rules reports the
 *  first one by name rather than as a single opaque false. */
function assertCopyRules(html: string, label: string): void {
  // docs/brand.md: no em dash anywhere on a generated page.
  expect(html.includes("—"), `${label}: contains an em dash`).toBe(false);
  // docs/brand.md: the word never appears, in any case.
  expect(html.toLowerCase().includes("experiment"), `${label}: says "experiment"`).toBe(false);
  // docs/brand.md: lime is the RSVP CTA's, so no puzzle page carries it.
  expect(html.includes("btn-primary"), `${label}: carries btn-primary`).toBe(false);
  // Two adjacent bands never share a tone.
  const bands = bandSequence(html);
  expect(bands.length, `${label}: names no band tones at all`).toBeGreaterThan(1);
  const repeats = bands.filter((tone, i) => i > 0 && tone === bands[i - 1]);
  expect(repeats, `${label}: band tones do not alternate: ${bands.join(" ")}`).toEqual([]);
  // The favicon link every committed page carries.
  expect(html, `${label}: does not link the favicon`).toContain("/favicon.svg");
}

// ---------------------------------------------------------------------------
// The surfaces under test, each loaded when the leg that needs it runs
// (header note 9).
// ---------------------------------------------------------------------------

type RenderModule = {
  renderWwyhdHand?: (data: GamesData, hand: HandFile) => string;
  renderWwyhdIndex?: (data: GamesData, hands: HandFile[]) => string;
};

async function renderModule(): Promise<RenderModule> {
  return (await import("./render")) as RenderModule;
}

/** The rendered hand page, built once and reused by legs (a), (b) and (c).
 *  Throws a message naming the missing export when tools/render.ts does not
 *  export renderWwyhdHand yet, which is the state at BASE. */
let handHtml: string | null = null;
async function handPage(): Promise<string> {
  if (handHtml === null) {
    const { renderWwyhdHand } = await renderModule();
    if (typeof renderWwyhdHand !== "function") {
      throw new Error("tools/render.ts does not export renderWwyhdHand(data, hand) yet");
    }
    handHtml = renderWwyhdHand(DATA, HAND);
  }
  return handHtml;
}

/** The rendered index for leg (d), built from the two synthetic hands handed
 *  over OLDEST FIRST (header note 5). */
let indexHtml: string | null = null;
async function indexPage(): Promise<string> {
  if (indexHtml === null) {
    const { renderWwyhdIndex } = await renderModule();
    if (typeof renderWwyhdIndex !== "function") {
      throw new Error("tools/render.ts does not export renderWwyhdIndex(data, hands) yet");
    }
    indexHtml = renderWwyhdIndex(DATA, [HAND, HAND_LATER]);
  }
  return indexHtml;
}

type ControllerModule = {
  lineVsReal?: (
    line: object[],
    realActions: object[],
    seat: string
  ) => { street: string; mine: string; real: string; differs: boolean }[];
};

async function controllerModule(): Promise<ControllerModule> {
  return (await import("../site/wwyhd.js")) as ControllerModule;
}

type RenderInputsModule = {
  seedRenderInputs?: (tempRoot: string, siteDir: string) => void;
};

async function renderInputsModule(): Promise<RenderInputsModule> {
  return (await import("./lib/render-inputs")) as RenderInputsModule;
}

// ---------------------------------------------------------------------------
// leg (a) [M1]: the sit-down state.
// ---------------------------------------------------------------------------
describe("leg (a) [M1]: the hand page's sit-down state carries the table", () => {
  test("carries the hand's title and its setup", async () => {
    const visible = withoutHandJson(await handPage());
    expect(visible).toContain(HAND.title);
    expect(visible).toContain(HAND.setup);
  });

  test("names every player's handle beside their First L. name", async () => {
    const visible = withoutHandJson(await handPage());
    // The three (handle, name) pairs the synthetic roster pins. Read off
    // DATA rather than typed, so a roster edit cannot leave this check
    // asserting a name nobody has.
    const pairs = HAND.players.map((player) => {
      const person = DATA.players.find((p) => p.aka.includes(player.handle))!;
      return { handle: player.handle, name: person.name };
    });
    expect(pairs.map((p) => p.name)).toEqual(["Alice A.", "Bob B.", "Carol C."]);
    for (const { handle, name } of pairs) {
      expect(visible, `the page never names ${name}`).toContain(name);
      expect(visible, `the page never shows the handle ${handle}`).toContain(handle);
      expect(
        nearestGap(visible, handle, name),
        `${handle} and ${name} are not beside each other on the page`
      ).toBeLessThanOrEqual(NEIGHBOURHOOD);
    }
  });

  test("carries every player's stack", async () => {
    const visible = withoutHandJson(await handPage());
    for (const player of HAND.players) {
      expect(
        carriesNumber(visible, player.stack),
        `the page never shows ${player.handle}'s stack of ${player.stack}`
      ).toBe(true);
    }
  });

  test("shows the seat's two cards and neither opponent's", async () => {
    const visible = withoutHandJson(await handPage());
    expect(SEAT_CARDS).toEqual(["Qs", "Qc"]);
    for (const card of SEAT_CARDS) {
      expect(visible, `the seat's card ${card} is not face up on the page`).toContain(card);
    }
    // The four cards alice and carol hold. None of them is a visitor's to
    // see at sit-down: the page is the table before the deal.
    expect(OPPONENT_CARDS).toEqual(["Ah", "Kd", "Jc", "Td"]);
    expect(
      OPPONENT_CARDS.filter((card) => visible.includes(card)),
      "an opponent's cards are on the page outside the embedded hand JSON"
    ).toEqual([]);
  });

  test("carries exactly one Deal button", async () => {
    const html = await handPage();
    expect(html.split(">Deal<").length - 1).toBe(1);
  });

  test("carries an email field and a display name field", async () => {
    const html = await handPage();
    const inputs = inputTags(html);
    const emails = inputs.filter((tag) => /\btype="email"/i.test(tag));
    expect(emails.length, `no <input type="email"> among: ${JSON.stringify(inputs)}`)
      .toBeGreaterThanOrEqual(1);
    // Header note 4: matched on attribute VALUES, plus a bound label's text,
    // so `name="email"` on the email field itself never counts as the
    // display name field.
    const labels = labelTextById(html);
    const names = inputs.filter((tag) => {
      if (/\btype="email"/i.test(tag)) return false;
      const values = ["id", "name", "placeholder", "aria-label"].map((a) => attr(tag, a));
      const labelText = labels.get(attr(tag, "id")) ?? "";
      return [...values, labelText].some((v) => /name/i.test(v));
    });
    expect(names.length, `no display name field among: ${JSON.stringify(inputs)}`)
      .toBeGreaterThanOrEqual(1);
  });

  test("embeds the hand file as JSON that parses back to the hand", async () => {
    const html = await handPage();
    expect(html).toContain(HAND_SCRIPT_OPEN);
    expect(JSON.parse(handJson(html))).toEqual(HAND);
  });
});

// ---------------------------------------------------------------------------
// leg (b) [M2]: the two sentences, verbatim.
// ---------------------------------------------------------------------------
describe("leg (b) [M2]: the disclosure and the first-go sentence", () => {
  // The global literal (spec §3, docs/brand.md). Verbatim: this is the one
  // sentence on the page that says what the visitor is looking at, and a
  // paraphrase of it is a different claim about a real hand.
  const DISCLOSURE =
    "This is a simulation. The cards shown at showdown are the real ones. " +
    "Everything else was filled in with what we judged likely.";
  const FIRST_GO = "Your first go is the one that counts. Play again as often as you like.";

  test("carries the disclosure sentence verbatim", async () => {
    expect(await handPage()).toContain(DISCLOSURE);
  });

  test("carries the first-go sentence verbatim", async () => {
    expect(await handPage()).toContain(FIRST_GO);
  });
});

// ---------------------------------------------------------------------------
// leg (c) [M3]: the copy rules and the two tags.
// ---------------------------------------------------------------------------
describe("leg (c) [M3]: the hand page obeys the copy rules and loads the controller", () => {
  test("no em dash, no experiment, no btn-primary, alternating bands, the favicon", async () => {
    assertCopyRules(await handPage(), "the hand page");
  });

  test("carries the controller as a module script", async () => {
    expect(await handPage()).toContain('<script type="module" src="/wwyhd.js">');
  });
});

// ---------------------------------------------------------------------------
// leg (d) [M4]: the index.
// ---------------------------------------------------------------------------
describe("leg (d) [M4]: the index lists every hand newest first", () => {
  const linkFor = (hand: HandFile) => `/wwyhd/${hand.id}/`;

  test("lists the later `opens` first", async () => {
    const html = await indexPage();
    const later = html.indexOf(linkFor(HAND_LATER));
    const earlier = html.indexOf(linkFor(HAND));
    expect(later, `the index never links ${linkFor(HAND_LATER)}`).toBeGreaterThanOrEqual(0);
    expect(earlier, `the index never links ${linkFor(HAND)}`).toBeGreaterThanOrEqual(0);
    expect(
      later,
      `${HAND_LATER.opens} opens later than ${HAND.opens} but is listed second`
    ).toBeLessThan(earlier);
  });

  test("each title links that hand's own page", async () => {
    const html = await indexPage();
    for (const hand of [HAND_LATER, HAND]) {
      const gap = nearestGap(html, linkFor(hand), hand.title);
      expect(
        gap,
        `"${hand.title}" is not the text of the link to ${linkFor(hand)}`
      ).toBeLessThanOrEqual(NEIGHBOURHOOD);
    }
  });

  test("carries each hand's game date", async () => {
    const html = await indexPage();
    expect(HAND.game).not.toBe(HAND_LATER.game);
    for (const hand of [HAND_LATER, HAND]) {
      expect(html, `the index never carries ${hand.id}'s game date`).toContain(hand.game);
    }
  });

  test("marks the newest hand as this week's, and only the newest", async () => {
    const html = await indexPage();
    // Header note: /this[ -]?week/i catches the prose ("This week's puzzle")
    // and a class ("this-week") alike, because M4 pins the mark, not how it
    // is spelled.
    const marks = [...html.matchAll(/this[\s-]?week/gi)].map((m) => m.index!);
    expect(marks.length, "the index marks nothing as this week's").toBeGreaterThan(0);
    const newest = html.indexOf(linkFor(HAND_LATER));
    const older = html.indexOf(linkFor(HAND));
    expect(newest).toBeGreaterThanOrEqual(0);
    expect(older).toBeGreaterThanOrEqual(0);
    // Every mark must sit nearer the newest hand's link than the older
    // one's. Distance rather than "before the older link" because no clause
    // says whether the mark is written above its entry's title or after it,
    // and a page-wide heading ("This week's puzzle", above the whole list)
    // is nearest the newest entry either way while a mark written into the
    // older hand's entry never is.
    const misplaced = marks.filter(
      (at) => Math.abs(at - newest) >= Math.abs(at - older)
    );
    expect(
      misplaced,
      "a this-week mark sits on the older hand's entry, not the newest"
    ).toEqual([]);
  });

  test("obeys the same copy rules as the hand page", async () => {
    assertCopyRules(await indexPage(), "the wwyhd index");
  });
});

// ---------------------------------------------------------------------------
// leg (e) [M5]: what the generator writes, and what seeds the drift check.
//
// The renderer is spawned as its OWN process with a temp directory as its
// cwd, the way tools/site.test.ts's drift block already spawns it and the
// way Charlie runs it: render.ts reads and writes plain relative paths, so
// pointing the cwd at a temp root is what keeps every write inside it.
// `process.execPath` is the bun binary running this suite, so nothing here
// depends on PATH inside the child.
// ---------------------------------------------------------------------------

/** Every file under `dir`, as paths relative to it, sorted. Returns [] when
 *  the directory does not exist, so a caller can tell "no directory" from
 *  "a directory with files" by asking existsSync separately. */
function relFilesUnder(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...relFilesUnder(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}

/** A temp root holding site/data/games.json and site/data/archive.json from
 *  the synthetic record, plus the synthetic hand when `withHand` is true.
 *  Returns the root's path; the caller removes it. */
function seedTempSite(prefix: string, withHand: boolean): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "site", "data"), { recursive: true });
  writeFileSync(join(root, "site", "data", "games.json"), JSON.stringify(DATA, null, 2));
  writeFileSync(join(root, "site", "data", "archive.json"), JSON.stringify(ARCHIVE, null, 2));
  if (withHand) {
    mkdirSync(join(root, "site", "data", "wwyhd"), { recursive: true });
    writeFileSync(
      join(root, "site", "data", "wwyhd", `${HAND.id}.json`),
      JSON.stringify(HAND, null, 2)
    );
  }
  return root;
}

describe("leg (e) [M5]: the generator writes the puzzle pages, and only when there are puzzles", () => {
  let withoutHands: string;
  let withHand: string;

  beforeAll(() => {
    withoutHands = seedTempSite("wwyhd-render-none-", false);
    execFileSync(process.execPath, [RENDER_TS], { cwd: withoutHands, stdio: "pipe" });
    withHand = seedTempSite("wwyhd-render-one-", true);
    execFileSync(process.execPath, [RENDER_TS], { cwd: withHand, stdio: "pipe" });
  });

  afterAll(() => {
    rmSync(withoutHands, { recursive: true, force: true });
    rmSync(withHand, { recursive: true, force: true });
  });

  test("writes nothing under site/wwyhd/ when site/data/wwyhd/ is absent", () => {
    const generated = join(withoutHands, "site", "wwyhd");
    expect(
      existsSync(generated),
      `site/wwyhd/ exists with ${JSON.stringify(relFilesUnder(generated))} but there were no hand files`
    ).toBe(false);
  });

  test("writes the index and one page per hand file when there is one", () => {
    const generated = join(withHand, "site", "wwyhd");
    expect(relFilesUnder(generated)).toEqual([`${HAND.id}/index.html`, "index.html"]);
  });
});

describe("leg (e) [M5]: seedRenderInputs copies the renderer's inputs", () => {
  let sourceWithHand: string;
  let sourceWithoutHand: string;

  // The "site directory" a caller hands the helper is the repo's own site/,
  // so these stand-ins carry the same shape: data/games.json,
  // data/archive.json and, in one of them, data/wwyhd/<id>.json.
  beforeAll(() => {
    sourceWithHand = mkdtempSync(join(tmpdir(), "wwyhd-seed-src-"));
    mkdirSync(join(sourceWithHand, "data", "wwyhd"), { recursive: true });
    writeFileSync(join(sourceWithHand, "data", "games.json"), JSON.stringify(DATA, null, 2));
    writeFileSync(join(sourceWithHand, "data", "archive.json"), JSON.stringify(ARCHIVE, null, 2));
    writeFileSync(
      join(sourceWithHand, "data", "wwyhd", `${HAND.id}.json`),
      JSON.stringify(HAND, null, 2)
    );

    sourceWithoutHand = mkdtempSync(join(tmpdir(), "wwyhd-seed-bare-"));
    mkdirSync(join(sourceWithoutHand, "data"), { recursive: true });
    writeFileSync(join(sourceWithoutHand, "data", "games.json"), JSON.stringify(DATA, null, 2));
    writeFileSync(join(sourceWithoutHand, "data", "archive.json"), JSON.stringify(ARCHIVE, null, 2));
  });

  afterAll(() => {
    rmSync(sourceWithHand, { recursive: true, force: true });
    rmSync(sourceWithoutHand, { recursive: true, force: true });
  });

  /** A fresh temp root with site/data/ already made, which is the state the
   *  drift block's beforeAll hands the helper (header note 8: the task
   *  replaces only that block's two copyFileSync lines, not its mkdirSync). */
  function freshRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(root, "site", "data"), { recursive: true });
    return root;
  }

  test("copies games.json, archive.json and every hand file to their paths", async () => {
    const { seedRenderInputs } = await renderInputsModule();
    if (typeof seedRenderInputs !== "function") {
      throw new Error("tools/lib/render-inputs.ts does not export seedRenderInputs yet");
    }
    const root = freshRoot("wwyhd-seed-into-");
    try {
      seedRenderInputs(root, sourceWithHand);
      expect(relFilesUnder(join(root, "site", "data"))).toEqual([
        "archive.json",
        "games.json",
        `wwyhd/${HAND.id}.json`,
      ]);
      // Copied, not merely created: the hand that arrives is the hand that
      // left, so a render spawned against the seeded tree renders the same
      // puzzle the committed tree does.
      expect(
        JSON.parse(readFileSync(join(root, "site", "data", "wwyhd", `${HAND.id}.json`), "utf8"))
      ).toEqual(HAND);
      expect(
        JSON.parse(readFileSync(join(root, "site", "data", "games.json"), "utf8"))
      ).toEqual(DATA);
      expect(
        JSON.parse(readFileSync(join(root, "site", "data", "archive.json"), "utf8"))
      ).toEqual(ARCHIVE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates no wwyhd directory when the source has none", async () => {
    const { seedRenderInputs } = await renderInputsModule();
    if (typeof seedRenderInputs !== "function") {
      throw new Error("tools/lib/render-inputs.ts does not export seedRenderInputs yet");
    }
    const root = freshRoot("wwyhd-seed-bare-into-");
    try {
      seedRenderInputs(root, sourceWithoutHand);
      expect(relFilesUnder(join(root, "site", "data"))).toEqual(["archive.json", "games.json"]);
      expect(
        existsSync(join(root, "site", "data", "wwyhd")),
        "seedRenderInputs made a wwyhd directory the source never had"
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// leg (f) [M6]: the controller imports without a DOM, and lineVsReal pairs
// the visitor's line with the seat's real one.
//
// The visitor's actions are written in the same shape the hand file's own
// actions carry (street, handle, type, amount), with the handle set to the
// seat: an implementation that reads the handle and one that ignores it both
// see a well-formed line, so this pins the pairing rather than a parameter
// shape no clause states.
// ---------------------------------------------------------------------------
describe("leg (f) [M6]: site/wwyhd.js imports under bun and exports lineVsReal", () => {
  const SEAT = HAND.seat;
  const REAL = HAND.real.actions as unknown as object[];
  /** The seat's own actions, in order: what "a line equal to the seat's real
   *  actions" means, read off the fixture rather than retyped. */
  const SEAT_REAL = HAND.real.actions.filter((a) => a.handle === SEAT) as unknown as object[];

  test("the module resolves with no DOM present", async () => {
    // bun test runs with no document; the module must guard its DOM work
    // behind `typeof document !== "undefined"` for this to resolve at all.
    expect(typeof document).toBe("undefined");
    const mod = await controllerModule();
    expect(typeof mod.lineVsReal, "site/wwyhd.js does not export lineVsReal yet").toBe("function");
  });

  test("a line that calls preflop against a real line that raised differs on PRE", async () => {
    const { lineVsReal } = await controllerModule();
    if (typeof lineVsReal !== "function") {
      throw new Error("site/wwyhd.js does not export lineVsReal(line, realActions, seat) yet");
    }
    // The seat really three-bet preflop (see HAND.real.actions); this
    // visitor only called.
    expect(SEAT_REAL[0]).toMatchObject({ street: "PRE", type: "raise" });
    const mine = [{ street: "PRE", handle: SEAT, type: "call", amount: 0 }];
    const rows = lineVsReal(mine, REAL, SEAT);
    expect(rows.length, "lineVsReal returned no rows at all").toBeGreaterThan(0);
    expect(rows[0]!.street).toBe("PRE");
    expect(rows[0]!.differs).toBe(true);
  });

  test("a line equal to the seat's real actions differs nowhere", async () => {
    const { lineVsReal } = await controllerModule();
    if (typeof lineVsReal !== "function") {
      throw new Error("site/wwyhd.js does not export lineVsReal(line, realActions, seat) yet");
    }
    const rows = lineVsReal(SEAT_REAL, REAL, SEAT);
    // A non-empty result matters as much as the flags: an implementation
    // returning [] would satisfy "every row differs false" vacuously.
    expect(rows.length, "lineVsReal returned no rows for the seat's own line").toBeGreaterThan(0);
    expect(rows.map((row) => row.differs)).toEqual(rows.map(() => false));
  });
});

// --- review fix, 2026-09-21 (fleet run 1 residual, task 7) ------------------
// The reveal, the action log and the pot line run in the browser and used to
// name players by handle only. The page now embeds a handle-to-name map beside
// the hand so the controller can name people First L., the site's name rule,
// the way the seat list already does.
describe("the page embeds a handle-to-name map for the controller", () => {
  const NAMES_OPEN = '<script type="application/json" id="names">';
  test("every seat's handle maps to its First L. name from games.json", async () => {
    const html = await handPage();
    const start = html.indexOf(NAMES_OPEN);
    expect(start, `the page carries no ${NAMES_OPEN} block`).toBeGreaterThan(-1);
    const from = start + NAMES_OPEN.length;
    const end = html.indexOf("</script>", from);
    const map = JSON.parse(html.slice(from, end));
    expect(Object.keys(map).sort()).toEqual(HAND.players.map((p) => p.handle).sort());
    for (const player of DATA.players) {
      for (const aka of player.aka) if (aka in map) expect(map[aka]).toBe(player.name);
    }
  });
});

// --- the oval table (Mike, 2026-09-21) ---------------------------------------
// "It's not clear to me the order of who is at the table." Every trainer and
// replayer draws the same thing: the hero at the bottom, the other seats
// clockwise in action order, a dealer button, the blinds posted, position
// tags. The renderer derives all of it from `dealer` and seat order, and the
// seats sit in the DOM in preflop action order so the phone fallback (an
// ordered list) reads top to bottom as the action goes.
describe("the table shows who sits where and who acts when", () => {
  function seatsInDomOrder(html: string): string[] {
    return [...html.matchAll(/<li class="wwyhd-seat[^"]*" data-handle="([^"]+)"/g)].map((m) => m[1]);
  }
  function seatBlock(html: string, handle: string): string {
    const start = html.indexOf(`data-handle="${handle}"`);
    const end = html.indexOf("</li>", start);
    return html.slice(start, end);
  }
  // HAND: alice (dealer), bob (the seat), carol; blinds 100/200. Three-handed
  // the dealer is the button, bob posts the small blind, carol the big blind,
  // and preflop the button acts first.
  test("seats come in preflop action order: the button first three-handed, the big blind last", async () => {
    const html = await handPage();
    expect(seatsInDomOrder(html)).toEqual(["alice", "bob", "carol"]);
  });
  test("every seat carries its position tag, and the button, small blind and big blind are marked", async () => {
    const html = await handPage();
    expect(seatBlock(html, "alice")).toContain('class="wwyhd-pos">BTN<');
    expect(seatBlock(html, "bob")).toContain('class="wwyhd-pos">SB<');
    expect(seatBlock(html, "carol")).toContain('class="wwyhd-pos">BB<');
    expect(seatBlock(html, "alice")).toContain('class="wwyhd-button"');
    expect(seatBlock(html, "bob")).toContain('class="wwyhd-blind">100<');
    expect(seatBlock(html, "carol")).toContain('class="wwyhd-blind">200<');
    expect(seatBlock(html, "alice")).not.toContain('class="wwyhd-blind"');
  });
  test("each seat is placed on the oval, the visitor's seat at the bottom center", async () => {
    const html = await handPage();
    const you = seatBlock(html, "bob");
    expect(you).toMatch(/style="--seat-x: ?50%; ?--seat-y: ?\d+%"/);
    const yPct = Number(/--seat-y: ?(\d+)%/.exec(you)![1]);
    expect(yPct).toBeGreaterThan(80);
    for (const handle of ["alice", "carol"]) {
      expect(seatBlock(html, handle)).toMatch(/style="--seat-x: ?\d+%; ?--seat-y: ?\d+%"/);
    }
  });
  test("the board and the pot live in the middle of the table, once each", async () => {
    const html = await handPage();
    const table = html.slice(html.indexOf('class="wwyhd-table"'), html.indexOf("</ol>"));
    expect(table).toContain('id="wwyhd-pot"');
    expect(table).toContain('id="wwyhd-board"');
    expect(html.split('id="wwyhd-pot"').length).toBe(2);
    expect(html.split('id="wwyhd-board"').length).toBe(2);
  });
  test("a seven-handed table tags UTG, UTG+1, HJ, CO before the button", () => {
    const handles = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const seven: HandFile = {
      ...HAND,
      seat: "p3",
      dealer: "p4",
      players: handles.map((h) => ({
        handle: h, stack: 5000, cards: ["2c", "3c"], shown: false,
        profile: h === "p3" ? null : { vpip: 30, af: 1, allInRate: 0.05, foldToRaise: 50, callDown: 50 },
      })) as HandFile["players"],
    };
    const data: GamesData = { ...DATA, players: handles.map((h) => ({ slug: h, name: `${h.toUpperCase()} X.`, aka: [h] })) };
    return renderModule().then(({ renderWwyhdHand }) => {
      const html = renderWwyhdHand!(data, seven);
      // dealer p4: SB p5, BB p6, then p7 UTG, p1 UTG+1, p2 HJ, p3 CO, p4 BTN
      expect(seatsInDomOrder(html)).toEqual(["p7", "p1", "p2", "p3", "p4", "p5", "p6"]);
      const tags = seatsInDomOrder(html).map((h) => /class="wwyhd-pos">([^<]+)</.exec(seatBlock(html, h))![1]);
      expect(tags).toEqual(["UTG", "UTG+1", "HJ", "CO", "BTN", "SB", "BB"]);
    });
  });
});
