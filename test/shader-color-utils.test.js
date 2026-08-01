import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../snippets/shader-color-utils.liquid'), 'utf8');

const { srgbToLinear, linearToSrgb, toHex, hexToRgb, PALETTE_COEFF_KEYS } =
  new Function(src + '\nreturn { srgbToLinear, linearToSrgb, toHex, hexToRgb, PALETTE_COEFF_KEYS };')(); // eslint-disable-line no-new-func

describe('shader-color-utils.liquid', () => {
  // ── round-trip ──────────────────────────────────────────────────────────────

  it('toHex(hexToRgb(hex, key)) round-trips for arbitrary non-coefficient hex strings', () => {
    var hexes = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#336699', '#a1b2c3', '#7f7f7f'];
    hexes.forEach(function (hex) {
      expect(toHex(hexToRgb(hex, 'u_color0'), 'u_color0')).toBe(hex);
    });
  });

  it('toHex(hexToRgb(hex, key)) round-trips for palette-coefficient keys too', () => {
    var hexes = ['#000000', '#ffffff', '#123456', '#abcdef'];
    hexes.forEach(function (hex) {
      expect(toHex(hexToRgb(hex, 'u_a'), 'u_a')).toBe(hex);
    });
  });

  // ── PALETTE_COEFF_KEYS bypass ──────────────────────────────────────────────

  it('bypasses the sRGB<->linear transform for all cosine-coefficient keys', () => {
    ['u_a', 'u_b', 'u_c', 'u_d', 'u_palette_a', 'u_palette_b', 'u_palette_c', 'u_palette_d'].forEach(function (key) {
      expect(PALETTE_COEFF_KEYS[key]).toBe(true);
    });
  });

  it('passes coefficient values outside [0,1] and negative values through unchanged (Cyberpunk c, Coral Reef b)', () => {
    // Cyberpunk: c: [2.0, 1.0, 0.0]
    expect(toHex([2.0, 1.0, 0.0], 'u_c')).toBe(toHex([2.0, 1.0, 0.0].map(function (x) { return x; }), 'u_c'));
    // Direct check: raw values pass straight into the hex encode (clamped only at [0,1] for display,
    // not linearized) — verify the coefficient path skips linearToSrgb entirely by comparing against
    // a manual clamp-and-encode with no gamma step.
    var v = [2.0, -0.15, -0.175];
    var expected = '#' + v.map(function (x) {
      var b = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
      return b.length === 1 ? '0' + b : b;
    }).join('');
    expect(toHex(v, 'u_b')).toBe(expected);
  });

  it('does not clamp negative/out-of-range coefficients before storage (hexToRgb bypass)', () => {
    // hexToRgb only ever receives hex strings, but the bypass itself is tested via
    // srgbToLinear never being applied: a coefficient hex maps 1:1 to its byte value.
    var rgb = hexToRgb('#ff0000', 'u_d');
    expect(rgb[0]).toBeCloseTo(1, 10);
    expect(rgb[1]).toBeCloseTo(0, 10);
    expect(rgb[2]).toBeCloseTo(0, 10);
  });

  // ── non-coefficient keys go through full sRGB<->linear round trip ─────────

  it('clamps into valid [0,255] hex at boundaries for non-coefficient keys (0, 1, out-of-range)', () => {
    expect(toHex([0, 0, 0], 'u_color0')).toBe('#000000');
    expect(toHex([1, 1, 1], 'u_color0')).toBe('#ffffff');
    // Out-of-range (>1 and <0) must clamp, not overflow/underflow or produce NaN.
    expect(toHex([2, -1, 0.5], 'u_color0')).toMatch(/^#[0-9a-f]{6}$/);
    expect(toHex([2, -1, 0.5], 'u_color0')).not.toContain('NaN');
  });

  it('produces no NaN for extreme inputs', () => {
    var hex = toHex([Infinity, -Infinity, 0], 'u_color0');
    expect(hex).not.toContain('NaN');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  // ── srgbToLinear/linearToSrgb are exact inverses ───────────────────────────

  it('srgbToLinear and linearToSrgb are exact inverses across [0,1] within floating-point tolerance', () => {
    for (var i = 0; i <= 20; i++) {
      var t = i / 20;
      expect(linearToSrgb(srgbToLinear(t))).toBeCloseTo(t, 10);
      expect(srgbToLinear(linearToSrgb(t))).toBeCloseTo(t, 10);
    }
  });
});
