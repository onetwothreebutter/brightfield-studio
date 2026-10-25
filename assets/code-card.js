/**
 * Code card — the pure half of code-card.html.
 *
 * A product's fourth gallery image is its shader source, set as type and lit
 * by the design it draws: a character that sits over ink takes that ink's
 * colour, and everything else stays a dim ghost so the whole excerpt reads.
 * The page owns the canvases; this file owns every decision that can be made
 * without one — what a pasted design means, which source lines to offer, how
 * big the type is, what colour each character cell is, and the HTML/CSS card
 * (a highlight reading down the lines on a seamless CSS loop) built from all
 * of that.
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

  // ── Line highlight ────────────────────────────────────────────────────────
  // A band `band` lines tall, with `soft` lines of falloff each side, sweeps
  // down the excerpt once per loop. Every line runs the same keyframes — lit
  // at 0%, fading over the falloff, dark, fading back to lit at 100% — shifted
  // by a negative delay to the moment the band's centre crosses it. The sweep's
  // period is rows + band + both falloffs, so the band clears the last line
  // before it re-enters above the first. 0% and 100% are the same keyframe and
  // every line shares one duration, so the loop has no seam. `soft: 0` with
  // `band: 1` steps line by line.

  function highlightTiming(o) {
    var band = Math.max(0.01, o.band);
    var soft = Math.max(0, o.soft || 0);
    var period = o.rows + band + 2 * soft;
    return {
      // Half-width of the lit plateau and width of each falloff, as fractions
      // of the loop. plateau + fall never exceeds a half, so they can't overlap.
      plateau: band / 2 / period,
      fall: soft / period,
      // When `row` sits at the band's centre, as a fraction of the loop.
      peak: function (row) { return (row + 0.5 + band / 2 + soft) / period; }
    };
  }

  function pct(f) { return +(f * 100).toFixed(4) + '%'; }

  // ease-in-out has smoothstep's flat ends, so a line eases in and out of the
  // band rather than snapping at its edge.
  function highlightKeyframes(name, t) {
    var h = t.plateau, s = t.fall;
    var stops = s > 0
      ? [[0, 1, 'linear'], [h, 1, 'ease-in-out'], [h + s, 0, 'linear'],
         [1 - h - s, 0, 'ease-in-out'], [1 - h, 1, 'linear'], [1, 1]]
      : [[0, 1, 'step-end'], [h, 0, 'step-end'], [1 - h, 1, 'linear'], [1, 1]];
    return '@keyframes ' + name + '{' + stops.map(function (k) {
      return pct(k[0]) + '{opacity:' + k[1] + (k[2] ? ';animation-timing-function:' + k[2] : '') + '}';
    }).join('') + '}';
  }

  // ── HTML ──────────────────────────────────────────────────────────────────
  // The card as real text: a <pre> of rows, each row two stacked layers of
  // the same runs — the resting layer (ink dimmed, bare text a ghost) and the
  // highlighted layer (ink full, bare text bright, a faint line bar) whose
  // opacity is the only thing animated, so the browser can run it on the
  // compositor. Every size is a share of the card's width (cqw and percentage
  // padding), so it is the same card at any width. Colours are per run of
  // identically inked characters, carried as a `--c` triple.

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function runsHtml(text, colors) {
    var out = '';
    for (var i = 0; i < text.length;) {
      var key = colors[i] ? colors[i].join(' ') : '';
      var j = i + 1;
      while (j < text.length && (colors[j] ? colors[j].join(' ') : '') === key) j++;
      var chunk = escapeHtml(text.slice(i, j));
      out += key ? '<i style="--c:' + key + '">' + chunk + '</i>' : chunk;
      i = j;
    }
    // An empty line still needs a line box, or the rows below it move up.
    return out || ' ';
  }

  function num(v, d) { return +v.toFixed(d == null ? 4 : d); }

  // o: { lines: [{ text, colors: [rgb|null per character] }], width, height,
  //      layout (fitLayout's), font, weight, ghost, restInk, hiWhite, lineBar,
  //      background, loop (s), band, soft, title, fontHref }
  function buildHtml(o) {
    var W = o.width, L = o.layout;
    var t = highlightTiming({ rows: o.lines.length, band: o.band, soft: o.soft });
    var css = [
      '.bf-cc{--bf-cc-ghost:' + o.ghost + ';--bf-cc-rest:' + o.restInk + ';--bf-cc-hi:' + o.hiWhite +
        ';--bf-cc-bar:' + o.lineBar + ';position:relative;container-type:inline-size;aspect-ratio:' +
        W + '/' + o.height + ';background:' + o.background + ';overflow:hidden}',
      '.bf-cc__code{margin:0;padding:' + pct(L.y / W) + ' 0 0;font-family:"' + o.font +
        '",ui-monospace,monospace;font-weight:' + o.weight + ';font-size:' + num(L.fontSize / W * 100) +
        'cqw;line-height:' + num(L.cellH / L.fontSize) + ';white-space:pre;font-variant-ligatures:none;' +
        'font-feature-settings:"calt" 0,"liga" 0;color:rgb(255 255 255/var(--bf-cc-ghost))}',
      '.bf-cc__code code{font:inherit}',
      '.bf-cc__row{display:grid}',
      '.bf-cc__row>span{grid-area:1/1;padding-left:' + pct(L.x / W) + '}',
      '.bf-cc i{font-style:normal}',
      '.bf-cc__rest i{color:rgb(var(--c)/var(--bf-cc-rest))}',
      '.bf-cc__hi{color:rgb(255 255 255/var(--bf-cc-hi));background:rgb(255 255 255/var(--bf-cc-bar));' +
        'opacity:0;animation:bf-cc-hl ' + o.loop + 's linear infinite;user-select:none;pointer-events:none}',
      '.bf-cc__hi i{color:rgb(var(--c))}',
      highlightKeyframes('bf-cc-hl', t),
      // Without motion, the still card: ink at full strength, nothing sweeping.
      '@media (prefers-reduced-motion:reduce){.bf-cc{--bf-cc-rest:1}.bf-cc__hi{animation:none}}'
    ].join('\n');
    var rows = o.lines.map(function (line, r) {
      var runs = runsHtml(line.text, line.colors);
      var delay = -(1 - t.peak(r)) * o.loop;
      return '<span class="bf-cc__row"><span class="bf-cc__rest">' + runs + '</span>' +
        '<span class="bf-cc__hi" aria-hidden="true" style="animation-delay:' + num(delay, 3) + 's">' +
        runs + '</span></span>';
    // No separator: inside a <pre>, a newline between rows is a line box of
    // its own, which double-spaces the card and the text it copies as.
    }).join('');
    var markup = '<div class="bf-cc"><pre class="bf-cc__code"><code>' + rows + '</code></pre></div>';
    var snippet = '<style>\n' + css + '\n</style>\n' + markup;
    var page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>' + escapeHtml(o.title || 'Code card') + '</title>\n' +
      (o.fontHref ? '<link rel="stylesheet" href="' + escapeHtml(o.fontHref) + '">\n' : '') +
      '<style>\nhtml,body{margin:0;height:100%;background:' + o.background + '}\n' +
      'body{display:grid;place-items:center}\n' +
      '.bf-cc{width:min(100vw,calc(100vh*' + W + '/' + o.height + '))}\n</style>\n' +
      '</head>\n<body>\n<!-- code card: start -->\n' + snippet + '\n<!-- code card: end -->\n</body>\n</html>\n';
    return { css: css, markup: markup, snippet: snippet, page: page };
  }

  window.CodeCard = {
    highlightTiming: highlightTiming,
    highlightKeyframes: highlightKeyframes,
    buildHtml: buildHtml,
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
