# Brightfield Studio

A custom Shopify theme for Brightfield Studio — a generative art store selling wearable real-time shader designs.

## Overview

Brightfield Studio sells GLSL shader T-shirts that customers can customize in-browser using live WebGL rendering. The key differentiator is real-time shader customization (color, intensity, and other per-product params) with a Printful mockup preview before ordering.

## Tech Stack

- **Shopify Liquid** — custom theme, no base theme
- **Vanilla JS + WebGL2** — GLSL fragment shaders (`#version 300 es`) rendered client-side
- **Cloudflare Workers + R2** — design image hosting, product creation, Printful order fulfillment, community gallery, reviews, and shader state sharing
- **Printful API** — print-on-demand fulfillment

## Architecture

The project has two parts:

- **Theme** (`sections/`, `assets/`, `layout/`) — Shopify theme files served by Shopify CDN
- **Worker** (`worker/`) — Cloudflare Worker handling: design image hosting in R2, custom product creation, Printful order fulfillment (orders/paid webhook), community design gallery (submit / approve / like), product reviews, shader state sharing (save/restore share links), and storage GC

Key files:

| File | Purpose |
|------|---------|
| `assets/rise-shirt.js` | Product page dot-halftone shader |
| `assets/hero-shader.js` | Homepage neon plasma shader |
| `sections/main-product.liquid` | Product page with Customize tab + shader GUI |
| `sections/homepage-shader-demo.liquid` | Homepage shader demo with controls and Copy Link sharing |
| `sections/hero.liquid` | Homepage hero with plasma canvas |
| `assets/theme.css` | All styles |
| `worker/src/index.js` | Cloudflare Worker: image hosting, product creation, order fulfillment, community gallery, reviews, shader state sharing |

## Shader System

- Products opt into the shader UI via a tag: `shader-[filename]` (e.g. `shader-rise-shirt`)
- Each product page loads its own shader script — shaders are **not** loaded globally
- GUI params are shared via `window._shaderState.values`: written by the inline GUI script, read by the deferred shader script

## Share Links

The Copy Link button on both the product page and homepage demo saves the current shader state to R2 via the Worker and copies a short URL (`#share=<id>`) to the clipboard. When a `#share=` URL is loaded:

1. The page fetches the state from `GET /get-shader-state/<id>` on the Worker
2. Controls are restored to the saved values
3. The hash is replaced with `#shader` (product) or `#shader-demo` (homepage)
4. On the homepage demo, the auto-cycling loop is suppressed

Worker endpoints:
- `POST /save-shader-state` — accepts `{ state: {...} }`, stores in R2, returns `{ id }` (UUID)
- `GET /get-shader-state/:id` — returns the stored state JSON

## How to Create a New Shirt

1. Create a product in the Printful app within the Shopify Admin. Upload a PNG export from your shader to create the initial product.
2. After creating the product in Printful, the product should sync to Shopify
3. Edit the product in Shopify and add the tag `shader-[shader-file-name]` so it will load your shader defined in `assets/[shader-file-name].js`
4. Deploy your latest shader by deploying this theme using the below deployment command

## Getting Started

```bash
# 1. Install git hooks
scripts/install-hooks.sh

# 2. Run theme dev server
shopify theme dev --store brightfield-2.myshopify.com
# Local preview: http://127.0.0.1:9292

# 3. Run Worker locally (if editing mockup pipeline)
cd worker && npm run dev
# Local Worker: http://127.0.0.1:8787
```

## Development Workflow

- Branch from `main`: `git checkout -b feat/...` or `fix/...`
- Never push directly to `main` (enforced by `.githooks/pre-push`)
- Open PR with `gh pr create`
- Test locally before pushing

## Deployment

Merging to `main` deploys automatically via GitHub Actions (`.github/workflows/test.yml`): after tests pass, the theme is pushed to Shopify and the Worker is deployed with Wrangler. Verify locally (`npm run dev`) before merging.

```bash
# Manual pushes, if ever needed:
npm run push                 # theme
cd worker && npm run deploy  # worker
```
