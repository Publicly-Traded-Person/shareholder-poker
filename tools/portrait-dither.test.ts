// Byte-exact pins for the client-side dither pipeline. This module is the JS
// home of the recipe in munger/ccg/dither-portrait.py (Atkinson, duotone in
// the rarity metals, right-edge feather); the two must not drift on the
// kernel. All fixtures are generated patterns, never a person.
//
// WHY THESE FIXTURES LOOK THE WAY THEY DO (read before "simplifying" one):
// every player's face runs through this math, so a kernel regression changes
// all of them at once and no page would look obviously broken. A pin is only
// worth its line count if a wrong kernel FAILS it. Fixtures whose pixels sit
// far from the 128 threshold cannot do that: no plausible amount of error
// diffusion flips a bit, so they pass just as happily against a plain
// threshold with the kernel deleted. The fixtures below are therefore chosen
// to sit in the band where diffusion decides the bit:
//
//   1. Flat mid-tone fields just under threshold. Every lit bit in the output
//      exists ONLY because error accumulated into it. These are the broad
//      signature pins.
//   2. One probe per tap. A black field, one just-under-threshold source
//      pixel, and one target primed so it can cross 128 only if that specific
//      tap fires. When one of these fails it names the broken tap, which a
//      single long bit string cannot do.
//
// Every expected value here was read off the shipped implementation and then
// re-derived against deliberately mutated copies of it (wrong divisor, each
// tap dropped in turn, diffusion removed entirely) to confirm each mutation
// turns at least one of these tests red. If you change a fixture, redo that
// check; a pin that no wrong kernel can fail is not a pin.
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the browser
import {
  PANEL_W, PANEL_H, METALS, atkinson, duotone, feather, stampPip, composePanel,
} from "../site/portrait-dither.js";

// Felt ink and the foil tint as RGBA bytes, spelled out once so the pins below
// read as colours rather than as magic numbers. 0x101216 / 0xc9a227.
const INK = [16, 18, 22, 255];
const FOIL = [201, 162, 39, 255];

/** Reads one pixel out of an RGBA buffer as a plain [r, g, b, a] array. */
const pixel = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
  Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

/** Renders a dither result as a bit string, which diffs far more readably
 *  than a 32-element array when a kernel change breaks one of the pins. */
const bits = (out: Uint8Array) => Array.from(out).join("");

describe("constants", () => {
  test("panel dimensions are the art slot at render scale", () => {
    expect(PANEL_W).toBe(620);
    expect(PANEL_H).toBe(236);
  });
  test("the four metals carry the styles.css ramp values over felt", () => {
    expect(Object.keys(METALS).sort()).toEqual(["copper", "foil", "pewter", "sapphire"]);
    expect(METALS.copper).toEqual({ ink: "#101216", tint: "#b06c3f" });
    expect(METALS.foil.tint).toBe("#c9a227");
    expect(METALS.sapphire.tint).toBe("#2b5d9e");
    expect(METALS.pewter.tint).toBe("#8a8d91");
  });
});

describe("atkinson", () => {
  test("returns one 0/1 byte per pixel in a Uint8Array", () => {
    const out = atkinson([200, 50, 100, 150], 2, 2);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(4);
  });

  test("a 2x2 of far-from-threshold pixels resolves to plain thresholding", () => {
    // Hand-traced: 6/8 of each error diffuses (right, right+1, and the three
    // below), 2/8 is discarded. [200,50,100,150] resolves to [1,0,0,1].
    // NOTE: this fixture pins behaviour, NOT the kernel. All four values sit
    // far from 128, so the diffused error never flips a bit and this exact
    // output also falls out of a bare threshold. The kernel pins are the
    // flat-field signatures and the per-tap probes below; do not treat this
    // test as covering them.
    expect(Array.from(atkinson([200, 50, 100, 150], 2, 2))).toEqual([1, 0, 0, 1]);
  });

  // --- the signature pins: every lit bit below is diffusion's doing ---

  test("pins the kernel on a flat 6x3 mid-tone field, bit for bit", () => {
    // 120 is eight steps under the threshold, so a bare threshold renders
    // this field entirely black. Each 1 below is error that walked into the
    // pixel through the kernel.
    expect(bits(atkinson(new Array(18).fill(120), 6, 3))).toBe("010010011010100101");
  });

  test("pins the kernel on a flat 8x4 mid-tone field, bit for bit", () => {
    // Wider and one row taller than the 6x3, which is what gives the
    // two-rows-down tap and the error divisor room to show themselves. This
    // is the single strictest pin in the file: every kernel mutation checked
    // (divisor 4, 6 or 16, diffusion removed, and each of the six taps
    // dropped on its own) changes this string.
    expect(bits(atkinson(new Array(32).fill(120), 8, 4)))
      .toBe("01001001011011001001001110010010");
  });

  test("pins the kernel on a flat highlight field, where the discarded 2/8 shows", () => {
    // 190 is well over threshold, so a bare threshold renders this solid
    // white. The holes are the 2/8 of the error Atkinson throws away, which
    // is exactly the early-Mac look the recipe is after.
    expect(bits(atkinson(new Array(32).fill(190), 8, 4)))
      .toBe("11111111111101111101110111111111");
  });

  // --- one probe per tap, so a failure names the tap that broke ---
  //
  // Shape of every probe: a 4x4 black field, a source pixel of 127 at (1, 1)
  // that stays off and therefore pushes its whole value (127/8 = 15.875) out
  // through the kernel, and a single target pixel primed just under 128. The
  // target lights up only if that one tap delivers. Drop the tap and the
  // whole field comes back black.

  /** Builds a probe board: 127 at (1, 1), `prime` at the named target. */
  const probe = (tx: number, ty: number, prime: number) => {
    const g = new Array(16).fill(0);
    g[1 * 4 + 1] = 127;
    g[ty * 4 + tx] = prime;
    return g;
  };

  test("the (x+1, y) tap carries error to the next pixel in the row", () => {
    expect(bits(atkinson(probe(2, 1, 113), 4, 4))).toBe("0000001000000000");
  });
  test("the (x+2, y) tap carries error two pixels along the row", () => {
    expect(bits(atkinson(probe(3, 1, 111), 4, 4))).toBe("0000000100000000");
  });
  test("the (x-1, y+1) tap carries error down and left", () => {
    expect(bits(atkinson(probe(0, 2, 113), 4, 4))).toBe("0000000010000000");
  });
  test("the (x, y+1) tap carries error straight down", () => {
    expect(bits(atkinson(probe(1, 2, 109), 4, 4))).toBe("0000000001000000");
  });
  test("the (x+1, y+1) tap carries error down and right", () => {
    expect(bits(atkinson(probe(2, 2, 104), 4, 4))).toBe("0000000000100000");
  });
  test("the (x, y+2) tap carries error two rows down", () => {
    expect(bits(atkinson(probe(1, 3, 105), 4, 4))).toBe("0000000000000100");
  });

  test("threshold sits at 128", () => {
    expect(Array.from(atkinson([128], 1, 1))).toEqual([1]);
    expect(Array.from(atkinson([127], 1, 1))).toEqual([0]);
  });
  test("solid fields stay solid", () => {
    expect(Array.from(atkinson(new Array(9).fill(0), 3, 3))).toEqual(new Array(9).fill(0));
    expect(Array.from(atkinson(new Array(9).fill(255), 3, 3))).toEqual(new Array(9).fill(1));
  });
  test("is deterministic", () => {
    const a = atkinson([10, 240, 130, 90, 200, 60], 3, 2);
    const b = atkinson([10, 240, 130, 90, 200, 60], 3, 2);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  test("a plain array and a typed array of the same values agree", () => {
    // The page hands this function a slice of canvas ImageData; the tests
    // hand it plain arrays. Both paths must land on the same bits.
    const v = [0, 40, 90, 130, 200, 250, 10, 60, 255, 128, 33, 77];
    expect(bits(atkinson(Uint8Array.from(v), 4, 3))).toBe(bits(atkinson(v, 4, 3)));
    expect(bits(atkinson(v, 4, 3))).toBe("000111001000");
  });
});

describe("duotone", () => {
  test("bit on is the metal tint, bit off is the felt ink", () => {
    const px = duotone(Uint8Array.from([1, 0]), 2, 1, "copper");
    expect(px).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(px)).toEqual([0xb0, 0x6c, 0x3f, 255, 0x10, 0x12, 0x16, 255]);
  });
  test("throws on an unknown metal rather than guessing a palette", () => {
    expect(() => duotone(Uint8Array.from([1]), 1, 1, "chrome")).toThrow(/metal/);
  });
});

describe("feather", () => {
  test("the right edge lands on ink and pixels left of the ramp are untouched", () => {
    const w = 400, h = 1;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w; i++) px.set([0xb0, 0x6c, 0x3f, 255], i * 4);
    feather(px, w, h);
    expect(Array.from(px.slice((w - 1) * 4, w * 4))).toEqual([0x10, 0x12, 0x16, 255]);
    expect(Array.from(px.slice(0, 4))).toEqual([0xb0, 0x6c, 0x3f, 255]); // x=0, outside RAMP=160
  });

  test("the ramp is exactly 160px wide and blends linearly across it", () => {
    // Pins RAMP itself, not just "something fades on the right". On a 400px
    // row the ramp opens at x = 400 - 160 = 240 (weight 0, so that pixel is
    // still untouched) and the first CHANGED pixel is 241. Widen or narrow
    // RAMP and every number below moves.
    const w = 400;
    const px = new Uint8ClampedArray(w * 4);
    for (let i = 0; i < w; i++) px.set([0xb0, 0x6c, 0x3f, 255], i * 4);
    feather(px, w, 1);

    let firstChanged = -1;
    for (let x = 0; x < w; x++) {
      const p = pixel(px, w, x, 0);
      if (p[0] !== 0xb0 || p[1] !== 0x6c || p[2] !== 0x3f) { firstChanged = x; break; }
    }
    expect(firstChanged).toBe(241);

    expect(pixel(px, w, 240, 0)).toEqual([0xb0, 0x6c, 0x3f, 255]); // ramp opens, weight 0
    expect(pixel(px, w, 241, 0)).toEqual([175, 107, 63, 255]);     // one step in
    expect(pixel(px, w, 320, 0)).toEqual([95, 63, 42, 255]);       // half way
    expect(pixel(px, w, 399, 0)).toEqual(INK);                     // fully ink
  });

  test("blends in place and hands back the same buffer", () => {
    // The page reuses one ImageData per adjustment, so this has to mutate
    // rather than allocate. Returning the same object is the contract the
    // consent page relies on.
    const px = new Uint8ClampedArray(8);
    expect(feather(px, 2, 1)).toBe(px);
  });
});

describe("stampPip", () => {
  // A club: three discs and a stem, in a shade 18% of the way from the felt
  // ink toward the metal tint. Over copper that lands on 45,34,29.
  const stamped = () => {
    const px = new Uint8ClampedArray(PANEL_W * PANEL_H * 4);
    for (let i = 0; i < PANEL_W * PANEL_H; i++) px.set(INK, i * 4);
    return px;
  };

  test("stamps in place and hands back the same buffer", () => {
    const px = stamped();
    expect(stampPip(px, PANEL_W, PANEL_H, "copper")).toBe(px);
  });

  test("the club sits where the staged cards keep theirs", () => {
    const px = stamped();
    stampPip(px, PANEL_W, PANEL_H, "copper");
    const SHADE = [45, 34, 29, 255];
    expect(pixel(px, PANEL_W, 508, 100)).toEqual(SHADE); // top disc centre
    expect(pixel(px, PANEL_W, 508, 74)).toEqual(SHADE);  // top disc rim
    expect(pixel(px, PANEL_W, 508, 73)).toEqual(INK);    // one pixel above it
    expect(pixel(px, PANEL_W, 488, 126)).toEqual(SHADE); // left disc centre
    expect(pixel(px, PANEL_W, 528, 126)).toEqual(SHADE); // right disc centre
    expect(pixel(px, PANEL_W, 508, 160)).toEqual(SHADE); // stem
    expect(pixel(px, PANEL_W, 508, 170)).toEqual(INK);   // below the stem
  });

  test("stays in its own corner and leaves the face alone", () => {
    const px = stamped();
    stampPip(px, PANEL_W, PANEL_H, "copper");
    let minX = PANEL_W, maxX = -1, minY = PANEL_H, maxY = -1;
    for (let y = 0; y < PANEL_H; y++) {
      for (let x = 0; x < PANEL_W; x++) {
        const p = pixel(px, PANEL_W, x, y);
        if (p[0] === INK[0] && p[1] === INK[1] && p[2] === INK[2]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    // The face sits on the LEFT, so the stamp must never reach into it.
    expect({ minX, maxX, minY, maxY }).toEqual({ minX: 462, maxX: 554, minY: 74, maxY: 169 });
  });

  test("throws on an unknown metal rather than guessing a shade", () => {
    expect(() => stampPip(new Uint8ClampedArray(4), 1, 1, "chrome")).toThrow(/metal/);
  });
});

describe("composePanel", () => {
  const src = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };

  /** A full-panel source in one flat colour, for the luma pins. */
  const solid = (r: number, g: number, b: number) => {
    const data = new Uint8ClampedArray(PANEL_W * PANEL_H * 4);
    for (let i = 0; i < PANEL_W * PANEL_H; i++) data.set([r, g, b, 255], i * 4);
    return { width: PANEL_W, height: PANEL_H, data };
  };

  test("emits exactly one panel", () => {
    const out = composePanel(src, { scale: 1, ox: 0, oy: 0 }, "pewter");
    expect(out.width).toBe(PANEL_W);
    expect(out.height).toBe(PANEL_H);
    expect(out.data.length).toBe(PANEL_W * PANEL_H * 4);
  });
  test("out-of-source samples become felt ink, not garbage", () => {
    const out = composePanel(src, { scale: 1, ox: 10000, oy: 10000 }, "pewter");
    expect(Array.from(out.data.slice(0, 4))).toEqual([0x10, 0x12, 0x16, 255]);
  });
  test("the pip corner carries the pip shade", () => {
    const out = composePanel(src, { scale: 1, ox: 10000, oy: 10000 }, "copper");
    // Pip center (508, 100): on an all-ink panel the stamp is the only mark.
    const i = (100 * PANEL_W + 508) * 4;
    expect(Array.from(out.data.slice(i, i + 3))).not.toEqual([0x10, 0x12, 0x16]);
  });

  test("stamps the pip after the feather, so the club keeps its full shade", () => {
    // Order matters and is easy to swap by accident. The club spans x =
    // 462..554, which sits INSIDE the 160px feather ramp that opens at x =
    // 460. Stamp first and the feather would wash the club out to roughly
    // 36,29,27 at its centre; stamping last leaves the shade untouched at
    // exactly 45,34,29. These bytes are the pin on the pipeline order.
    const out = composePanel(src, { scale: 1, ox: 10000, oy: 10000 }, "copper");
    const SHADE = [45, 34, 29, 255];
    expect(pixel(out.data, PANEL_W, 508, 100)).toEqual(SHADE); // top disc centre
    expect(pixel(out.data, PANEL_W, 488, 126)).toEqual(SHADE); // left disc centre
    expect(pixel(out.data, PANEL_W, 528, 126)).toEqual(SHADE); // right disc centre
    expect(pixel(out.data, PANEL_W, 508, 160)).toEqual(SHADE); // stem
  });

  test("greys by Rec. 709 luma, not by a flat channel average", () => {
    // The three primaries are the whole test. Under Rec. 709 green carries
    // 0.7152 of the luma (255 * 0.7152 = 182, over threshold, so the panel
    // lights up) while red carries 0.2126 and blue 0.0722 (both under, so
    // both stay dark). Average the channels instead and all three land on 85
    // and go dark together, which is how a washed-out portrait would ship
    // unnoticed. (0, 0) is outside both the feather ramp and the pip, so it
    // reports the dither bit directly.
    expect(pixel(composePanel(solid(0, 255, 0), { scale: 1, ox: 0, oy: 0 }, "foil").data, PANEL_W, 0, 0)).toEqual(FOIL);
    expect(pixel(composePanel(solid(255, 0, 0), { scale: 1, ox: 0, oy: 0 }, "foil").data, PANEL_W, 0, 0)).toEqual(INK);
    expect(pixel(composePanel(solid(0, 0, 255), { scale: 1, ox: 0, oy: 0 }, "foil").data, PANEL_W, 0, 0)).toEqual(INK);
  });

  test("blue carries its 0.0722 of the luma and is not quietly dropped", () => {
    // The three primaries above cannot see a missing blue term, because blue
    // alone is dark either way. This colour is the one that can: 0.7152 * 170
    // + 0.0722 * 255 = 140.0, over threshold, so the panel lights up. Drop
    // the blue term and it falls to 121.6 and goes dark.
    const teal = composePanel(solid(0, 170, 255), { scale: 1, ox: 0, oy: 0 }, "foil");
    expect(pixel(teal.data, PANEL_W, 0, 0)).toEqual(FOIL);
  });

  test("runs the feather, so the panel's right edge is ink in every row", () => {
    // A lit panel would otherwise carry dither bits all the way to x = 619.
    // Checking every row (not one sample) is what makes this fail if the
    // feather call is ever dropped from the pipeline.
    const out = composePanel(solid(0, 255, 0), { scale: 1, ox: 0, oy: 0 }, "foil");
    for (let y = 0; y < PANEL_H; y++) {
      expect(pixel(out.data, PANEL_W, PANEL_W - 1, y)).toEqual(INK);
    }
    // Just outside the ramp the art is still full-strength foil, which is
    // what proves the row above is the feather and not an all-ink panel.
    expect(pixel(out.data, PANEL_W, 459, 0)).toEqual(FOIL);
  });

  test("honours scale, ox and oy when cropping the source", () => {
    // An 8x8 white source under scale 2, ox 4, oy 1. Dest (x, y) reads source
    // (floor(x / 2 + 4), floor(y / 2 + 1)), so the source runs out at dest
    // x = 8 and dest y = 14 and everything past that falls back to felt ink.
    // Ignore the scale and the white block would end at x = 4; ignore ox and
    // it would run to x = 16. Both mis-crops move these pins.
    const white = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
    const out = composePanel(white, { scale: 2, ox: 4, oy: 1 }, "foil");
    expect(pixel(out.data, PANEL_W, 0, 0)).toEqual(FOIL);   // inside the crop
    expect(pixel(out.data, PANEL_W, 7, 0)).toEqual(FOIL);   // last in-source column
    expect(pixel(out.data, PANEL_W, 8, 0)).toEqual(INK);    // first column past it
    expect(pixel(out.data, PANEL_W, 10, 0)).toEqual(INK);   // and it stays past it
    expect(pixel(out.data, PANEL_W, 0, 13)).toEqual(FOIL);  // last in-source row
    expect(pixel(out.data, PANEL_W, 0, 14)).toEqual(INK);   // first row past it
  });
});
