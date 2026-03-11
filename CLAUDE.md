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
- Shader GUI params shared via `window._shaderState.values` (written by inline GUI script, read by deferred shader JS)
- Each page section loads its own shader script — not globally

## Shader system

### Key files
- `assets/shader-base.js` — shared WebGL 1.0 boilerplate
- `assets/[name].js` — shader-specific GLSL + uniform wiring; calls `window.ShaderBase.create(...)`
- `snippets/shader-controls-[name].liquid` — defines `var controls = [...]` and optionally `var customAfterBuild = function() {...}`
- `snippets/shader-controls-base.liquid` — shared JS globals rendered before every shader snippet
- `sections/main-product.liquid` — renders base snippet then the correct shader snippet via `{% case shader_file %}`

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
