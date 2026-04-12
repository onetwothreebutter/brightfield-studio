#!/usr/bin/env node
/**
 * Generate a signed distance field (SDF) texture from shirt-template.png.
 *
 * The output is a grayscale PNG where:
 *   0.0  (pixel 0)   = far outside the shirt silhouette
 *   0.5  (pixel 128) = exactly on the shirt boundary
 *   1.0  (pixel 255) = deepest interior point
 *
 * Usage:
 *   node scripts/generate-shirt-sdf.mjs
 *   node scripts/generate-shirt-sdf.mjs --print-area 0.20,0.15,0.60,0.68 --size 512
 *
 * Requires:  npm install --save-dev sharp
 */

import { join, dirname } from 'path';
import { fileURLToPath }  from 'url';

// ── Dependency check ──────────────────────────────────────────────────────────

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Error: sharp is not installed.');
  console.error('Run:  npm install --save-dev sharp');
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
}

const printAreaStr = getArg('--print-area', '0.20,0.15,0.60,0.68');
const [paL, paT, paW, paH] = printAreaStr.split(',').map(Number);
const SDF_SIZE = parseInt(getArg('--size', '512'), 10);
const ALPHA_THRESHOLD = parseInt(getArg('--threshold', '127'), 10);

const ROOT        = join(dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_PATH  = join(ROOT, 'assets', 'shirt-template.png');
const OUTPUT_PATH = join(ROOT, 'assets', 'shirt-sdf.png');

// ── Load, crop, resize ────────────────────────────────────────────────────────

const meta = await sharp(INPUT_PATH).metadata();
const iW = meta.width, iH = meta.height;

const cropLeft   = Math.round(paL * iW);
const cropTop    = Math.round(paT * iH);
const cropWidth  = Math.round(paW * iW);
const cropHeight = Math.round(paH * iH);

console.log(`Input:   ${iW}×${iH}`);
console.log(`Crop:    [${cropLeft},${cropTop}] ${cropWidth}×${cropHeight}  (print-area ${printAreaStr})`);
console.log(`Output:  ${SDF_SIZE}×${SDF_SIZE}  →  ${OUTPUT_PATH}`);

const raw = await sharp(INPUT_PATH)
  .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
  .resize(SDF_SIZE, SDF_SIZE, { kernel: 'lanczos3' })
  .ensureAlpha()
  .raw()
  .toBuffer();

// ── Extract alpha channel ─────────────────────────────────────────────────────

const W = SDF_SIZE, H = SDF_SIZE;
const alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  alpha[i] = raw[i * 4 + 3];
}

const insideCount  = alpha.filter(a => a > ALPHA_THRESHOLD).length;
const outsideCount = W * H - insideCount;
console.log(`Inside pixels:  ${insideCount}  Outside: ${outsideCount}  (threshold ${ALPHA_THRESHOLD})`);

if (insideCount === 0) {
  console.error('Error: no inside pixels found. Check that shirt-template.png has an alpha channel.');
  console.error('If the shirt is on a solid background, consider removing it first.');
  process.exit(1);
}

// ── Jump Flood Algorithm ──────────────────────────────────────────────────────
// Returns Float32Array of Euclidean distances (pixels) to the nearest seed.
// Seeds are pixels where inside[i] === 1.

function computeJFA(insideMask, w, h) {
  const NONE = -32768; // sentinel for Int16 (no valid coord uses this value)

  const seedX = new Int16Array(w * h).fill(NONE);
  const seedY = new Int16Array(w * h).fill(NONE);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (insideMask[i]) { seedX[i] = x; seedY[i] = y; }
    }
  }

  // Find first power-of-2 >= max(w, h), then start passes at half that.
  let k = 1;
  while (k < Math.max(w, h)) k <<= 1;

  const nextX = new Int16Array(w * h);
  const nextY = new Int16Array(w * h);

  // Passes: k = n/2, n/4, ..., 2, 1
  for (k >>= 1; k >= 1; k >>= 1) {
    nextX.set(seedX);
    nextY.set(seedY);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx * k;
            const ny = y + dy * k;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            const ni  = ny * w + nx;
            const nsx = seedX[ni];
            const nsy = seedY[ni];
            if (nsx === NONE) continue;

            const ddx   = x - nsx, ddy = y - nsy;
            const dist2 = ddx * ddx + ddy * ddy;

            const csx = nextX[i], csy = nextY[i];
            if (csx === NONE) {
              nextX[i] = nsx; nextY[i] = nsy;
            } else {
              const cddx = x - csx, cddy = y - csy;
              if (dist2 < cddx * cddx + cddy * cddy) {
                nextX[i] = nsx; nextY[i] = nsy;
              }
            }
          }
        }
      }
    }

    seedX.set(nextX);
    seedY.set(nextY);
  }

  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i  = y * w + x;
      const sx = seedX[i], sy = seedY[i];
      if (sx === NONE) {
        dist[i] = Infinity;
      } else {
        const dx = x - sx, dy = y - sy;
        dist[i] = Math.sqrt(dx * dx + dy * dy);
      }
    }
  }
  return dist;
}

// ── Build signed distance field ───────────────────────────────────────────────

const insideMask  = new Uint8Array(W * H).map((_, i) => alpha[i] > ALPHA_THRESHOLD ? 1 : 0);
const outsideMask = new Uint8Array(W * H).map((_, i) => alpha[i] > ALPHA_THRESHOLD ? 0 : 1);

process.stdout.write('Computing interior JFA… ');
const distToInside  = computeJFA(insideMask,  W, H);
process.stdout.write('done\nComputing exterior JFA… ');
const distToOutside = computeJFA(outsideMask, W, H);
process.stdout.write('done\n');

// Signed distance: positive = inside, negative = outside
const sdf = new Float32Array(W * H);
let maxInner = 0;

for (let i = 0; i < W * H; i++) {
  sdf[i] = insideMask[i] ? distToOutside[i] : -distToInside[i];
  if (sdf[i] > maxInner) maxInner = sdf[i];
}

console.log(`Max interior distance: ${maxInner.toFixed(1)} px  (used as normalization scale)`);

// ── Encode as 8-bit grayscale and write PNG ───────────────────────────────────
// Normalization: sd / maxInner mapped to [-1,1], then * 0.5 + 0.5 → [0,1] → [0,255]
// 128 = exactly on the shirt boundary.

const scale = maxInner > 0 ? maxInner : 1;
const pixels = Buffer.alloc(W * H);

for (let i = 0; i < W * H; i++) {
  const normalized = sdf[i] / scale;                        // roughly [-1, 1]
  const byte = Math.round(Math.max(0, Math.min(1, normalized * 0.5 + 0.5)) * 255);
  pixels[i] = byte;
}

await sharp(pixels, { raw: { width: W, height: H, channels: 1 } })
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT_PATH);

console.log(`\nDone! Wrote ${OUTPUT_PATH}`);
console.log(`SDF scale: ${scale.toFixed(2)} px per unit`);
console.log(`  In the shader: sd = texture(u_sdf_texture, uv).r * 2.0 - 1.0`);
console.log(`    sd = -1.0 → deepest outside`);
console.log(`    sd =  0.0 → shirt boundary`);
console.log(`    sd = +1.0 → deepest inside  (~${scale.toFixed(0)} px from edge)`);
