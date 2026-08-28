// Byte-exact pins for the client-side dither pipeline. This module is the JS
// home of the recipe in munger/ccg/dither-portrait.py (Atkinson, duotone in
// the rarity metals, right-edge feather); the two must not drift on the
// kernel. All fixtures are generated patterns, never a person.
import { describe, expect, test } from "bun:test";
// @ts-ignore - plain JS module shared with the browser
import {
  PANEL_W, PANEL_H, METALS, atkinson, duotone, feather, stampPip, composePanel,
} from "../site/portrait-dither.js";

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
  test("pins the kernel on a 2x2 fixture, byte for byte", () => {
    // Hand-traced: 6/8 of each error diffuses (right, right+1, and the three
    // below), 2/8 is discarded. [200,50,100,150] resolves to [1,0,0,1].
    expect(Array.from(atkinson([200, 50, 100, 150], 2, 2))).toEqual([1, 0, 0, 1]);
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
});

describe("duotone", () => {
  test("bit on is the metal tint, bit off is the felt ink", () => {
    const px = duotone(Uint8Array.from([1, 0]), 2, 1, "copper");
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
});

describe("composePanel", () => {
  const src = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
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
});
