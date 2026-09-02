// Guards on docs/publishing.md and CLAUDE.md — the runbook is normative in
// this repo (repo CLAUDE.md, spec §8 step 5: "same commit as the behavior
// it describes"). Task 3 of the player-pages/trophies/Hope Coin plan adds
// four steps to the runbook: card fields at a set minting, a Hope Coin
// handoff, a player bio, and where a new trophy goes. This file is what
// keeps that prose honest: each step is located by its own markdown
// heading and checked for the exact backticked field names it must name,
// so a step whose words are scattered across the document (not something
// Charlie, reading this once a month at 10pm, could actually follow) fails
// here instead of shipping quietly wrong. Run: bun test tools.
//
// A note on why the registry-id check below is scoped to BACKTICKED forms
// only, and not bare words: docs/publishing.md's Cards section already
// contains the bare word "champion" in ordinary prose ("a champion's foil
// means something because nothing else moves" — see that section) and
// that is English, not a copied trophy list. Every other field name this
// file checks for is written as a backticked code span (the convention
// this runbook already uses throughout), so a copied list of trophy ids
// would show up the same way. Scoping the check to backticked forms is
// what actually distinguishes "the runbook copied the registry" from "the
// runbook uses a word that happens to also be a trophy name." Do not
// loosen this to a bare-word check — it would fail forever on that one
// untouched sentence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TROPHIES } from "./lib/trophies";

const DOCS_PATH = new URL("../docs/publishing.md", import.meta.url).pathname;
const CLAUDE_PATH = new URL("../CLAUDE.md", import.meta.url).pathname;
const docs = readFileSync(DOCS_PATH, "utf8");
const claudeMd = readFileSync(CLAUDE_PATH, "utf8");

// Splits a markdown file into sections by heading line (any of #, ##, ###
// ...). Each section runs from its own heading line to the line before the
// next heading of any level, so a subheading (###) ends its parent
// section's (##) slice early — the same way a reader's eye treats it, and
// the same reason a step needs its own heading rather than living as a
// paragraph inside a bigger one. Takes the raw file text; returns one
// entry per heading, in document order, holding the heading's own text
// (the #s stripped) and the body between it and the next heading (or end
// of file for the last one). Throws nothing: a file with no headings at
// all just returns an empty array.
function sections(md: string): { heading: string; body: string }[] {
  const lines = md.split("\n");
  const headingLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) headingLines.push(i);
  }
  const out: { heading: string; body: string }[] = [];
  for (let h = 0; h < headingLines.length; h++) {
    const start = headingLines[h];
    const end = h + 1 < headingLines.length ? headingLines[h + 1] : lines.length;
    out.push({
      heading: lines[start].replace(/^#{1,6}\s+/, ""),
      body: lines.slice(start + 1, end).join("\n"),
    });
  }
  return out;
}

// Finds the one section whose heading contains `needle` (case-insensitive).
// Throws with a helpful message if none or more than one match, so a typo'd
// heading (here, or in the runbook itself) fails loudly at this line
// instead of a later assertion silently checking the wrong slice — or
// every slice — of the file.
function sectionByHeading(md: string, needle: string): { heading: string; body: string } {
  const matches = sections(md).filter((s) =>
    s.heading.toLowerCase().includes(needle.toLowerCase())
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one heading containing "${needle}" in ${md === docs ? "docs/publishing.md" : "the file"}, found ${matches.length}`
    );
  }
  return matches[0];
}

describe("docs/publishing.md points at the trophy registry, not a copy of it [M1]", () => {
  test("names tools/lib/trophies.ts as the single place a trophy is added", () => {
    expect(docs).toContain("tools/lib/trophies.ts");
  });

  // Leg (a), backtick-scoped per the ruling in the header comment above:
  // a copied list would carry every id as its own backticked code span,
  // the same way every other field name in this runbook is written. None
  // of the 15 registry ids should appear that way.
  for (const trophy of TROPHIES) {
    test(`does not carry the registry id \`${trophy.id}\` as a backticked code span`, () => {
      expect(docs).not.toContain("`" + trophy.id + "`");
    });
  }
});

describe("docs/publishing.md: card-minting step names its card fields [M2]", () => {
  const cardStep = sectionByHeading(docs, "card fields");
  const outsideCardStep = docs.replace(cardStep.body, "");
  const CARD_FIELDS = ["cardSetName", "metal", "file", "title"] as const;

  for (const field of CARD_FIELDS) {
    test(`names \`${field}\` inside the step`, () => {
      expect(cardStep.body).toContain("`" + field + "`");
    });
  }

  // Leg (c): the same four assertions, run against the whole file minus
  // this step's own slice, must NOT all pass — otherwise these checks
  // would be satisfied by a field name mentioned only in some unrelated
  // paragraph, rather than by this step actually naming its fields.
  test("the four fields do not all also appear backticked outside the step", () => {
    const allFourElsewhere = CARD_FIELDS.every((field) =>
      outsideCardStep.includes("`" + field + "`")
    );
    expect(allFourElsewhere).toBe(false);
  });
});

describe("docs/publishing.md: Hope Coin handoff step [M3]", () => {
  const coinStep = sectionByHeading(docs, "hope coin handoff");
  const outsideCoinStep = docs.replace(coinStep.body, "");
  const COIN_TOKENS = ["hopeCoin.history", "holder", "from", "how", "to"] as const;

  for (const token of COIN_TOKENS) {
    test(`names \`${token}\` inside the step`, () => {
      expect(coinStep.body).toContain("`" + token + "`");
    });
  }

  test("the tokens do not all also appear backticked outside the step (leg c-equivalent)", () => {
    const allElsewhere = COIN_TOKENS.every((token) =>
      outsideCoinStep.includes("`" + token + "`")
    );
    expect(allElsewhere).toBe(false);
  });

  // Leg (d2): naming the fields is not enough on its own — a step that
  // lists `holder`, `from`, `how`, and `to` without saying which stop each
  // belongs to would tell Charlie to fill in a field on the wrong entry.
  test(`distinguishes "the new stop's" fields from "the previous stop's"`, () => {
    expect(coinStep.body).toContain("the new stop's");
    expect(coinStep.body).toContain("the previous stop's");
  });
});

describe("docs/publishing.md: player bio step [M3]", () => {
  // Located by its own heading, separate from the coin-handoff step above,
  // per the brief: "a separate step covers editing a player bio."
  const bioStep = sectionByHeading(docs, "player bio");

  test("names `bio` inside the step", () => {
    // A plain substring check here would be satisfied by a longer word
    // like "biography" containing "bio" — but it would NOT be satisfied by
    // one containing the exact backticked form `bio`, since "`biography`"
    // does not contain the substring "`bio`" (the character after "bio"
    // inside that word is "g", not a closing backtick). Backticking the
    // field name is itself what rules out the accidental substring match.
    expect(bioStep.body).toContain("`bio`");
  });
});

describe("docs/publishing.md: adding a trophy step [M1]", () => {
  test("has its own heading, separate from the other three steps", () => {
    // Existence check only: sectionByHeading() throws if this heading is
    // missing or ambiguous, which is the assertion.
    expect(() => sectionByHeading(docs, "adding a trophy")).not.toThrow();
  });
});

describe("CLAUDE.md no longer parks the trophies/rarity-ladder bullet [M4]", () => {
  test("no line mentions both trophies and a rarity ladder", () => {
    const offending = claudeMd
      .split("\n")
      .filter((line) => /trophies/i.test(line) && /rarity ladder/i.test(line));
    expect(offending).toEqual([]);
  });

  // This plan does not touch the 2020 / April+June 2026 backfill item, and
  // the brief is explicit that bullet "stays exactly as it is" — so its
  // continued presence is part of what this test protects, not just an
  // absence of the other one.
  test("the 2020 / April+June 2026 backfill bullet is untouched", () => {
    expect(claudeMd).toContain(
      "April + June 2026 and the 2020 season are not yet in `games.json`"
    );
  });
});
