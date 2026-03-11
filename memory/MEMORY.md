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
