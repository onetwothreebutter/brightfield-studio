# Brightfield Studio

A custom Shopify theme for Brightfield Studio — a generative art store selling wearable real-time shader designs.

## Overview

Brightfield Studio sells GLSL shader T-shirts that customers can customize in-browser using live WebGL rendering. The key differentiator is real-time shader customization (color, intensity, and other per-product params) with a Printful mockup preview before ordering.

## Tech Stack

- **Shopify Liquid** — custom theme, no base theme
- **Vanilla JS + WebGL 1.0** — GLSL fragment shaders rendered client-side
- **Cloudflare Workers + R2** — mockup generation pipeline
- **Printful API** — print-on-demand fulfillment

## Architecture

The project has two parts:

- **Theme** (`sections/`, `assets/`, `layout/`) — Shopify theme files served by Shopify CDN
- **Worker** (`worker/`) — Cloudflare Worker that composites a rendered shader canvas PNG into a Printful product mockup

Key files:

| File | Purpose |
|------|---------|
| `assets/rise-shirt.js` | Product page dot-halftone shader |
| `assets/hero-shader.js` | Homepage neon plasma shader |
| `sections/main-product.liquid` | Product page with Customize tab + shader GUI |
| `sections/hero.liquid` | Homepage hero with plasma canvas |
| `assets/theme.css` | All styles |
| `worker/src/index.js` | Cloudflare Worker: canvas PNG → Printful mockup |

## Shader System

- Products opt into the shader UI via a tag: `shader-[filename]` (e.g. `shader-rise-shirt`)
- Each product page loads its own shader script — shaders are **not** loaded globally
- GUI params are shared via `window._shaderState.values`: written by the inline GUI script, read by the deferred shader script

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
