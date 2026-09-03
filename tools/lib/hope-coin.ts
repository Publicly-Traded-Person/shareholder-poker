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

import type { GamesData } from "./standings";

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
// Throws: Error, with a message naming the specific stop(s) involved (by
// 1-based position and holder) and the dates in conflict, matching the
// refuse-to-publish voice in tools/publish-game.ts — this message is what
// Charlie reads at night right after he broke the chain, so it says what
// is wrong, not just that something is wrong.
export function validateCoinHistory(data: GamesData): void {
  const history = data.hopeCoin.history;
  if (history === undefined || history.length === 0) return;

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
}
