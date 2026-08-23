# Brightfield Studio — Claude Instructions

## Workflow
- Always branch from `main` before starting new work: `git checkout -b feat/...` or `fix/...`
- Never push directly to `main`
- Merge via PR: `gh pr create` after pushing the branch
- Never run `shopify theme push` automatically — wait for the user to verify locally first, then ask

### PR descriptions
Follow `docs/pr-descriptions.md`. Sections, in order, dropping any that don't apply:
**Problem** (or Context) → **Change** → **Notes** → **Not done here** → **Testing**.

Non-negotiable:
- Explain why the *obvious* fix doesn't work whenever one exists — that paragraph is the point of the description.
- For shader/visual changes, state explicitly whether existing designs render identically at default values.
- **Not done here** is required if anything is deferred (manual admin steps, secrets, follow-ups).
- Testing shows the real command and counts (`npm test` — 569 passed, 19 files). If local visual verification hasn't happened, say so — never imply it did.
- Don't restate the diff file by file.

## Dev commands
- Dev preview: `npm run dev` → `shopify theme dev --store brightfield-2.myshopify.com`
- Manual push: `npm run push` → `shopify theme push --store brightfield-2.myshopify.com`
- Palette lab: `npm run palette-lab` → probabilistic palette editor + sample grid at `palette-lab.html`

## Architecture
- Shopify theme (custom, no base theme)
- Products opt into shader UI via tag `shader-[filename]` (e.g. `shader-rise-shirt`)
- Shader GUI params shared via `window._shaderState.values` (written by inline GUI script, read by deferred shader JS)
- Each page section loads its own shader script — not globally

## Shader system

### Key files
- `assets/shader-base.js` — shared WebGL2 boilerplate (`#version 300 es` GLSL: `in`/`out` varyings, `out vec4 fragColor` instead of `gl_FragColor`, `texture()` instead of `texture2D()`)
- `assets/[name].js` — shader-specific GLSL + uniform wiring; calls `window.ShaderBase.create(...)`
- `snippets/shader-controls-[name].liquid` — defines `var controls = [...]` and optionally `var customAfterBuild = function() {...}`
- `snippets/shader-controls-base.liquid` — shared JS globals rendered before every shader snippet
- `sections/main-product.liquid` — renders base snippet then the correct shader snippet via `{% case shader_file %}`
- `assets/shader-defs.js` — **generated**, do not edit. `npm run build:shader-defs` concatenates `snippets/shader-controls-*.liquid` into a plain script (`window.ShaderDefs`) for the dev pages, which can't render Liquid. Every control array and `customAfterBuild` is the snippet's own source, so nothing is retyped and nothing can drift; `test/shader-defs.test.js` fails if the committed file and the snippets disagree. **Edit the snippet, then regenerate.**
- `scripts/build-shader-defs.mjs` — that generator.
- `assets/shader-gui.js` — the control panel those defs render into (`ShaderGUI.build(el, def, opts)`), including the dependency show/hide rules. Injects its own stylesheet.

### `ShaderGUI.build(container, def, opts)`
```javascript
window.ShaderGUI.build(document.getElementById('shader-gui-body'), shaderDef, {
  values,               // object written to; defaults to _shaderState.values
  onChange,             // fn(key, ctrl) after every write
  hiddenKeys,           // rendered but never shown — state still drives dependencies
  randomize: false,     // drop the Randomize button (it uses Math.random)
  customAfterBuild: false  // skip the shader's preset wiring (it writes colors)
});
```
Controls initialise from `opts.values`, not from the control defaults, so a host that has already decided something (the lab forces `u_color_mode`) gets a panel that agrees with the screen. `hiddenKeys` rows are built and kept in sync — the dependency passes read their state — but stay hidden via `.shader-control--owned`, and a section header whose rows are all hidden hides itself.

### Rendering a shader offline (`window.ShaderBase.manual`)
Set `window.ShaderBase.manual = true` **before** loading `assets/[name].js`. `ShaderBase.create` then skips its rAF loop, idle timer, IntersectionObserver and first frame, and returns a handle (also parked on `ShaderBase.last`, since shader scripts drop the return value):

```javascript
window.ShaderBase.manual = true;              // once, before any shader script
// …load assets/echo-text.js…
var handle = window.ShaderBase.last;          // null if create() bailed out
window._shaderState.values = values;
handle.renderFrame(12.0);                     // one frame at a fixed t, values snapped
```
`renderFrame` rebinds its own program and quad first, so many shaders can share one WebGL context — which is the only way to render 50 thumbnails without Chrome dropping contexts. Same `t` + same values ⇒ same pixels.

### Shared globals (from `shader-controls-base.liquid`)
Never redefine these locally in a shader snippet — they are already in scope:
- `SHADER_FONTS` — canonical 22-font array
- `COSINE_PRESETS` — 21 cosine palette presets (Rainbow, Cool Blue, Neon Heat, Cyberpunk, Golden, and others)
- `FOUR_STOP_PRESETS` — 14 four-stop presets (Neon, Retro, Sunset, Aurora, Dusk, and others)
- `toHex(v)` — float[3] → hex string
- `vividHex(hue)` — hue (0–1) → vivid hex string at fixed high saturation/value; used by the global Randomize button for every `type: 'color'` control, and by any shader's own custom randomize button (e.g. Chladni's two-hue pattern randomizer)
- `applyColors(keyValPairs)` — writes to `_shaderState.values` + updates color pickers + dispatches input event
- Font preload `forEach` — preloads all `SHADER_FONTS` at 700 weight

### Naming conventions
- Cosine palette uniforms: `u_a`, `u_b`, `u_c`, `u_d` (vec3)
- Color mode: `u_color_mode` — 0 = cosine palette, 1 = 4-stop
- `paletteDependent: true` — row visible when `u_color_mode` = 0
- `stopDependent: true` — row visible when `u_color_mode` = 1
- Outline: `outlineEnabled` (toggle), `outlineWidth` (range), `u_outline_color` (color)

### Font select control
```javascript
{ key: 'textFont', label: 'Font', type: 'select', value: 'Montserrat', textDirty: true,
  options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; }) }
```

### Cosine preset wiring (in `customAfterBuild`)
```javascript
var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];
function applyCosinePreset(p) {
  applyColors(cosineKeys.map(function (k, i) { return [k, [p.a, p.b, p.c, p.d][i]]; }));
}
applyCosinePreset(COSINE_PRESETS['Rainbow']); // sync pickers on load
var presetSel = document.querySelector('[data-param-key="YOUR_PRESET_KEY"]');
if (presetSel) presetSel.addEventListener('change', function () {
  var p = COSINE_PRESETS[this.value]; if (p) applyCosinePreset(p);
});
```

### 4-stop preset wiring
```javascript
function apply4ColorPreset(p) {
  applyColors([['u_color0',p.c0],['u_color1',p.c1],['u_color2',p.c2],['u_color3',p.c3]]);
}
var fSel = document.querySelector('[data-param-key="YOUR_PRESET_KEY"]');
if (fSel) fSel.addEventListener('change', function () {
  var p = FOUR_STOP_PRESETS[this.value]; if (p) apply4ColorPreset(p);
});
```

### Finish section — standard controls (every shader must include these)
The Finish section is always the last section in the controls array and contains these controls in order:
1. `u_opacity` — range 0–1, default 1.0, `noRandomize: true`
2. `u_grain_mode` — select (Organic/Blue Noise/Scratches/Crosshatch), default '0', `noRandomize: true`
3. `u_distress` — range 0–0.85, default 0.0, `noRandomize: true`
4. `u_distress_scale` — range 10–600, label 'Grain Size', default 80, `noRandomize: true`
5. `u_distress_falloff` — range 0–1, step 0.05, default 0.0, `noRandomize: true`
6. `u_vignette_top` — range 0–20, step 0.05, default 0, `noRandomize: true`
7. `u_vignette_bottom` — range 0–20, step 0.05, default 0, `noRandomize: true`
8. `u_vignette_left` — range 0–20, step 0.05, default 0, `noRandomize: true`
9. `u_vignette_right` — range 0–20, step 0.05, default 0, `noRandomize: true`
10. `u_pos_x` — range -0.5–0.5, default 0.0, `noRandomize: true`
11. `u_pos_y` — range -0.5–0.5, default 0.0, `noRandomize: true`
12. `u_scale` — range 0.2–3.0, step 0.05, default 1.0, `noRandomize: true`

Shader-specific extras (beyond vignette) go between `u_distress_falloff` and `u_vignette_top`.

**GLSL uniforms to declare in every shader:**
```glsl
uniform float u_opacity;
uniform float u_grain_mode;
uniform float u_distress;
uniform float u_distress_scale;
uniform float u_distress_falloff;
uniform float u_vignette_top;
uniform float u_vignette_bottom;
uniform float u_vignette_left;
uniform float u_vignette_right;
uniform float u_pos_x;
uniform float u_pos_y;
uniform float u_scale;
```

**UV position/scale transform — apply at the very top of `main()`, right after computing `uv`:**
```glsl
vec2 uv = gl_FragCoord.xy / u_resolution;
uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);
```
This shifts and zooms the entire design. All subsequent coordinate work derives from `uv`, so everything (pattern, palette, text overlay) moves together. Use a separate `dUV = gl_FragCoord.xy / u_resolution` (raw, untransformed) for distress/vignette edge calculations so those remain anchored to the actual screen.

**Shaders with a non-standard coordinate system** (e.g. Chladni uses a centered `p` space): compute `uv` first, apply the transform, then derive `p` from the transformed `uv`:
```glsl
vec2 uv = gl_FragCoord.xy / u_resolution;
uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);
vec2 p = vec2((uv.x * 2.0 - 1.0) * u_aspect, uv.y * 2.0 - 1.0);
```

**`setup()` additions:**
```js
posX:  gl.getUniformLocation(program, 'u_pos_x'),
posY:  gl.getUniformLocation(program, 'u_pos_y'),
scale: gl.getUniformLocation(program, 'u_scale'),
```

**`render()` additions:**
```js
gl.uniform1f(u.posX,  v.u_pos_x != null ? v.u_pos_x : 0.0);
gl.uniform1f(u.posY,  v.u_pos_y != null ? v.u_pos_y : 0.0);
gl.uniform1f(u.scale, v.u_scale  != null ? v.u_scale  : 1.0);
```

### Gamma encoding (always include in GLSL)
Output is premultiplied alpha (the canvas is created with `premultipliedAlpha: true`):
```glsl
vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));
fragColor = vec4(encoded * alpha, alpha);
```

### ctx.font weight
Always use bold: `ctx.font = 'bold ' + fontSize + 'px ' + fontFamily`

### Adding a new shader
1. Create `snippets/shader-controls-[name].liquid` — define `controls` array and optional `customAfterBuild`; use globals from base snippet
2. Create `assets/[name].js` — call `window.ShaderBase.create({ fragSrc, setup, render, textKey })`
3. Add `{% when '[name]' %} {% render 'shader-controls-[name]' %}` to the case block in `sections/main-product.liquid`
4. Tag the product `shader-[name]` in Shopify
5. `npm run build:shader-defs`, then add the shader to the `#shader-picker` list in `test-shaders.html` — the palette lab picks it up from `shader-defs.js` automatically. Run this after **any** snippet control change, not just a new shader; `npm test` fails if you forget.

**Checklist before submitting:** confirm `u_vignette_top`, `u_vignette_bottom`, `u_vignette_left`, `u_vignette_right`, `u_pos_x`, `u_pos_y`, `u_scale` are in the Finish section controls AND declared as GLSL uniforms + `setup()` locations + `render()` calls. See "Finish section — standard controls" above.

## Probabilistic color palettes

A palette is a *color system*, not a list to pick from uniformly: a vocabulary
(which colors), a hierarchy (how likely each one is), a geography (how those
odds shift across the canvas and with shape size), and controlled seed-driven
variation. Separate from the shader system — these run on the CPU and can drive
any generative algorithm.

### Key files
- `assets/probabilistic-palette.js` — engine (`window.ProbabilisticPalette`). DOM-free and renderer-free.
- `assets/probabilistic-palette-ui.js` — mountable editor (`ProbabilisticPaletteUI.mount(el, { palette, onChange })`); injects its own styles.
- `assets/probabilistic-palette-shader.js` — adapter that colors a real product shader from a palette (`ProbabilisticPaletteShader.mapPalette`). DOM-free and WebGL-free; depends on `window.ShaderDefs`.
- `assets/probabilistic-palette-demo.js` — two reference generators (subdivision, scatter) that consume the engine. Also the lab's **Shapes** sources, which is where per-shape rules (size groups, size curves, inheritance) have shapes to bite on.
- `palette-lab.html` — editor + preview + 25–50 thumbnail sample grid (`npm run palette-lab`). The Source picker offers both families: **Shapes** (the CPU generators) and **Shaders** (all 13 products). Size rules are live in shape mode and badged engine-only in shader mode, so the editor is remounted when the family changes.
- `test/probabilistic-palette.test.js` — determinism, distribution, spatial, geometry, spark and preset coverage.
- `test/probabilistic-palette-shader.test.js` — slot mapping, mode selection, print density, spark rarity across 50 seeds, and full coverage of the 13-shader registry.

### Rules
- **Never `Math.random()`** — every probabilistic decision goes through `makeRng(seed)` / `deriveSeed(seed, ...tags)`. Same seed + geometry + palette + settings ⇒ identical output. A test asserts no call sites exist.
- **Weights auto-normalize** — `39/25/17` and `0.39/0.25/0.17` are the same palette. Never require them to sum to 1.
- **Never ink black to make black areas.** Unprinted shapes return `{ printed: false, color: null }` and are simply not drawn, so the shirt shows through. Print density is its own control, not a palette color.
- **Interpolate probabilities, not RGB.** Spatial weights are per-color `spatial: [wStart, wEnd]` pairs interpolated across the field; every shape keeps a discrete palette color.

### Size groups
The third kind of structure, next to geography (where a shape is) and inheritance (what it is next to): shapes of the same **scale** take one color, wherever they sit.

```javascript
palette.sizeGroups = { enabled: true, mode: 'clusters', minGap: 0.02, maxGroups: 5, minShare: 0.06 };
palette.sizeGroups = { enabled: true, mode: 'bands', maxGroups: 4 };   // guaranteed count
// grouping needs the whole composition up front — a cohort can't be found one shape at a time
var assigner = PP.createAssigner(palette, { seed: seed, totalShapes: shapes.length, shapes: shapes });
assigner.groups();   // → { bounds: [...], colors: [{ color, colorIndex }, …] } or null
```

Two modes, and the choice is a real trade-off. `sizeGroupBounds(sizes, opts)` is pure either way — no RNG at all.

- **`clusters`** (default) — boundaries are *found, not imposed*: sort the composition's own sizes and split at the widest gaps. A design with three real scales gets three groups; a smooth one gets one, which is the honest answer. Tiers always correspond to something in the geometry, but the count is not guaranteed.
  - **`minGap: 0.02` is the measured default.** Generative size distributions are usually smooth; much coarser and most compositions collapse to a single group. Both reference generators produce 4–5 well-populated groups at this setting.
  - **The floor is 0.001**, low enough to go under the spacing of a densely sampled field and prise splits out of a distribution that has no real gaps. Know what that buys: when every candidate gap is the same width the widest-first sort is a tie, so the cuts land wherever `minShare` first allows them — **bunched, not spread**. On the shaders' 64-sample field (spacing 0.0159) every value below that produces the identical result: 5 cohorts at `[0.516, 0.579, 0.643, 0.706]`, one holding half the range and three of them slivers. `bands` imposes tiers too, but evenly and legibly. On the shape sources it changes nothing at all — 0.001, 0.005 and 0.02 all give the same 5 groups, because real generative distributions have their widest gaps well above 0.02.
  - **`minShare` rejects singleton tiers.** A lone outlier is the widest gap in almost every composition, so a split is only kept when both sides hold at least that share of the shapes. Without it, grouping degenerates into "everything, plus three singletons".
- **`bands`** — the size range is cut into `maxGroups` equal slices, so you always get that many tiers. `minGap` and `minShare` do not apply; the count is the point. The cost is splitting where the geometry has nothing, and on a skewed distribution (a power-law scatter) most shapes can land in one band. The lab's swatch tooltips show per-band counts, which is where you see that happening.
- **Sparks are excluded from the group draw but stay reachable per shape.** A spark that wins a whole cohort stops being a find and becomes a tier; its weight and conditions still decide where it lands on individual shapes.
- **Grouping re-colours; it does not delete.** `printDensity` is a separate decision from "which cohort is this", and running both at once means switching grouping on silently removes elements the design had a moment earlier — which reads as grouping being broken rather than as density doing its job. So under grouping the print/skip roll cannot drop anything unless the palette opts in with `sizeGroups.dropElements: true` (**Print density may drop elements** in the editor). On a shader that is expressed as `u_group_density = 1`, so the GLSL keeps one code path and every element's roll simply passes.
  - **The roll is still drawn either way**, so every stream downstream of it is identical. Flipping the setting re-colours the composition rather than reshuffling it, and the elements that survive at `dropElements: true` are coloured exactly as they are when nothing is dropped. A test pins that.
  - Ungrouped behaviour is untouched: density still decides shapes in the shape path and still blacks out gradient slots in the shader path.
- **Grouping skips inheritance** — a group is already the grouping — and is inert unless the caller passes `shapes`.

### Driving an algorithm
```javascript
var assigner = ProbabilisticPalette.createAssigner(palette, {
  seed: seed, totalShapes: shapes.length, shapes: shapes   // `shapes` enables size groups
});
shapes.forEach(function (s, i) {
  var a = assigner.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex });
  if (!a.printed) return;          // leave transparent — shirt shows through
  ctx.fillStyle = a.color;
});
```
`x`, `y` and `size` are normalized 0–1. **`size` is the shape's extent rescaled
against the smallest and largest in its own composition — not its rank.** A rank
would be uniform by construction and so has no gaps for `clusters` to split on:
measured, it takes scatter from 5 cohorts to 1. The trade is that a skewed
distribution stays skewed, which is why `bands` can put most of a power-law
scatter in band 0. `parentIndex` is what makes inheritance read as regions rather
than noise — pass it whenever the algorithm has a real parent/neighbor.

### Driving a product shader
A fragment shader has no shapes — it has a handful of color uniforms. The adapter
treats each live one as a "shape" and runs the ordinary assigner over them:

```javascript
var m = ProbabilisticPaletteShader.mapPalette(ShaderDefs.SHADERS['echo-text'], {
  palette: palette, seed: seed,
  values: settings,    // the control panel's state; defaults to the shader's own
  variation: 0         // 0 = those settings, untouched
});
window._shaderState.values = m.values;           // complete, ready to render
handle.renderFrame(ProbabilisticPaletteShader.FIXED_TIME);
```

- **Four-stop wins wherever it's offered.** The mode is picked by matching the
  option *label* (`4-Stop`), not by assuming a value — the shaders disagree about
  numbering (echo-text is Flat/4-Stop/Cosine, four-circles is
  Cosine/4-Stop/Per-Quadrant, rise-shirt is Cosine/4-Stop/OKLCH). Cosine and
  OKLCH mode take curve coefficients rather than colors, so they are never
  assigned. chladni has no mode control and always paints with its two colors.
- **A shader that colors something itself keeps doing so.** stacked-gradient
  draws its word in the complement of the gradient unless *Custom Text Color* is
  on; the lab leaves `u_text_color` alone until that toggle flips, then takes it
  over as a fifth slot. Off-palette color in a preview is usually this, not a bug.
- **Repeats are the point.** Draws are with replacement and inheritance still
  applies, so a dominant color winning two neighbouring stops paints a flat band.
  Without-replacement would give every design one of each color — a rainbow, and
  the exact flat hierarchy the system exists to avoid.
- **An unprinted slot is `#000000`.** Black is the shirt, never an ink — same rule
  as the shape path, expressed the only way a shader can express it.
- **Slots hidden by the chosen mode are skipped** (four-circles' per-quadrant
  colors in four-stop mode) so they don't eat a draw or a spark's `maxShare`.
- **Size rules are engine-only here** — `sizeCurve`, `geometryEnabled` and
  `conditions.minSize`/`maxSize` are dropped for the slot draw, because a gradient
  stop has no area of its own. Left in, the stock spark's `maxSize: 0.35` would
  lock it out of every design. The lab mounts the editor with
  `inertGeometry: true` so those controls are visibly badged **engine-only**
  rather than quietly doing nothing.
- **Size groups reach the shaders that expose an element size.** A fragment shader has no shape list, but it already computed how big the element under each fragment is, and it can name which element that is. So the CPU sends only what it alone can decide — the cohort boundaries, the color each one drew, the print odds and the seed — and the GLSL does the lookup and the roll. No readback, no ID buffer, no second pass. A shader opts in with one line:
  ```glsl
  // size: 0 = smallest element, 1 = largest.  id: this element's own index.
  col = applyPaletteGroups(col, size, id);
  ```
  `shader-base.js` declares `u_group_mode/_count/_bounds[7]/_colors[8]/_seed/_density`, looks them up itself and uploads them each frame, so there is no per-shader JS wiring. **Support is detected, not listed**: a shader that never calls `paletteGroupColor` has the uniforms optimized out, so `handle.supportsGroups` (a null uniform location) can't drift from the GLSL. The lab badges the size rules inert on exactly the shaders that report false.

  Wired so far, with the size expression and the element id each uses: **rise-shirt** (`1.0 - t` since dot radius is `mix(effectiveMax, u_min_radius, t)`; id = halftone cell `floor(gridUv.y) * u_cols + floor(gridUv.x)`), **circle-on-line** / **line-circle** (line thickness within `u_width_top`→`u_width_bot`; id = `floor(warped * u_line_count)`, the line index `phase` is the fract of), **three-square** (`fillSample`, the normalized column width — a binary signal, so only two cohorts are ever reached; id = `layer * 1024.0 + floor(scaledX)`, offset by layer so the same column of two squares is two elements).

  **Print density rolls per element, in the GLSL.** `paletteRoll32` is a transcription of `makeRng`/`elementRoll`, not a second generator: mulberry32 is pure uint32 arithmetic and WebGL2 uint math wraps mod 2^32 exactly as `Math.imul` and `>>>` do, so the shader reaches the same decision the CPU would — on every GPU, without a readback. A float hash would drift between drivers and break same-seed-same-pixels.
  - **`highp` is load-bearing, not decoration.** A GLSL ES 3.00 fragment shader defaults `int`/`uint` to **mediump** (16 bits guaranteed) and these shaders declare only `precision mediump float`. Left implicit, the arithmetic is exact on desktop and wrong on a phone. Every uint in the roll, `u_group_seed`, `u_group_density` and each shader's `…Id` local is explicitly `highp` — the id matters too, since past 2048 a mediump float stops counting in ones and adjacent elements start sharing a roll.
  - **The roll is quantized to 24 bits both sides.** A fragment float carries a 24-bit mantissa at best, so `elementRoll` drops the same low 8 bits the GPU cannot hold. That is what makes the two the same decision rather than one 8 bits apart.
  - Measured over 12 seeds at density 0.5: rise-shirt inks 0.496 of its full-density area (±0.02 — thousands of dots). The line shaders swing 0.11–0.94 around a mean near 0.6, because they have ~20 elements of very unequal area; **density is coarse wherever the element count is small**, and that is the geometry, not the hash.
  - **A flat roll is unbiased, not lumpy-free — do not confuse the two.** With every element rolling at `density`, the expected inked *area* is exactly `density`, measured: 0.3 → 0.300, 0.5 → 0.500, 0.68 → 0.680. What goes wrong on circle-on-line is variance, not bias: `u_power` spaces the lines evenly in `warped` rather than in `t`, so **line 0 alone carries 28.6% of the ink** (it is the dome, not a stripe) and one coin flip decides it. At density 0.68, 12 of 36 grid seeds lost the whole dome.
  - **`applyPaletteGroups(col, size, id, weight)` weights the roll by ink carried.** `weight` is the element's extent relative to an average one, and the chance becomes `density^(1/weight)` — see `elementPrintChance`. The exponent form is what makes it affordable in a fragment shader: it needs only this element's weight, no total and no second pass, and `pow` fixes both endpoints so density 0 still prints nothing and 1 still prints everything. Weight 1 is exactly `density`, so the three-argument form is unchanged.
    - **Wired on circle-on-line and line-circle**, which share the geometry and so shared the defect. The weight is the cell's extent in `t` — `((g+1)/N)^(1/power) - (g/N)^(1/power)`, times `N` — read off the same geometry the stripes are drawn from, so it cannot drift from what is on screen. Validated against measured per-line areas: line 0 weighs 6.03 against a true 5.7× the average share. Measured on line-circle at density 0.5 with `dropElements` on, the largest element survives **37 of 40 seeds** against the 20 a flat roll would give.
    - **`highp` has to be on the operands, not just the result.** GLSL evaluates an expression at the precision of its *operands*, so `highp float dotId = <mediump maths>` converts a value that has already lost precision — it looks correct and does nothing. Every input to an element id is declared `highp` individually. It matters past 2048, where a mediump float stops counting in ones: rise-shirt's `row * u_cols + col` reaches rows×cols and three-square's layer offset reaches 3072, so adjacent elements would start sharing a print roll on exactly the mobile hardware the qualifier exists for.
  - **Group, then post-process, then mask — in that order.** `applyPaletteGroups` returns `vec3(0)` for an unprinted element, which is only "shirt" if nothing touches it afterwards. rise-shirt inverts its dots, and inverting a masked colour turns *no ink* into **pure white ink** — measured at 10,247 white pixels with Invert Colour on. A shader that post-processes the ink colour uses `paletteGroupedColor` (colour only) and applies `paletteElementPrinted` last.
  - **Evaluate `size` once per element, not per fragment.** A stripe has exactly one thickness, so deriving `lineSize` from the fragment's own `t` let a cohort boundary fall *inside* a line and paint its top half one colour and its bottom half another. It is sampled at the stripe's midpoint instead — `pow((lineId + 0.5) / u_line_count, 1/power)` — while `lineWidth` stays per-fragment, because that is the geometry and it is what keeps the stripe edges smooth. Measured with the bounds bunched (clusters at minGap 0.001, which is where it bites): **24 split stripes across 16 of 20 seeds before, 0 after** on circle-on-line, and **21 across 17 of 20, also to 0** on line-circle. It barely shows at `bands` with well-separated bounds, which is what makes it easy to miss — and easy to misread as the palette rather than as a bug. Any shader wiring size groups should ask what its element is and sample there. All four wired shaders now do: circle-on-line and line-circle at the stripe midpoint, rise-shirt at the halftone cell centre, three-square at the column centre.
    - **`size` is not a proxy for area here.** The dome sits at `lineSize ≈ 0.05` — the *thinnest* lines — yet carries the most ink, because its area comes from the power warp and not from stripe thickness. Weighting by `size` would have made it worse.
    - **The trade is honest and worth stating: this buys stability with bias.** Dome retention at density 0.68 goes from 68% to ~94% (1 of 36 grid seeds now loses it), but expected inked area rises to 0.753 — about 7pp over nominal. Subdividing a large element into several ids instead would cut the same variance with *no* bias, at the cost of changing what counts as an element.

  One honest limit remains: a shader's size field is *continuous*, so natural clustering finds no gaps and returns one group — **fixed bands is the mode that does something here**.

  **Cohort labels are a diagnostic for exactly that.** With grouping on, the lab's **Cohort labels** checkbox numbers each size band on the artwork, so the tiering is read off the design instead of inferred from its colors — which is the hard case precisely when two cohorts draw the same color, or when clusters has collapsed to one and every explanation looks the same. In clusters mode on circle-on-line you get a single `1`, which is the collapse made visible.
  - **Wired on circle-on-line only**, on purpose — it is a tuning aid, not an overlay to carry everywhere. `shader-base.js` owns the generic parts: `u_group_debug`, a 3×5 bitmap font for 1–8 (`paletteDigitBits`/`paletteDigitMask` — cheaper and sharper than a text texture, and no JS wiring), and `paletteGroupLabelMask(uv, x, y0, y1, h, pxAspect)`, which places one label per cohort at its band's midpoint along whatever axis the shader maps size to. The shader supplies only the mapping: circle-on-line's size *is* `t`, so `y0`/`y1` are the circle's top and bottom, swapped when `u_width_bot < u_width_top`.
  - **It cannot reach a product render.** `u_group_debug` is not a control, so it is absent from `defaultValues`, and `mapPalette` never emits it — the lab sets it on the mapped values itself. A test asserts the adapter never mentions it.
  - **Support is detected, same as grouping**: `handle.supportsGroupLabels` is a null uniform location, so the lab offers the toggle on exactly the shaders whose GLSL answers to it rather than keeping a list of names that drifts. The row also stays hidden until grouping is on, since there are no cohorts to number otherwise.
  - Drawn after gamma and after the grain, so the glyphs stay crisp white and a heavy distress setting cannot eat them. Labels ride the `u_pos_*`/`u_scale` transform with the design, and appear on the thumbnail grid too while the toggle is on.
  - **Crowded cohorts step sideways** rather than stacking into an unreadable pile — which matters because bunched cuts (a too-small `minGap`) are exactly when the count is worth reading. The staircase still shows the crowding.
- **`paletteOwnedKeys(def)` is what a control panel must hide** — the color mode
  and every literal ink uniform, mode-independent on purpose so a panel never
  reshuffles itself mid-edit. Coefficients and outline colors stay editable. The
  lab passes it to `ShaderGUI.build` as `hiddenKeys`.
- **`variation` defaults to 0, and the lab leaves it there.** A sample grid is a
  controlled comparison: one design, one set of shader settings, many seeds, so
  the only thing changing cell to cell is what the palette decided. Turned up, it
  drifts non-color params off the shader's defaults — never colors, never text,
  honoring `noRandomize` and every `textDirty` control, through
  `PP.makeRng`/`PP.deriveSeed` — but then the grid is showing two variables.

### Thumbnail drift and text
`variation` must never re-typeset a text overlay — a sample grid is for judging
colour, and re-flowing the words in every cell is noise (and forces a letter-atlas
rebuild per cell: 4 canvases in three-square, 11 in scaling-letters). `isVariable`
excludes anything `textDirty` or keyed `text*`, so **a control that changes the
rendered text must carry `textDirty: true`** — including ones not named `text`.
`u_font_family` on three-square and scaling-letters is the case that got missed.

### Editor + lab gotchas
- **`markInert` says "engine-only", and that is accurate** — the engine honours
  size rules and size groups on the shape sources; only the shader in front of
  you cannot. The reason string is in the row's `title`. It reads as broken
  mainly because the explanation is easy to miss, not because the tag is wrong.
- **The drop indicator has to name the side the row will land on.** Reorder is
  `splice(from,1)` then `splice(to,0)`, which lands the row at index `to` in
  both directions — relative to the row under the cursor that is *above* when
  dragging up and *below* when dragging down. `dataTransfer` is unreadable
  during `dragover` by spec, so the source index is tracked in a mount-scoped
  `dragFrom` instead.
- **`ShaderGUI.build` shares one tooltip element and one document listener**
  (`sharedTip()`), because the lab rebuilds the panel on every Source change and
  on Reset. Per-build listeners would accumulate for the life of the page and
  keep detached rows alive.
- **A shader script that 404s fires `onerror`, not `onload`.** `withShader` has
  to drain `pending[name]` there too, or every later preview and grid cell
  queues a callback nothing will resolve while the canvas keeps showing the
  previous shader.
- **`GROUP_MAX` (8) is a hard GLSL array size.** The adapter asks the engine for
  at most that many cohorts rather than truncating a larger split, since the
  first 7 boundaries of a 12-band solution are not an 8-band one. The editor
  slider caps at 8; stored or pasted palette JSON need not.

### Spatial weights are authored in the same unit as `weight`
A `spatial: [wStart, wEnd]` pair replaces the flat weight across the field, and
both are on the same scale — the editor seeds those two inputs from `weight`.
So in `effectiveWeights`, a color *without* a pair must contribute its authored
`weight`, not its normalized share. Mixing the two units in one vector made
every color lacking a pair roughly two orders of magnitude rarer than the panel
reported: a 60/30/10 palette with a pair on the dominant color alone rendered as
**99.4 / 0.6 / 0.07**. The shipped presets happen to give every color a pair, so
this only ever showed up on hand-edited palettes — which is most of them, since
the editor writes `spatial` only when those inputs are touched.

### `wordDependent` keys off `u_text_enabled`
Not `wordEnabled`, which no snippet defines. Keyed off the wrong name, four
-circles' entire Word Overlay section stayed hidden in both dev pages and its
`u_text_color` was excluded from the palette draw while still being hidden from
the panel — an off-palette color with no control anywhere.

### Editor readouts must ask what is actually happening
Two settings only mean what they say under conditions the panel has to check:
- **Print density exposes no shirt while grouping is on** unless
  `sizeGroups.dropElements` is set, so a readout derived from `printDensity`
  alone reported exposed garment while the engine printed every shape.
- **Randomize weights honours `spark: true` and `variationScale: 0`** — the
  lock its own Lock weight checkbox sets, three hundred lines away.
- **Anything that writes a field another control renders from needs
  `rebuild()`, not `changed()`.** Ticking Spark sets `variationScale = 0`, which
  is exactly what Lock weight displays; `changed()` only re-runs the readouts,
  so the box kept showing its build-time state.

### `generativeWeights` defaults to on
`createAssigner` skips variation only when the flag is exactly `false`.
`describe()` — which the tier badges and preview strip read — must use the same
test, or an unset flag makes the reported hierarchy differ from the rendered one.

### Adding a preset
Data only, no engine change:
```javascript
ProbabilisticPalette.registerPreset(ProbabilisticPalette.createPalette({
  id: 'brightfield-black-04', name: 'Brightfield / Black 04',
  printDensity: 0.68, inheritance: 0.65, weightVariation: 0.10, generativeWeights: true,
  colors: [
    { id: 'bone', name: 'Bone', color: '#EFE6D2', weight: 40, spatial: [55, 20],
      sizeCurve: ProbabilisticPalette.SIZE_CURVE_PRESETS.large },
    { id: 'spark', name: 'Spark', color: '#69CDB5', weight: 2, spark: true, variationScale: 0,
      conditions: { maxSize: 0.35, maxShare: 0.05 } }
  ]
}));
```
Sparks should set `variationScale: 0` (locks the share so the seed can't inflate
it) plus at least one condition — `maxSize`, `minSize`, `region`, `afterColor`,
or `maxShare` — so they read as a find rather than a texture.

### Importing a palette
Hex lists only — no image extraction, no network fetch. In the palette lab hit
**Import**, paste, and check the swatch readout before committing:

- Any separator works (comma, newline, space, hyphen), so a Coolors URL pastes
  as-is: `https://coolors.co/palette/606c38-283618-fefae0-dda15e-bc6c25`.
- Bare `606c38` parses; `#abc` shorthand expands, but bare `abc` is rejected on
  purpose so words in pasted prose don't become colors.
- **Replace palette** rebuilds from the paste; **Add to palette** appends the
  new hexes below the current hierarchy at low weight, skipping duplicates.

Headless equivalent:
```javascript
var hexes = ProbabilisticPalette.parseHexList(pasted);          // → ['#606C38', …]
var palette = ProbabilisticPalette.paletteFromHexList(hexes, { name: 'Olive 01' });
```
`paletteFromHexList` assigns weights by a geometric ramp in **paste order** (each
color ~⅔ of the one before), so order the paste dominant → rarest. With 4+
colors the last entry becomes the spark at a fixed 3%. Both functions are pure
and deterministic — same input, same palette.

### Promoting an import to a committed preset
1. Import, then tune in the lab against the sample grid.
2. **Copy JSON** in the editor.
3. Paste it as a `registerPreset(createPalette({ ... }))` block in
   `assets/probabilistic-palette.js`, after the existing presets and before the
   export map.
4. Replace the generated `id` with a stable kebab one (`brightfield-black-04`)
   and use a `Brightfield / …` name — `PRESETS` is keyed by **name**, and
   `registerPreset` silently overwrites a duplicate.
5. Add a `description`.
6. `npm test` — the preset loop in `test/probabilistic-palette.test.js` validates
   any newly registered preset automatically.
