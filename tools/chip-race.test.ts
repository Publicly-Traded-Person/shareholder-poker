// Tests for the chip-race fragment builder and the marker injector. Uses the
// synthetic fixture logs (invented players only; real logs never enter the
// repo). Run: bun test tools/chip-race.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildChipRaceFragment, injectFragment, clockPT, MARK_START, MARK_END } from "./chip-race";

const csv = await Bun.file(new URL("./fixtures/mini-log.csv", import.meta.url)).text();
// Two tables of one tournament: hand numbers overlap, table 2 has a rebuy and
// a bust (ivy, 00:31), and closes into table 1 at 00:33 (see the fixtures).
const t1 = await Bun.file(new URL("./fixtures/mini-t1.csv", import.meta.url)).text();
const t2 = await Bun.file(new URL("./fixtures/mini-t2.csv", import.meta.url)).text();

// One polyline's points attribute, found by the <title> that names its player.
function pointsOf(frag: string, player: string): string {
  const m = frag.match(new RegExp(`points="([^"]*)"><title>${player}</title>`));
  if (!m) throw new Error(`no polyline for ${player}`);
  return m[1];
}

describe("clockPT", () => {
  test("renders a UTC log timestamp as a Pacific clock time, daylight or standard", () => {
    expect(clockPT("2026-09-09T03:43:33.135Z")).toBe("8:43pm");
    expect(clockPT("2026-01-01T00:33:00.000Z")).toBe("4:33pm");
    expect(clockPT("2026-01-01T20:05:00.000Z")).toBe("12:05pm");
  });
});

describe("buildChipRaceFragment, one table", () => {
  const frag = buildChipRaceFragment([csv], { date: "2026-01-01", startingStack: 5000 });
  test("is a bare figure fragment, not a document", () => {
    expect(frag).toStartWith('<figure class="chip-race">');
    expect(frag).not.toContain("<!doctype");
    expect(frag).not.toContain("<head>");
    expect(frag).not.toContain("http://");
    expect(frag).not.toContain("https://");
  });
  test("draws one polyline and one legend key per player", () => {
    expect((frag.match(/<polyline/g) || []).length).toBe(3);
    expect((frag.match(/class="key"/g) || []).length).toBe(3);
    expect(frag).toContain('class="chip-legend"');
  });
  test("states the date, entries, and hands in the meta line, with no table count", () => {
    expect(frag).toContain("Chip race: 2026-01-01. 3 entries, 3 hands.");
    expect(frag).not.toContain("across");
  });
  test("plots x as time since the first snapshot, not hand number", () => {
    // Snapshots at 00:03, 00:06, 00:08: hand 2 sits 3/5 of the way across
    // the 640-unit plot (x = 40 + 384), where a hand axis would put it at 2/3.
    expect(pointsOf(frag, "alice")).toStartWith("40.0,");
    expect(pointsOf(frag, "alice")).toContain(" 424.0,");
  });
  test("draws no merge marker and no region labels", () => {
    expect(frag).not.toContain('class="merge"');
    expect(frag).not.toContain("final table");
  });
  test("contains no em dash", () => {
    expect(frag).not.toContain("—");
  });
});

describe("buildChipRaceFragment, two tables", () => {
  const frag = buildChipRaceFragment([t1, t2], { date: "2026-01-01", startingStack: 1000 });
  test("draws every player from both tables on one chart", () => {
    expect((frag.match(/<polyline/g) || []).length).toBe(6);
    for (const p of ["dave", "erin", "frank", "gina", "hank", "ivy"]) expect(frag).toContain(`<title>${p}</title>`);
  });
  test("names the table count in the meta line", () => {
    expect(frag).toContain("Chip race: 2026-01-01. 7 entries, 6 hands across two tables.");
  });
  test("marks the merge once, at its Pacific clock time, with the region labels", () => {
    expect((frag.match(/class="merge"/g) || []).length).toBe(1);
    expect(frag).toContain("tables merge 4:33pm");
    expect(frag).toContain(">two tables<");
    expect(frag).toContain(">final table<");
  });
  test("ends the non-final-table bust at zero, at the moment it happened", () => {
    // ivy busts at 00:31 on table 2; the plot runs 00:02:30 to 00:36:30, so
    // her last point is 28.5/34 of the way across, on the axis (y = 360).
    expect(pointsOf(frag, "ivy")).toEndWith(" 576.5,360.0");
  });
  test("labels the x axis every half hour of Pacific wall-clock time", () => {
    expect(frag).toContain(">4:30pm<");
    expect(frag).not.toContain("4:00pm");
  });
});

describe("buildChipRaceFragment, more players than palette colors", () => {
  // Eight invented players in one hand: the eighth reuses the first color,
  // so it must be told apart some other way (a dashed stroke, and a matching
  // legend swatch). Colors alone ran out on the fourteen-player September game.
  const names = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const stacks = names.map((n, i) => `#${i + 1} ""${n} @ id${i}"" (1000)`).join(" | ");
  const eight = [
    "entry,at,order",
    `"Player stacks: ${stacks}",2026-01-01T00:03:00.000Z,300`,
    `"-- starting hand #1 (id: h1) (No Limit Texas Hold'em) (dealer: ""p1 @ id0"") --",2026-01-01T00:02:00.000Z,200`,
  ].join("\n");
  const frag = buildChipRaceFragment([eight], { date: "2026-01-01", startingStack: 1000 });
  test("dashes the lines past the seventh and marks their legend swatches", () => {
    expect((frag.match(/stroke-dasharray/g) || []).length).toBe(1);
    expect(frag).toMatch(/stroke-dasharray="[^"]+" points="[^"]*"><title>p8<\/title>/);
    expect((frag.match(/swatch swatch--dashed/g) || []).length).toBe(1);
  });
});

// The SVG text and marker lines carry no presentation attributes of their
// own (a stylesheet rule beats an attribute, so a size set both ways drifts;
// memory 2026-09-07). The stylesheet is therefore the only place the axis
// labels, the merge marker, and the dashed swatch get their look, and a
// missing rule would ship unstyled black text on the dark figure.
describe("site/styles.css styles the chart's axis, merge marker, and dashed swatch", () => {
  const css = readFileSync(new URL("../site/styles.css", import.meta.url).pathname, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // The body of every leaf rule whose selector list names `selector`
  // exactly (a grouped rule "a, b { }" counts for both a and b).
  const rule = (selector: string): string | null => {
    const bodies: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      if (m[1].split(",").map(x => x.trim().replace(/\s+/g, " ")).includes(selector)) bodies.push(m[2]);
    }
    return bodies.length ? bodies.join(";") : null;
  };
  test.each([
    [".chip-race .tick text", "font-size"],
    [".chip-race .tick text", "fill"],
    [".chip-race .tick line", "stroke"],
    [".chip-race .merge line", "stroke-dasharray"],
    [".chip-race .merge text", "font-size"],
    [".chip-race .region", "font-size"],
    [".chip-race .swatch--dashed", "mask-image"],
  ])("%s declares %s", (selector, prop) => {
    const body = rule(selector);
    expect(body).not.toBeNull();
    expect(body).toMatch(new RegExp(`(^|[\\s;])${prop}\\s*:`));
  });
});

describe("injectFragment", () => {
  const frag = buildChipRaceFragment([csv], { date: "2026-01-01", startingStack: 5000 });
  const shell = `<p>before</p>\n${MARK_START}\nold content\n${MARK_END}\n<p>after</p>`;
  test("replaces everything between the markers and keeps the rest", () => {
    const out = injectFragment(shell, frag);
    expect(out).toContain("<p>before</p>");
    expect(out).toContain("<p>after</p>");
    expect(out).toContain('class="chip-race"');
    expect(out).not.toContain("old content");
  });
  test("is idempotent: a second inject replaces, never appends", () => {
    const once = injectFragment(shell, frag);
    const twice = injectFragment(once, frag);
    expect((twice.match(/class="chip-race"/g) || []).length).toBe(1);
  });
  test("halts on a page without exactly one marker pair", () => {
    expect(() => injectFragment("<p>no markers</p>", frag)).toThrow(/marker pair/);
    expect(() => injectFragment(shell + MARK_START + MARK_END, frag)).toThrow(/marker pair/);
  });
});
