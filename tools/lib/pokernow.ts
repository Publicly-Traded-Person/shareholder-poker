// Public-safe PokerNow log reader for the poker.kmikeym.com generators.
// Raw logs are private runtime inputs; only synthetic fixtures live in-repo.

export class ChipConservationError extends Error {}

export function playerName(quoted: string): string {
  const inner = quoted.replace(/^"+|"+$/g, "");
  return inner.split(" @ ")[0].trim();
}

// Each CSV line: "<entry>",<iso>,<order> with internal quotes escaped as "".
export function parseRows(csv: string): { entry: string; order: number }[] {
  const out: { entry: string; order: number }[] = [];
  for (const raw of csv.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("entry,")) continue;
    const m = line.match(/^"((?:[^"]|"")*)",([^,]+),(\d+)$/);
    if (!m) continue;
    out.push({ entry: m[1].replace(/""/g, '"'), order: Number(m[3]) });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

export function handCount(rows: { entry: string }[]): number {
  return rows.filter(r => /^-- starting hand #\d+/.test(r.entry)).length;
}

export function stackSnapshots(rows: { entry: string }[]): { hand: number; stacks: Record<string, number> }[] {
  const out: { hand: number; stacks: Record<string, number> }[] = [];
  let hand = 0;
  for (const { entry } of rows) {
    let m = entry.match(/^-- starting hand #(\d+)/);
    if (m) { hand = Number(m[1]); continue; }
    if (entry.startsWith("Player stacks:")) {
      const stacks: Record<string, number> = {};
      const re = /"([^"]+)" \((\d+)\)/g;
      let s: RegExpExecArray | null;
      while ((s = re.exec(entry))) stacks[playerName(`"${s[1]}"`)] = Number(s[2]);
      out.push({ hand, stacks });
    }
  }
  return out;
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
