# Brightfield Studio

A custom Shopify theme for Brightfield Studio — a generative art store selling wearable real-time shader designs.

## Overview

Brightfield Studio sells GLSL shader T-shirts that customers can customize in-browser using live WebGL rendering. The key differentiator is real-time shader customization (color, intensity, and other per-product params) with a Printful mockup preview before ordering.

## Tech Stack

- **Shopify Liquid** — custom theme, no base theme
- **Vanilla JS + WebGL 1.0** — GLSL fragment shaders rendered client-side
- **Cloudflare Workers + R2** — mockup generation, community gallery, and shader state sharing
- **Printful API** — print-on-demand fulfillment

## Architecture

The project has two parts:

- **Theme** (`sections/`, `assets/`, `layout/`) — Shopify theme files served by Shopify CDN
- **Worker** (`worker/`) — Cloudflare Worker handling: mockup generation (canvas PNG → Printful), community design gallery (submit / approve / like), and shader state sharing (save/restore short-ID share links)

Key files:

| File | Purpose |
|------|---------|
| `assets/rise-shirt.js` | Product page dot-halftone shader |
| `assets/hero-shader.js` | Homepage neon plasma shader |
| `sections/main-product.liquid` | Product page with Customize tab + shader GUI |
| `sections/homepage-shader-demo.liquid` | Homepage shader demo with controls and Copy Link sharing |
| `sections/hero.liquid` | Homepage hero with plasma canvas |
| `assets/theme.css` | All styles |
| `worker/src/index.js` | Cloudflare Worker: mockup generation, community gallery, shader state sharing |

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
- `POST /save-shader-state` — accepts `{ state: {...} }`, stores in R2, returns `{ id }` (6-char alphanumeric)
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

```bash
# Theme (after PR merge — verify locally first)
shopify theme push --store brightfield-2.myshopify.com

# Worker (if worker/ changed)
cd worker && npm run deploy
```
