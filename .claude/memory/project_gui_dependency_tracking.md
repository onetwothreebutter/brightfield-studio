---
name: GUI dependency tracking pattern
description: How to add show/hide row visibility tied to a toggle or select in the shader controls GUI builder
type: project
---

The shader GUI builder in `sections/main-product.liquid` and `test-shaders.html` share a dependency tracking pattern for showing/hiding control rows based on toggle or select state. Both files must be kept in sync when adding new dependency types.

## Pattern for a new toggle-based dependency (e.g. `wordEnabled`)

**Control definition** — mark dependent controls with a flag:
```javascript
{ key: 'wordEnabled', label: 'Enabled', type: 'toggle', value: 0 }
{ key: 'text', ..., wordDependent: true }
```

**In both GUI builders** (main-product.liquid + test-shaders.html):
1. Declare array + btn variable at top of builder: `var wordDependentRows = []; var wordToggleBtn = null;`
2. In toggle block, capture btn: `if (ctrl.key === 'wordEnabled') wordToggleBtn = btn;`
3. In row loop, register: `if (ctrl.wordDependent) wordDependentRows.push(row);`
4. Add visibility function + call it + wire listener:
```javascript
function applyWordVisibility() {
  var on = wordToggleBtn && wordToggleBtn.dataset.on === '1';
  wordDependentRows.forEach(function(r){ r.style.display = on ? '' : 'none'; });
}
if (wordToggleBtn) wordToggleBtn.addEventListener('click', applyWordVisibility);
applyWordVisibility();
```
5. In test-shaders.html also call `applyWordVisibility()` inside the toggle click handler and in the randomize re-run.

## Existing dependency types
- `paletteDependent` — shown when `u_color_mode === '0'` (cosine)
- `stopDependent` — shown when `u_color_mode === '1'` (4-stop)
- `oklchDependent` / `quadDependent` — shown when `u_color_mode === '2'` (oklch or per-quadrant; different shaders, never on same page)
- `textColorDependent` — shown when `u_use_text_color` toggle is on
- `outlineDependent` — shown when `outlineEnabled` toggle is on
- `wordDependent` — shown when `wordEnabled` toggle is on (four-circles only)

## Select-based color mode
`main-product.liquid` tracks `colorModeSel` (for shaders that use a 3-option select instead of a toggle for `u_color_mode`). `test-shaders.html` also has this. The `applyPaletteVisibility()` function checks `colorModeSel.value` when present, otherwise falls back to `colorModeBtn.dataset.on`.

**Why:** Needed for four-circles which has 3 color modes (Cosine/4-Stop/Per-Quadrant) — a toggle only supports 2 states.
