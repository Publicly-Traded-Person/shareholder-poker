// Opponent profile numbers for a WWYHD hand file, computed from PokerNow
// log CSVs. Saved here because the 9/20 and 10/11 puzzles each recomputed
// them with a throwaway script and the numbers drifted (memory 2026-10-11).
//
// Usage:
//   bun tools/wwyhd-profile.ts <log.csv> [log2.csv ...] --handles a,b,c
//
// Prints one JSON profile per handle in the shape tools/lib/wwyhd.ts wants:
//   vpip        % of hands dealt where the player voluntarily put chips in
//               preflop (call, bet or raise; posting a blind does not count)
//   af          postflop aggression: (bets + raises) / calls
//   allInRate   share of hands dealt in which the player went all in
//   foldToRaise % of bets and raises faced before the river that the player
//               folded to (a check or call to the same bet counts as not folding)
//   callDown    % of river bets faced that the player called or raised
// The logs are PRIVATE and never enter this repo; pass paths from outside it.

import { readFileSync } from "node:fs";

type Stats = { hands: number; vpip: number; bets: number; raises: number; calls: number; allIn: number; facedPre: number; foldedPre: number; facedRiver: number; calledRiver: number };

const args = process.argv.slice(2);
const hi = args.indexOf("--handles");
if (hi < 0 || args.length < 2) {
  console.error("usage: bun tools/wwyhd-profile.ts <log.csv> [...] --handles a,b,c");
  process.exit(2);
}
const handles = args[hi + 1].split(",").map((s) => s.trim());
const files = args.filter((a, i) => i !== hi && i !== hi + 1);
const stats = new Map<string, Stats>();
for (const h of handles) stats.set(h, { hands: 0, vpip: 0, bets: 0, raises: 0, calls: 0, allIn: 0, facedPre: 0, foldedPre: 0, facedRiver: 0, calledRiver: 0 });

function parseCsv(text: string): string[] {
  // PokerNow CSV: entry,at,order; the entry is quoted with "" escapes.
  const out: string[] = [];
  for (const line of text.split("\n").slice(1)) {
    if (!line.startsWith('"')) continue;
    let i = 1, s = "";
    while (i < line.length) {
      if (line[i] === '"') { if (line[i + 1] === '"') { s += '"'; i += 2; continue; } break; }
      s += line[i++];
    }
    out.push(s);
  }
  return out.reverse(); // the file is newest-first
}

const who = (e: string) => { const m = e.match(/^"([^"@]+?) @ /); return m ? m[1].trim() : null; };

for (const f of files) {
  const entries = parseCsv(readFileSync(f, "utf8"));
  let street = "PRE";
  let inHand = new Set<string>();
  let vpipThis = new Set<string>();
  let allInThis = new Set<string>();
  // who is facing a live bet right now (handles still to act on the current bet)
  let pending: { bettor: string; toAct: Set<string>; river: boolean } | null = null;
  const settle = (folder: string | null, action: "fold" | "stay") => {
    if (!pending) return;
    // not used directly; see below
  };
  for (const e of entries) {
    if (e.startsWith("-- starting hand")) {
      street = "PRE"; inHand = new Set(); vpipThis = new Set(); allInThis = new Set(); pending = null; continue;
    }
    if (e.startsWith("Player stacks:")) {
      for (const m of e.matchAll(/"([^"@]+?) @ [^"]*" \((\d+)\)/g)) {
        const h = m[1].trim(); inHand.add(h);
        const s = stats.get(h); if (s) s.hands++;
      }
      continue;
    }
    if (e.startsWith("Flop:")) { street = "FLOP"; pending = null; continue; }
    if (e.startsWith("Turn:")) { street = "TURN"; pending = null; continue; }
    if (e.startsWith("River:")) { street = "RIVER"; pending = null; continue; }
    if (e.startsWith("-- ending hand")) { pending = null; continue; }
    const h = who(e); if (!h) continue;
    const s = stats.get(h);
    const allIn = / and go all in/.test(e);
    if (allIn && s && !allInThis.has(h)) { allInThis.add(h); s.allIn++; }
    const isFold = / folds$/.test(e), isCheck = / checks$/.test(e), isCall = / calls \d/.test(e), isBet = / bets \d/.test(e), isRaise = / raises to \d/.test(e);
    if (!(isFold || isCheck || isCall || isBet || isRaise)) continue;
    // facing a bet?
    if (pending && pending.toAct.has(h)) {
      pending.toAct.delete(h);
      if (s) {
        if (pending.river) { s.facedRiver++; if (isCall || isRaise) s.calledRiver++; }
        else { s.facedPre++; if (isFold) s.foldedPre++; }
      }
    }
    if (street === "PRE" && (isCall || isBet || isRaise) && s && !vpipThis.has(h)) { vpipThis.add(h); s.vpip++; }
    if (street !== "PRE" && s) { if (isBet) s.bets++; if (isRaise) s.raises++; if (isCall) s.calls++; }
    if (isFold) inHand.delete(h);
    if (isBet || isRaise) {
      const toAct = new Set(inHand); toAct.delete(h);
      pending = { bettor: h, toAct, river: street === "RIVER" };
    }
  }
}
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
for (const h of handles) {
  const s = stats.get(h)!;
  const profile = {
    vpip: pct(s.vpip, s.hands),
    af: s.calls ? Number(((s.bets + s.raises) / s.calls).toFixed(2)) : s.bets + s.raises,
    allInRate: Number((s.hands ? s.allIn / s.hands : 0).toFixed(2)),
    foldToRaise: pct(s.foldedPre, s.facedPre),
    callDown: pct(s.calledRiver, s.facedRiver),
  };
  console.log(`${h} (${s.hands} hands) ${JSON.stringify(profile)}`);
}
