# Brightfield Studio — Project Memory

## User Preferences
- **File editing**: User allows edits without confirmation — proceed directly when making code changes.

## Workflow
- **Always branch from main** before starting new work: `git checkout -b feat/...` or `fix/...`
- **Never push directly to main** — branch protection is not enforced (free private repo), so this is a convention-only rule
- Merge via PR: `gh pr create` after pushing the branch
- Main branch: `main`
- Remote: `https://github.com/onetwothreebutter/brightfield-studio.git`
- Store: `brightfield-2.myshopify.com`
- Dev preview: `npm run dev` → `shopify theme dev --store brightfield-2.myshopify.com`
- Manual push: `npm run push` → `shopify theme push --store brightfield-2.myshopify.com`
- **Never run `shopify theme push` automatically** — always wait for the user to verify changes locally first, then ask before pushing
- Shopify CLI token: prefix is `shpass_...` (newer format); pass via `SHOPIFY_CLI_THEME_TOKEN` env var, NOT `--password` flag

## CI/CD
- GitHub Actions: `.github/workflows/test.yml`
- Test job runs on every push/PR; deploy job runs on merge to `main` only (after tests pass)
- Deploy uses `SHOPIFY_CLI_THEME_TOKEN` env var + `--theme $SHOPIFY_THEME_ID` (no `--password` flag — deprecated)
- Secrets needed in GitHub repo settings: `SHOPIFY_CLI_THEME_TOKEN`, `SHOPIFY_THEME_ID` (= `143500345459`)
- Theme ID also in `shopify.theme.toml` under `[environments.production]`

## Architecture
- Shopify theme (custom, no base theme)
- Each page section loads its own shader script — **not globally**
  - Homepage hero → `assets/hero-shader.js` → targets `#hero-shader-canvas`
  - Product page → `assets/rise-shirt.js` → targets `#shader-canvas`
- Products opt into shader UI via tag `shader-[filename]` (e.g. `shader-rise-shirt`); GLSL lives in the named asset file
- Shader GUI params shared via `window._shaderState.values` (written by inline GUI script, read by deferred shader JS)
- Product shader canvas: `aspect-ratio: 3 / 4` (portrait) — shaders must account for this

## Shader System
- `assets/shader-base.js` — shared WebGL 1.0 boilerplate (compile, quad, resize, text texture, export)
- Each shader calls `window.ShaderBase.create({ fragSrc, setup, render, drawText, textKey })`
- GUI controls defined in `snippets/shader-controls-[name].liquid` (rendered as inline JS)
- `controls` array supports types: `range`, `toggle`, `color`, `text`, `select`, `header`
- `paletteDependent: true` — row hidden when `u_color_mode` toggle is ON
- `stopDependent: true` — row hidden when `u_color_mode` toggle is OFF (added for three-square)
- `customAfterBuild()` — optional function defined in snippet, called after controls DOM is built
- **Shared globals** (`SHADER_FONTS`, `COSINE_PRESETS`, `FOUR_STOP_PRESETS`, `toHex`, `applyColors`, font preload) live in `snippets/shader-controls-base.liquid` — rendered before every shader snippet; never redefine locally
- Read `memory/shader-controls-standard.md` before creating a new shader control snippet or JS file

## Key Files
- `assets/rise-shirt.js` — product page dot halftone shader + uniform reader
- `assets/line-circle.js` — line-circle shader
- `assets/three-square.js` — three-square columns shader (ported from ThreeSquare.tsx)
- `assets/hero-shader.js` — homepage neon plasma shader
- `sections/main-product.liquid` — product page with Photo/Shader tab switcher + Customize GUI
- `sections/hero.liquid` — homepage hero with plasma shader canvas
- `assets/theme.css` — all styles (IBM Plex Mono, Space Grotesk, cyan/magenta palette)
- `layout/theme.liquid` — global layout (shader scripts NOT included here)

## Shader Porting Notes (TSL → GLSL)
- Source shaders: `/Users/ericjohnson/src/ericdjohnson-portfolio/next-frontend/src/components/shaders/`
- TSL uniforms become GLSL uniforms + JS `gl.uniform*` calls in `render()`
- `cosinePalette(t, a, b, c, d)` = `a + b * cos(6.28318 * (c * t + d))`
- `sdBox2d(p, s)` = `max(abs(p.x), abs(p.y)) - s`
- For portrait canvas (3:4), squareSize constraint must use `0.5 * min(1, aspect)` not just `0.5`
- 4 letter textures in three-square managed manually (not via ShaderBase's single-texture system)

## Shader Reference
- RiseShirt source: `.../shaders/RiseShirt.tsx` — dot halftone grid, radius gradient by Y, optional text overlay
- ThreeSquare source: `.../shaders/ThreeSquare.tsx` — diagonal squares, vertical columns, per-square letter mask, cosine/4-stop palette
