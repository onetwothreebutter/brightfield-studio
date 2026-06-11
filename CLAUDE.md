# Brightfield Studio — Claude Instructions

## Workflow
- Always branch from `main` before starting new work: `git checkout -b feat/...` or `fix/...`
- Never push directly to `main`
- Merge via PR: `gh pr create` after pushing the branch
- Never run `shopify theme push` automatically — wait for the user to verify locally first, then ask

## Dev commands
- Dev preview: `npm run dev` → `shopify theme dev --store brightfield-2.myshopify.com`
- Manual push: `npm run push` → `shopify theme push --store brightfield-2.myshopify.com`

## Architecture
- Shopify theme (custom, no base theme)
- Products opt into shader UI via tag `shader-[filename]` (e.g. `shader-rise-shirt`)
- Shader GUI params shared via `window._shaderState.values` (written by the GUI builder in `assets/product-page.js`, read by deferred shader JS)
- Each page section loads its own shader script — not globally

## Shader system

### Key files
- `assets/shader-base.js` — shared WebGL 1.0 boilerplate
- `assets/[name].js` — shader-specific GLSL + uniform wiring; calls `window.ShaderBase.create(...)`
- `snippets/shader-controls-[name].liquid` — defines `var controls = [...]` and optionally `var customAfterBuild = function() {...}`
- `snippets/shader-controls-base.liquid` — shared JS globals rendered before every shader snippet
- `sections/main-product.liquid` — renders base snippet then the correct shader snippet via `{% case shader_file %}`, exposing them as `window._shaderControls`; sets `window._productPageConfig` (shaderFile, productHandle, submissionId, holdReveal)
- `assets/product-page.js` — all product-page JS (tabs, GUI builder, Preview on Shirt, community submit); deferred, must load before `shader-base.js`

### Shared globals (from `shader-controls-base.liquid`)
Never redefine these locally in a shader snippet — they are already in scope:
- `SHADER_FONTS` — canonical 22-font array
- `COSINE_PRESETS` — 5 cosine palette presets (Rainbow, Cool Blue, Neon Heat, Cyberpunk, Golden)
- `FOUR_STOP_PRESETS` — 5 four-stop presets (Neon, Retro, Sunset, Aurora, Dusk)
- `toHex(v)` — float[3] → hex string
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
```glsl
vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));
gl_FragColor  = vec4(encoded, alpha);
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
