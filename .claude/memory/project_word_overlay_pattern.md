---
name: word overlay pattern (ShaderBase drawText)
description: How to add a single-word text overlay to a shader using ShaderBase's built-in text system, referencing line-circle.js as the canonical example
type: project
---

## Reference implementation
`assets/line-circle.js` is the canonical example of a shader with a word overlay.

## How it works
ShaderBase creates a 1024×1024 canvas when `drawText` is provided. It redraws when `textKey` changes or `_shaderState.textDirty` is set. The texture is passed as the 7th argument to `render(gl, u, v, w, h, t, textTex)`.

## GLSL
- Declare `uniform sampler2D u_word_texture;` (assign to TEXTURE4 if slots 0–3 are taken)
- Aspect-correct the UV lookup so text isn't stretched:
```glsl
vec2 wordAnchor = vec2(u_word_x, u_word_y);
vec2 wordUV = vec2((uv.x - wordAnchor.x) * u_aspect, uv.y - wordAnchor.y) + wordAnchor;
vec4 wordSample = texture(u_word_texture, wordUV);
float wordFill   = smoothstep(0.05, 0.6, wordSample.r);  // R = fill
float wordStroke = smoothstep(0.05, 0.6, wordSample.g);  // G = outline
```

## Canvas drawing (drawText)
- R channel = letter fill: `ctx.fillStyle = 'rgb(255,0,0)'`
- G channel = outline stroke: `ctx.strokeStyle = 'rgb(0,255,0)'`
- Position: `cx = textX * size`, `cy = (1 - textY) * size` (UNPACK_FLIP_Y maps canvas top → UV top)
- Always use `ctx.font = 'bold ...'`

## textKey
Include every JS value that affects the canvas output so ShaderBase redraws on change:
```javascript
textKey: function(v) {
  return JSON.stringify([v.wordEnabled, v.text, v.textX, v.textY,
                         v.textFontSize, v.textFont,
                         v.wordOutline, v.wordOutlineWidth, v.u_word_outline_color]);
}
```

## Alpha blending (word bleeds outside shapes)
```glsl
float wordAlpha = clamp(wordFill + wordStroke, 0.0, 1.0) * step(u_distress, dn) * u_opacity;
float alpha = max(baseAlpha, wordAlpha);
```

## Enabled toggle
Set `drawText` to draw a blank canvas when `wordEnabled` is falsy:
```javascript
var txt = (v.wordEnabled && v.text) ? v.text : '';
```
