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
   Then inject the chip race into it (the shell carries CHIP-RACE markers;
   the chart lives ON the game page, and old chip-race.html URLs redirect
   via `site/_redirects`):

   ```
   bun tools/chip-race.ts <log.csv> --date YYYY-MM-DD --start 5000 --inject site/games/<date>/index.html
   ```

   The tool halts if the markers are missing (copy the newest game page to
   get them) and overwrites everything between them, so never hand-edit
   inside the marker pair.
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
5. Update `nextGame` in `site/data/games.json`, then re-run
   `bun tools/render.ts`: the season page's next-game card, its upcoming
   projections, and `site/next-game.ics` all derive from `nextGame`, and the
   pre-merge drift check fails if the regeneration is skipped.
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

## Portrait consent (per set, Tier 2b)

Card portraits ship only with the player's yes, given on a private page that
shows their actual card. Charlie stages the images; the tool does the rest.

1. In munger, run `ccg/stage-candidates.sh` (Charlie's side). It produces
   `candidates/` with a `manifest.json` and `<handle>/<variant>.png` whole-card
   renders. Source photos never leave munger's gitignored `photos-raw/`.
2. From this repo:
   `bun tools/portrait-asks.ts <path-to-candidates>`
   It validates the manifest against `games.json` handles (unknown handle
   halts, same as publish-game: fix the input, never the check), uploads the
   PNGs to the private `poker-portraits` R2 bucket, writes one ask per player
   into D1, and prints one link per player.
3. Hand the printed links to Mike. Sending them is HIS call and is held
   separately from any merge (they soft-reveal the set to the people on it).
4. Check answers any time: `bun tools/portrait-asks.ts --status --set YYYY-MM`.
   No admin page exists on purpose.
5. If a player asks in person to take their photo down:
   `bun tools/portrait-asks.ts --revoke <handle> --set YYYY-MM`
   That appends a declined row. It never deletes history: the ledger keeps
   the fact that consent was once given, and the latest row wins.
6. Asks die on their own 60 days after staging (the link 404s). After a set
   is settled, `bun tools/portrait-asks.ts --prune` deletes the now
   unreachable candidate PNGs of expired asks from the bucket, so faces
   without a yes do not sit in storage forever.

Rehearsal: add `--local` to any command to run against `wrangler pages dev`
state instead of production. Nothing in this flow touches git: candidate
images live only in R2, answers live only in D1.

## Reminder export (emails, Tier 2)

`wrangler d1 execute poker-rsvp-db --command "SELECT email FROM rsvps WHERE game='YYYY-MM-DD'"`
prints to stdout. Never redirect into a file inside this repo.
