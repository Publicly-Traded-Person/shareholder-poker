# Self-serve portrait upload (temporary, in-browser dither)

**Date:** 2026-08-27
**Status:** Approved direction (Mike, 2026-08-27: upload is fine as a temporary
surface; "we can pull it down after we do the card"; teardown is manual, on his
signal)
**Author:** Nova, from a design pass with Mike
**Builder:** Nova
**Tracking issue:** `Publicly-Traded-Person/shareholder-poker#17`
**Prior specs:** `2026-08-26-portrait-consent-pages-design.md` (the consent
pages, shipped in PR #19; this extends them and changes none of their
invariants), `2026-08-17-poker-quarterly-systems-design.md` (site spec, §3
privacy boundary)
**Related, deliberately separate:** #20 (public card generator app, parked)

## 1. What this is

The consent page gains a fourth path next to the staged crops: the player
uploads their own photo, watches it dithered live in their card's rarity
metal, frames it themselves, and approves it. What they approve is what
prints.

The surface is temporary by intent. It exists for a set's collection window
and comes down manually when Mike signals, via a one-line flag flip (§9).

## 2. The constraint that shapes everything

**The raw photo never leaves the browser.** All rendering (crop, Atkinson
dither, duotone, feather, pip corner) happens client-side in a canvas. The
only bytes that ever reach the server are the finished, dithered art panel
the player explicitly approves.

Three things fall out of that single rule:

- The prior spec's §3 invariant, "source photographs never reach this repo or
  this bucket," survives verbatim. No new privacy tier exists. The bucket
  still holds only rendered, consented art.
- The preview is truthful by construction. The player is not approving a
  preview of something a server will re-render; the pixels on their screen
  are the artifact. This preserves the byte-identity principle that makes
  the consent strong (prior spec §6).
- There is no upload validation problem for photographs, because photographs
  are never uploaded. The server validates a small PNG of exact known
  dimensions (§8), nothing more.

## 3. Accepted risk, recorded

While an ask is live and uploads are on, anyone holding a player's capability
URL can replace that player's card art. Mike accepted this on 2026-08-27 with
two mitigations named: the surface is temporary (he signals teardown), and he
reviews the rendered print cards before anything ships, which he does anyway.
This is a deliberate product call, not an oversight. Do not silently add
authentication to close it; §10 of the site spec keeps auth out of scope.

## 4. Player flow

On `/portrait/<token>`, when the ask is live, `portraitUploads` is on (§9),
and the ask carries a valid `metal` (§6):

1. Under the crop picker: **"Or use a different photo."** Tapping reveals the
   upload block: a file input (`accept="image/*"`).
2. The chosen photo loads into a canvas via `createImageBitmap` with
   `imageOrientation: "from-image"` (phones lie about rotation in EXIF; this
   is the one line that un-lies them). Nothing is transmitted.
3. The player pans and zooms the photo under a fixed letterbox frame with the
   art panel's aspect. On every adjustment the page re-renders the full
   recipe live: Atkinson dither, duotone in the ask's rarity metal, right
   edge feathered into the field, suit pip in its corner. The preview shows
   the finished art panel at display size, not a mock of the whole card.
4. **"Use this photo"** exports the composed panel as a 620x236 PNG and POSTs
   it to `/api/portrait/<token>/upload`. On success the page shows the
   standard approved state. Uploading IS approving: the request stores the
   art as variant `self` and appends an `approved` row with variant `self`
   in the same handler, because a player who taps "Use this photo" has said
   yes to exactly these pixels, and splitting that into two steps invites a
   stored-but-unconsented state.
5. Once `self` exists it appears in the picker as **"Your photo"** alongside
   the staged crops. Everything downstream treats it as an ordinary variant:
   the img endpoint serves it, `latestAnswer` resolves it, `--status` prints
   `approved (self)`. A player can still change their mind to a staged crop
   or decline; latest row wins, as ever. **Display rule:** staged variants
   are whole cards and `self` is an art panel, so when `self` is selected
   the card-shot area shows the panel at panel proportions with one caption
   line, "Your art panel; the printed card carries it in the art slot."
   The page never fakes a full-card composite it cannot make truthfully.
6. Re-uploading while the ask is live overwrites `self.png` and appends a
   fresh `approved (self)` row. One object per ask, by key.

Degradation: if the flag is off, the ask is expired, or the ask has no valid
`metal`, the upload block simply does not render. The staged-crop flow is
complete without it. The page never explains why the block is absent; a
capability URL should not narrate its own configuration.

## 5. The dither module

`site/portrait-dither.js`, a public static asset (it is an algorithm, not a
secret), loaded by the consent page with `<script src>`. Pure functions over
pixel arrays so `bun test` can pin them without a browser:

- `atkinson(gray, w, h)`: Atkinson error diffusion, 6/8 of the error
  distributed, 2/8 discarded. The discard is the point: it blows highlights
  and crushes shadows into the early-Mac look (munger proof, 2026-08-26).
  Port the recipe from `munger/ccg/dither-portrait.py`; this module is the
  JS home of the same math, and the two must not drift on the diffusion
  kernel.
- `duotone(bits, w, h, metal)`: maps the 1-bit result onto {felt ink, metal
  tint}. The METALS table carries the four ramps keyed `foil | sapphire |
  copper | pewter`, hex values copied from `site/styles.css` tokens (foil
  `#c9a227`, sapphire `#2b5d9e`, copper `#b06c3f`, pewter `#8a8d91`) over
  felt `#101216`. Values are duplicated from CSS deliberately, with a
  comment naming the source: canvas cannot read custom properties from a
  stylesheet it has not applied, and a lookup indirection is worse for
  Charlie than a labeled copy.
- `feather(pixels, w, h)`: alpha ramp on the right edge into the field
  color, so the face sits IN the card rather than pasted on it. Whole-panel
  dither in one pass, per the proof: "a uniform noise floor reads as card
  art."
- `composePanel(source, view, metal)`: the one entry point the page calls;
  crops per the player's pan/zoom, grayscales, runs the three above, stamps
  the pip corner, returns a 620x236 ImageData.

Target dimensions are fixed at **620x236** (the art slot at render scale,
established in the munger proof) and exported as constants the upload
endpoint's validator shares in spirit (§8).

## 6. Data model changes

Additive only. The consent ledger's semantics do not change.

- `portrait_asks` gains **`metal TEXT`** (nullable): the card's rarity metal
  for this player this set, one of `foil | sapphire | copper | pewter`. The
  page reads it for the duotone. Written by the staging tool, never by hand.
- **Migration:** `CREATE TABLE IF NOT EXISTS` will not add a column to the
  deployed table, so the runbook gains a one-time
  `ALTER TABLE portrait_asks ADD COLUMN metal TEXT` step for existing
  databases (local and remote), run once. `schema.sql`'s CREATE gains the
  column for fresh databases, with the why annotated inline.
- Charlie's `manifest.json` player entries gain a **required `metal`** field.
  Validation halts without it, or with a value outside the four metals, same
  posture as everything else: fix the manifest, never guess a metal.
- Asks that predate `metal` (Mike's live 2026-08 ask): re-staging the player
  writes it, and re-staging rotates the token by existing design, which
  orphans prior answers and requires a re-approve. That is acceptable here
  and worth a runbook sentence; do not add a token-preserving special case
  for a one-player backfill.
- `variants`: on a successful upload the handler adds `"self"` to the ask's
  variants array if absent (read-modify-write; fine at this scale). `self`
  matches the existing `[a-z0-9]{1,8}` id grammar, so `parseVariants`,
  `variantAllowed`, the img endpoint, and `--status` need no new cases.

## 7. R2 layout

```
asks/<set_slug>/<handle>/self.png     the player's approved art panel, 620x236
```

Same prefix as staged variants, so expiry pruning (`--prune`) already covers
it with zero changes. Unlike staged variants this object is an art panel,
not a whole card; the img endpoint does not care (it streams bytes), and the
picker labels it "Your photo" rather than pretending it is a full-card
render.

## 8. The upload endpoint

`POST /api/portrait/<token>/upload`, a new Pages Function at
`functions/api/portrait/[token]/upload.js`. Body: the raw PNG bytes
(`Content-Type: image/png`), not multipart; the client sends exactly one
small artifact and multipart parsing is surface for nothing.

Guards, in order, each with the reason it exists:

1. Token shape, then live unexpired ask: 404 on any miss, indistinguishable
   from unknown (prior spec §8; probing learns nothing).
2. `portraitUploads` flag on, read from `/data/games.json` via `env.ASSETS`
   (the page's existing pattern): 404 when off, and 404 when the read itself
   fails. An unreadable flag fails CLOSED; on this surface the safe answer
   to "am I allowed?" is always no. The flag being off is not an error state
   the outside world gets to observe.
3. Size cap **262,144 bytes** before reading further: a legitimate panel is
   ~100 to 200KB.
4. PNG signature (8 magic bytes) and IHDR dimensions parsed from bytes 16
   to 23 must be exactly **620x236**: the dimension check is a cheap
   authenticity guard, since only our compositor naturally emits that shape.
   Reject with 400 `{error: "bad image"}`.
5. On pass: R2 put to `asks/<set>/<handle>/self.png`, add `self` to
   variants, append `approved`/`self` to `portrait_answers`, return
   `{ok: true, answer: "approved", variant: "self"}`.

Responses carry the standard headers (`X-Robots-Tag: noindex, nofollow`,
`Cache-Control: private, no-store`) on every branch, like every other
portrait surface.

Server-side content inspection stops at magic bytes and dimensions on
purpose. The stored object is already consented by its uploader, is served
only behind that same capability token, and is reviewed by Mike before any
card prints. Deeper validation would be theater.

## 9. The flag and the teardown

`site/data/games.json` gains one root field: **`"portraitUploads": true`**.
Public and boolean, it reveals nothing. The file stays in canonical
`JSON.stringify(data, null, 2)` form; generators ignore unknown root keys.

**Teardown is manual, on Mike's signal** (his call, 2026-08-27). Executing
the signal is a one-line PR flipping the flag to `false`; merge deploys it.
After the flip: the upload endpoint 404s, the page stops rendering the
upload block, and everything already consented keeps working: existing
`self` art still serves and still prints, because consent given does not
evaporate when the collection window closes. Storage dies later with the
ask, via expiry and `--prune`, unchanged.

The code stays in the tree between windows. Next set, staging with the flag
on is the whole re-launch.

## 10. The Charlie seam

- `stage-candidates.sh` output contract (munger side): manifest entries add
  `metal`. His pipeline already knows each card's rarity; this exports it.
- `tools/portrait-asks.ts` gains one verb:
  `bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM [--out <path>]`.
  It checks the ledger's latest answer for that ask is `approved` with
  variant `self` (halting otherwise, naming what they actually approved),
  then downloads `self.png` via wrangler for his print render. Staged
  variants need no pull; he staged them.
- `docs/publishing.md` "Portrait consent" section grows: the one-time
  `ALTER TABLE` migration, the `metal` manifest field, the `--pull` step in
  the print flow, and the teardown flip. Normative as ever; lands in the
  same PR as the code.

## 11. Testing

- **Dither module**: exact-output tests on small fixtures. `atkinson` on a
  known 4x4 gray ramp pins the diffusion kernel byte-for-byte; `duotone`
  pins the four metal mappings; `composePanel` asserts 620x236 output and
  that the pip corner pixels match the stamp. A kernel regression here
  changes every player's face; the tests are the drift guard against the
  Python original.
- **Upload endpoint**: hostile-stub tests in the existing
  `tools/portrait-lib.test.ts` pattern for every guard branch: bad token,
  expired ask, flag off, oversize body, wrong magic, wrong dimensions, and
  the happy path asserting the R2 put key, the variants update, the
  appended `approved`/`self` row, and both privacy headers. No response
  contains an email or the flag state.
- **Manifest validation**: missing `metal`, invalid `metal`, halts listed
  with every other problem in one error.
- **`--pull`**: halts on no-ask, on declined, on approved-with-staged-crop;
  downloads on approved-self. Injected deps, no filesystem, as the CLI
  tests already do.
- Suite green (`bun test tools`) before any commit; render drift and
  games.json canonical-form checks unchanged (the flag field lands once, in
  this feature's own commit, and the canonical form is preserved).

## 12. Out of scope

- Storing or transmitting raw photographs, anywhere, ever.
- Moderation UI or approval queues. Mike's print review is the backstop.
- Authentication (site spec §10) or any change to the capability-URL model.
- The public card generator app: parked as #20, different product,
  different rules.
- Changing the staged-crop flow, the consent ledger semantics, or the
  expiry/prune lifecycle. This feature only adds a variant source.
- Automated teardown. The signal is Mike's, manually, recorded as such.
