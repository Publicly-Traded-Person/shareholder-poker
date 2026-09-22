# What Would You Have Done? (design)

**Status:** spec, approved for build by Mike 2026-09-20; reviewed with Mike
by Nova the same day and amended (the rows marked *review* in section 2 and
the notes marked *review* below). **Builder:** Nova.
**Author of this spec and of the weekly hand files:** Charlie.

## 1. What it is

A weekly puzzle on poker.kmikeym.com. One real hand from the last game.
The visitor sits in one player's seat, sees that player's cards and the
action, and plays the hand out against the other players, who are driven
by rules built from their real profiles. When the hand ends the visitor
sees how many chips they finished with, what really happened at the
table, what everyone else who sat in that seat did at each decision, and a
leaderboard. Same deal for everyone, most chips wins.

Two jobs: keep the poker list engaged between games, and teach people to
play. It goes out to the poker list by email, once a week, the same way
the cards do.

## 2. Decisions already made (do not reopen without Mike)

| decision | choice | why |
|---|---|---|
| audience | anyone on the poker list; no login | RSVP pattern: email + display name, nothing else |
| identity | email + display name, entered once per hand, stored with the result | gives per-person stats across weeks without accounts |
| opponents | deterministic rules from each player's profile | "it's all programmatic so that everyone playing the sim has the same chance" |
| cards | fixed per hand, including holdings nobody showed, authored weekly | "cards are fixed, because that is the scenario" |
| score | chips finished with, from a fixed stack, on that one deal | "we just see who is able to get the most chips from that hand" |
| the reveal | what really happened, in one line, shown separately from the score | drama without pretending the real line was the right one |
| where it runs | the hand engine in the browser; one Pages Function records the result | nothing per visitor to host; instant; the hand is a reviewable file |
| commentary | none in v1 | no "you should have"; the leaderboard and the real outcome teach |
| ranking (*review*) | the first attempt ranks; replays are allowed, recorded, never ranked | the hand is deterministic, so replaying is a search for the ceiling; "each person's first attempt is what is logged, but they are allowed to play again" |
| the unknowns (*review*) | authored, and every page says so | "we have to guess or it's not fun"; the disclosure sentence is in section 3 |
| cheating (*review*) | not designed against in v1 | small audience playing honestly; a fake name to scout then a real name to win is a problem for later, if it happens |
| display names (*review*, amended *build* 2026-09-21) | what the player typed wins; their roster handle is the fallback when they type nothing | the review's rule cloned RSVP's `resolveDisplay`, where the handle beats the typed name. Playing the live puzzle Mike typed "Mike" and the board showed "kmikeym". An RSVP list answers "who is coming" and the handle is how the room knows each other; this is a field labelled Display name on a leaderboard, and a field that ignores what you put in it is a lie. The endpoint has its own `displayNameFor`; RSVP's helper is untouched |

## 3. Two constraints from the source material

**The log is one line.** PokerNow records what each player did, in order,
once. The moment the visitor's move differs from the seat player's, the
log has nothing more to say. That is why opponents are models and why the
hidden cards are authored: past the first deviation the hand is a
simulation, and the spec says so on the page.

**Hole cards are known only at showdown.** A player's cards appear in the
log only if the hand reached showdown, or if that player exported the
log. So the seat player must be someone who showed down (their cards are
real) and every opponent who folded before showdown gets a holding chosen
by Charlie when the hand is authored. Those holdings are fiction, chosen
to be plausible for that player's line, and the reveal labels them as
such: "Beau folded; for this puzzle he was holding K♣ 9♣."

*Review:* every page of the puzzle carries this, in the display voice: **This
is a simulation. The cards shown at showdown are the real ones. Everything
else was filled in with what we judged likely.** The reveal marks each authored
holding and an authored runout the same way.

## 4. Components

### 4.1 The hand file (data, authored weekly)

`site/data/wwyhd/<YYYY-MM-DD>-<n>.json`, one per puzzle, committed via
PR like everything else. Schema, v1:

```json
{
  "id": "2026-09-08-1",
  "game": "2026-09-08",
  "handNo": 212,
  "title": "Seven-deuce against the aces",
  "setup": "Table 1, blinds 400/800, seven-handed. Drew is on the button.",
  "seat": "MoHDI_Drew",
  "blinds": { "sb": 400, "bb": 800, "ante": 0 },
  "dealer": "joshb",
  "players": [
    { "handle": "joshb",      "stack": 61200, "cards": ["Ah","As"], "shown": true,  "profile": { "vpip": 36, "af": 2.14, "foldToRaise": 41, "callDown": 55, "allInRate": 0.4 } },
    { "handle": "MoHDI_Drew", "stack": 18900, "cards": ["7d","2c"], "shown": true,  "profile": null },
    { "handle": "bg",         "stack": 24400, "cards": ["Kc","9c"], "shown": false, "profile": { "...": "..." } }
  ],
  "board": ["7h","2d","Qs","7c","9d"],
  "real": {
    "actions": [ { "street": "PRE", "handle": "joshb", "type": "raise", "amount": 2400 }, { "...": "..." } ],
    "result": "Drew called the shove and won 38,600 with a full house. Josh finished the hand with 22,600.",
    "seatChips": 57500,
    "endStacks": { "joshb": 22600, "MoHDI_Drew": 57500, "bg": 24400 }
  },
  "startChips": 18900,
  "profileThrough": "2026-09-08",
  "opens": "2026-09-23",
  "closes": "2026-09-30"
}
```

Rules for the file:

- Every number that came from the log is copied from the log, never
  typed from memory. `shown: true` means the cards are real. `shown:
  false` means Charlie chose them, and the reveal says so.
- The seat player's `profile` is null: the visitor is playing that seat.
- `startChips` is the seat's stack at the start of the hand; the score is
  chips at the end minus nothing. Bigger is better; folding preflop
  scores `startChips` minus any blind already posted.
- `board` is the full five cards. If the real hand ended before the
  river, the remaining cards are authored, marked in the reveal.
- The dignity rule applies to `title`, `setup` and `result`: the strong
  side of every player, always.
- *Review:* `profile` numbers are the player's **lifetime** numbers from
  munger, not one night's, through the game named in `profileThrough`. Lifetime
  is steadier and closer to who the player is; the date lets a reader check
  the numbers against munger.
- *Review:* `closes` in the file is the only source of truth for when a puzzle
  stops ranking. Nothing infers it from the next puzzle's `opens`.
- *Build:* `real` carries `endStacks` as well as `seatChips`: a map from every
  handle at the table to that player's stack at the start of the NEXT hand,
  copied from that hand's `Player stacks:` line in the log. `wwyhd-check`
  replays `real.actions` through the engine and asserts the stacks it lands on
  equal `endStacks` exactly, which is what turns a mistyped number into a
  failure at Charlie's desk instead of a wrong puzzle on the live site.
  `seatChips` stays, as the seat's own figure the page shows, and must agree
  with `endStacks[seat]`. One seat's number could not catch a transcription
  error in anyone else's line; the whole table's can.
- *Build:* an action in `real.actions` carries `amount`, not `to`, and for a
  bet or a raise it is the TOTAL that player's contribution to the street
  becomes, the number PokerNow's "raises to N" prints. Fold, check and call
  carry `amount` 0. One field name, one meaning, everywhere in this feature.

### 4.2 The engine (browser, `site/wwyhd-engine.js`)

Plain JS, no framework, no build step, like `rsvp.js` and `card-zoom.js`.
Pure functions over a state object so the whole thing is unit-testable
under `bun test` without a DOM.

*Build:* this section named the engine `site/wwyhd.js` when it was written,
which is also the page controller's path (4.4), so the spec named one path as
two things. The engine is `site/wwyhd-engine.js`; the controller keeps
`site/wwyhd.js` and is described in 4.4 with the page it drives.

Responsibilities:

- Betting rounds for no-limit hold'em: preflop through river, blinds and
  antes, minimum raise, all-in, **side pots** (the one known-hard part;
  test it with three-way all-ins at different stack sizes). *Review:* the
  second classic trap gets its own tests: an all-in for less than a full
  raise does not reopen the action for players who have already acted.
- The visitor's action set at each decision: fold, check or call, and a
  bet or raise with a size picker (min, half pot, pot, all-in, plus a
  free entry). No advice, no highlighting.
- Opponent decisions via the rule table (4.3), called with the full
  visible state and the opponent's own cards.
- Showdown: seven-card hand evaluation. Use a small, well-known
  evaluator vendored into `site/` rather than an npm dependency at
  runtime, so the page stays a static file. *Build:* it is its own module,
  `site/wwyhd-eval.js`, imported by `site/wwyhd-engine.js`. One file per
  concern (evaluator, engine, rules, controller), and all four at `site/`
  root rather than under `site/wwyhd/`, so `site/wwyhd/` holds only
  generated pages and the renderer's drift check has nothing hand-written
  to trip over.
- Determinism: no randomness anywhere in the engine. Same hand file and
  same visitor choices produce the same chip count, every time, on every
  machine. A test asserts this by replaying a recorded line.
- Output: the chip count, and the visitor's line as a list of
  `{ street, type, amount }`.
- *Review:* one file, run in three places (browser, Worker, `bun test`).
  Nova checks first, in a local `wrangler pages dev`, whether the Function
  can import it from `site/` directly. If it can, there is one copy and
  nothing to drift. If it cannot, the Function carries a verbatim copy and a
  test fails the suite the moment the two differ, which is how munger keeps
  its userscript and `preflop.ts` in step.

### 4.3 The opponent rules (`site/wwyhd-rules.js`)

A readable decision table, not a neural anything. Inputs: the opponent's
profile numbers, their cards, the board, the pot, the amount to call, the
number of players still in, and position. Output: one action.

The profile numbers, all from the logs. Four exist already (see
`/cards/how-to-read/`); two are new and Charlie adds them to the
card-stat computation in munger:

| number | meaning | already computed |
|---|---|---|
| `vpip` | share of hands entered voluntarily preflop | yes |
| `af` | (bets + raises) / calls | yes |
| `allInRate` | all-ins per hand | yes (count; divide by hands) |
| `peak` | not used by rules | yes |
| `foldToRaise` | share of the time a raise in front of them was folded to | **new** |
| `callDown` | share of river bets faced that were called | **new** |

The v1 table, deliberately simple so it can be argued with in a PR:

1. Rank the opponent's hand strength on the current street into one of
   five bands (air, weak pair or draw, medium, strong, monster) with the
   evaluator plus a fixed preflop chart.
2. Preflop, unopened: enter the pot if the hand's chart rank is within
   the top `vpip` percent of starting hands; raise rather than call when
   `af` >= 1.5, otherwise call.
3. Facing a bet or raise: fold when the hand is below the band that
   `foldToRaise` implies (higher `foldToRaise`, higher the bar); call in
   the middle bands; raise with strong or monster when `af` >= 1.5, else
   call.
4. River, facing a bet: call with medium or better when `callDown` >=
   50, otherwise strong or better.
5. All-in: with a monster always; with strong when `allInRate` is above
   `ALL_IN_STRONG`, a named constant (*review:* not the table median, which
   would make one opponent's play depend on who else is seated and leave
   the per-regular fixtures with no canonical answer); never otherwise
   unless the call would be less than a fifth of the stack.
6. Every threshold is a named constant at the top of the file, with the
   number's source in a comment. No number is inlined.

The table is a starting point. The test suite fixes the action in a few
canonical spots, so a tuning change is visible as a diff in expected actions
and reviewed as such.

*Build:* those fixtures are four archetype profiles, not one per regular: a
rock, a calling station, an aggressor and a maniac, each a plausible set of
real numbers, invented rather than anyone's. Test fixtures in this repo are
synthetic by the privacy tier (section 3 and repo `CLAUDE.md`), so a real
player's numbers never sit in a file under `tools/`; they arrive inline in
each hand file Charlie writes, and `site/wwyhd-rules.js` reads them from
there. Four archetypes at the corners of the profile space also pin the
table harder than a dozen regulars clustered in its middle would.

*Build, 2026-09-21 (Mike, testing the live puzzle):* "the whole point of this
is that every player is acting a little differently... rules should be based
on the attributes of the players because they have different risk tolerances
and stacks and other stats." The six numbered rules above are a table of
universal decisions with a few profile inputs, and they played that way: an
opponent called an all-in with ace-five because every hand inside `vpip`
called every raise, and nobody bet when checked to because the table had no
bet in it at all. The rules now DERIVE each decision from the acting player's
own numbers, and `site/wwyhd-rules.js` exports `traits(profile)` so what a
player will do can be read off their profile alone:

| from | what it sets |
|---|---|
| `vpip`, and the seat | `entry(position)`: the percentile a holding must be inside to play, wider late, tighter early |
| `af` | `betBar`: the hand strength needed to bet into a check (four minus a slope times `af`), `raiseBar` above it, and `betFrac`, the bet as a share of the pot |
| `foldToRaise`, `callDown` | `continueBar(street)`: the strength needed to keep going against a bet, `callDown` taking over on the river |
| `allInRate`, `callDown` | `risk`, and from it `maxShare(band)`: the share of the stack this player will put in with a hand that strong |
| `allInRate` | `shoveBar`, and `commitShare`: how committed a raise must already be before all in is on the table |

The named constants left in `THRESHOLDS` are SCALE FACTORS, not decisions:
they say how steeply `af` moves a bet bar, not what any player does. Rule 6
above still holds, and no number is inlined.

Worked, from the September 8 profiles: at `af` 0.84 Chris H. bets a strong
hand and sizes it at 47% of the pot; at `af` 1.35 Mike M. bets a medium hand
and sizes at 57%; at `foldToRaise` 64 LEWD needs two pair to continue against
a flop bet where bg at 55 continues with a pair; at `callDown` 100
U_perfection calls a river bet with anything and at 25 LEWD needs a strong
hand. No two of the six have the same bar.

### 4.4 The page (`site/wwyhd/<id>/index.html`, plus `site/wwyhd/index.html`)

One job per page (Mike's standard, 2026-09-20; the rule is in
`CLAUDE.md` and the portrait pages are the model):

*Build:* the pages are generated by `bun tools/render.ts` and the one
hand-written thing behind them is the controller, `site/wwyhd.js`: it reads
the hand file, drives `site/wwyhd-engine.js` and `site/wwyhd-rules.js`, and
owns every bit of DOM work, so the three modules under it stay pure and
testable without a DOM. It guards its DOM work behind a `typeof document`
check so it imports cleanly under `bun test` too. This is the path 4.2
used to name for the engine.

- **Sit down.** The title, the setup line, the table drawn from the hand
  file (seats, stacks, the seat's cards face up, everyone else face
  down), and one button: Deal. Below it, the email and display name
  fields. *Review:* the RSVP form keeps nothing in the browser, so the
  puzzle page saves both fields to `localStorage` after the visitor's first
  submit and prefills them next time. No dependence on RSVP.
- **Play.** The action to you, the pot, the board as it comes, and the
  visitor's options. The opponents act with a short pause so the hand
  reads as a hand. *Changed 2026-09-22 (Mike, after Beau: "it needs a
  dramatic pause after the last action, it goes right to showing the
  result"):* this used to say "no text beyond what the table shows". The
  hand is short, so it is now paced for drama instead: the hole cards are
  dealt in one at a time, every action is captioned across the felt
  ("Beau G. raises to 540."), a street's cards land a beat after its last
  action, and a hand that ends with two or more players in goes to a
  showdown on the table (live cards turned over, authored ones labeled
  "for this puzzle", the board run out street by street with the river
  slowest, the pot pushed and the winner named) before one button, "See
  how you did", opens the reveal. The line is submitted the moment the
  hand ends, underneath the showdown. Skip runs the wait at no speed, and
  reduced motion cuts it to a fraction. Timing only: nothing paced decides
  anything, and the chips are the same at any speed.
- **The reveal.** Chips finished with, in the display voice. Then, in
  order: what really happened (one line, from `real.result`); the
  visitor's line against the real line, street by street; at each of the
  seat's decisions, what share of visitors chose what; the hidden
  holdings, labeled as authored; the leaderboard (display names and
  chips, top ten plus the visitor's own row).
- *Review, the share-of-visitors figure:* everyone faces the same first
  decision, so that breakdown is always real. After the first deviation,
  visitors are in different hands, and a breakdown "on the turn" only means
  something among the visitors who took the same path there. A decision is
  keyed by the street plus the full action sequence before it; the page
  shows the breakdown at a spot only when at least `MIN_SHARED` (5) first
  attempts reached it, and shows just the visitor's own choice otherwise.
  The first decision always qualifies.
- The index page lists past puzzles with the leaderboard winner's name,
  and the current one at the top. Closed puzzles can still be played;
  results after `closes` are recorded but not ranked.

Brand rules hold: bands alternate, no lime (the RSVP CTA keeps it), no
em dashes, first name plus last initial for real players, handles as
they are. The card metal palette is available for the table felt.

### 4.5 The Function and the table (`functions/api/wwyhd.js`, D1)

Cloned from `functions/api/rsvp.js`, same discipline:

```sql
CREATE TABLE IF NOT EXISTS wwyhd_results (
  hand_id      TEXT NOT NULL,
  email        TEXT NOT NULL,
  attempt      INTEGER NOT NULL,   -- 1 for the first submit, then 2, 3, ...
  display_name TEXT NOT NULL,
  line         TEXT NOT NULL,      -- JSON list of {street,type,amount}
  decisions    TEXT NOT NULL,      -- JSON list of {key,type}: the decision keys this
                                   -- attempt actually reached, and what was chosen at
                                   -- each. *Build:* the share-of-visitors histogram is
                                   -- aggregated from this column and from nothing
                                   -- else, so a spot's breakdown never has to be
                                   -- rebuilt by replaying every stored line
  chips        INTEGER NOT NULL,   -- the SERVER's replay of `line`, never the client's number
  ranked       INTEGER NOT NULL,   -- 1 when this row counts for the leaderboard and the
                                   -- histogram, 0 when it does not. *Build:* ranked-ness
                                   -- is decided once, at submit time, as attempt = 1 AND
                                   -- submitted on or before the hand file's `closes`.
                                   -- Storing the verdict rather than deriving it at read
                                   -- time keeps the leaderboard from silently rewriting
                                   -- itself the day a puzzle closes
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hand_id, email, attempt)
);
```

*Review:* append-only, one row per attempt. The leaderboard and the
share-of-visitors figures read `ranked = 1` only; replays are kept so the
visitor can see their own history and so nothing is ever overwritten, but
they rank nowhere. `count` on the GET is distinct emails.

*Build, the routes.* Both verbs are `/api/wwyhd?hand=<hand_id>`: one Function
file at `functions/api/wwyhd.js`, the hand id in a query parameter, exactly
the shape `game` already rides on in `functions/api/rsvp.js`. A Pages
bracketed dynamic segment would buy nothing a query parameter does not, and
would cost a second file and a second path shape to keep in step. A request
with no `hand`, or one whose value is not a `YYYY-MM-DD-<n>` id, is a 404
before any asset fetch happens.

- `POST /api/wwyhd?hand=<hand_id>` with `{ email, displayName, line }`. The
  Function assigns `attempt` (one more than that email's highest for the
  hand) and the display name resolves through the roster with
  `resolveDisplay`, as RSVP does. The page says, once, that the first go is
  the one that counts.
- The Function **re-runs the engine on the submitted line** against the
  hand file and uses its own chip count, never the client's. The engine
  is pure JS so the same file runs in the Worker. This is the whole
  anti-cheat and it costs nothing.
- `GET /api/wwyhd?hand=<hand_id>` returns `{ count, leaderboard: [{name,
  chips}], choices: { <decisionKey>: { fold: n, call: n, raise: n } } }`.
  **Never an email.** Same rule as RSVP, same test.
- Validation as RSVP: email shape, display name length, hand id must
  exist in `site/data/wwyhd/`, line must replay without error.
- *Review, the hand file at runtime:* the Function reads it through the
  Pages static asset binding (`env.ASSETS.fetch` of
  `/data/wwyhd/<hand_id>.json`). A missing asset is a 404 and is the whole
  hand-id validation; no second list of ids to keep in step.
- *Review, abuse:* nothing stops a visitor submitting under someone else's
  email. RSVP has the same property. Not designed against in v1 (section 2);
  if it is abused, a per-browser token issued at first submit is the fix.

### 4.6 Per-person stats (v1: minimal)

With email as the key across hands, the index page can show, for the
visitor whose email is in `localStorage`, their own row: puzzles played,
best finish, average chips against the field. Nothing public beyond the
per-hand leaderboard. A cross-week leaderboard is a v2 question.

## 5. The weekly runbook (Charlie)

Goes into `docs/publishing.md` when the feature ships. *Build:* it has, as
that file's `## The weekly puzzle` section, which is the normative copy
(repo `CLAUDE.md`); the steps below are the design's own shorter statement of
the same order, with the one-time schema apply and the two prose gates (the
disclosure and what ranks) added there.

1. After the monthly publish, pick one hand from the log: a showdown
   hand with a real decision in it. Prefer a hand already in the recap.
2. Write the hand file. Every log number copied. Choose hidden holdings
   that fit the folded players' lines. Choose the runout if the hand
   ended early.
3. `bun tools/wwyhd-check.ts <file>`: replays the real line through the
   engine and asserts it produces the real result (stacks match the
   log). If it does not, the file is wrong, not the engine.
4. PR. Mike reads the setup and result lines. Merge on his go.
5. Email the poker list. One line, the table image, the link. Same shape
   as the portrait email.
6. The previous puzzle stops ranking on its own `closes` date; set the new
   one's `opens` to match.

*Review, later:* most of step 2 is transcription. Stacks, blinds, dealer, the
real action list, the board and the shown cards are all in the log, in the
shape munger's parser already produces. Once this repo's log reader knows the
action lines (#57), a `bun tools/wwyhd-draft.ts <log> --hand N` writes the
skeleton and leaves Charlie only the judgment: hidden holdings, the runout if
the hand ended early, and the title, setup and result lines. Not a v1
dependency; Charlie writes the first files by hand.

## 6. Testing

- Engine: betting-round unit tests; side pots with two and three all-ins
  at unequal stacks; a short all-in that does not reopen the action;
  showdown ties; determinism by replay.
- Rules: the four archetype fixtures (4.3); canonical spots; a table-wide
  "nobody folds a monster, nobody shoves air" invariant.
- Hand files: every committed file replays its real line to its real
  result (`wwyhd-check` runs inside `bun test tools`, so a wrong file
  cannot merge).
- Function: never returns an email; rejects a line that does not
  replay; server chip count wins over client; a second submit from the same
  email is `attempt` 2 and changes neither the leaderboard nor the
  share-of-visitors figures; display names resolve through the roster.
- If the engine is copied into the Function rather than imported: the copy
  matches the source byte for byte.
- Page: one job per state; bands alternate; no lime; no em dashes.

## 7. Out of scope for v1

- Advice, coaching text, or a "correct" answer. The score is the answer.
- Seeing other visitors' lines before finishing the hand.
- Multiple seats per hand, or playing the same hand from another seat.
- Anything the co-pilot writes. If commentary comes later it is a
  separate feature with its own consent question for the players named.
- Accounts, passwords, or a cross-week leaderboard.

## 8. Questions put to Mike, and his answers (review, 2026-09-20)

- Leaderboard, last attempt or best attempt? **Neither: the first attempt.**
  Replays allowed, recorded, never ranked.
- Does the leaderboard show display names to everyone, as RSVP does? **Yes.**
- Should the real players be told when their hand is the puzzle? **Yes**, in
  the weekly email. The page's own disclosure (section 3) says which cards
  were real and which were filled in.
- Invented holdings in a named player's hands? **Yes, that is the game**:
  "we have to guess or it's not fun." The disclosure sentence is the
  condition.
- Cheating, and one visitor overwriting another's row? **Not a v1 concern.**
  Revisit if it happens.

## 9. Order of work (review)

Engine and its tests first, side pots and the short all-in before anything
else. Then the rule table with one fixture per regular. Then the Function
and the table. Then the page. Charlie hand-writes the first hand file as
soon as the engine can replay one; the draft tool waits for #57.
