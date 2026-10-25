/**
 * Code card — the pure half of code-card.html.
 *
 * A product's fourth gallery image is its shader source, set as type and lit
 * by the design it draws: a character that sits over ink takes that ink's
 * colour, and everything else stays a dim ghost so the whole excerpt reads.
 * The page owns the canvases; this file owns every decision that can be made
 * without one — what a pasted design means, which source lines to offer, how
 * big the type is, and what colour each character cell is.
 *
 * DOM-free and renderer-free, so it runs under jsdom.
 */
(function () {
  'use strict';

  // ── Pasted designs ────────────────────────────────────────────────────────
  // The product page's restore payload is `{ shader, values }`; a share link
  // carries it base64'd in `?bfr=`, and the palette lab's export sidecar wraps
  // it as `design`. All four spellings arrive in the same paste box.

  function decodeBase64Json(s) {
    try { return JSON.parse(atob(s)); } catch (e) { return null; }
  }

  function parseDesign(text) {
    if (typeof text !== 'string') return null;
    var s = text.trim();
    if (!s) return null;
    var raw = null;
    if (s.charAt(0) === '{') {
      try { raw = JSON.parse(s); } catch (e) { return null; }
    } else {
      var m = s.match(/[?&]bfr=([^&#\s]+)/);
      raw = decodeBase64Json(m ? decodeURIComponent(m[1]) : s);
    }
    if (!raw || typeof raw !== 'object') return null;
    var d = raw.design && typeof raw.design === 'object' ? raw.design : raw;
    if (typeof d.shader !== 'string' || !d.shader) return null;
    if (!d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;
    return { shader: d.shader, values: d.values };
  }

  // ── Source listing ────────────────────────────────────────────────────────
  // Every shader splices ShaderBase.commonGLSL (a few hundred lines of grain,
  // vignette and palette-group plumbing) into its own source. It is identical
  // in all of them and never what a buyer wants to read, so the listing folds
  // it to one row. Line numbers stay those of the compiled source.

  function sourceRows(fragSrc, shared) {
    var lines = String(fragSrc).split('\n');
    var skip = shared ? String(shared).split('\n') : null;
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      if (skip && skip.length > 1 && lines[i] === skip[0] && matchesAt(lines, i, skip)) {
        rows.push({ shared: true, count: skip.length });
        i += skip.length - 1;
        continue;
      }
      rows.push({ line: i + 1, text: lines[i] });
    }
    return rows;
  }

  function matchesAt(lines, at, block) {
    if (at + block.length > lines.length) return false;
    for (var j = 0; j < block.length; j++) {
      if (lines[at + j] !== block[j]) return false;
    }
    return true;
  }

  // Lines from..to (1-based, inclusive, either order) of the compiled source,
  // dedented so the excerpt starts at the left margin of the card.
  function excerpt(fragSrc, from, to) {
    var lines = String(fragSrc).split('\n');
    var a = Math.max(1, Math.min(from, to));
    var b = Math.min(lines.length, Math.max(from, to));
    return dedent(lines.slice(a - 1, b).join('\n'));
  }

  // Tabs to two spaces, trailing space trimmed, common indent removed. Blank
  // lines don't count toward the common indent.
  function dedent(text) {
    var lines = String(text).replace(/\t/g, '  ').split('\n').map(function (l) {
      return l.replace(/\s+$/, '');
    });
    var indent = Infinity;
    lines.forEach(function (l) {
      if (!l) return;
      indent = Math.min(indent, l.match(/^ */)[0].length);
    });
    if (!isFinite(indent)) indent = 0;
    return lines.map(function (l) { return l.slice(indent); }).join('\n');
  }

  // The first line of a shader's main(), for a default excerpt that is about
  // the design rather than its uniform declarations. 1 when there is none.
  function mainLine(fragSrc) {
    var lines = String(fragSrc).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*void\s+main\s*\(/.test(lines[i])) return i + 1;
    }
    return 1;
  }

  // ── Settings line ─────────────────────────────────────────────────────────
  // `// count 4 · fill 1 · diagonal offset 0.13 · column density 26` — the
  // shader's own range controls ahead of Finish, so the card names this
  // design rather than the shader in general.

  function decimalsOf(step) {
    var s = String(step);
    var dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }

  function settingsLine(def, values, max) {
    max = max == null ? 4 : max;
    var parts = [];
    var controls = (def && def.controls) || [];
    for (var i = 0; i < controls.length && parts.length < max; i++) {
      var c = controls[i];
      if (c.type === 'header' && c.label === 'Finish') break;
      if (c.type !== 'range' || !c.key || c.key.charAt(0) === '_') continue;
      // A control's own default is in display units; the live value of a
      // toRadians control is in radians, as the shader receives it.
      var live = values && values[c.key] != null;
      var v = Number(live ? values[c.key] : c.value);
      if (!isFinite(v)) continue;
      if (live && c.toRadians) v = v * 180 / Math.PI;
      var shown = String(parseFloat(v.toFixed(decimalsOf(c.step != null ? c.step : 0.01))));
      parts.push(String(c.label).toLowerCase() + ' ' + shown);
    }
    return parts.length ? '// ' + parts.join(' · ') : '';
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  // One monospace grid, sized so the longest line fits the width and every
  // line fits the height — never cropped mid-token — and centred in whatever
  // slack the other axis leaves. `advance` is the font's character width per
  // pixel of font size, which the page measures.

  function fitLayout(o) {
    var cols = Math.max(1, o.cols);
    var rows = Math.max(1, o.rows);
    var pad = Math.round((o.padding || 0) * Math.min(o.width, o.height));
    var availW = Math.max(1, o.width - 2 * pad);
    var availH = Math.max(1, o.height - 2 * pad);
    var fontSize = Math.min(availW / (cols * o.advance), availH / (rows * o.lineHeight));
    var cellW = fontSize * o.advance;
    var cellH = fontSize * o.lineHeight;
    return {
      fontSize: fontSize, cellW: cellW, cellH: cellH,
      x: (o.width - cols * cellW) / 2,
      y: (o.height - rows * cellH) / 2
    };
  }

  // ── Per-glyph ink ─────────────────────────────────────────────────────────
  // Reads the design under one character cell. `data` is RGBA already
  // flattened on black, so brightness is the ink: a pixel brighter than
  // `floor` (0–255) counts as inked, and `coverage` is the inked share.
  //
  // The colour is the ink as printed, not the cell's average. A plain mean
  // comes out muddy, because thin strokes are mostly anti-aliased edge and the
  // gaps between them are black. So the hue is a brightness-weighted mean of
  // the inked pixels, and it is then scaled up to the brightest one, which is
  // where the stroke is solid.

  function sampleCell(data, width, height, cell, floor) {
    var x0 = Math.max(0, Math.floor(cell.x));
    var y0 = Math.max(0, Math.floor(cell.y));
    var x1 = Math.min(width, Math.ceil(cell.x + cell.w));
    var y1 = Math.min(height, Math.ceil(cell.y + cell.h));
    var total = 0, inked = 0, wsum = 0, r = 0, g = 0, b = 0, peak = 0;
    for (var y = y0; y < y1; y++) {
      var i = (y * width + x0) * 4;
      for (var x = x0; x < x1; x++, i += 4) {
        total++;
        var pr = data[i], pg = data[i + 1], pb = data[i + 2];
        var w = Math.max(pr, pg, pb);
        if (w <= floor) continue;
        inked++; wsum += w; r += pr * w; g += pg * w; b += pb * w;
        if (w > peak) peak = w;
      }
    }
    if (!inked) return { coverage: 0, color: null };
    r /= wsum; g /= wsum; b /= wsum;
    var k = peak / Math.max(r, g, b);
    return {
      coverage: inked / total,
      color: [r, g, b].map(function (c) { return Math.min(255, Math.round(c * k)); })
    };
  }

  window.CodeCard = {
    parseDesign: parseDesign,
    sourceRows: sourceRows,
    excerpt: excerpt,
    dedent: dedent,
    mainLine: mainLine,
    settingsLine: settingsLine,
    fitLayout: fitLayout,
    sampleCell: sampleCell
  };
})();
