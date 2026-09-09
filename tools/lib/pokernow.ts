// Public-safe PokerNow log reader for the poker.kmikeym.com generators.
// Raw logs are private runtime inputs; only synthetic fixtures live in-repo.
//
// A multi-table tournament (10+ players, first seen 2026-09-08) exports ONE
// LOG PER TABLE, each numbering its hands from #1 at the same moment. Hand
// numbers are therefore comparable only inside one log; the `at` timestamp
// is the one axis every table shares. mergeLogs() below is how the two
// publish tools read N logs as one timeline.

export class ChipConservationError extends Error {}

export type Row = { entry: string; at: string; order: number };

export function playerName(quoted: string): string {
  const inner = quoted.replace(/^"+|"+$/g, "");
  return inner.split(" @ ")[0].trim();
}

// Each CSV line: "<entry>",<iso>,<order> with internal quotes escaped as "".
// Returns rows oldest-first (the export is newest-first). `at` is the row's
// UTC timestamp as written in the log; keep it as the string it came in as,
// ISO-8601 with a fixed width sorts correctly as text.
export function parseRows(csv: string): Row[] {
  const out: Row[] = [];
  for (const raw of csv.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("entry,")) continue;
    const m = line.match(/^"((?:[^"]|"")*)",([^,]+),(\d+)$/);
    if (!m) continue;
    out.push({ entry: m[1].replace(/""/g, '"'), at: m[2], order: Number(m[3]) });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

export function handCount(rows: { entry: string }[]): number {
  return rows.filter(r => /^-- starting hand #\d+/.test(r.entry)).length;
}

// One snapshot per "Player stacks:" line (PokerNow writes one at the start
// of every hand), with the hand counter it followed and its timestamp.
// Over rows from mergeLogs(), `hand` is whichever table dealt most recently
// and means nothing across tables; read `at` instead. The last snapshot of
// a merged timeline is the final table's last hand, which is the one chip
// conservation must be checked against: every chip in play ends up there.
export function stackSnapshots(rows: { entry: string; at: string }[]): { hand: number; at: string; stacks: Record<string, number> }[] {
  const out: { hand: number; at: string; stacks: Record<string, number> }[] = [];
  let hand = 0;
  for (const { entry, at } of rows) {
    let m = entry.match(/^-- starting hand #(\d+)/);
    if (m) { hand = Number(m[1]); continue; }
    if (entry.startsWith("Player stacks:")) {
      const stacks: Record<string, number> = {};
      const re = /"([^"]+)" \((\d+)\)/g;
      let s: RegExpExecArray | null;
      while ((s = re.exec(entry))) stacks[playerName(`"${s[1]}"`)] = Number(s[2]);
      out.push({ hand, at, stacks });
    }
  }
  return out;
}

// Every player who left a table with nothing, and when. A bust is the only
// way a line on the chip race reaches zero: stack snapshots are taken at
// the start of a hand, so a player who lost everything simply stops
// appearing in them. Without this, a player who busted on a non-final
// table would end mid-chart still holding chips. A player who rebuys after
// busting gets no quit line (PokerNow keeps their seat), so only the final
// exit is reported here.
export function busts(rows: { entry: string; at: string }[]): { player: string; at: string }[] {
  const out: { player: string; at: string }[] = [];
  for (const { entry, at } of rows) {
    const m = entry.match(/^The player "([^"]+)" quits the game with a stack of 0\.$/);
    if (m) out.push({ player: playerName(`"${m[1]}"`), at });
  }
  return out;
}

// Reads N table logs as one tournament. Rows come back sorted by timestamp
// across all tables (ties keep log order, then PokerNow's own order), each
// tagged with the index of the log it came from. `merges` is the moment
// each non-final table closed: its log's last row, which is the "was moved
// to table" line PokerNow writes as it empties the table into the survivor.
// The final table is the log whose last row is latest. One log gives no
// merges and rows identical to parseRows() apart from the tag.
export function mergeLogs(csvs: string[]): { rows: (Row & { table: number })[]; tables: number; merges: string[] } {
  const logs = csvs.map(parseRows);
  const rows = logs.flatMap((log, table) => log.map(r => ({ ...r, table })));
  rows.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.table - b.table || a.order - b.order
  );
  const lastAt = logs.map(log => log[log.length - 1].at);
  const finalTable = lastAt.indexOf(lastAt.slice().sort().reverse()[0]);
  const merges = lastAt.filter((_, i) => i !== finalTable).sort();
  return { rows, tables: logs.length, merges };
}

// Chips enter a tournament only through a buy-in, so
// total final chips / starting stack = entries. Non-integer totals mean the
// log or the starting stack is wrong; refuse rather than publish a bad pot.
export function entryCount(finalStacks: Record<string, number>, startingStack: number): number {
  const total = Object.values(finalStacks).reduce((a, b) => a + b, 0);
  if (total === 0 || total % startingStack !== 0) {
    throw new ChipConservationError(
      `total chips ${total} is not a whole multiple of starting stack ${startingStack}`
    );
  }
  return total / startingStack;
}
