# Brightfield Studio — Claude Instructions

## Workflow
- Always branch from `main` before starting new work: `git checkout -b feat/...` or `fix/...`
- Never push directly to `main`
- Merge via PR: `gh pr create` after pushing the branch
- Never run `shopify theme push` automatically — wait for the user to verify locally first, then ask

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
5. Add the shader to `test-shaders.html`

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
- `assets/probabilistic-palette-demo.js` — two reference generators (subdivision, scatter) that consume the engine.
- `palette-lab.html` — editor + preview + 25–50 thumbnail sample grid (`npm run palette-lab`).
- `test/probabilistic-palette.test.js` — determinism, distribution, spatial, geometry, spark and preset coverage.

### Rules
- **Never `Math.random()`** — every probabilistic decision goes through `makeRng(seed)` / `deriveSeed(seed, ...tags)`. Same seed + geometry + palette + settings ⇒ identical output. A test asserts no call sites exist.
- **Weights auto-normalize** — `39/25/17` and `0.39/0.25/0.17` are the same palette. Never require them to sum to 1.
- **Never ink black to make black areas.** Unprinted shapes return `{ printed: false, color: null }` and are simply not drawn, so the shirt shows through. Print density is its own control, not a palette color.
- **Interpolate probabilities, not RGB.** Spatial weights are per-color `spatial: [wStart, wEnd]` pairs interpolated across the field; every shape keeps a discrete palette color.

### Driving an algorithm
```javascript
var assigner = ProbabilisticPalette.createAssigner(palette, { seed: seed, totalShapes: shapes.length });
shapes.forEach(function (s, i) {
  var a = assigner.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex });
  if (!a.printed) return;          // leave transparent — shirt shows through
  ctx.fillStyle = a.color;
});
```
`x`, `y` and `size` are normalized 0–1 (`size` is the shape's rank within its own
composition). `parentIndex` is what makes inheritance read as regions rather
than noise — pass it whenever the algorithm has a real parent/neighbor.

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
