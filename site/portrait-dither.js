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
