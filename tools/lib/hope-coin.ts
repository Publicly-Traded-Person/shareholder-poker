// The Hope Coin chain validator: the one function that checks
// hopeCoin.history tells a single, unbroken story. It is the guard for
// Charlie's monthly handoff append (docs/publishing.md "Hope Coin handoff"),
// which is the moment the chain actually gets broken — a half-closed
// previous stop, a summary that quietly drifted from the last entry, a
// stop pasted in the wrong place. This is Task 6 of
// docs/superpowers/plans/2026-09-02-player-pages-trophies-hope-coin.md; the
// two docs/publishing.md notes that used to say this check "does not exist
// yet" are corrected in the same commit that adds this file.
//
// Pure module: no clock, no I/O. validateCoinHistory takes the parsed
// GamesData and either returns or throws; it never mutates its argument.
//
// Run: never directly. bun test tools/lib/hope-coin.test.ts exercises it in
// isolation with synthetic fixtures; tools/data.test.ts runs it against the
// real committed site/data/games.json so the live data is under the rule
// too, not just fixtures.

import type { GamesData, HopeCoinStop } from "./standings";

// One stop's tenure, reduced to whole months (spec section 7.1: "every
// date on the chain is reduced to its month"). Produced by tenureMonths
// below and consumed by holderShares, the donut, the tenure strip, and
// the legend table (tools/render.ts) - all four read the same segments,
// so none of them can silently disagree about who held the Coin how long.
export type TenureSegment = { holder: string; from: string; to: string; months: number };

// One holder's whole-career share of the chain, produced by holderShares
// below. `reigns` is how many separate stops that holder appears in
// (someone who won the Coin back a second time has two), `months` is the
// sum of those stops' months, and `percent` is that holder's whole-number
// share of the total (spec section 7.2, the donut).
export type HolderShare = { holder: string; reigns: number; months: number; percent: number };

// Checks hopeCoin.history end to end and throws an Error describing exactly
// which stop is wrong and how, or returns nothing if the chain is sound.
// Takes the whole parsed games.json (GamesData); it needs both hopeCoin.
// history and the two summary fields beside it (holder, since) to check
// them against each other. Returns void — success is "did not throw".
//
// A history that is absent, or present but empty, is valid and returns
// immediately: the site shipped before the Coin had a recorded past (see
// the comment on GamesData.hopeCoin.history in tools/lib/standings.ts), so
// "no history yet" is not the same claim as "a broken history."
//
// Every other check below assumes at least one stop exists. In order:
//
// 0. Format: every `from` and `to` present is YYYY-MM-DD, or YYYY-MM when
//    the record knows the handoff only to the month (Beau's chain of
//    custody, 2026-09-05, dates seven of the twelve real handoffs that
//    way). Checked first because every comparison below is a plain string
//    comparison, which orders "2022-4" and "04/2022" wrongly without a
//    murmur; the page prints month and year either way, so the shorter
//    form loses nothing on screen. Two adjacent stops must still match on
//    the identical string at the handoff (rule 3), so a month-only `to`
//    meets a month-only `from`, never a full date.
//
// 1. Presence: only the first stop may omit `from` (nobody remembers when
//    the Coin arrived there — see the HopeCoinStop comment in standings.ts)
//    and only the last stop may omit `to` (it is the only stop still
//    current). A non-first stop with no `from`, or a non-last stop with no
//    `to`, throws — checked before the date-comparison checks below because
//    those checks need every non-first `from` and every non-last `to` to
//    actually be there to compare.
//
// 2. Order: each stop's `from` (once defined; only index 0 can lack one)
//    must not be earlier than the previous stop's `from`. Equal is allowed
//    on purpose: the Coin can change hands twice in one game night, which
//    puts two adjacent stops on the exact same calendar date (a stop whose
//    own `from` equals its own `to`, immediately followed by the next
//    stop's `from` on that same date). That is a real, legitimate chain,
//    not a data error, so the boundary case of an equal-date pair between
//    adjacent stops passes; only a stop whose `from` is strictly *before*
//    the previous stop's `from` throws, because that is the array holding
//    two stops out of chronological order.
//
// 3. Handoff match: a stop's `to` must equal the next stop's `from`
//    exactly. This is the literal claim in the spec ("each stop hands off
//    to the next on the same date") and it is a stricter, separate check
//    from ordering above — two stops can be in perfectly ascending order
//    and still leave an untracked gap (or overlap) between where one
//    holder's tenure ends and the next one's starts, which this check
//    catches and ordering alone would not.
//
// 4. Summary agreement: hopeCoin.holder must equal the last stop's holder,
//    and hopeCoin.since must equal the last stop's `from` (skipped only if
//    the last stop is also the first and has no `from` at all — nothing to
//    compare `since` against in that case). The two summary fields at the
//    top of the file are what every other page actually reads; a history
//    that disagrees with them would make the coin page and the standings
//    tile tell two different stories about who holds the Coin today.
//
// 5. Miles and route (2026-09-05, the odometer and route graphic): on each
//    stop, in this order, `milesIn`, when present, must be a whole number
//    of zero or more (zero is a real hand-to-hand pass, no driving in
//    between, so it is not an error); `milesHeld`, when present, must be a
//    whole number of one or more (a stop with no miles held omits the
//    field rather than setting it to zero); `route`, when present, must
//    have `milesHeld` on the same stop (a route only makes sense for a
//    stop the Coin actually traveled during), must be a non-empty array,
//    and none of its names may be an empty string or contain an em dash
//    (the character U+2014), matching the no-em-dash rule that applies to
//    everything else the site prints. See the HopeCoinStop comment in
//    standings.ts for what the three fields themselves mean; this rule
//    only checks their shape.
//
// Throws: Error, with a message naming the specific stop(s) involved (by
// 1-based position and holder) and the values that broke the rule - the
// dates in conflict for rules 0 through 4, the offending mileage or route
// name for rule 5 - matching the
// refuse-to-publish voice in tools/publish-game.ts — this message is what
// Charlie reads at night right after he broke the chain, so it says what
// is wrong, not just that something is wrong.
export function validateCoinHistory(data: GamesData): void {
  const history = data.hopeCoin.history;
  if (history === undefined || history.length === 0) return;

  // 0. Format.
  const DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];
    for (const [field, value] of [["from", stop.from], ["to", stop.to]] as const) {
      if (value !== undefined && !DATE.test(value)) {
        throw new Error(
          `hopeCoin.history stop ${i + 1} (${stop.holder}) has a "${field}" of "${value}". Dates are ` +
          `YYYY-MM-DD, or YYYY-MM when only the month is on record; nothing else. Fix the value.`
        );
      }
    }
  }

  // 1. Presence.
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];
    const isFirst = i === 0;
    const isLast = i === history.length - 1;
    if (!isFirst && stop.from === undefined) {
      throw new Error(
        `hopeCoin.history stop ${i + 1} (${stop.holder}) has no "from" date. Only the first stop ` +
        `may omit it (nobody remembers when the Coin arrived there); every later stop needs the date ` +
        `it took over. Fix the stop, or move it to index 0 if it really is the earliest one on record.`
      );
    }
    if (!isLast && stop.to === undefined) {
      throw new Error(
        `hopeCoin.history stop ${i + 1} (${stop.holder}) has no "to" date but is not the last stop. ` +
        `Only the current, final stop may leave "to" open. Close it out with the date the Coin left, ` +
        `or move this stop to the end of the array if it is actually the current one.`
      );
    }
  }

  // 2. Order (see the equal-date ruling in the function comment above).
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (prev.from !== undefined && cur.from !== undefined && cur.from < prev.from) {
      throw new Error(
        `hopeCoin.history is out of order: stop ${i} (${prev.holder}) starts ${prev.from}, which is ` +
        `later than stop ${i + 1} (${cur.holder})'s start of ${cur.from}. Stops must run oldest to ` +
        `newest; move stop ${i + 1} earlier in the array or fix whichever date is wrong.`
      );
    }
  }

  // 3. Handoff match.
  for (let i = 0; i < history.length - 1; i++) {
    const cur = history[i];
    const next = history[i + 1];
    if (cur.to !== next.from) {
      throw new Error(
        `hopeCoin.history stop ${i + 1} (${cur.holder}) ends "${cur.to}" but stop ${i + 2} ` +
        `(${next.holder}) starts "${next.from}". One stop's "to" must equal the next stop's "from" ` +
        `with no gap and no overlap. Fix whichever date is wrong.`
      );
    }
  }

  // 4. Summary agreement.
  const last = history[history.length - 1];
  if (data.hopeCoin.holder !== last.holder) {
    throw new Error(
      `hopeCoin.holder is "${data.hopeCoin.holder}" but the last stop in hopeCoin.history is held by ` +
      `"${last.holder}". They must agree: update hopeCoin.holder to the newest stop's holder, or append ` +
      `the missing stop if the history simply stops short of today.`
    );
  }
  if (last.from !== undefined && data.hopeCoin.since !== last.from) {
    throw new Error(
      `hopeCoin.since is "${data.hopeCoin.since}" but the last stop's "from" is "${last.from}". They ` +
      `must agree: update hopeCoin.since to match the newest stop's start date.`
    );
  }

  // 5. Miles and route (see the function comment above for the full rule).
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];

    if (stop.milesIn !== undefined && (!Number.isInteger(stop.milesIn) || stop.milesIn < 0)) {
      throw new Error(
        `hopeCoin.history stop ${i + 1} (${stop.holder}) has a "milesIn" of ${stop.milesIn}. It must be ` +
        `a whole number of zero or more (zero is a real hand-to-hand pass, no driving in between). Fix ` +
        `the value.`
      );
    }

    if (stop.milesHeld !== undefined && (!Number.isInteger(stop.milesHeld) || stop.milesHeld < 1)) {
      throw new Error(
        `hopeCoin.history stop ${i + 1} (${stop.holder}) has a "milesHeld" of ${stop.milesHeld}. It ` +
        `must be a whole number of one or more; a stop with no miles held should omit the field, not ` +
        `set it to zero. Fix the value.`
      );
    }

    if (stop.route !== undefined) {
      if (stop.milesHeld === undefined) {
        throw new Error(
          `hopeCoin.history stop ${i + 1} (${stop.holder}) has a "route" but no "milesHeld". A route ` +
          `only makes sense for a stop the Coin actually traveled during: add "milesHeld", or remove ` +
          `the route.`
        );
      }
      if (stop.route.length === 0) {
        throw new Error(
          `hopeCoin.history stop ${i + 1} (${stop.holder}) has an empty "route" array. Either list the ` +
          `places it passed through, or omit the field entirely.`
        );
      }
      for (const place of stop.route) {
        if (place === "") {
          throw new Error(
            `hopeCoin.history stop ${i + 1} (${stop.holder}) has an empty string in its "route". Every ` +
            `place name must be non-empty. Fix or remove the entry.`
          );
        }
        if (place.includes("\u2014")) {
          throw new Error(
            `hopeCoin.history stop ${i + 1} (${stop.holder}) has a "route" name of "${place}" ` +
            `containing an em dash. Site copy never uses one: use a comma, "to", or rewrite the name.`
          );
        }
      }
    }
  }
}

// monthIndex turns a chain date into a single ascending integer, month by
// month: 2023-07 and 2026-09 differ by 26 regardless of how many days sit
// in between, which is the only kind of subtraction tenureMonths below (or
// any graphic built on it) ever needs. Takes a YYYY-MM or YYYY-MM-DD
// string and reads only its first seven characters, so a full date and
// its own bare month collapse to the same index - the chain mixes both
// forms freely (see the HopeCoinStop comment in standings.ts, and rule 0
// above), and every caller needs the two forms to agree. Returns
// year * 12 + (month - 1): zero-based on purpose, so two indexes ever
// subtract cleanly instead of needing a special case at the year
// boundary. Throws nothing: a date in the wrong shape is rule 0's job to
// catch, before this function ever sees it.
export function monthIndex(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return year * 12 + (month - 1);
}

// tenureMonths turns the chain into one TenureSegment per stop, the single
// input the donut, the tenure strip, and the legend table (tools/render.ts)
// all reduce further, so the three graphics can never disagree with each
// other about who held the Coin how long (spec section 7.1, "month math,
// defined once"). Takes the history in chain order - it never sorts it,
// trusting the same order validateCoinHistory above already treats as
// canonical - and the date of the latest game on the spine, because the
// current stop has no "to" yet and the page's own caption is "as of" a
// game night, never the clock (spec section 7.1).
//
// Returns one segment per stop, except the first stop when it has no
// "from": the Coin's time there is explicitly not counted (spec section
// 7.1's "before July 2021 is not counted" sentence), so it produces no
// segment at all rather than a segment with a made-up start. Every other
// stop always has a "from", and every stop but the last always has a
// "to" - both guaranteed by rule 1 above - so this function leans on that
// guarantee instead of repeating the check. Each segment's `from` and
// `to` are cut to their YYYY-MM month whether the source stop carried a
// full date or just a month, and `months` is monthIndex(to) -
// monthIndex(from): zero when a stop changed hands within a single month
// (spec section 7.1's same-month ruling).
//
// Throws nothing.
export function tenureMonths(history: HopeCoinStop[], latestGame: string): TenureSegment[] {
  const segments: TenureSegment[] = [];
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];
    if (i === 0 && stop.from === undefined) continue;

    // Safe by the invariant in the function comment above: only index 0
    // can lack "from", and only the last stop can lack "to".
    const from = stop.from!.slice(0, 7);
    const isLast = i === history.length - 1;
    const to = (isLast ? latestGame : stop.to!).slice(0, 7);
    segments.push({ holder: stop.holder, from, to, months: monthIndex(to) - monthIndex(from) });
  }
  return segments;
}

// holderShares collapses tenureMonths' segments to one row per holder,
// the exact shape the legend table reads (spec section 7.4, "holder,
// reigns, months, share") and the donut's arcs are drawn from - a holder
// who won the Coin back for a second reign gets one row with two reigns
// counted, not two rows the page would have to explain away. Takes the
// segments in chain order, the order tenureMonths returns them in and
// never re-sorted first: that order is how tied holders keep the same
// relative position all the way through, both in the returned list and
// in the rounding tie-break below.
//
// Returns one HolderShare per distinct holder, sorted by months
// descending; a tie in months goes to whichever holder's earliest segment
// comes first in the input (spec section 7.4, "ties by chain order") -
// never alphabetical order and never a plain object's own key-insertion
// order, either of which could quietly put the donut and the legend table
// out of step with each other. `reigns` is that holder's segment count
// and `months` is the sum of them.
//
// `percent` is each holder's whole-number share of the total, and the
// whole set always sums to exactly 100 (spec section 7.2): floor every
// share first, then hand out the leftover points - 100 minus the sum of
// the floors - one each to the holders with the largest fractional
// remainder, in the same order as the already-sorted list when two
// remainders tie exactly. That is the only rounding rule that can promise
// the total always lands on 100 without ever favoring the largest holder
// just because it is largest (a 27/6/6 split, for instance, owes its
// leftover point to a six-month holder, not the 27-month one - see the
// test for the arithmetic). When every segment is zero months (a chain
// with no dated history yet), every percent comes back 0 rather than
// dividing by zero.
//
// Throws nothing.
export function holderShares(segments: TenureSegment[]): HolderShare[] {
  // One running total per holder, first-appearance order preserved for
  // free: a Map iterates in the order its keys were first set, which is
  // exactly the tie-break rule above.
  const totals = new Map<string, { holder: string; reigns: number; months: number }>();
  for (const seg of segments) {
    const running = totals.get(seg.holder);
    if (running === undefined) {
      totals.set(seg.holder, { holder: seg.holder, reigns: 1, months: seg.months });
    } else {
      running.reigns += 1;
      running.months += seg.months;
    }
  }

  const byHolder = [...totals.values()];
  const totalMonths = byHolder.reduce((sum, h) => sum + h.months, 0);

  // Sort by months descending. Array.prototype.sort is stable, and
  // byHolder already carries first-appearance order from the Map above,
  // so holders tied on months keep that order rather than swapping.
  byHolder.sort((a, b) => b.months - a.months);

  if (totalMonths === 0) {
    return byHolder.map((h) => ({ holder: h.holder, reigns: h.reigns, months: h.months, percent: 0 }));
  }

  // Largest-remainder rounding. Floor every share first...
  const shares = byHolder.map((h) => (h.months / totalMonths) * 100);
  const floors = shares.map((s) => Math.floor(s));
  const remainders = shares.map((s, i) => s - floors[i]);
  const leftover = 100 - floors.reduce((sum, f) => sum + f, 0);

  // ...then hand out the leftover points by largest remainder. The sort
  // below is stable, so a tie in remainder falls back to byHolder's own
  // order - the same first-appearance tie-break used to sort byHolder
  // itself, never a second, different rule.
  const byRemainderDesc = remainders
    .map((_, i) => i)
    .sort((a, b) => remainders[b] - remainders[a]);
  const percents = [...floors];
  for (let k = 0; k < leftover; k++) {
    percents[byRemainderDesc[k]] += 1;
  }

  return byHolder.map((h, i) => ({ holder: h.holder, reigns: h.reigns, months: h.months, percent: percents[i] }));
}

// odometer sums the two figures every mile-related tile on the page shows
// (spec section 6, tile 1, and the "on the road" leg labels below the
// journey): the distance a stop's own leg covered arriving (`milesIn`)
// plus, on the RV stints, the distance the Coin traveled while parked
// there (`milesHeld`). Takes the history in any order - the sum does not
// care about chain order, unlike tenureMonths above.
//
// Returns `onRecord`, the sum of every stop's `milesIn` plus every stop's
// `milesHeld` (a stop missing either field contributes nothing for that
// field - never a zero it did not actually report, which is why rule 5
// above requires an absent field rather than a zero one), and
// `unmeasuredLegs`, the count of stops after the first with no `milesIn`.
// The first stop is never counted toward `unmeasuredLegs`: the Coin's
// arrival there is definitionally unknown (see the HopeCoinStop comment
// in standings.ts on why `milesIn` is absent there), not a gap in Beau's
// count, so the "one leg still unmeasured" caption (spec section 6) never
// blames a stop nobody could have measured in the first place.
//
// Throws nothing.
export function odometer(history: HopeCoinStop[]): { onRecord: number; unmeasuredLegs: number } {
  let onRecord = 0;
  let unmeasuredLegs = 0;
  for (let i = 0; i < history.length; i++) {
    const stop = history[i];
    onRecord += stop.milesIn ?? 0;
    onRecord += stop.milesHeld ?? 0;
    if (i > 0 && stop.milesIn === undefined) unmeasuredLegs += 1;
  }
  return { onRecord, unmeasuredLegs };
}

// formatMiles is the one thousands-separator helper every graphic on the
// page shares (spec section 6, "through one helper", and section 7.2),
// so "17,677" reads the same whether it comes from the odometer tile, a
// leg label, or a donut caption - never four different rounding rules
// wearing the same font. Takes a whole number of miles.
//
// Returns it as a string with a comma inserted every three digits from
// the right, counting from the decimal point if there is one; it never
// rounds - it only ever reformats the digits it is handed, it does not
// decide what they are.
//
// Throws nothing.
export function formatMiles(n: number): string {
  const s = String(n);
  const dot = s.indexOf(".");
  const wholePart = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  return wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}
