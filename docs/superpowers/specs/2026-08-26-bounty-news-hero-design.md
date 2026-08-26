# poker.kmikeym.com: Bounty Board, News Band, Hero Fan

**Date:** 2026-08-26 (second pass, same day as the TCG design pass)
**Status:** Approved direction (Mike: "spec 1, 2, and 3 and let's build them")
**Author:** Nova-shareholder-poker
**Prior specs:** `2026-08-26-tcg-design-pass-design.md` (shipped, PR #10);
`2026-08-17-poker-quarterly-systems-design.md` (the site spec)

## 1. What this is

Three home-page features drawn from the official-TCG-site research pass
(Flesh and Blood, Star Wars Unlimited, One Piece Card Game, Marvel Snap,
surveyed 2026-08-26): a bounty board, a news band, and card art in the hero.
Together they give the home page the "official game site" grammar: art-led
hero, news feed, and in-world artifacts as UI. Everything ships inside the
locked brand system (light bands, rarity metals, system sans, one lime CTA,
no build step).

**The signature element is the bounty board.** The hero fan and news band
stay disciplined inside the existing tile and stat grammar; the board is
where this pass spends its one aesthetic risk.

## 2. The bounty board (the signature)

A new parchment band (`band-dark`, `band-inner--wide`) titled "The bounty
board", holding two posted notices. The design risk: the notices are the
site's first rotated objects, styled as typed notices pinned to a board,
which is the One Piece wanted-poster idea translated into our ledger world.

Each `.notice` is a white card (existing tile border + shadow grammar) with:

- a drawn pushpin dot centered on the top edge (a small filled circle,
  copper for notice 1, foil for notice 2; drawn CSS, never emoji),
- a mono uppercase eyebrow: `BOUNTY · OPEN`,
- a display headline,
- body copy,
- a mono reward line with a drawn mark: `REWARD: ONE SHARE` (foil gem) and
  `REWARD: THE HOPE COIN` (coin mark),
- a static rotation: notice 1 at -1.2deg, notice 2 at +1deg. Rotation is a
  static transform, not motion, so it is not gated on
  `prefers-reduced-motion`.

The two notices:

1. **Cain and Abel.** Body: the existing "Legends of the table" paragraph
   moves here verbatim (it already is the bounty's story). The brother stays
   unnamed, exactly as the published copy has it. Reward: one share.
2. **The Hope Slayer hunt.** Body: static copy stating the rule (three
   kills on the holder takes the Coin) with a runtime-filled tally of
   hunters and their skull gems (§5). The static sentence reads complete
   without the tally. Reward: the Hope Coin.

Constraints: no lime anywhere in the band; the only link is an outline link
to `/standings/`. Per `docs/brand.md` "Held-back copy", **no new
card-economy CTA line is written**; the board reuses published copy only.

The "Legends of the table" band stays, keeping only the 29,968-chip
collapse story (its Cain and Abel paragraph moved to the board; no
duplication).

## 3. The news band: "Latest from the table"

Replaces two full-width prose bands ("Last game, hand by hand" and "The
Hope Coin") with one 3-up tile band, the FAB/SWU news-feed pattern. Reuses
the `.tiles` grammar with a three-column modifier at the 900px breakpoint.

- **LAST GAME** (eyebrow): one hand-written narrative line (Charlie's,
  monthly), a runtime-filled mono stat line (date · winner · entries · pot
  · hands), and a link to the latest game page (href runtime-filled; static
  fallback `/games/`).
- **THE CARDS** (eyebrow): hand-written line (current: Set 2 in
  production, reusing the cards-index copy), link to `/cards/`.
- **THE COIN** (eyebrow): one hand-written line, runtime-filled holder +
  held-since, link to `/standings/`.

Band heading: `h2.display` "Latest from the table" (home's section voice).

## 4. The hero fan

The felt hero band gains card art, the art-led-hero rule every reference
site follows. Desktop (≥900px): the band goes `band-inner--wide` with the
`.cols` split, copy + form left, a fan of three card PNGs right (card 1
LEWD in front, cards 2 and 3 behind, rotated roughly -8/0/+8deg,
overlapping, max height ~340px). Mobile: a compact fan strip above the h1,
max height 96px, so the RSVP form stays near the top of the first screen.

Rules: reuses the committed PNGs (no new assets); static art with no
shimmer or holo (the foil band below keeps that exclusivity); decorative
`alt=""` (the set page carries the descriptions); the hero keeps its single
lime CTA unchanged.

## 5. Runtime facts: `site/home-facts.js`

The mechanism that keeps the new bands honest without adding hand-typed
numbers. Follows the `site/rsvp.js` precedent exactly (the next-game date
already comes from `/data/games.json` at runtime; header comment there
states the doctrine).

- New file `site/home-facts.js`, loaded with `defer` from the home page
  only. Budget: under ~90 lines, Charlie-density comments.
- Fetches `/data/games.json` once; derives: the latest game (max date),
  its winner display name (players map), its stat line; the Hope Coin
  holder + since; skull tallies per hunter (count `"hope-slayer"` in each
  player's trophies across games; this duplicates `deriveStandings` in
  ~6 lines because `tools/` is Bun TypeScript and `site/` is no-build JS,
  and the file says so in a comment).
- Fills empty, supplementary elements by id (`fact-last-game`,
  `fact-last-game-link`, `fact-coin`, `fact-skulls`). Every slot is
  invisible-when-empty; the hand-written copy around them reads complete
  without JS. Skull gems render as the established inline SVG marks.
- On any fetch or parse failure it does nothing (the static page stands).

Charlie's monthly touch shrinks to the two one-liners (Last game, The
Coin) plus, when the Coin moves, the notice body; `docs/publishing.md`
gains that step in the same change (the runbook currently never mentions
the home page at all, which this pass fixes).

## 6. What does not change

Theme tokens and band alternation (the new order alternates cleanly: cta
hero, light foil, dark news, light legends, dark bounty board, light how-
the-night-runs, cta, light footer); the RSVP flow and `rsvp.js`; every
page other than `site/index.html`; the generated pages and `games.json`;
the one-lime rule (the hero's button remains the page's only lime); no new
binary assets; no em dashes; "experiment" never; names First L. only.

## 7. Acceptance

- `bun test tools` green, including new home invariants (notice count,
  news tiles, home-facts script tag, still exactly one `btn-primary`).
- Brand greps empty; drift check clean (generated pages untouched).
- Dual-width pass at 390px and 1440px: fan beside copy on desktop, compact
  above the heading on mobile with the form high on the page; tiles 3-up
  desktop, stacked mobile; notices readable and rotated.
- With JS disabled: home reads as complete prose, no empty-looking holes.
- With `prefers-reduced-motion: reduce`: nothing on the new bands moves
  (nothing animates on them at all).

## 8. Out of scope

Ticket-stub styling on `/games/` (idea 5), the sitemap footer (idea 6),
the photo band (idea 7, parked on privacy), any Discord link, and any
change to the card-economy held-back copy.
