# Shader Controls — Standard Reference

Read this before creating a new shader control snippet or JS file.

## Shared globals (from `shader-controls-base.liquid`)

`SHADER_FONTS`, `COSINE_PRESETS`, `FOUR_STOP_PRESETS`, `toHex`, `applyColors`, and the font preload
`forEach` are all defined in `snippets/shader-controls-base.liquid`, which is rendered before every
`{% case %}` branch in `sections/main-product.liquid`. Do NOT redefine them locally.

## Naming conventions

- Cosine palette uniforms: `u_a`, `u_b`, `u_c`, `u_d` (vec3)
- Outline: `outlineEnabled` (toggle), `outlineWidth` (range), `u_outline_color` (color)
- Color mode: `u_color_mode` — 0 = cosine palette, 1 = 4-stop (toggle or select)
- `paletteDependent: true` → row visible when `u_color_mode` = 0 (cosine active)
- `stopDependent: true` → row visible when `u_color_mode` = 1 (4-stop active)

## Font select control

```javascript
{ key: 'textFont', label: 'Font', type: 'select', value: 'Montserrat', textDirty: true,
  options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; }) }
```

Use `SHADER_FONTS.map(...)` — never hard-code the options array locally.

## textKey fields (canonical)

```javascript
textKey: function(v) {
  return JSON.stringify([
    v.u_text_enabled, v.text, v.textX, v.textY, v.textFontSize, v.textFont,
    v.u_text_rotation, v.outlineEnabled, v.outlineWidth, v.u_outline_color,
  ]);
}
```

Omit fields the shader doesn't support (e.g. omit `u_text_enabled` if there's no enable toggle).

## ctx.font weight

Always use bold (700): `ctx.font = 'bold ' + fontSize + 'px ' + fontFamily`

## Gamma encoding (GLSL — always include)

```glsl
vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));
gl_FragColor  = vec4(encoded, alpha);
```

## Cosine preset wiring in `customAfterBuild`

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

## 4-stop preset wiring

```javascript
function apply4ColorPreset(p) {
  applyColors([['u_color0',p.c0],['u_color1',p.c1],['u_color2',p.c2],['u_color3',p.c3]]);
}
var fSel = document.querySelector('[data-param-key="YOUR_PRESET_KEY"]');
if (fSel) fSel.addEventListener('change', function () {
  var p = FOUR_STOP_PRESETS[this.value]; if (p) apply4ColorPreset(p);
});
```

## Preset select control options (cosine)

```javascript
{ key: '_XX_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow',
  options: [
    { label: 'Rainbow',   value: 'Rainbow'   },
    { label: 'Cool Blue', value: 'Cool Blue' },
    { label: 'Neon Heat', value: 'Neon Heat' },
    { label: 'Cyberpunk', value: 'Cyberpunk' },
    { label: 'Golden',    value: 'Golden'    },
  ]
}
```

## Preset select control options (4-stop)

```javascript
{ key: '_XX_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon',
  options: [
    { label: 'Neon',   value: 'Neon'   },
    { label: 'Retro',  value: 'Retro'  },
    { label: 'Sunset', value: 'Sunset' },
    { label: 'Aurora', value: 'Aurora' },
    { label: 'Dusk',   value: 'Dusk'   },
  ]
}
```

## Adding a new shader

1. Create `snippets/shader-controls-[name].liquid` — define `var controls = [...]` and optionally
   `var customAfterBuild = function () { ... }`. Use globals from base; do not redefine them.
2. Create `assets/[name].js` — call `window.ShaderBase.create({ fragSrc, setup, render, textKey })`.
3. Add `{% when '[name]' %} {% render 'shader-controls-[name]' %}` to the case block in
   `sections/main-product.liquid`.
4. Tag the product `shader-[name]` in Shopify.
