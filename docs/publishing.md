# Publishing a game (the runbook)

Ratchet status: pass 1 (one command + narrative + Mike's go). Each pass
removes a named manual step; see the plan and spec section 6.

**Running the suite writes to `site/`, so commit the regeneration before you
test.** `bun test tools` is not read-only: one of its checks
(`tools/site.test.ts`, "the generated paths clean") re-runs
`bun tools/render.ts` for real, in place, to prove the committed standings
page, games index, calendar file, player pages, and Hope Coin page are
exactly what the generator produces. That check refuses to run at all while
any of those five paths is uncommitted - it names the dirty path in its
failure message - because it cannot tell your fresh regeneration apart from
a hand-edit it would otherwise silently overwrite.

This refusal is not a rare misfire. You will hit it every single time you
follow this runbook's own step 5, because that step's own instruction is
"re-run `bun tools/render.ts`," which is exactly what leaves those five
paths dirty. Expect it, and work in this order:

1. Regenerate (`bun tools/render.ts`, as step 5 says).
2. Commit the generated pages (the five paths above, or the whole diff).
3. Run `bun test tools` on a clean tree.
4. Review the diff.

The same refusal fires for the reason it exists: an uncommitted hand-edit to
any of the five paths trips it too, on purpose, so it never silently
overwrites work you meant to keep. Either way the fix is the same - commit
or stash the dirty path, then run `bun test tools` again.

## Game night + day after

1. Export the PokerNow log CSV. It is PRIVATE; it never enters this repo.
2. Write `results.json` (the judged part): `[{handle, finish, payout, rebuys, trophies}]`.
3. Run: `bun tools/publish-game.ts <log.csv> --date YYYY-MM-DD --results results.json`
   - Halts on chip-conservation mismatch, an unknown handle, or a trophy id
     in `results.json` that is not one of the ids in `tools/lib/trophies.ts`.
     Fix the input, never the check.
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

   Backfilling an old season instead of publishing a new game? Delete that
   season from `backfillPending` (top of `games.json`) in the same commit.
   The "This record starts with ..." line on standings and the games index
   derives from the earliest game on the spine plus that list; the list is
   the only thing that knows a season is still missing, so an entry left
   behind would keep announcing a backfill that already happened.
6. Review the full diff. Get Mike's explicit go. Push. Cloudflare deploys.
7. Board: comment results on the month's game issue, close it, open next
   month's issue, add to project #1.

## Hope Coin handoff (same commit as the game that moved it)

When the Coin changes hands at a game, append one stop to `hopeCoin.history`
(top of `site/data/games.json`) in the same commit as that game's own
publish. A handoff touches three things. `validateCoinHistory`
(`tools/lib/hope-coin.ts`, wired into `tools/data.test.ts`) is the chain
validator that catches a half-done handoff — a stop with no `to` that is
not actually the last one, a summary that disagrees with the last stop,
stops out of order, or a stop whose `to` does not match the next stop's
`from`. It only checks; it does not write anything for you, so still do
all three by hand and then run `bun test tools` before you commit:

- Append a new stop to `hopeCoin.history` with the new stop's `holder` (the
  slug it moved to), the new stop's `from` (the date it moved, YYYY-MM-DD),
  the new stop's `how` (one plain sentence: what happened, nothing more),
  and, when it is known, the new stop's `place`.
- Set the previous stop's `to` to that same date. The previous stop is
  whichever stop was last in `hopeCoin.history` before this one; it is the
  only field on it that still needed closing.
- Update the two summary fields at the very top of the file to match the
  new last stop: `hopeCoin.holder` becomes the new stop's `holder`, and
  `hopeCoin.since` becomes the new stop's `from`.

Do all three in the same edit. `bun test tools` now checks the chain end to
end (that the summary agrees with the last stop, that every earlier stop's
`to` is filled, that stops run oldest to newest with no gap between one
stop's `to` and the next stop's `from`), so leaving a piece out fails the
suite instead of quietly publishing a Coin page that tells two different
stories. Read the failure message; it names the stop and the fields that
disagree.

### Prepending a remembered pre-spine stop

Everything above is the APPEND case: a new stop becomes the new last stop,
closing off whichever stop used to be last. Recovering an earlier stop Mike
now remembers - a hop the Coin made before the earliest stop already on
file - is the opposite edit. Following the append bullets above for it
would build a broken chain (there is no "previous stop" to close; the
remembered stop comes before everything already in the array), so do this
instead:

- Insert the new stop at the FRONT of `hopeCoin.history` (index 0), not the
  end.
- Set the new stop's `to` to whatever date was, until this edit, the first
  stop's `from`. That is the one date that keeps the chain unbroken: the
  remembered stop now hands off, with no gap and no overlap, to the stop
  that used to be first.
- Leave the new stop's `from` off entirely when Mike does not remember the
  exact date the Coin arrived there. Only the first stop in the array may
  omit `from`, and after this edit the new stop IS the first one.
- If the remembered holder has never appeared in `hopeCoin.history` or on
  any game's roster, add them to `players` (top of `games.json`) so the
  page has a name to show, not a bare slug. A holder with no games of their
  own is a legitimate roster entry; they never get a page under
  `site/player/` (that only happens on a slug's first game result), but the
  Hope Coin page still names whoever it says held the Coin.
- The two summary fields at the top of the file, `hopeCoin.holder` and
  `hopeCoin.since`, do NOT change for a prepend. They describe who holds
  the Coin right now, and a stop about its distant past never touches that.

Run `bun test tools` after a prepend the same as after an append.
`validateCoinHistory` is what catches a mistake either way - it does not
have a separate "prepend mode," it just checks the whole array's shape, so
a broken prepend fails the exact same rules a broken append would.

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

### Card fields on every result

Minting a set also touches two things on the `games.json` side that the
steps above do not cover, because they live on the game's data, not on the
set page itself. Do these in the same commit as the set page:

- The game itself gets `cardSetName`: the set's own display name, exactly
  as it reads on the set page, for example "The Founder's Table". Add it
  beside `cardSet` (same game object). The "card cross-check" describe
  block in `tools/site.test.ts` (Task 5) checks the pair over every game in
  the real data: a game carrying `cardSet` with no `cardSetName` now fails
  the suite, so a skipped `cardSetName` is caught before it merges.
- Every result in that game gets a `card` block with three fields: `metal`
  (one of `foil`, `sapphire`, `copper`, `pewter`, which the pages name
  Foil, Rare, Uncommon, Common), `file` (the filename under
  `site/cards/<cardSet>/assets/`, nothing more), and `title` (the caption
  title exactly as it reads under that card on the set page, never a
  paraphrase).

A set that ships with some results carrying a `card` block and others
missing it is a half-done state. The same card cross-check (Task 5) catches
it: it fails whenever an asset under `assets/` is claimed by no result, or
by more than one, so an incomplete fill is caught before it merges. Finish
all of them yourself, before the commit that ships the set page.

## Player bio (optional, one paragraph)

A player's `bio` (their entry in the `players` array, top of `games.json`)
is one paragraph in Charlie's own words, written for the public to read on
that player's page. It follows the same dignity rule as everything else in
`site/`, and it is never lifted from the vault's private notes; write it
fresh for this page, even if a private note already says something similar.

Leave `bio` absent when there is nothing ready to publish yet. The page
simply renders with no analysis block in that case; an absent `bio` is a
complete, valid state, not a placeholder waiting to be filled.

## Adding a trophy

A new trophy is one entry in `tools/lib/trophies.ts`: an id, a name, an
earn line, a look, and, for anything derived from the record rather than
judged by a human at the table, a rule. That file is the single place a
trophy gets added; read its own header comment before adding one. Do not
copy its list of ids into this runbook: a copied list is a second list that
goes stale the moment the real one changes, and Charlie should always be
reading the one true list, not a snapshot of it.

After adding an entry, run the suite (`bun test tools`). It rejects a
malformed entry, such as a missing field or a rule left off a trophy that
needs one, before it can reach a page.

## Portrait consent (per set, Tier 2b)

Card portraits ship only with the player's yes, given on a private page that
shows their actual card. Charlie stages the images; the tool does the rest.

### One-time setup (first set only)

Before the first set ever ships, run these commands from this repo's
root. The migration bullet below is the exception to "first set only": run
it against an already-deployed database too, since a database whose first
set shipped before this feature does not retroactively gain the column.

- Create the private bucket: `npx wrangler r2 bucket create poker-portraits`
  (running this again just reports the bucket already exists; harmless, but
  not silent)
- Apply the consent tables: `npx wrangler d1 execute poker-rsvp-db --remote --file site/schema.sql`
  (and the `--local` twin for rehearsal: `npx wrangler d1 execute poker-rsvp-db --local --file site/schema.sql`)
  This one is idempotent (`schema.sql` uses `IF NOT EXISTS`), so rerunning it
  later never breaks anything.
- Add the metal column to an already-deployed database (a database created
  from `schema.sql` fresh, after 2026-08-27, already has it and does not need
  this): `npx wrangler d1 execute poker-rsvp-db --remote --command "ALTER TABLE portrait_asks ADD COLUMN metal TEXT"`
  (and the `--local` twin: `npx wrangler d1 execute poker-rsvp-db --local --command "ALTER TABLE portrait_asks ADD COLUMN metal TEXT"`).
  Run this once per database. Running it again is harmless, it just errors
  with "duplicate column name", which you can ignore. This MUST run before
  deploying any version of the site that reads the `metal` column (the
  consent page's SELECT does, starting with this feature) - deploying first
  would 500 every existing portrait link.

### Every set

1. In munger, run `ccg/stage-candidates.sh` (Charlie's side). It produces
   `candidates/` with a `manifest.json` and `<handle>/<variant>.png` whole-card
   renders. Source photos never leave munger's gitignored `photos-raw/`. The
   manifest now also carries a `metal` per player (foil, sapphire, copper, or
   pewter, matching that player's card rarity); staging halts on a manifest
   entry missing it or naming anything else, same as an unknown handle - fix
   the input, never the check.
2. From this repo's root:
   `bun tools/portrait-asks.ts <path-to-candidates>`
   It validates the manifest against `games.json` handles (unknown handle
   halts, same as publish-game: fix the input, never the check), uploads the
   PNGs to the private `poker-portraits` R2 bucket, writes one ask per player
   into D1, and prints one link per player.
3. Hand the printed links to Mike. Sending them is HIS call and is held
   separately from any merge (they soft-reveal the set to the people on it).
   While `"portraitUploads": true` in `site/data/games.json` (the default
   from here on), a player can also skip the staged crops entirely and use
   their own photo instead: their browser dithers and composes it into the
   card art panel on their own device, and only that finished panel - never
   the original photo - is sent back to us. Using the picture on the page
   IS the approval; there is no separate confirm step for a self-upload.
3b. UPLOAD-ONLY ASKS, for a player nobody has a photo of (added 2026-09-01):
   `bun tools/portrait-asks.ts --stage-upload-only handle=metal[,handle=metal...] --set YYYY-MM`
   mints an ask with NO staged crops. The player's consent page then offers
   only the self-upload path: their own photo, dithered in their own browser,
   upload is approval, same as any self-upload. Metals are the four rarity
   names (foil, sapphire, copper, pewter), matching that player's card on the
   published set page; the page needs the metal to duotone the panel. Unknown
   handles halt, same as everywhere. Nothing goes to R2 at staging time.
   These asks age, answer, revoke, pull, and prune exactly like crop asks.
   Note that while uploads are flagged off, an unanswered upload-only page
   has nothing actionable on it (it says so neutrally); flip the flag before
   sending these links.
4. Check answers any time: `bun tools/portrait-asks.ts --status --set YYYY-MM`.
   (If it prints `retrying once`, see "When a wrangler call fails" below.)
   No admin page exists on purpose. A self-upload shows the same as any other
   approval, as `approved (self)`.
5. If a player asks in person to take their photo down:
   `bun tools/portrait-asks.ts --revoke <handle> --set YYYY-MM`
   That appends a declined row. It never deletes history: the ledger keeps
   the fact that consent was once given, and the latest row wins.
6. Before rendering any card whose status reads `approved (self)`, pull that
   player's panel down out of R2:
   `bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM`
   That writes `<handle>-self.png` in the current directory (or wherever
   `--out <path>` says); use it as that player's art in the render, in place
   of a staged crop. A staged crop needs no pull, it already sits on disk
   under `candidates/`. `--pull` refuses (halts, never guesses) unless the
   latest answer for that handle/set is `approved`/`self` - nothing to fetch
   for a decline, a not-yet-answered ask, or an approved staged crop.
   Pull runs before prune (next step) on purpose: once the print render has
   the pixels it needs, deleting a kept panel is a choice, not an accident.
7. Asks die on their own 60 days after staging (the link 404s). After a set
   is settled, `bun tools/portrait-asks.ts --prune` deletes the now
   unreachable candidate PNGs of expired asks from the bucket, so faces
   without a yes do not sit in storage forever. It deliberately spares one
   thing: an expired ask whose latest answer is `approved`/`self` keeps that
   self panel instead of deleting it, because a self-upload lives nowhere
   but R2 (a staged crop also sits on disk in `candidates/`, so losing the R2
   copy of a crop only costs a re-upload, not the only copy of consented
   art). Prune prints each kept panel on its own line, for example:
   `kept: asks/2026-08/genet/self.png (approved self panel; pull it for the
   print render, then delete it deliberately with wrangler if you are done
   with it)`
   If you are genuinely done with a kept panel after the print render ships,
   delete it yourself with `npx wrangler r2 object delete
   poker-portraits/<key> --remote`. The explicit `--remote` matters here the
   same as it does on every other r2 command in this runbook: without it the
   command can silently hit local dev state instead of the real bucket, and
   this is a deliberate one-off delete you want to land for real. Prune will
   never do it for you.

Rehearsal: add `--local` to any command to run against `wrangler pages dev`
state instead of production. Nothing in this flow touches git: candidate
images live only in R2, answers live only in D1.

### Standing portraits

kmikeym's card art is his approved self-upload panel, permanently: he
approved it on his own consent page (`approved (self)`, 2026-08-29, copper
duotone) and directed on 2026-09-01 that it be used on Set 1, Set 2, and
every future set. The panel lives in munger at `ccg/portraits-approved/`
(and stays in R2; prune spares approved self panels on its own). At render
time, attach it to his card the same way a staged crop is attached; his
rarity metal is copper in both existing sets, so the tint already matches.
No new ask is ever staged for him. If his rarity metal changes in a future
set, re-tint before rendering rather than shipping a mismatched panel.

### Turning uploads off

Self-upload is a standing feature, not a per-set toggle, but Mike can shut it
off at any time by signal. Flip `"portraitUploads"` to `false` in
`site/data/games.json`, PR that one-line change, and merge (every push to
`main` deploys). Consent already given does not evaporate: existing
`approved (self)` answers keep serving on their page and keep printing
exactly as before. The flip only stops new uploads - the upload block simply
stops rendering on every consent page from the next deploy on, flag-off and
no-ask/expired render the identical 404 on the endpoint itself.

## RSVP preflight + who has not RSVP'd (emails, Tier 2)

The roster table is seeded by hand from a gitignored file (emails never
enter git), so nothing in the repo can see whether the seed ever ran. It
sat empty for the site's first two weeks with every page rendering fine
(issue #26). The preflight makes that state loud:

```bash
bun tools/rsvp-status.ts             # roster rows + RSVP count for nextGame
bun tools/rsvp-status.ts --missing   # who on the roster has not RSVP'd yet
```

Run the counts line at the start of RSVP week (T-7) and before the
individual-outreach pass (T-4). `roster: 0 rows` means STOP and seed first;
the player list and seed procedure live in `K5M/Charlie/Poker/Poker
Roster.md`. `--missing` refuses to answer while the roster is empty, on
purpose: an empty result from an empty roster would be indistinguishable
from "everyone has RSVP'd."

Both verbs print to stdout only. `--missing` prints emails; that is the
allowed direction (stdout, never a file in this repo), but clear your
scrollback if you are screen-sharing.

## When a wrangler call fails

Both `portrait-asks.ts` and `rsvp-status.ts` talk to D1 and R2 through one
shared wrapper (`tools/lib/wrangler.ts`, issue #34). It applies two rules,
so you can read a failure without guessing:

- **wrangler printed an error**: the tool stops on the first try and shows
  wrangler's own message. That is a real problem (bad SQL, expired login,
  wrong binding). Fix it; do not just rerun.
- **wrangler exited nonzero with nothing on stderr**: this was seen three
  times on 2026-09-01 and 02 and cleared on rerun every time. The wrapper
  now retries that one call once by itself, printing
  `wrangler exited N with no output; retrying once` on stderr. You do not
  need to rerun by hand. If the retry also fails, the message says
  `failed twice` and shows both attempts' exit codes and output tails; that
  is worth debugging.

The retry wraps a single wrangler call, never a whole verb, so a staging
batch is never replayed (a replay could mint duplicate tokens).

## Reminder export (emails, Tier 2)

`wrangler d1 execute poker-rsvp-db --command "SELECT email FROM rsvps WHERE game='YYYY-MM-DD'"`
prints to stdout. Never redirect into a file inside this repo.
