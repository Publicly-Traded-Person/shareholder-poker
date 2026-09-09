import { describe, expect, test } from "bun:test";
import { parseRows, playerName, stackSnapshots, busts, mergeLogs, entryCount, handCount, ChipConservationError } from "./pokernow";

const csv = await Bun.file(new URL("../fixtures/mini-log.csv", import.meta.url)).text();
// Two tables of one synthetic tournament (invented players only). Both count
// hands from #1 at the same moment; table 2 has a rebuy, a bust, and closes
// into table 1 at 00:33. See the fixture files for the timeline.
const t1 = await Bun.file(new URL("../fixtures/mini-t1.csv", import.meta.url)).text();
const t2 = await Bun.file(new URL("../fixtures/mini-t2.csv", import.meta.url)).text();

describe("parseRows", () => {
  test("returns rows oldest-first and unescapes doubled quotes", () => {
    const rows = parseRows(csv);
    expect(rows[0].order).toBeLessThan(rows[rows.length - 1].order);
    expect(rows.some(r => r.entry.includes('"alice @ aaa111"'))).toBe(true);
  });
  test("keeps each row's timestamp", () => {
    const rows = parseRows(csv);
    expect(rows[0].at).toBe("2026-01-01T00:01:00.000Z");
    expect(rows[rows.length - 1].at).toBe("2026-01-01T00:09:00.000Z");
  });
});

describe("playerName", () => {
  test("strips the id suffix", () => {
    expect(playerName('"alice @ aaa111"')).toBe("alice");
  });
});

describe("stackSnapshots", () => {
  test("associates each stacks line with the current hand number and its timestamp", () => {
    const snaps = stackSnapshots(parseRows(csv));
    expect(snaps.length).toBe(3);
    expect(snaps[0]).toEqual({ hand: 1, at: "2026-01-01T00:03:00.000Z", stacks: { alice: 5000, bob: 5000, carol: 5000 } });
    expect(snaps[2].stacks.alice).toBe(9000);
  });
});

describe("busts", () => {
  test("reports each player who left with nothing, at the moment they left", () => {
    expect(busts(parseRows(t2))).toEqual([{ player: "ivy", at: "2026-01-01T00:31:00.000Z" }]);
  });
  test("is empty for a log where nobody busted", () => {
    expect(busts(parseRows(csv))).toEqual([]);
  });
});

describe("mergeLogs", () => {
  test("orders the union by timestamp, not by per-table hand number", () => {
    const { rows } = mergeLogs([t1, t2]);
    const snaps = stackSnapshots(rows);
    expect(snaps.map(s => s.at)).toEqual([
      "2026-01-01T00:02:30.000Z", // table 1 hand 1
      "2026-01-01T00:02:31.000Z", // table 2 hand 1
      "2026-01-01T00:12:30.000Z", // table 2 hand 2
      "2026-01-01T00:15:30.000Z", // table 1 hand 2
      "2026-01-01T00:22:30.000Z", // table 2 hand 3
      "2026-01-01T00:36:30.000Z", // table 1 hand 3, after the merge
    ]);
  });
  test("tags every row with the index of the log it came from", () => {
    const { rows } = mergeLogs([t1, t2]);
    expect(rows.filter(r => r.table === 0).length).toBe(parseRows(t1).length);
    expect(rows.filter(r => r.table === 1).length).toBe(parseRows(t2).length);
  });
  test("reports the moment each closed table folded into the final one", () => {
    const merged = mergeLogs([t1, t2]);
    expect(merged.tables).toBe(2);
    expect(merged.merges).toEqual(["2026-01-01T00:33:00.000Z"]);
  });
  test("reports no merge for a single log", () => {
    const merged = mergeLogs([csv]);
    expect(merged.tables).toBe(1);
    expect(merged.merges).toEqual([]);
    expect(merged.rows.map(r => r.entry)).toEqual(parseRows(csv).map(r => r.entry));
  });
  test("counts hands across every table and takes chip conservation from the final table's last hand", () => {
    const { rows } = mergeLogs([t1, t2]);
    expect(handCount(rows)).toBe(6);
    const snaps = stackSnapshots(rows);
    expect(entryCount(snaps[snaps.length - 1].stacks, 1000)).toBe(7);
  });
});

describe("handCount", () => {
  test("counts starting-hand lines", () => {
    expect(handCount(parseRows(csv))).toBe(3);
  });
});

describe("entryCount", () => {
  test("derives entries from chip conservation", () => {
    expect(entryCount({ alice: 9000, bob: 4000, carol: 2000 }, 5000)).toBe(3);
  });
  test("throws when totals do not divide by the starting stack", () => {
    expect(() => entryCount({ alice: 9000, bob: 4100 }, 5000)).toThrow(ChipConservationError);
  });
});
