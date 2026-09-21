# What Would You Have Done? (design)

**Status:** spec, approved for build by Mike 2026-09-20. **Builder:** Nova.
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
    "actions": [ { "street": "PRE", "handle": "joshb", "type": "raise", "to": 2400 }, { "...": "..." } ],
    "result": "Drew called the shove and won 38,600 with a full house. Josh finished the hand with 22,600.",
    "seatChips": 57500
  },
  "startChips": 18900,
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

### 4.2 The engine (browser, `site/wwyhd.js`)

Plain JS, no framework, no build step, like `rsvp.js` and `card-zoom.js`.
Pure functions over a state object so the whole thing is unit-testable
under `bun test` without a DOM.

Responsibilities:

- Betting rounds for no-limit hold'em: preflop through river, blinds and
  antes, minimum raise, all-in, **side pots** (the one known-hard part;
  test it with three-way all-ins at different stack sizes).
- The visitor's action set at each decision: fold, check or call, and a
  bet or raise with a size picker (min, half pot, pot, all-in, plus a
  free entry). No advice, no highlighting.
- Opponent decisions via the rule table (4.3), called with the full
  visible state and the opponent's own cards.
- Showdown: seven-card hand evaluation. Use a small, well-known
  evaluator vendored into `site/` rather than an npm dependency at
  runtime, so the page stays a static file.
- Determinism: no randomness anywhere in the engine. Same hand file and
  same visitor choices produce the same chip count, every time, on every
  machine. A test asserts this by replaying a recorded line.
- Output: the chip count, and the visitor's line as a list of
  `{ street, type, amount }`.

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
   the table median; never otherwise unless the call would be less than
   a fifth of the stack.
6. Every threshold is a named constant at the top of the file, with the
   number's source in a comment. No number is inlined.

The table is a starting point. The test suite includes one fixture per
regular, built from their real numbers, asserting the action in a few
canonical spots, so a tuning change is visible as a diff in expected
actions and reviewed as such.

### 4.4 The page (`site/wwyhd/<id>/index.html`, plus `site/wwyhd/index.html`)

One job per page (Mike's standard, 2026-09-20; the rule is in
`CLAUDE.md` and the portrait pages are the model):

- **Sit down.** The title, the setup line, the table drawn from the hand
  file (seats, stacks, the seat's cards face up, everyone else face
  down), and one button: Deal. Below it, the email and display name
  fields, prefilled from `localStorage` if the visitor has RSVP'd before.
- **Play.** The action to you, the pot, the board as it comes, and the
  visitor's options. No text beyond what the table shows. The opponents
  act with a short pause so the hand reads as a hand.
- **The reveal.** Chips finished with, in the display voice. Then, in
  order: what really happened (one line, from `real.result`); the
  visitor's line against the real line, street by street; at each of the
  seat's decisions, what share of visitors chose what; the hidden
  holdings, labeled as authored; the leaderboard (display names and
  chips, top ten plus the visitor's own row).
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
  display_name TEXT NOT NULL,
  line         TEXT NOT NULL,   -- JSON list of {street,type,amount}
  chips        INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (hand_id, email)
);
```

- `POST /api/wwyhd/<hand_id>` with `{ email, displayName, line, chips }`.
  One row per email per hand, upsert, so a replay overwrites (the
  leaderboard is best-of-one-attempt only if Mike wants it; default is
  last attempt, stated on the page).
- The Function **re-runs the engine on the submitted line** against the
  hand file and uses its own chip count, never the client's. The engine
  is pure JS so the same file runs in the Worker. This is the whole
  anti-cheat and it costs nothing.
- `GET /api/wwyhd/<hand_id>` returns `{ count, leaderboard: [{name,
  chips}], choices: { <decisionKey>: { fold: n, call: n, raise: n } } }`.
  **Never an email.** Same rule as RSVP, same test.
- Validation as RSVP: email shape, display name length, hand id must
  exist in `site/data/wwyhd/`, line must replay without error.

### 4.6 Per-person stats (v1: minimal)

With email as the key across hands, the index page can show, for the
visitor whose email is in `localStorage`, their own row: puzzles played,
best finish, average chips against the field. Nothing public beyond the
per-hand leaderboard. A cross-week leaderboard is a v2 question.

## 5. The weekly runbook (Charlie)

Goes into `docs/publishing.md` when the feature ships:

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
6. When the next puzzle opens, the previous closes.

## 6. Testing

- Engine: betting-round unit tests; side pots with two and three all-ins
  at unequal stacks; showdown ties; determinism by replay.
- Rules: one fixture per regular; canonical spots; a table-wide
  "nobody folds a monster, nobody shoves air" invariant.
- Hand files: every committed file replays its real line to its real
  result (`wwyhd-check` runs inside `bun test tools`, so a wrong file
  cannot merge).
- Function: never returns an email; rejects a line that does not
  replay; server chip count wins over client.
- Page: one job per state; bands alternate; no lime; no em dashes.

## 7. Out of scope for v1

- Advice, coaching text, or a "correct" answer. The score is the answer.
- Seeing other visitors' lines before finishing the hand.
- Multiple seats per hand, or playing the same hand from another seat.
- Anything the co-pilot writes. If commentary comes later it is a
  separate feature with its own consent question for the players named.
- Accounts, passwords, or a cross-week leaderboard.

## 8. Open questions for Mike (not blocking the build)

- Leaderboard: last attempt or best attempt? Default in this spec: last.
- Does the leaderboard show display names to everyone, as RSVP does?
  Default: yes, that is the point.
- Should the real players be told when their hand is the puzzle? Default:
  yes, in the weekly email, since their cards and line are shown.
