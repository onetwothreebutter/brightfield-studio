# Brightfield Studio

A custom Shopify theme for Brightfield Studio — a generative art store selling wearable real-time shader designs.

## Overview

Brightfield Studio sells GLSL shader T-shirts that customers can customize in-browser using live WebGL rendering. The key differentiator is real-time shader customization (color, intensity, and other per-product params) with a live on-shirt mockup preview — composited client-side — before ordering.

## Tech Stack

- **Shopify Liquid** — custom theme, no base theme
- **Vanilla JS + WebGL2** — GLSL fragment shaders (`#version 300 es`) rendered client-side
- **Cloudflare Workers + R2** — design image hosting, product creation, Printful order fulfillment, community gallery, reviews, shader state sharing, and share pages
- **Printful API** — print-on-demand fulfillment

## Architecture

The project has two parts:

- **Theme** (`sections/`, `assets/`, `layout/`) — Shopify theme files served by Shopify CDN
- **Worker** (`worker/`) — Cloudflare Worker handling: design image hosting in R2, custom product creation, Printful order fulfillment (orders/paid webhook), community design gallery (submit / approve / like), product reviews, shader state sharing (save/restore share links), image share pages on `share.brightfield.studio`, a per-device recent-designs gallery, background removal (Cloudflare Images), an admin moderation UI, and storage GC.

Key files:

| File | Purpose |
|------|---------|
| `assets/rise-shirt.js` | Product page dot-halftone shader |
| `assets/hero-shader.js` | Homepage neon plasma shader |
| `sections/main-product.liquid` | Product page with Customize tab + shader GUI |
| `sections/homepage-shader-demo.liquid` | Homepage shader demo with controls and Share-link sharing |
| `sections/hero.liquid` | Homepage hero with plasma canvas |
| `assets/theme.css` | Main stylesheet (a few sections carry their own `{% stylesheet %}` blocks) |
| `worker/src/index.js` | Cloudflare Worker — every endpoint (full feature list under Architecture above) |

## Shader System

- Products opt into the shader UI via a tag: `shader-[filename]` (e.g. `shader-rise-shirt`)
- Each product page loads its own shader script — shaders are **not** loaded globally
- GUI params are shared via `window._shaderState.values`: written by the inline GUI script, read by the deferred shader script

## Share Links

Three share surfaces exist:

- **Homepage demo — Share button**: saves the current shader state to R2 via `POST /save-shader-state` and copies a short URL (`#share=<id>`) to the clipboard.
- **Product page — Share button**: captures the canvas as a JPEG and POSTs it with the shader state to `POST /create-share`; the Worker stores both and returns an absolute share-page URL (`https://share.brightfield.studio/<id>`), which is what gets copied. That page carries the design image in its Open Graph/Twitter meta tags (so link previews show it) and immediately redirects the visitor to the product with a `?bfr=<base64-state>#shader` URL that restores the design.
- **Community gallery cards** copy the same `https://share.brightfield.studio/<id>` URL form for approved submissions. For those ids the share page serves metadata from `community/submissions/` and redirects to the product (or the community page) **without** a `?bfr=` restore payload — the restore link is a direct-share feature.

Both pages still restore `#share=` URLs. When one is loaded:

1. The page fetches the state from `GET /get-shader-state/<id>` on the Worker
2. Controls are restored to the saved values
3. The hash is replaced with `#shader` (product) or `#shader-demo` (homepage)
4. On the homepage demo, the auto-cycling loop is suppressed

(A legacy `#s=<base64>` inline-state format is also still restored on both pages.)

Worker endpoints:
- `POST /save-shader-state` — accepts `{ state: {...} }`, stores in R2, returns `{ id }` (UUID)
- `GET /get-shader-state/:id` — returns the stored state JSON
- `POST /create-share` — accepts `{ image, shader, productHandle, values }`, stores the JPEG + metadata in R2, returns `{ id, url }`
- `GET https://share.brightfield.studio/<id>` — the share page itself (a hostname catch-all: a GET on that host not matching an earlier route treats the path as the id — `/img/*` and the other host-agnostic routes still win there, which matters since design images themselves are served from that host; the same page is also at `GET /share/:id` on the workers.dev domain)

## How to Create a New Shirt

1. Create a product in the Printful app within the Shopify Admin. Upload a PNG export from your shader to create the initial product.
2. After creating the product in Printful, the product should sync to Shopify
3. Edit the product in Shopify and add the tag `shader-[shader-file-name]` so it will load your shader defined in `assets/[shader-file-name].js`
4. Deploy your latest shader by deploying this theme using the below deployment command

For a shader that doesn't exist yet, first follow "Adding a new shader" in `CLAUDE.md`: besides the JS file, a new shader needs a `snippets/shader-controls-[name].liquid` snippet, a `{% when %}` branch in `sections/main-product.liquid`'s case block (an unlisted tag falls back to rise-shirt's controls), and a `npm run build:shader-defs` run.

## Getting Started

```bash
# 1. Install git hooks
scripts/install-hooks.sh

# 2. Run theme dev server (picks a free port, 9292 preferred)
npm run dev
# Local preview: the URL the CLI prints (http://127.0.0.1:9292 when free)

# 3. Run Worker locally (if editing the worker)
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
