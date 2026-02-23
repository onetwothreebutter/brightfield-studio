# Printful Mockup Integration Plan

## Goal

Allow customers to click "Preview on Shirt" from the shader Customize panel, which exports their current shader design and returns a photorealistic Printful mockup of it on a t-shirt.

---

## Architecture

```
Browser
  │
  │  1. Export shader canvas → PNG blob
  │
  ▼
Cloudflare Worker  (keeps Printful API key server-side)
  │
  │  2. Upload PNG → Cloudflare R2  (gets a public URL)
  │  3. POST /mockups  →  Printful API
  │  4. Poll GET /mockups/{task_key} until complete
  │  5. Delete PNG from R2
  │
  ▼
Browser
  │
  │  6. Display mockup image in UI
```

**Why Cloudflare Worker + R2?**
- Printful requires a **public image URL** (no base64 accepted)
- API key stays server-side — never exposed to the browser
- Worker free tier: 100k requests/day; R2 free tier: 10 GB storage, 1M writes/month
- No cold starts, global edge

---

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Research & Credentials | ✅ Done | |
| 2. Cloudflare Worker | ✅ Done | |
| 3. Canvas Export | 🔧 Implemented, untested | |
| 4. Shopify UI | 🔧 Implemented, untested | |
| 5. Metafield Setup | ⏳ Pending | Hardcoded to variant 4012 (White/M) for now |
| 6. End-to-end test | ⏳ Pending | |
| 7. Deploy to production | ⏳ Pending | |

---

## Phase 1 — Research & Credentials ✅

- **Printful private token** created at developers.printful.com
  - Scopes: View store products, View and manage store files
  - Stored as Cloudflare Worker secret (`PRINTFUL_API_KEY`)
- **Product:** Bella + Canvas 3001 Unisex Staple T-Shirt (Printful product ID `71`)
- **Variant used for mockups:** White / M → variant ID `4012`
- **Front print area:** 1800 × 2400 px at 150 DPI

---

## Phase 2 — Cloudflare Worker ✅

**Location:** `worker/` subfolder inside the Shopify theme repo

**Infrastructure:**
- Worker: `brightfield-mockup-worker` deployed to `https://brightfield-mockup-worker.eric-d-johnson.workers.dev`
- R2 bucket: `mockup-staging` with public access enabled at `https://pub-6029e26e344643f388b32734c4c2f53e.r2.dev`
- Secrets stored in Cloudflare vault: `PRINTFUL_API_KEY`, `R2_PUBLIC_DOMAIN`

**Endpoint:** `POST /generate-mockup`

Request body:
```json
{ "image": "<base64 PNG>", "variant_id": 4012 }
```

Worker flow:
1. Decode base64 → upload to R2 as `designs/{uuid}.png`
2. POST to Printful mockup-generator API
3. Poll until `status === "completed"` (max 20 attempts × 1.5s)
4. Delete PNG from R2
5. Return `{ mockup_url: "..." }`

CORS allows `https://brightfield-2.myshopify.com` and `http://127.0.0.1:9292` (local dev).

**Deploy:**
```bash
cd worker && npm run deploy
```

---

## Phase 3 — Canvas Export 🔧 Implemented, untested

Changes to `assets/rise-shirt.js`:
- WebGL context created with `preserveDrawingBuffer: true` (required for `toDataURL()`)
- `window._shaderExport(w, h, callback)` exposed globally:
  - Temporarily resizes canvas to target dimensions
  - Forces text texture redraw at new size
  - Renders one frame
  - Calls `callback(base64png)`
  - Restores canvas to original size

---

## Phase 4 — Shopify UI 🔧 Implemented, untested

Changes to `sections/main-product.liquid`:
- **"Preview on Shirt" button** added to `shader-gui__footer` below the controls
  - `data-variant-id="4012"` hardcoded (White/M)
  - `data-worker-url` points to the deployed Worker
- **Mockup modal** — fullscreen overlay with the mockup image, close button, and download link
- Click handler: calls `window._shaderExport(1800, 2400, ...)` → POSTs to Worker → shows modal

Changes to `assets/theme.css`:
- `.shader-gui__footer` styles
- `.mockup-modal` + child styles

---

## Phase 5 — Metafield Setup ⏳

Currently the variant ID is hardcoded to `4012` (White/M). To make it per-product:

1. Add metafield definition in Shopify admin: namespace `printful`, key `variant_id`, type `integer`
2. Set the value on each product
3. Update the button in `main-product.liquid`:
```liquid
data-variant-id="{{ product.metafields.printful.variant_id | default: 4012 }}"
```

---

## Phase 6 — End-to-End Test ⏳

1. Open http://127.0.0.1:9292/products/dot-rise
2. Switch to Shader tab
3. Click "Preview on Shirt"
4. Verify mockup loads in modal
5. Verify download link works

---

## Phase 7 — Deploy to Production ⏳

```bash
# Push theme changes
shopify theme push --store brightfield-2.myshopify.com --theme 143500345459 --allow-live

# Worker is already deployed — redeploy if changed
cd worker && npm run deploy
```

---

## Open Questions

1. **Multiple variants** — should the mockup reflect the selected Shopify variant (color/size), or always use a canonical one (White/M)?
2. **Caching** — same shader params + same variant could reuse a cached mockup URL
3. **Worker URL** — `workers.dev` works; a custom subdomain (`api.brightfieldstudio.com`) is cleaner long-term
