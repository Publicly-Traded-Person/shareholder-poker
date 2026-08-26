# poker.kmikeym.com: TCG Design Pass

**Date:** 2026-08-26
**Status:** Draft for Mike's review
**Author:** Nova-shareholder-poker
**Prior spec:** `2026-08-17-poker-quarterly-systems-design.md` (this pass closes its §4
trophies gap and §7 rarity-accent gap; it changes no privacy tier and no publish invariant)

## 1. What this is

A design pass over the live site, driven by a survey of the best TCG sites on
the web. The site works; it does not yet look like what it is, a trading-card
economy with real stakes. Mike's call (BBS, 2026-08-25): the site must be
finished this week so The Drip can promote it the week of 9/01, ahead of the
September 8 game. Promo traffic arrives two ways, Discord links on phones and
newsletter links on desktops, so **mobile and desktop are both first-class**.
Today the desktop rendering is a stretched phone page.

Three goals, in order:

1. A stranger who lands on any page understands the site in five seconds.
2. The cards, the site's best asset, become its visual spine on every page.
3. Charlie can still maintain every page he could maintain yesterday.

## 2. What the reference sites teach

Surveyed 2026-08-26: Scryfall (set galleries, desktop and mobile), Limitless
TCG (tournament results), the official Disney Lorcana card gallery, and
simeydotme's Pokemon-cards CSS holographic work.

1. **Cards are the interface.** Scryfall renders pure card-image grids, 4-up
   on desktop, 2-up nearly edge-to-edge on mobile, with no text boxes under
   the cards. The card art carries its own metadata.
2. **Section headers are hairline rules with centered small-caps labels and
   counts** ("SHOWCASE CARDS · 29 CARDS").
3. **Tables earn card-world identity through small inline marks.** Limitless
   places a crown icon beside past champions and deck sprites in every row,
   in compact zebra rows.
4. **One event, several lenses.** Limitless heads each tournament with a stat
   strip and tabs (Results, Decklists, Statistics, Cards). Related views are
   chrome, not buried text links.
5. **Chrome is drawn, never typed.** Lorcana's filters are custom glyph
   badges. Emoji as UI markers reads as a placeholder next to crafted card art.
6. **Foil behaves like foil.** The holographic effect is pointer-driven CSS
   custom properties feeding gradients, blend modes, and a small 3D tilt.
7. **A pack rip is a sequence, not an image.** Anticipation, then the deal,
   rarity last.

Layout constant across all three sites: content sits in a ~1000 to 1100px
container with dense internal structure, never a single narrow prose column.

## 3. Layout system

The one structural change everything else hangs on.

- `.band-inner` stays at 720px for prose bands. Reading copy stays narrow.
- New `.band-inner--wide`, max-width 1080px, for card grids, tables, and
  two-column bands. Same centering, same padding.
- New `.cols` helper: CSS grid, one column below 900px, two equal columns
  above. Gap 2rem. This is the only breakpoint the site gains; every
  responsive behavior in this pass keys off 900px.
- Both classes live in `site/styles.css` with header comments explaining
  when each applies, so the next page author picks the right one without
  reading this spec.

## 4. Page by page

### 4.1 Home (`site/index.html`)

Structure and copy stay. Changes are presentation only:

- "The foil is in play" band goes `band-inner--wide` with the `.cols` split:
  card left, copy right. The card grows to ~300px on desktop and takes the
  holo treatment (§5).
- No new number surfaces. Every stat on the home page today is maintained by
  hand at publish time; adding more would grow Charlie's monthly edit. The
  chip-race story band spec'd in the prior spec §7 stays deferred (§10).
- The footer RSVP repeat is an open decision (§11.1).

### 4.2 Cards index (`site/cards/index.html`)

Today a two-item bullet list with no card art. It becomes a gallery:

- One row per set inside `band-inner--wide`: set name and date on the left,
  a strip of that set's six card thumbnails on the right (the existing PNGs,
  small), the whole row linking to the set page.
- Set 2 (in production) gets a card-back placeholder drawn in CSS: felt
  background, rarity rule, the words "In production". No new image assets.

### 4.3 Set page (`site/cards/2026-07/index.html`)

The flagship fix.

- "The set" band goes `band-inner--wide`; the grid minimum rises from 160px
  to 240px so the cards read at desktop sizes. Mobile stays 2-up.
- **The white caption boxes go away.** The card art already states name,
  handle, rank, and rarity. What remains under each card: one unboxed line of
  small muted text, a drawn rarity gem (§7.3) plus "Chris G. · Champion"
  form, because at mobile 2-up the painted card text is too small to lean on.
  The full detail stays in each image's `alt` text, which is already good.
- Section headers become rule-labels (§2.2): "THE SET · 6 CARDS".
- The foil card gets the holo treatment (§5) and keeps the shimmer as its
  no-JS fallback.
- The pack rip GIF is replaced or cut per §6.
- A one-line set plate under the h1 formalizes what the intro prose already
  says: `6 cards · minted July 14, 2026 · 201 hands`, in the `.stat` voice.

### 4.4 Standings (`tools/render.ts` → `site/standings/index.html`)

Closes the prior spec's §4: "all-time results, trophies, rarity ladder".

- A trophy row above the table, two bordered tiles in `band-inner--wide`:
  - **The Foil**: reigning champion (winner of the latest game), foil accent
    border via `.rarity-foil`, linking to the current set page.
  - **The Hope Coin**: holder, held-since date, skull counts, drawn coin and
    skull marks (§7.3).
  Both tiles derive from `games.json` through the existing `deriveStandings`;
  no new hand-typed numbers, per the brand numbers rule.
- The table gains small inline marks beside names: a foil gem for the
  reigning champion, the coin for the holder. Marks are inline SVG emitted by
  `render.ts`, never emoji.
- The `🪙` in the Hope Coin heading becomes the drawn coin.
- Table and tiles sit in `band-inner--wide`; row padding tightens so ten
  players fit one desktop screen.

### 4.5 Games index (`tools/render.ts` → `site/games/index.html`)

Today a bullet list. Each game becomes a bordered row card in
`band-inner--wide`: the date as display type, the winner's name in
`--foil-deep`, a stat strip (`entries · pot · hands`), and links to the game
page and, where one exists, that month's card set.

The set link needs data: `games.json` game objects gain an optional
`cardSet: "YYYY-MM"` field naming the set page directory. Additive, canonical
formatting preserved, validated by the existing data tests (extend
`tools/data.test.ts` to check the referenced directory exists).

### 4.6 Game pages (`site/games/<date>/index.html`, hand-authored)

- A lens row under the h1 on both committed pages: `Story · Results · Chip
  race · Cards · Standings` as outline pills (anchor links within the page,
  plus cross-page links). This is pattern §2.4.
- The stat line under the h1 keeps its content and gains the stat-strip
  treatment (bordered, mono, single line that wraps on mobile).
- The August page's results table renders with extreme row heights on mobile
  (~130px per row against the standings page's ~40px for the same `.ledger`
  class). Diagnose and fix during implementation; the styles must end up
  shared, not forked per page.
- These are committed pages: the fix is a one-time hand edit to both, and
  the **narrative-page template in `docs/publishing.md` changes in the same
  commit** so future game pages are born with the lens row and stat strip
  (repo rule: runbook and behavior change together).

### 4.7 Chip race pages and 404

No layout work. They get the chrome sweep only (§7): favicon link,
`aria-current` nav, meta description.

## 5. The foil holo effect

Makes the foil card behave like a foil, on the two pages it appears (home,
set page).

- **Written from scratch.** The simeydotme repository has no license; we
  take the published technique, not the code. The technique is standard:
  pointer position writes two CSS custom properties, CSS derives a small
  3D tilt (max ~10deg), a moving glare (radial gradient, screen blend), and
  a rainbow band (linear gradient, color-dodge, masked to the card).
- **Vanilla JS, one new file `site/holo.js`, target under 60 lines** plus a
  styles.css block. No build step, per repo invariant. File and function
  header comments per repo comment rules.
- Applies only to `.card-frame--holo`, which only the foil card carries.
  Scarcity of the effect is the point: the site's rule that a champion's
  gold means something extends to motion.
- **Fallbacks, in order:** no JS → the existing shimmer animation; touch-only
  device → shimmer (no pointer to track); `prefers-reduced-motion: reduce` →
  fully static, shimmer off too (the existing guard already does this).
- Performance: transforms and opacity only, one rAF throttle, `will-change`
  applied on pointer-enter and removed on leave.

## 6. The pack rip

The current 520KB `pack-rip.gif` renders as a near-black rectangle and reads
as a broken image. Two options, decision in §11.2:

- **(a) Cut it now.** Remove the GIF and the band; the set grid above is
  the reveal. Ships this week, saves 520KB.
- **(b) Deal the set.** Replace the GIF with a tap-through deal: the six
  card PNGs stacked as a deck, each tap deals the next card, commons first,
  foil last. Vanilla JS, button semantics for keyboard access,
  reduced-motion shows the dealt row statically. No new assets. Roughly a
  day with polish.

Recommendation: (a) for the promo deadline, (b) filed as a follow-up issue.
The pack-rip concept stays in the prior spec either way.

## 7. Chrome sweep

Small fixes, one pass, every page.

1. **Favicon.** `site/favicon.svg`, a card-suit spade in ink with a foil
   accent, plus `<link rel="icon">` on every page and in the `render.ts`
   page template. Kills the 404 every visit currently logs.
2. **Current-page nav.** Each page marks its own nav link
   `aria-current="page"`; `render.ts` emits it, committed pages get a
   one-time hand edit. CSS: sapphire underline plus weight, on the existing
   nav link styles.
3. **Emoji to drawn marks.** Every emoji doing UI work is replaced by inline
   SVG in the rarity metals: gems for foil/rare/uncommon/common, the coin,
   the skull. Sources today: set-page captions (`✨⭐◆●🪙`), the standings
   heading (`🪙`). Emoji inside narrative prose stays; this rule covers
   chrome, not Charlie's copy voice.
4. **Link unfurls.** Promo week means the URL gets pasted into Discord and
   Substack. Home and set pages get `og:title`, `og:description`,
   `og:image` (v1: the foil card PNG, absolute URL) and the twitter card
   tags; `render.ts` template gets the generic versions. Non-home pages also
   gain a one-line `meta description`.

## 8. What does not change

- Theme v2 tokens, band alternation, felt-and-lime quarantine, the masthead
  rarity rule (survey confirmed it renders correctly; the earlier "gap"
  report was a screenshot artifact).
- All copy voice and every narrative sentence. Microcopy this pass adds
  (labels, captions, meta descriptions) gets Charlie's content pass before
  merge.
- Privacy tiers, the RSVP function, `rsvp.js`, the publish pipeline,
  `games.json` canonical formatting (the §4.5 field is additive).
- The card PNGs themselves.
- No new binary assets enter git except `favicon.svg` (text) unless §11.3
  decides otherwise.

## 9. Acceptance checks

Every item runs before the PR is called done:

- `bun test tools` green, including the extended `data.test.ts`.
- Drift check clean: `bun tools/render.ts && git diff --exit-code` on the
  generated pages.
- `grep -rl "—" site/` empty; `grep -ril "experiment" site/` empty.
- Playwright pass at 390px and 1440px over all pages: no horizontal body
  scroll anywhere, tables scroll inside `.table-scroll`, cards render at
  their intended sizes, nav marks the current page.
- Favicon returns 200; zero console errors on every page.
- With `prefers-reduced-motion: reduce`: no shimmer, no holo, no deal
  animation.
- Set page total transfer weight ends at or below today's (the GIF leaves;
  nothing heavier arrives).
- Lime button count per page matches the §11.1 decision.

## 10. Out of scope (unchanged from the known-open-items list)

- `games.json` backfill (April, June, 2020); the record qualifier stays.
- Player pages (`/player/<slug>`, reserved in the prior spec).
- The home-page annotated chip-race story (prior spec §7). When built, it
  starts with the dataviz skill, per that spec.
- Set 2 card assets and page (waiting on production).
- Newsletter integration beyond the existing footer link.

## 11. Decisions (settled by Mike, 2026-08-26)

1. **One lime action per page.** The hero submit stays lime; the footer
   RSVP jump drops to the white outline style (`.btn-secondary`). This
   reading reconciles `docs/brand.md` (one lime CTA per page) with the
   prior spec §7 ("RSVP again"): the action repeats, the lime does not.
2. **Pack rip: cut now.** The GIF and its band go; the set grid is the
   reveal. The tap-through deal (§6b) is filed as a follow-up issue.
3. **OG image: the foil card PNG**, absolute URL. A composed 1200x630
   image is filed with the pack-rip follow-up.
