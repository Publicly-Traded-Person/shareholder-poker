# Publishing a game (the runbook)

Ratchet status: pass 1 (one command + narrative + Mike's go). Each pass
removes a named manual step; see the plan and spec section 6.

## Game night + day after

1. Export the PokerNow log CSV. It is PRIVATE; it never enters this repo.
2. Write `results.json` (the judged part): `[{handle, finish, payout, rebuys, trophies}]`.
3. Run: `bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json`
   - Halts on chip-conservation mismatch or an unknown handle. Fix the input,
     never the check.
4. Write the narrative page `site/games/<date>/index.html` (copy an existing
   game page shell). Dignity rule; no em dashes; no collections/owed content.
   The shell includes the head chrome (favicon link, meta description from
   the stat line, and the og:title/og:description/og:image/og:url/og:type
   plus twitter:card link-unfurl block so a shared game link previews
   correctly), the lens pills under the h1 (Story · Results · Chip race
   · Standings, plus "The cards" once the month's set page exists), the
   `stat stat-strip` fact line, `id="story"`/`id="results"` anchors, and
   `ledger ledger--notes` on the results table. Copy the newest game page
   to get all of it.

   Home page: refresh the three news one-liners ("Last game", "The cards",
   "The coin"), and the bounty notices if a bounty was settled or the Coin
   moved. The numbers under them fill themselves from games.json at runtime
   (site/home-facts.js); never type numbers into the home page.
5. Update `nextGame` in `site/data/games.json`.
6. Review the full diff. Get Mike's explicit go. Push. Cloudflare deploys.
7. Board: comment results on the month's game issue, close it, open next
   month's issue, add to project #1.

## Cards (per set, still manual by design)

Card copy is judgment; it does not automate. Render per
`munger/ccg/launch-aug-2026/ASSETS.md`, add `site/cards/<YYYY-MM>/`.

Building the set page: copy the NEWEST set page (`site/cards/2026-07/` today)
into the new directory and swap its content. Four of its choices are
deliberate design rules, not accidents of the July page, so keep them:

- **Captions are one unboxed line** under each card: a drawn gem SVG plus
  "Rarity · First L. · Title". Never a white caption box, never emoji, and
  never a surname. The card art itself carries name, handle, and rank; the
  caption exists only because the painted text is small at phone sizes.
- **`card-frame--holo` goes on the foil card only.** The pointer-tilt effect
  is exclusive by design: a champion's foil means something because nothing
  else moves. Every other card is plain `card-frame shimmer`-free.
- **There is no pack-rip section.** The July GIF was cut on purpose (it read
  as a broken image); its replacement is a filed follow-up
  (shareholder-poker#11). Do not resurrect it from the July launch assets.
- **Head chrome comes with the copy:** favicon link, meta description, and
  the og:/twitter unfurl block with the new set's own og:title and og:url.
  Update the set plate line (cards · minted date · hands) and the footer's
  "game these cards came from" link to the new game.

Order matters: create `site/cards/<YYYY-MM>/index.html` BEFORE adding
`cardSet` to `games.json`, because the data suite fails on a `cardSet` whose
page directory does not exist yet.

When the set page ships, add `"cardSet": "YYYY-MM"` to that game's object in
`site/data/games.json` (after `"pot"`), add the set to the gallery rows in
`site/cards/index.html`, and re-run `bun tools/render.ts` so the games index
links it. The data suite checks the referenced page exists. In the same
change, refresh the home page's "The cards" tile (`site/index.html`) so it
names the set that just shipped instead of the one still in production; it
is hand-typed copy, not runtime-filled, so nothing else will catch it going
stale.

## Reminder export (emails, Tier 2)

`wrangler d1 execute poker-rsvp-db --command "SELECT email FROM rsvps WHERE game='YYYY-MM-DD'"`
prints to stdout. Never redirect into a file inside this repo.
