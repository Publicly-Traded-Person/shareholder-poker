# Brand + design rules — poker.kmikeym.com

The rules every page on this site ships under. They came from the KmikeyM brand
book and the site's design spec; if a change collides with one, flag it to Mike
rather than absorbing the collision. Charlie owns this page's content.

## Copy

- **No em dashes.** Anywhere, ever. Comma, period, colon, or parens instead.
- **The word "experiment" never appears.** Use "market in a person",
  "publicly traded person", "binding votes".
- **Dignity rule.** Every player mention reads as the *positive* aspect of that
  player's style. Truth-based, never mean. "Ultra-passive nit" becomes "The
  Patient Rock". Real people, real shareholders, read these pages.
- **Held-back copy.** One card-economy CTA line is deliberately unpublished,
  pending Mike's reveal decision. It is not written down in this repo on
  purpose. Before adding any card-related call to action, ask Mike or Charlie.
- **Names.** Player display names are **first name + last initial** ("Chris
  G."), never a full surname — anywhere in this public repo, including slugs,
  test fixtures, and docs — so nobody can google a player and find their poker
  record (Mike, 2026-08-18; supersedes the 2026-07-15 full-name clearance).
  Handles are the players' own public gamer tags and stay as-is.
  `tools/data.test.ts` enforces the format on `games.json`; if any individual
  player objects even to this, drop to handle-only for that person.
- **Numbers.** Anything derived from a game comes from `site/data/games.json`,
  never typed by hand. Hand-typed stats are how scoreboards rot.

## Color

- **Palette = the card rarity ladder:** foil gold `#c9a227`, sapphire
  `#2b5d9e`, copper `#b06c3f`, pewter `#8a8d91` (tokens in
  `site/styles.css`). Accents, rules, standings highlights all draw from
  these four. A champion's gold means something; don't use it decoratively.
- **Lime `#c6f43a` is quarantined.** Exactly ONE primary CTA per page (the
  RSVP action), always lime, never adjacent to a rarity metal — it sits on
  its own dark neutral band (`band-cta`). All other buttons are
  white/black/outline per background.

## Layout

- **Sections alternate light and dark bands.** Never stack two of the same
  tone. Classes: `band-light` / `band-dark` / `band-cta`.
- **Mobile first.** The entry path is a Discord link on a phone. Wide content
  (tables, charts) scrolls inside its own container (`table-scroll`); the page
  body never scrolls horizontally.
- **Type:** condensed heavy display face for names and finishes (`display`),
  monospace for every stat (`stat`) so the fixed stat schema aligns as a set.
- **Motion is guarded.** Shimmer and pack-rip effects run only under
  `prefers-reduced-motion: no-preference`.

## Privacy (summary — full version in the design spec)

- Emails, RSVP/roster rows, and raw PokerNow logs **never enter this repo**.
  The RSVP GET endpoint never returns an email.
- No money-owed / collections content on any page. Results and payouts are
  public; who still owes whom is not.

## Before any merge to main

`main` deploys to poker.kmikeym.com automatically. Pre-merge checklist:

```
grep -rl "—" site/                 # must be empty
grep -ril "experiment" site/       # must be empty
bun test tools                     # must pass
```

Copy changes get Charlie's content pass; everything public gets Mike's go.

*Sources: KmikeyM brand rules · `docs/superpowers/specs/2026-08-17-poker-quarterly-systems-design.md` §7 · plan Global Constraints.*
