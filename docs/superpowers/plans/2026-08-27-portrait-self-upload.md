# Portrait Self-Upload Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player uploads their own photo on the consent page, watches it dithered live in their card's rarity metal, frames it, and approves it; only the finished 620x236 art panel ever leaves their browser, and approving stores it as ledger variant `self`.

**Architecture:** A pure pixel-math module (`site/portrait-dither.js`) does crop, Atkinson dither, duotone, feather, and pip stamping client-side; one new Pages Function (`POST /api/portrait/<token>/upload`) validates a small PNG (magic bytes + exact dimensions + size cap) and records art + approval atomically; the consent page grows a conditional upload block gated by a `portraitUploads` flag in games.json and a per-ask `metal` column. The CLI gains `metal` plumbing and a `--pull` verb for Charlie's print seam. Teardown is a manual one-line flag flip on Mike's signal.

**Tech Stack:** Plain JS Pages Functions, canvas ImageData math (no libraries), D1, R2, Bun + TypeScript tools, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-27-portrait-self-upload-design.md` (committed `25e5b14`). Prior art: the consent pages as merged in PR #19 (`72662e3`).

**Acceptance:** suite — committed bun test suite plus per-task review; no seal requested.

## Global Constraints

- **The raw photograph never reaches any server.** No task adds any path by which un-dithered image bytes are transmitted or stored. The only upload is the finished 620x236 panel.
- Privacy (site spec §3): no email in any response, table, output, or fixture. Test fixtures are synthetic: invented players only (never `kmikeym`, `LEWD`, `bg`, `spladow`, `amaxwell`, `nickmershon`, `MoHDI_Drew`, `Webvee`), and any test image bytes are generated patterns (gradients, blocks), never a photograph of a person.
- Every `/portrait/*` and `/api/portrait/*` response carries `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` on every branch including 404s. Unknown, expired, and flag-off are the same 404; the flag fails CLOSED when its read fails (spec §8).
- Copy rules apply to runtime-rendered HTML: no em dashes, "experiment" never, dignity rule, First + last initial names, no lime (`.btn-primary` must not appear), no links into the site.
- `site/data/games.json` gains exactly ONE root key (`"portraitUploads": true`) and stays in canonical `JSON.stringify(data, null, 2)` form; nothing else in it changes. Generated pages (`site/standings/index.html`, `site/games/index.html`) stay byte-identical under `bun tools/render.ts`.
- Validation halts, never guesses: a manifest without a valid `metal` refuses to stage; a malformed ask row 404s; `--pull` refuses unless the latest answer is `approved`/`self`.
- Every file opens with a header comment (what/where/how); every exported function gets a what/returns/throws comment carrying the why of each invariant (repo rule, Mike 2026-08-18).
- The page's `SELECT` gains the `metal` column, which exists in production only after the one-time `ALTER TABLE` migration (runbook + manual Task 9, run before merge). No task assumes the column exists without it.
- Never push to `main` (every push deploys). `bun test tools` green before any commit.

---

### Task 1: The dither module (`site/portrait-dither.js`)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `site/portrait-dither.js`
- Test: `tools/portrait-dither.test.ts`

**Interfaces:**
- Produces: ES module exports `PANEL_W = 620`, `PANEL_H = 236`, `METALS` (`{foil|sapphire|copper|pewter: {ink, tint}}`), `atkinson(gray: number[]|TypedArray, w, h): Uint8Array` (0/1 bits), `duotone(bits, w, h, metal): Uint8ClampedArray` (RGBA), `feather(rgba: Uint8ClampedArray, w, h): Uint8ClampedArray` (in place, returns it), `stampPip(rgba, w, h, metal): Uint8ClampedArray` (in place), `composePanel(src: {data, width, height}, view: {scale, ox, oy}, metal): {data: Uint8ClampedArray, width, height}`.

Every player's face goes through this math; a kernel regression changes them all, which is why review is adversarial and the tests pin bytes.

- [ ] **Step 1: Write the failing tests** at `tools/portrait-dither.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect FAIL**: `bun test tools/portrait-dither.test.ts`
- [ ] **Step 3: Implement `site/portrait-dither.js`**:

```js
// Client-side portrait pipeline for the consent page's self-upload block:
// crop, Atkinson dither, rarity duotone, right-edge feather, pip stamp.
// Served as a public static asset at /portrait-dither.js (it is an algorithm,
// not a secret) and loaded by functions/portrait/[token].js with
// <script type="module">. bun test exercises it directly
// (tools/portrait-dither.test.ts). This is the JS home of the recipe in
// munger/ccg/dither-portrait.py; keep the kernel and ramps in sync with it.

// The art slot at render scale (munger proof, 2026-08-26). The upload
// endpoint enforces the same numbers via PANEL_W/PANEL_H in
// functions/api/_portrait.js; a sync test in tools/portrait-lib.test.ts
// pins the two pairs equal.
export const PANEL_W = 620;
export const PANEL_H = 236;

// Rarity duotone ramps over the felt. Values are DUPLICATED from
// site/styles.css tokens on purpose: canvas cannot read custom properties
// from a stylesheet it has not applied, and a labeled copy is more legible
// than an indirection. If the brand palette moves, both files move.
export const METALS = {
  foil:     { ink: "#101216", tint: "#c9a227" },
  sapphire: { ink: "#101216", tint: "#2b5d9e" },
  copper:   { ink: "#101216", tint: "#b06c3f" },
  pewter:   { ink: "#101216", tint: "#8a8d91" },
};

// How far the right edge melts into the field, in pixels. The face sits on
// the LEFT and feathers rightward so it reads as card art, not a pasted
// photo (munger proof: "a uniform noise floor reads as card art").
const RAMP = 160;

// Pip geometry: a club in the right third, matching where the staged cards
// keep theirs. Drawn as three discs and a stem so it needs no font or path
// rasterizer.
const PIP = { cx: 508, cy: 118, r: 26 };

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

// Atkinson error diffusion over a grayscale buffer. Returns one 0/1 bit per
// pixel. Exactly 6/8 of each pixel's error diffuses (two to the right, three
// below, one two rows down); the discarded 2/8 is what blows highlights and
// crushes shadows into the early-Mac look, so do not "fix" it.
export function atkinson(gray, w, h) {
  const g = Float32Array.from(gray);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const on = g[i] >= 128;
      out[i] = on ? 1 : 0;
      const err = (g[i] - (on ? 255 : 0)) / 8;
      if (x + 1 < w) g[i + 1] += err;
      if (x + 2 < w) g[i + 2] += err;
      if (y + 1 < h) {
        if (x > 0) g[i + w - 1] += err;
        g[i + w] += err;
        if (x + 1 < w) g[i + w + 1] += err;
      }
      if (y + 2 < h) g[i + 2 * w] += err;
    }
  }
  return out;
}

// Maps dither bits onto the metal ramp: on = tint, off = felt ink. Throws on
// an unknown metal; a wrong palette on a consent artifact is worse than a
// loud failure (halt-don't-guess, repo posture).
export function duotone(bits, w, h, metal) {
  const ramp = METALS[metal];
  if (!ramp) throw new Error(`unknown metal "${metal}"`);
  const ink = hex(ramp.ink), tint = hex(ramp.tint);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = bits[i] ? tint : ink;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return px;
}

// Blends the rightmost RAMP pixels toward the felt ink so the portrait melts
// into the field instead of ending at a hard edge. In place; returns rgba.
export function feather(rgba, w, h) {
  const ink = hex(METALS.foil.ink); // ink is the same across all four ramps
  for (let y = 0; y < h; y++) {
    for (let x = w - RAMP; x < w; x++) {
      if (x < 0) continue;
      const t = (x - (w - RAMP)) / (RAMP - 1);
      const i = (y * w + x) * 4;
      rgba[i] = Math.round(rgba[i] + (ink[0] - rgba[i]) * t);
      rgba[i + 1] = Math.round(rgba[i + 1] + (ink[1] - rgba[i + 1]) * t);
      rgba[i + 2] = Math.round(rgba[i + 2] + (ink[2] - rgba[i + 2]) * t);
    }
  }
  return rgba;
}

// Stamps the suit pip (a club: three discs and a stem) in a shade one step
// off the felt, the way the staged cards keep theirs. In place; returns rgba.
export function stampPip(rgba, w, h, metal) {
  const ramp = METALS[metal];
  if (!ramp) throw new Error(`unknown metal "${metal}"`);
  const ink = hex(ramp.ink), tint = hex(ramp.tint);
  const shade = ink.map((v, k) => Math.round(v + (tint[k] - v) * 0.18));
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    rgba[i] = shade[0]; rgba[i + 1] = shade[1]; rgba[i + 2] = shade[2]; rgba[i + 3] = 255;
  };
  const disc = (cx, cy, r) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) put(cx + x, cy + y);
    }
  };
  disc(PIP.cx, PIP.cy - 18, PIP.r);
  disc(PIP.cx - 20, PIP.cy + 8, PIP.r);
  disc(PIP.cx + 20, PIP.cy + 8, PIP.r);
  for (let y = PIP.cy + 8; y < PIP.cy + 52; y++) {
    const half = Math.max(3, Math.round((y - PIP.cy - 8) * 0.28));
    for (let x = PIP.cx - half; x <= PIP.cx + half; x++) put(x, y);
  }
  return rgba;
}

// The one entry point the page calls per adjustment. Crops the player's
// source ImageData per their pan/zoom (nearest sampling; dest pixel (x, y)
// reads source (x / scale + ox, y / scale + oy)), grayscales by Rec. 709
// luma, then runs dither, duotone, feather, and pip. Samples outside the
// source become the felt ink, never garbage. Returns a plain
// {data, width, height} panel the page hands to putImageData/toBlob.
export function composePanel(src, view, metal) {
  const gray = new Float32Array(PANEL_W * PANEL_H);
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const sx = Math.floor(x / view.scale + view.ox);
      const sy = Math.floor(y / view.scale + view.oy);
      let v = 16; // felt-dark default for out-of-source samples
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height) {
        const i = (sy * src.width + sx) * 4;
        v = 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
      }
      gray[y * PANEL_W + x] = v;
    }
  }
  const bits = atkinson(gray, PANEL_W, PANEL_H);
  const rgba = duotone(bits, PANEL_W, PANEL_H, metal);
  feather(rgba, PANEL_W, PANEL_H);
  stampPip(rgba, PANEL_W, PANEL_H, metal);
  return { data: rgba, width: PANEL_W, height: PANEL_H };
}
```

- [ ] **Step 4: Run, expect PASS**; run `bun test tools`.
- [ ] **Step 5: Commit** (`feat: client-side dither module, byte-pinned`).

---

### Task 2: Schema column and the uploads flag

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `site/schema.sql`
- Modify: `site/data/games.json`
- Test: `tools/portrait-schema.test.ts`

**Interfaces:**
- Produces: `portrait_asks.metal TEXT` (nullable) in the CREATE for fresh databases; `"portraitUploads": true` as a games.json root key.

- [ ] **Step 1: Append failing assertions** to `tools/portrait-schema.test.ts`, inside the existing `describe("portrait consent schema")`:

```ts
  test("portrait_asks carries the nullable metal column", () => {
    expect(/\n\s+metal\s+TEXT/.test(schema)).toBe(true);
  });
```

  And a new top-level describe in the same file:

```ts
// File-scope read: top-level await is fine in a bun test module, and an
// await inside a describe callback is not.
const gamesRaw = await Bun.file(new URL("../site/data/games.json", import.meta.url)).text();

describe("uploads flag", () => {
  test("games.json carries portraitUploads and stays canonical", () => {
    const data = JSON.parse(gamesRaw);
    expect(typeof data.portraitUploads).toBe("boolean");
    expect(gamesRaw).toBe(JSON.stringify(data, null, 2) + "\n");
  });
});
```

  (If the file has no trailing newline on main, drop the `+ "\n"` to match reality; assert whichever canonical form the committed file actually has, and keep it.)

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit `site/schema.sql`**: inside `CREATE TABLE IF NOT EXISTS portrait_asks`, after the `variants` column line, add:

```sql
  metal      TEXT,                 -- rarity metal for this set's card: foil |
                                   -- sapphire | copper | pewter. Read by the
                                   -- consent page to duotone a self-uploaded
                                   -- panel; written by portrait-asks.ts, never
                                   -- by hand. Nullable because asks staged
                                   -- before 2026-08-27 predate it; the runbook
                                   -- carries the one-time ALTER for deployed
                                   -- databases (IF NOT EXISTS cannot add it).
```

- [ ] **Step 4: Edit `site/data/games.json`**: add `"portraitUploads": true,` as a root key immediately after the `"nextGame": {...}` block, preserving the file's exact `JSON.stringify(data, null, 2)` form. Change nothing else in the file.
- [ ] **Step 5: Run the tests, expect PASS**, then `bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html` (the generators must ignore the new key; if this diff is non-empty, STOP and report rather than committing).
- [ ] **Step 6: Commit** (`config: metal column and the portraitUploads flag`).

---

### Task 3: PNG and variant helpers (`_portrait.js`)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial
**Commutes:** `tools/portrait-lib.test.ts`

**Files:**
- Modify: `functions/api/_portrait.js`
- Modify: `tools/portrait-lib.test.ts`

**Interfaces:**
- Consumes: the file's existing exports (unchanged).
- Produces: `PANEL_W = 620`, `PANEL_H = 236`, `pngDims(bytes: Uint8Array): {w, h} | null`, `addVariant(variantsJson: string, id: string): string | null`.

- [ ] **Step 1: Append to `tools/portrait-lib.test.ts`** (extend the existing import from `_portrait.js` with `pngDims, addVariant, PANEL_W, PANEL_H`). First, at FILE SCOPE next to the other shared fixtures, so Task 4's block can use it without touching this one (do not rename):

```ts
// Minimal real PNG header: 8-byte signature, IHDR length + type, then
// big-endian width and height. 620 = 0x026C, 236 = 0xEC. Shared by the
// helper tests below and the upload endpoint tests.
export const pngHeader = (w: number, h: number) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
```

  Then the failing describe block:

```ts
describe("pngDims / addVariant / panel constants", () => {
  test("panel constants match the dither module's", async () => {
    // @ts-ignore - browser-shared module
    const dither = await import("../site/portrait-dither.js");
    expect(PANEL_W).toBe(dither.PANEL_W);
    expect(PANEL_H).toBe(dither.PANEL_H);
  });
  test("reads dimensions from a real header", () => {
    expect(pngDims(pngHeader(620, 236))).toEqual({ w: 620, h: 236 });
    expect(pngDims(pngHeader(10, 10))).toEqual({ w: 10, h: 10 });
  });
  test("rejects junk without throwing", () => {
    expect(pngDims(new Uint8Array(0))).toBe(null);
    expect(pngDims(new Uint8Array(23))).toBe(null);
    const notPng = pngHeader(620, 236); notPng[0] = 0x00;
    expect(pngDims(notPng)).toBe(null);
    const notIhdr = pngHeader(620, 236); notIhdr[12] = 0x4a;
    expect(pngDims(notIhdr)).toBe(null);
  });
  test("addVariant appends once and never mangles", () => {
    expect(addVariant('["a","b"]', "self")).toBe('["a","b","self"]');
    expect(addVariant('["a","b","self"]', "self")).toBe('["a","b","self"]');
    expect(addVariant("not json", "self")).toBe(null);
    expect(addVariant("[]", "self")).toBe(null);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (note: the constants-sync test also fails until Task 1's module exists in the integrated tree; within this task's own worktree, guard it with a try/catch dynamic import that skips when the module is absent, OR simply assert the literals `620`/`236` here and leave the cross-module equality to the test as written, which goes green at wave merge. Prefer the literal assertions plus the dynamic-import test marked with `test.if(await Bun.file(new URL("../site/portrait-dither.js", import.meta.url)).exists())` so the task is green standalone and the sync check arms itself once both land).
- [ ] **Step 3: Append to `functions/api/_portrait.js`**:

```js
// The art panel dimensions the upload endpoint enforces. Duplicated from
// site/portrait-dither.js on purpose (a Function importing a site/ asset
// would lean on bundler behavior nothing else here relies on); the sync
// test in tools/portrait-lib.test.ts pins the two pairs equal.
export const PANEL_W = 620;
export const PANEL_H = 236;

// Reads the dimensions out of a PNG's fixed-position header: 8 signature
// bytes, IHDR chunk, big-endian width at 16..19 and height at 20..23.
// Returns null on anything that is not a PNG-shaped buffer, so the caller
// can reject without parsing untrusted bytes any further than 24 offsets.
export function pngDims(bytes) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// Adds one variant id to a portrait_asks.variants JSON array, idempotently.
// Returns the updated (or unchanged) JSON string, or null when the stored
// column fails parseVariants: a malformed ask must halt the caller, never
// be silently repaired (halt-don't-guess).
export function addVariant(variantsJson, id) {
  const v = parseVariants(variantsJson);
  if (v === null) return null;
  if (v.includes(id)) return variantsJson;
  return JSON.stringify([...v, id]);
}
```

- [ ] **Step 4: Run, expect PASS**; `bun test tools`.
- [ ] **Step 5: Commit** (`feat: png header and variant helpers for self-upload`).

---

### Task 4: The upload endpoint

**Type:** implementation
**Depends-on:** 1, 3
**Review:** adversarial
**Commutes:** `tools/portrait-lib.test.ts`

**Files:**
- Create: functions/api/portrait/[token]/upload.js
- Modify: `tools/portrait-lib.test.ts`

(The Create path is a literal Cloudflare Pages parameter filename, brackets included, not a glob; unbackticked so the plan compiler does not read it as one. Created by exactly this one task. The Depends-on 1 exists because this task's test block imports `site/portrait-dither.js` for the constants-sync case.)

**Interfaces:**
- Consumes: `isValidToken`, `isExpired`, `toSqlUtc`, `pngDims`, `addVariant`, `PANEL_W`, `PANEL_H` from `functions/api/_portrait.js` (Task 3); `TOKEN`, `PAST`, `FUTURE`, `ASK` file-scope fixtures already in the test file.
- Produces: `POST /api/portrait/<token>/upload` accepting raw `image/png` bytes; 404 on unknown/expired/flag-off/malformed-ask, 400 on oversize/bad-body/bad-image, 200 `{ok: true, answer: "approved", variant: "self"}` after R2 put + variants update + `approved`/`self` ledger append. Standard privacy headers on every branch.

- [ ] **Step 1: Append a failing describe block** `"POST /api/portrait/<token>/upload"` to `tools/portrait-lib.test.ts`. Do NOT modify `makePortraitEnv`; this block defines its own richer stub (the upload handler needs an UPDATE recorder, an R2 put recorder, and an ASSETS flag, which the shared factory deliberately lacks):

```ts
  function makeUploadEnv(asks: AskRow[], flag: unknown = { portraitUploads: true }) {
    const answers: AnswerRow[] = [];
    const updates: { variants: string; token: string }[] = [];
    const puts: { key: string; size: number }[] = [];
    const db = {
      prepare(sql: string) {
        let args: any[] = [];
        const stmt = {
          bind(...a: any[]) { args = a; return stmt; },
          async first() {
            if (!sql.includes("FROM portrait_asks")) throw new Error(`unexpected first(): ${sql}`);
            return asks.find((r) => r.token === args[0]) ?? null;
          },
          async run() {
            if (sql.includes("UPDATE portrait_asks SET variants")) {
              updates.push({ variants: args[0], token: args[1] });
              return { success: true };
            }
            if (sql.includes("INSERT INTO portrait_answers")) {
              answers.push({ token: args[0], answer: "approved", variant: "self", answered_at: args[1] });
              return { success: true };
            }
            throw new Error(`unexpected run(): ${sql}`);
          },
          async all() { throw new Error(`unexpected all(): ${sql}`); },
        };
        return stmt;
      },
    };
    const bucket = { async put(key: string, bytes: Uint8Array) { puts.push({ key, size: bytes.byteLength }); } };
    const assets = {
      async fetch() {
        if (flag === "throw") throw new Error("assets down");
        return new Response(JSON.stringify(flag));
      },
    };
    return { env: { POKER_RSVP_DB: db, POKER_PORTRAITS: bucket, ASSETS: assets }, answers, updates, puts };
  }
  const pngBody = (w: number, h: number, pad = 100) => {
    const head = pngHeader(w, h); // from the Task 3 describe block, file scope
    const b = new Uint8Array(head.length + pad);
    b.set(head);
    return b;
  };
  const uploadReq = (body: Uint8Array | string) =>
    new Request(`https://poker.example/api/portrait/${TOKEN}/upload`, {
      method: "POST", headers: { "Content-Type": "image/png" }, body,
    });
```

  (`pngHeader` is a file-scope fixture Task 3 added; use it, never redefine it.)

  Cases, each `await onRequestPost({ request, params: { token }, env })` with assertions on status, JSON body, both privacy headers, and that `puts`/`updates`/`answers` recorded nothing on every reject path: invalid token shape 404; unknown token 404; expired ask 404; flag off (`{portraitUploads: false}`) 404; flag missing (`{}`) 404; ASSETS read failure (`"throw"`) 404 (fail closed); body over 262144 bytes 400 `{"error":"too large"}`; empty body 400; non-PNG bytes 400 `{"error":"bad image"}`; PNG with wrong dimensions (620x235, 619x236) 400; malformed variants column on the ask 404; happy path 200 `{ok: true, answer: "approved", variant: "self"}` with `puts` recording key `asks/2026-08/genet/self.png` and the body size, `updates` recording variants `'["a","b","self"]'` for `TOKEN`, one appended answer row with `answered_at` matching `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`; re-upload (call twice) records a second put and a second answer row and variants stays deduped; and no response body on any branch contains `"@"`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** functions/api/portrait/[token]/upload.js:

```js
// Accepts ONE small finished art panel and records the approval it implies.
// Served at POST /api/portrait/<token>/upload on poker.kmikeym.com. The raw
// photograph never reaches this endpoint (self-upload spec s2): the browser
// dithers and composes locally, and what arrives is the exact 620x236 PNG
// the player saw. Uploading IS approving (s4): the art store, the variants
// update, and the approved/self ledger row happen in one handler, because a
// stored-but-unconsented state must not exist.
import {
  isValidToken, isExpired, toSqlUtc, pngDims, addVariant, PANEL_W, PANEL_H,
} from "../../_portrait.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: HEADERS });

// A legitimate panel runs ~100 to 200KB; anything larger is not ours.
const MAX_BYTES = 262144;

export async function onRequestPost({ request, params, env }) {
  const token = params.token;
  if (!isValidToken(token)) return json({ error: "not found" }, 404);

  const ask = await env.POKER_RSVP_DB
    .prepare("SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?")
    .bind(token).first();
  if (!ask || isExpired(ask.expires_at, toSqlUtc(new Date()))) return json({ error: "not found" }, 404);

  // Flag gate, AFTER the ask gate so flag-off and no-ask are the same 404,
  // and failing CLOSED on any read failure: on this surface the safe answer
  // to "am I allowed?" is always no (self-upload spec s8). The flag being
  // off is not an error state the outside world gets to observe.
  let uploadsOn = false;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/games.json", request.url));
    uploadsOn = (await res.json()).portraitUploads === true;
  } catch { uploadsOn = false; }
  if (!uploadsOn) return json({ error: "not found" }, 404);

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return json({ error: "too large" }, 400);
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); }
  catch { return json({ error: "bad body" }, 400); }
  if (bytes.byteLength === 0) return json({ error: "bad body" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "too large" }, 400);

  // Magic bytes + exact panel dimensions. The dimension check doubles as a
  // cheap authenticity guard: only our compositor naturally emits 620x236.
  // Deeper content inspection would be theater (spec s8): the object is
  // consented by its uploader, served only behind this same token, and
  // reviewed by Mike before any card prints.
  const dims = pngDims(bytes);
  if (!dims || dims.w !== PANEL_W || dims.h !== PANEL_H) return json({ error: "bad image" }, 400);

  const variants = addVariant(ask.variants, "self");
  if (variants === null) return json({ error: "not found" }, 404); // malformed ask: never guess

  await env.POKER_PORTRAITS.put(`asks/${ask.set_slug}/${ask.handle}/self.png`, bytes);
  await env.POKER_RSVP_DB
    .prepare("UPDATE portrait_asks SET variants = ? WHERE token = ?")
    .bind(variants, token).run();
  await env.POKER_RSVP_DB
    .prepare("INSERT INTO portrait_answers (token, answer, variant, answered_at) VALUES (?, 'approved', 'self', ?)")
    .bind(token, toSqlUtc(new Date())).run();

  return json({ ok: true, answer: "approved", variant: "self" });
}
```

- [ ] **Step 4: Run, expect PASS**; `bun test tools`.
- [ ] **Step 5: Commit** (`feat: self-upload endpoint, upload is approval`).

---

### Task 5: The page's upload block

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial
**Commutes:** `tools/portrait-lib.test.ts`

**Files:**
- Modify: functions/portrait/[token].js
- Modify: `tools/portrait-lib.test.ts`

(The Modify path with brackets is the literal Pages parameter filename, not a glob; unbackticked for the plan compiler. This task is that file's only writer in this plan.)

**Interfaces:**
- Consumes: `composePanel`, `PANEL_W`, `PANEL_H`, `METALS` from `/portrait-dither.js` at runtime via `<script type="module">` (Task 1); the page's existing helpers and structure (unchanged semantics).
- Produces: the conditional upload block (flag on + valid metal + live ask), the `self` picker label "Your photo", the panel display rule with its caption, and the client script that pans/zooms, live-dithers, and POSTs to `/api/portrait/<token>/upload`.

**Parallelization rationale:** the page consumes only Task 1's module API (a runtime script URL and function signatures fixed in Task 1's Interfaces), never Task 4's code, so the two build in parallel; both append describe blocks to the shared portrait test module (declared Commutes).

- [ ] **Step 1: Append a failing describe block** `"GET /portrait/<token> upload block"` to `tools/portrait-lib.test.ts`, reusing `makePortraitEnv` + an ASSETS wrapper exactly as the existing page tests do, with `AskRow` rows extended by `metal` (add `metal?: string` to the `AskRow` type in the same edit; the shared type gains an optional field, which changes no existing test). Fixture data as in the existing page block plus `portraitUploads: true` on the games.json stub. Cases:
  - flag on + `metal: "copper"` + live ask: HTML contains `Or use a different photo`, `id="photo-in"`, `accept="image/*"`, `id="use-photo"`, `/portrait-dither.js`, `It never leaves your device`;
  - flag on but no `metal` on the ask: none of those strings render (block absent, page otherwise normal, 200);
  - flag on but `metal: "chrome"`: block absent;
  - flag off (`portraitUploads: false` in the stub): block absent;
  - ASSETS stub that throws: block absent AND the page still renders 200 (the existing stats-swallow path);
  - ask whose variants include `self`: picker contains `Your photo` and does NOT contain `Crop SELF`;
  - `self` selected (seed an `approved`/`self` answer row): the card-shot figure carries class `card-shot--panel` and the caption `Your art panel; the printed card carries it in the art slot.` is not `hidden`; with a staged crop selected the caption IS `hidden`;
  - the whole HTML still contains no em dash, no `experiment`, no `btn-primary`, no `@`, no `<a href="/`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Modify** functions/portrait/[token].js. Exact edits, keyed to the file as merged in PR #19:

  1. The ask SELECT (currently `"SELECT handle, set_slug, variants, expires_at FROM portrait_asks WHERE token = ?"`) gains `metal`:

```js
    .prepare("SELECT handle, set_slug, variants, expires_at, metal FROM portrait_asks WHERE token = ?")
```

  (Requires the one-time ALTER migration on deployed databases; the runbook and manual Task 9 own that ordering. Add one comment line above the SELECT saying exactly that.)

  2. The stats try-block (currently assigning only `stats`) also derives the flag, failing closed:

```js
  let stats = null;
  let uploadsOn = false;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/games.json", request.url));
    const data = await res.json();
    stats = statsFor(data, ask.set_slug, ask.handle);
    // Fail CLOSED: any read failure leaves uploads off. The block simply
    // does not render; a capability URL never narrates its own config.
    uploadsOn = data.portraitUploads === true;
  } catch { /* stats stay null, uploads stay off; the consent ask still works */ }

  // The four rarity metals, duplicated from site/portrait-dither.js METALS
  // keys on purpose: this Function cannot import a site/ asset without
  // leaning on bundler behavior nothing else relies on.
  const METAL_NAMES = ["foil", "sapphire", "copper", "pewter"];
  const canUpload = uploadsOn && METAL_NAMES.includes(ask.metal);
```

  3. The picker label handles `self` (replace the label expression inside the existing `variants.map`): `v === "self" ? "Your photo" : \`Crop ${v.toUpperCase()}\``. The `variants.length < 2` guard stays exactly as it is: a lone staged crop shows no picker until `self` arrives, at which point length is 2 and the picker appears on its own.
  4. The card-shot figure gains the panel display rule (spec s4): compute `const isPanel = selected === "self";`, render `class="card-shot${isPanel ? " card-shot--panel" : ""}"` on the figure, and add after the `<img>`:

```html
<figcaption id="panel-note" class="fine"${isPanel ? "" : " hidden"}>Your art panel; the printed card carries it in the art slot.</figcaption>
```

  5. Page-scoped CSS additions inside the existing `<style>`: `.card-shot--panel img { width: 100%; border-radius: 8px; }`, `.upload-block { margin: 1.5rem 0; text-align: center; }`, `#preview { width: 100%; max-width: 620px; border-radius: 8px; touch-action: none; }`, `.upload-block label { display: block; margin: .5rem 0; }`.
  6. After the fine-print line, when `canUpload`, render the upload block; otherwise render nothing:

```js
  const uploadBlock = !canUpload ? "" : `
  <div class="upload-block">
    <p class="fine">Or use a different photo. It never leaves your device; only the finished dithered panel is sent, and only if you approve it.</p>
    <input type="file" id="photo-in" accept="image/*">
    <div id="composer" hidden>
      <canvas id="preview" width="620" height="236"></canvas>
      <label class="fine">Zoom <input type="range" id="zoom" min="0.05" max="4" step="0.01"></label>
      <p class="fine">Drag the picture to frame it. The face reads best on the left.</p>
      <button type="button" id="use-photo" class="btn-secondary">Use this photo</button>
    </div>
  </div>`;
```

  interpolated into the HTML between the fine-print `<p>` and the `<noscript>` line, plus a second script rendered only when `canUpload` (after the existing `</script>`):

```js
  const uploadScript = !canUpload ? "" : `
<script type="module">
  import { composePanel } from "/portrait-dither.js";
  const metal = ${JSON.stringify(ask.metal)};
  const input = document.getElementById("photo-in");
  const composer = document.getElementById("composer");
  const preview = document.getElementById("preview");
  const zoom = document.getElementById("zoom");
  const ctx = preview.getContext("2d");
  let src = null;
  let view = { scale: 1, ox: 0, oy: 0 };

  function render() {
    if (!src) return;
    const panel = composePanel(src, view, metal);
    ctx.putImageData(new ImageData(panel.data, panel.width, panel.height), 0, 0);
  }

  input.addEventListener("change", async function () {
    const file = input.files && input.files[0];
    if (!file) return;
    // The photo is decoded and processed HERE, in this tab, and nowhere
    // else. imageOrientation un-lies phone EXIF rotation.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const off = document.createElement("canvas");
    off.width = bmp.width; off.height = bmp.height;
    const octx = off.getContext("2d");
    octx.drawImage(bmp, 0, 0);
    src = octx.getImageData(0, 0, bmp.width, bmp.height);
    const fit = Math.max(620 / src.width, 236 / src.height);
    view = { scale: fit, ox: (src.width - 620 / fit) / 2, oy: (src.height - 236 / fit) / 2 };
    zoom.min = String(Math.min(fit, 0.05));
    zoom.value = String(fit);
    composer.hidden = false;
    render();
  });

  zoom.addEventListener("input", function () {
    view.scale = Number(zoom.value);
    render();
  });

  let drag = null;
  preview.addEventListener("pointerdown", function (e) {
    drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener("pointermove", function (e) {
    if (!drag) return;
    const cssScale = preview.getBoundingClientRect().width / 620;
    view.ox = drag.ox - (e.clientX - drag.x) / cssScale / view.scale;
    view.oy = drag.oy - (e.clientY - drag.y) / cssScale / view.scale;
    render();
  });
  preview.addEventListener("pointerup", function () { drag = null; });

  document.getElementById("use-photo").addEventListener("click", function () {
    preview.toBlob(function (blob) {
      fetch("/api/portrait/${token}/upload", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      }).then(function (r) {
        if (r.ok) { location.reload(); return; }
        document.getElementById("state").textContent =
          "That did not go through. Try again, or just tell Mike.";
      }).catch(function () {
        document.getElementById("state").textContent =
          "That did not go through. Try again, or just tell Mike.";
      });
    }, "image/png");
  });
</script>`;
```

  Reload on success is deliberate: the reloaded page shows the server's truth (self selected, approved state), which is simpler and more honest than mirroring state client-side.
  7. Update the file's header comment to mention the upload block and where the pixels are processed (this repo's comments are normative).
- [ ] **Step 4: Run, expect PASS**; `bun test tools`.
- [ ] **Step 5: Commit** (`feat: self-upload block on the consent page`).

---

### Task 6: Metal plumbing and `--pull` in the CLI stack

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tools/lib/portraits.ts`
- Modify: `tools/portrait-asks.ts`
- Test: `tools/portraits.test.ts`
- Test: `tools/portrait-asks.test.ts`

**Interfaces:**
- Consumes: existing exports of both files as merged in PR #19 (`CandidateSet`, `validateCandidates`, `askUpsertSql`, `statusSql`, `PortraitDeps`, `stage`, the wrangler-backed `realDeps`).
- Produces: `CandidateSet.players[]` entries gain `metal: string`; `validateCandidates` requires `metal` in each manifest player entry, value in `foil|sapphire|copper|pewter`, halting otherwise (added to the same one-throw problems list); `askUpsertSql` takes and writes `metal` (INSERT column list + `metal = excluded.metal` in the upsert); `PortraitDeps` gains `r2get(key: string, outPath: string): void | Promise<void>`; new exported `pull(handle: string, set: string, out: string | undefined, deps: PortraitDeps): Promise<void>`; CLI verb `bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM [--out <path>] [--local]` (KNOWN_FLAGS gains `--pull` and `--out`; usage text updated).

**Parallelization rationale:** every semantic change to the staging/validation stack lives in this one task so no wave is ever internally inconsistent (last run's statusSql lesson: when a rule changes, every implementation of it changes in the same diff). It owns all four files alone; no other task touches them.

- [ ] **Step 1: Write failing tests.** In `tools/portraits.test.ts`: add `metal: "copper"` (and a second player `metal: "pewter"`) to the existing MANIFEST/DATA-derived fixtures so current happy-path tests keep passing under the new contract; new cases: player entry without `metal` halts with a message containing `metal`; `metal: "chrome"` halts; `validateCandidates` returns players carrying their metal; `askUpsertSql({...with metal: "copper"})` output contains `metal` in the column list, `'copper'`, and `metal = excluded.metal`. In `tools/portrait-asks.test.ts`: add `metal` to the manifest fixtures (stage tests must keep passing); new `pull` tests with injected deps: no ask for handle/set halts naming both; latest answer `declined` halts saying so; latest answer `approved` with variant `b` halts naming `b`; latest `approved`/`self` calls `deps.r2get("asks/2026-08/genet/self.png", "genet-self.png")` (default out) or the `--out` path when given, and prints one confirmation line. `pull` resolves the latest answer through the same `statusSql` d1 query `status` uses; assert the SQL passed to the fake d1 contains `ORDER BY w2.rowid DESC` (the append-order rule; never re-implement resolution).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `portraits.ts`: `METAL_RE = /^(foil|sapphire|copper|pewter)$/` beside the other REs; validate inside the existing per-player loop (push to `problems`, `continue` on failure, same style); thread `metal` through `CandidateSet`, the `players.push`, `AskUpsert`, and `askUpsertSql`. `portrait-asks.ts`: `stage` passes `set.players[i].metal` into the upsert; `PortraitDeps.r2get`; `realDeps` implements it as `npx wrangler r2 object get poker-portraits/<key> --file <out> (--local|--remote)`; `pull` per the tests; `main` wires `--pull`/`--out` with the existing usage/exit(1) posture. Header comments updated (the runbook is Task 7's file; this task's comments still name the new verb).
- [ ] **Step 4: Run, expect PASS**; `bun test tools`.
- [ ] **Step 5: Commit** (`feat: metal plumbing and --pull for the print seam`).

---

### Task 7: Runbook

**Type:** implementation
**Depends-on:** 2, 4, 5, 6

**Files:**
- Modify: `docs/publishing.md`

**Interfaces:**
- Consumes: the CLI verbs exactly as Task 6 produces them; the flag exactly as Task 2 names it.

Edit the existing "## Portrait consent (per set, Tier 2b)" section:

1. In the one-time setup subsection, add the second migration line: `npx wrangler d1 execute poker-rsvp-db --remote --command "ALTER TABLE portrait_asks ADD COLUMN metal TEXT"` (plus the `--local` twin), with one sentence: run once per database, errors harmlessly with "duplicate column name" if repeated, and must run before deploying any version that reads `metal`.
2. In the every-set flow: note the manifest now requires `metal` per player (staging halts without it), and that while `portraitUploads` is on in `site/data/games.json`, players can also upload their own photo, which the page dithers on their device; only the finished panel is stored, and uploading counts as approving.
3. New numbered step in the print flow: for any player whose status reads `approved (self)`, run `bun tools/portrait-asks.ts --pull <handle> --set YYYY-MM` to fetch their panel for the card render; staged crops need no pull.
4. New short paragraph "Turning uploads off": Mike signals; flip `"portraitUploads"` to `false` in `site/data/games.json` in a one-line PR and merge. Existing self approvals keep serving and printing (consent given does not evaporate); only new uploads stop.
5. No em dashes, "experiment" never.

- [ ] **Step: run `bun test tools`, commit** (`docs: runbook covers metal, self-upload, --pull, and the flag flip`).

---

### Task 8: Suite and drift gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7

**Files:**
- Test: `tools/`

1. `bun test tools` green, no skips.
2. `bun tools/render.ts && git diff --exit-code site/standings/index.html site/games/index.html`.
3. games.json canonical and minimal: `git diff main -- site/data/games.json` shows exactly the one added `portraitUploads` line, and `bun -e "const t = await Bun.file('site/data/games.json').text(); const d = JSON.parse(t); if (t.trim() !== JSON.stringify(d, null, 2).trim()) throw new Error('not canonical')"` passes.

---

### Task 9: Migration + live rehearsal

**Type:** manual
**Depends-on:** 8

**Files:**
- Test: (none; operator actions)

Run by Nova after the merge gate, before the PR is handed to Mike.

1. One-time migration, both databases: `npx wrangler d1 execute poker-rsvp-db --local --command "ALTER TABLE portrait_asks ADD COLUMN metal TEXT"` and the `--remote` twin ("duplicate column name" on a rerun is fine).
2. Re-stage Mike's ask WITH metal from the munger candidates dir once its manifest carries `"metal": "copper"` for kmikeym (coordinate: Nova may add the field to the local manifest copy for the rehearsal; Charlie's `stage-candidates.sh` owns it going forward and gets a BBS note). Re-staging rotates the token and orphans his `approved (a)` row, per spec s6; his fresh link goes to him in chat only, never a committed file.
3. Local rehearsal: schema + stage `--local`, `npx wrangler pages dev site`, then Playwright: open the local link, verify the upload block renders, feed the file input a GENERATED test image (a gradient PNG made in the test run, never a person's photo), drag + zoom, verify the live dithered preview updates, Use this photo, verify reload shows "Your photo" selected and the approved state, `--status --local` shows `approved (self)`, `--pull --local` fetches the panel and the bytes equal what the browser sent. Curl the guards: oversize body 400, non-PNG 400, wrong-dims PNG 400, flag flipped off locally then upload 404s and the block disappears.
4. Remote staging: run the real stage for Mike's ask (metal included). Do NOT upload any panel remotely on his behalf; his real click-through happens on the deployed site after merge.
5. Screenshot of the composer with the dithered preview to Mike.

---

### Task 10: PR and the held sends

**Type:** release
**Depends-on:** 9

**Files:**
- Test: (none)

1. Push the integration branch as `nova/portrait-self-upload`; PR to `main`. Body: what shipped, the raw-photo-never-leaves-the-browser rule, the accepted forwarded-link risk restated with its spec reference, the migration note (already applied to both databases), the teardown flip being Mike's signal, and Charlie's items (manifest `metal` field in `stage-candidates.sh`, copy pass on the new block's strings). Never push `main`.
2. BBS note to Charlie: manifest contract change (`metal` required), `--pull` in his print flow, runbook updated.
3. Merge on Mike's go. After merge, verify Mike's fresh link live, hand it to him in chat, and remind: sends to other players stay held (his reveal call, unchanged); teardown on his signal.

---

## Operator smoke

- do: Open your fresh `/portrait/<token>` link on your phone, tap "Or use a different photo", and pick any photo from your camera roll.
  see: The photo appears already dithered in copper, updating live as you drag and zoom. Nothing uploads yet; airplane-mode the phone after the page loads if you want proof.
- do: Frame yourself badly on purpose (face far right), then well (face left), watching the feathered right edge.
  see: The face melts into the dark field on the right side either way; the club pip stays put.
- do: Tap "Use this photo", let the page reload.
  see: "Your photo" is selected in the picker, the panel shows with its caption line, and the state line says you approved.
- do: Run `bun tools/portrait-asks.ts --status --set 2026-08`.
  see: `kmikeym ... approved (self)` with a fresh timestamp.
- do: Say the word to turn uploads off, then reload your link after the flip deploys.
  see: The upload block is gone; your approved photo still shows and still counts.
