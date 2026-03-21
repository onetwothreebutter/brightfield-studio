---
name: four-circles shader architecture
description: Key facts about the four-circles shader — color modes, texture slots, word overlay, per-quadrant controls
type: project
---

## Files
- `assets/four-circles.js` — GLSL + JS render logic
- `snippets/shader-controls-four-circles.liquid` — controls array + customAfterBuild
- Test entry in `test-shaders.html` under `SHADERS['four-circles']`

## Color modes (`u_color_mode`)
Three-way select (not a toggle):
- `'0'` — Cosine palette (u_a/b/c/d)
- `'1'` — 4-stop gradient (u_color0–3)
- `'2'` — Per-Quadrant solid colors (u_quad0–3)

GLSL uses `step()` to branch: `step(0.5, u_color_mode)` picks cosine vs 4-stop, `step(1.5, u_color_mode)` picks per-quadrant.
`render()` parses colorMode with `parseFloat()` since it arrives as a string from the select.

## Texture slots
- TEXTURE0–3: per-quadrant letter textures (u_tex1–4), managed manually in render()
- TEXTURE4: word overlay texture (u_word_texture), managed by ShaderBase's drawText/textKey system

## Word overlay
- Uses ShaderBase's `drawText` + `textKey` callbacks
- Controlled by `wordEnabled` toggle — `drawText` returns early (blank canvas) when off
- GLSL uniforms: `u_word_texture`, `u_word_x/y`, `u_word_color`, `u_use_word_color`, `u_word_outline_color`
- Word alpha uses `max(baseAlpha, wordAlpha)` so text can bleed outside circle shapes
- Default word text: `'GLOW'`

## Per-quadrant controls
- `u_quad0` = top-left, `u_quad1` = top-right, `u_quad2` = bottom-left, `u_quad3` = bottom-right
- Default picker values match Mondrian palette (red/blue/yellow/white)
- No preset dropdown — user sets colors directly via pickers

## Per-letter controls
- `u_text_enabled` toggle, `u_letter1`–`4` text inputs, `u_font_family`, `u_font_size`
- Letter outline drawn into green channel of texture; GLSL reads it via `activeTex.g`
