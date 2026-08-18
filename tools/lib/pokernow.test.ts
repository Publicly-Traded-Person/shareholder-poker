import { describe, expect, test } from "bun:test";
import { parseRows, playerName, stackSnapshots, entryCount, handCount, ChipConservationError } from "./pokernow";

const csv = await Bun.file(new URL("../fixtures/mini-log.csv", import.meta.url)).text();

describe("parseRows", () => {
  test("returns rows oldest-first and unescapes doubled quotes", () => {
    const rows = parseRows(csv);
    expect(rows[0].order).toBeLessThan(rows[rows.length - 1].order);
    expect(rows.some(r => r.entry.includes('"alice @ aaa111"'))).toBe(true);
  });
});

describe("playerName", () => {
  test("strips the id suffix", () => {
    expect(playerName('"alice @ aaa111"')).toBe("alice");
  });
});

describe("stackSnapshots", () => {
  test("associates each stacks line with the current hand number", () => {
    const snaps = stackSnapshots(parseRows(csv));
    expect(snaps.length).toBe(3);
    expect(snaps[0]).toEqual({ hand: 1, stacks: { alice: 5000, bob: 5000, carol: 5000 } });
    expect(snaps[2].stacks.alice).toBe(9000);
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
