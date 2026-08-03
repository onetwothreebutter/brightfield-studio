const ALLOWED_ORIGINS = new Set([
  'https://brightfield.studio',
  'https://brightfield-2.myshopify.com',
]);
const PRINTFUL_API = 'https://api.printful.com';

// Bella + Canvas 3001 — product ID 71, front print area
const PRODUCT_ID   = 71;
const PRINT_WIDTH  = 1800;
const PRINT_HEIGHT = 2400;

// Garment color used for order fulfillment. The storefront doesn't offer a
// color choice, so every custom-design order is fulfilled in one fixed color —
// matches the Black/M variant (4017) already used as the canonical example
// elsewhere in this repo (worker/test-upload.mjs, worker/fetch-printfiles.mjs).
// Override with the PRINTFUL_GARMENT_COLOR var/secret if that ever changes.
const DEFAULT_PRINTFUL_GARMENT_COLOR = 'Black';

let _shopifyToken = null;
let _shopifyTokenExpiry = 0;
let _onlineStorePublicationId = null;
let _printfulLocationId = null;
let _printfulSizes = null;
let _printfulVariantMap = null;

async function getShopifyToken(env) {
  if (_shopifyToken && Date.now() < _shopifyTokenExpiry) return _shopifyToken;
  const tokenUrl = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;
  console.log('[getShopifyToken] POST', tokenUrl);
  console.log('[getShopifyToken] client_id present:', !!env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID);
  console.log('[getShopifyToken] client_secret present:', !!env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID,
      client_secret: env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  const rawText = await res.text();
  console.log('[getShopifyToken] status:', res.status);
  let data;
  try { data = JSON.parse(rawText); }
  catch {
    // Log the raw detail server-side only — this error can propagate up through
    // shopifyAdmin() -> createShopifyProduct() to the unauthenticated /create-product
    // handler, which reflects err.message straight back to the client (see the
    // catch block around createShopifyProduct() below). Never embed response body
    // content in the thrown message.
    console.error(`[getShopifyToken] non-JSON response (status ${res.status}):`, rawText.slice(0, 200));
    throw new Error(`Token endpoint returned non-JSON (status ${res.status})`);
  }
  if (!data.access_token) {
    // Same reasoning as the non-JSON branch above: this error can reach the
    // unauthenticated /create-product client verbatim. Shopify's OAuth error
    // body is normally just { error, error_description } with no secrets, but
    // don't reflect arbitrary upstream JSON to a public caller regardless.
    console.error('[getShopifyToken] token endpoint response missing access_token:', JSON.stringify(data));
    throw new Error(`Failed to get Shopify token (status ${res.status})`);
  }
  _shopifyToken = data.access_token;
  _shopifyTokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  return _shopifyToken;
}

async function shopifyAdmin(env, query, variables) {
  const token = await getShopifyToken(env);
  const res = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const data = await res.json();
  if (data?.errors) console.error('[shopifyAdmin] errors:', JSON.stringify(data.errors));
  return data;
}

async function getOnlineStorePublicationId(env) {
  if (_onlineStorePublicationId) return _onlineStorePublicationId;
  const data = await shopifyAdmin(env, `query { publications(first: 20) { edges { node { id name } } } }`);
  const edges = data?.data?.publications?.edges || [];
  console.log('[publications] available:', edges.map(e => e.node.name));
  const match = edges.find(e => e.node.name === 'Online Store');
  if (match) _onlineStorePublicationId = match.node.id;
  return _onlineStorePublicationId;
}

async function getPrintfulLocationId(env) {
  if (_printfulLocationId) return _printfulLocationId;
  const data = await shopifyAdmin(env, `query { shop { fulfillmentServices { handle serviceName location { id } } } }`);
  const services = data?.data?.shop?.fulfillmentServices || [];
  console.log('[fulfillmentServices] available:', services.map(s => s.handle));
  const match = services.find(s => s.handle?.toLowerCase().includes('printful') || s.serviceName?.toLowerCase().includes('printful'));
  if (match?.location?.id) _printfulLocationId = match.location.id;
  return _printfulLocationId;
}

const CANONICAL_SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

async function getPrintfulSizes(env) {
  if (_printfulSizes) return _printfulSizes;
  try {
    const res = await fetch(`${PRINTFUL_API}/products/${PRODUCT_ID}`, {
      headers: env.PRINTFUL_API_KEY ? { 'Authorization': `Bearer ${env.PRINTFUL_API_KEY}` } : {},
    });
    if (!res.ok) {
      console.warn('[getPrintfulSizes] non-OK response:', res.status);
      return null;
    }
    const data = await res.json();
    const variants = data?.result?.variants || [];
    const seen = new Set();
    for (const v of variants) {
      if (v.size) seen.add(v.size);
    }
    // Sort by canonical garment order; unknown sizes appended at end
    const known = CANONICAL_SIZE_ORDER.filter(s => seen.has(s));
    const unknown = [...seen].filter(s => !CANONICAL_SIZE_ORDER.includes(s));
    const sizes = [...known, ...unknown];
    if (sizes.length) {
      _printfulSizes = sizes;
      console.log('[getPrintfulSizes] sizes from Printful (sorted):', sizes);
    }
    return _printfulSizes;
  } catch (err) {
    console.warn('[getPrintfulSizes] error (non-fatal):', err.message);
    return null;
  }
}

// Maps each garment size (e.g. 'M', 'XL') to its Printful catalog variant ID for
// PRODUCT_ID, filtered to a single garment color (see
// DEFAULT_PRINTFUL_GARMENT_COLOR) since the storefront doesn't offer a color
// choice. Used by the orders/paid webhook to translate a custom-design line
// item's SKU size suffix (see parseCustomSku()) into the variant_id Printful's
// POST /orders endpoint requires.
//
// Extends the same Printful catalog fetch getPrintfulSizes() above already
// makes (GET /products/{id}): that function only keeps the deduped size
// *labels* it needs for the Shopify "Size" option, discarding color and id;
// this one keeps the size -> variant *id* mapping needed to actually place an
// order. Kept as a separate cached call (rather than sharing one raw-variants
// cache) so each stays simple and independently testable.
async function getPrintfulVariantMap(env) {
  if (_printfulVariantMap) return _printfulVariantMap;
  try {
    const res = await fetch(`${PRINTFUL_API}/products/${PRODUCT_ID}`, {
      headers: env.PRINTFUL_API_KEY ? { 'Authorization': `Bearer ${env.PRINTFUL_API_KEY}` } : {},
    });
    if (!res.ok) {
      console.warn('[getPrintfulVariantMap] non-OK response:', res.status);
      return null;
    }
    const data = await res.json();
    const variants = data?.result?.variants || [];
    const targetColor = (env.PRINTFUL_GARMENT_COLOR || DEFAULT_PRINTFUL_GARMENT_COLOR).toLowerCase();

    const map = {};
    // Pass 1: only the target color, so two variants sharing a size (different
    // colors) never collide.
    for (const v of variants) {
      if (v.size && v.id != null && (v.color || '').toLowerCase() === targetColor) {
        map[v.size] = v.id;
      }
    }
    // Pass 2: fill any size missing from the target color (e.g. a color that
    // doesn't offer every size) from whatever color is available, so a gap in
    // one color's size run doesn't silently drop an order — better to fulfill
    // in a slightly-off color than fail outright. Logged so it's noticeable.
    for (const v of variants) {
      if (v.size && v.id != null && !(v.size in map)) {
        console.warn('[getPrintfulVariantMap] no', targetColor, 'variant for size', v.size, '— falling back to color', v.color);
        map[v.size] = v.id;
      }
    }

    if (Object.keys(map).length) {
      _printfulVariantMap = map;
      console.log('[getPrintfulVariantMap] size -> variant id map:', map);
    }
    return _printfulVariantMap;
  } catch (err) {
    console.warn('[getPrintfulVariantMap] error (non-fatal):', err.message);
    return null;
  }
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { const u = new URL(origin); return u.hostname === '127.0.0.1' || u.hostname === 'localhost'; }
  catch { return false; }
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : 'https://brightfield.studio',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ── Payload limits for unauthenticated write endpoints ───────────────────────
// Shader-state / values objects are a few KB in practice; canvas images
// (design/mockup/checkout/share) are typically well under 2 MB. Caps leave
// generous headroom while keeping anonymous R2 writes bounded.
const MAX_STATE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Base64 inflates by 4/3; allow the image(s) plus values/metadata.
const MAX_SINGLE_IMAGE_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + MAX_STATE_BYTES;
// /save-preview carries up to three images: design, mockup, and optional checkout.
const MAX_PREVIEW_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) * 3 + MAX_STATE_BYTES;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// Uses Cloudflare's native Workers Rate Limiting binding (GA since 2025-09-19;
// https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
// declared per-endpoint in wrangler.toml as [[ratelimits]] blocks. A binding's
// limit/period is fixed at deploy time, so each endpoint gets its own named
// binding rather than one shared binding differentiated by key — see
// wrangler.toml for the limit chosen per endpoint and the reasoning.
//
// Keyed by CF-Connecting-IP: the real client IP as seen by Cloudflare's edge,
// set on every request that reaches a Worker and not attacker-controlled
// (unlike X-Forwarded-For, which a client can send any value for). The
// binding docs generally steer away from pure-IP keys because a shared IP
// (office NAT, campus network) can cause false positives across unrelated
// users — but the goal here isn't per-user fairness, it's stopping a single
// flooding script, and the limits in wrangler.toml are set well above what a
// real shopper's editing session ever needs, so legitimate shared-IP traffic
// shouldn't trip it.
async function checkRateLimit(env, bindingName, request) {
  const limiter = env[bindingName];
  // Binding missing (e.g. some local/test environments) — nothing to check.
  if (!limiter) return true;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown-ip';
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    // Fail OPEN, not closed. If the limiter binding itself is misconfigured or
    // has a transient error, the right degradation is "no rate limiting for
    // this request" — not a 500 on every request to an otherwise-healthy
    // endpoint. A broken abuse-prevention layer should never be able to take
    // the whole endpoint down; anonymous flooding is the lesser risk.
    console.warn(`[rate-limit] ${bindingName} check failed, failing open:`, err.message);
    return true;
  }
}

function rateLimitedResponse(headers) {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
    { status: 429, headers }
  );
}

// Reads and parses a JSON body, rejecting bodies over maxBytes before parsing.
// Returns { body } on success, or { error, status } for the caller to return.
async function readLimitedJson(request, maxBytes) {
  const text = await request.text();
  if (text.length > maxBytes) return { error: 'Payload too large', status: 413 };
  try { return { body: JSON.parse(text) }; }
  catch { return { error: 'Invalid JSON', status: 400 }; }
}

// ── Image serving ────────────────────────────────────────────────────────────
// Images live in R2 but are served through this worker at /img/{key} instead of
// the pub-*.r2.dev URL: that domain is a rate-limited dev domain (images
// intermittently fail to load in production), and serving them here also allows
// on-the-fly thumbnail resizing via the IMAGES binding (?w=320).

const IMG_BASE = 'https://share.brightfield.studio/img';
const IMG_MAX_WIDTH = 2000;
// Only image objects are servable — JSON blobs under other prefixes
// (device-designs/, community/submissions/, shader-states/) stay private.
const IMG_PREFIXES = ['mockups/', 'designs/', 'checkouts/', 'product-images/', 'shares/'];

function imgUrl(key) {
  return `${IMG_BASE}/${key}`;
}

// Returns the R2 key when `url` points at an image we host ourselves (either
// the worker's /img/ route or the legacy pub-*.r2.dev domain), else null.
function ownImageKey(env, url) {
  if (!url) return null;
  if (url.startsWith(`${IMG_BASE}/`)) return url.slice(IMG_BASE.length + 1).split('?')[0];
  if (env.R2_PUBLIC_DOMAIN && url.startsWith(`https://${env.R2_PUBLIC_DOMAIN}/`)) {
    return url.slice(`https://${env.R2_PUBLIC_DOMAIN}/`.length).split('?')[0];
  }
  return null;
}

function rewriteLegacyImgUrl(env, url) {
  if (!url || !env.R2_PUBLIC_DOMAIN) return url;
  const prefix = `https://${env.R2_PUBLIC_DOMAIN}/`;
  return url.startsWith(prefix) ? imgUrl(url.slice(prefix.length)) : url;
}

// Rewrites the image-URL fields of a stored design/submission entry in place,
// so entries saved before the /img/ route existed render through it too.
const IMG_URL_FIELDS = ['designUrl', 'mockupUrl', 'checkoutImageUrl', 'imageUrl'];
function rewriteLegacyImgUrls(env, entry) {
  if (!entry) return entry;
  for (const f of IMG_URL_FIELDS) {
    if (entry[f]) entry[f] = rewriteLegacyImgUrl(env, entry[f]);
  }
  return entry;
}

// Fetches image bytes, reading straight from R2 when the URL is one of our own —
// a worker cannot fetch() its own custom domain, and going through pub-*.r2.dev
// hits its rate limit. Returns null when the image can't be read.
async function fetchImageBytes(env, url) {
  const key = ownImageKey(env, url);
  if (key) {
    const obj = await env.MOCKUP_STAGING.get(key);
    return obj ? await obj.arrayBuffer() : null;
  }
  const res = await fetch(url);
  return res.ok ? await res.arrayBuffer() : null;
}

async function handleServeImage(request, env, ctx) {
  const url = new URL(request.url);
  let key;
  try { key = decodeURIComponent(url.pathname.slice('/img/'.length)); }
  catch { return new Response('Not found', { status: 404 }); } // malformed %-encoding

  if (!IMG_PREFIXES.some(p => key.startsWith(p)) || !/\.(png|jpe?g|webp)$/i.test(key) || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  // Only ?w= participates in the cache key so junk params can't fragment the cache
  let width = parseInt(url.searchParams.get('w'), 10);
  width = Number.isFinite(width) && width > 0 ? Math.min(width, IMG_MAX_WIDTH) : 0;

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  // &rv= (resize-version) busts the edge cache when the resize transform changes,
  // e.g. the v2 background-matte fix for the alpha-fringe halo on mockup thumbnails
  const cacheKey = new Request(`${IMG_BASE}/${key}${width ? `?w=${width}&rv=2` : ''}`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const obj = await env.MOCKUP_STAGING.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const sourceType = obj.httpMetadata?.contentType
    || (/\.png$/i.test(key) ? 'image/png' : /\.webp$/i.test(key) ? 'image/webp' : 'image/jpeg');

  let body = await obj.arrayBuffer();
  let outType = sourceType;
  // Full-size responses always match their cache key; a ?w= response only does
  // if the resize actually ran
  let cacheable = !width;
  if (width && env.IMAGES) {
    try {
      // Keep the source format: PNG mockups carry alpha (background-removed).
      // Downscaling a segmented PNG leaves a light halo around the subject —
      // the semi-transparent edge pixels from `segment: 'foreground'` still
      // carry the original mockup backdrop color, and get smeared brighter by
      // the resize. Matting onto the cart thumbnail's own background color
      // (--color-surface-2, theme.css) bakes in the correct edge color instead
      // of leaving it to whatever the browser composites over later. No-op for
      // jpg mockups (no alpha channel).
      const resized = await env.IMAGES
        .input(body)
        .transform({ width, fit: 'scale-down', background: '#1a1a1a' })
        .output({ format: sourceType, quality: 82 });
      body = await resized.response().arrayBuffer();
      cacheable = true;
    } catch (err) {
      console.warn('[serve-image] resize failed, serving original:', err.message);
    }
  }

  const response = new Response(body, {
    headers: {
      'Content-Type': outType,
      // Keys are UUIDs and content never changes once written
      'Cache-Control': cacheable
        ? 'public, max-age=31536000, immutable'
        // Failed resize: don't let the full-res original get pinned under the
        // thumbnail key — not in the edge cache, not in the browser
        : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
  if (cache && cacheable) {
    const store = cache.put(cacheKey, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(store); else await store;
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url      = new URL(request.url);
    const method   = request.method;
    const pathname = url.pathname;

    if (method === 'POST' && pathname === '/generate-mockup') {
      return handleGenerateMockup(request, env, origin);
    }

    if (method === 'GET' && pathname === '/list-designs') {
      return handleListDesigns(request, env, origin);
    }

    if (method === 'POST' && pathname === '/delete-design') {
      return handleDeleteDesign(request, env, origin);
    }

    if (method === 'POST' && pathname === '/community/submit')  return handleCommunitySubmit(request, env, origin);
    if (method === 'GET'  && pathname === '/community/list')    return handleCommunityList(request, env, origin);
    if (method === 'POST' && pathname === '/community/like')    return handleCommunityLike(request, env, origin);
    if (method === 'GET'  && pathname === '/community/pending') return handleCommunityPending(request, env, origin);
    if (method === 'POST' && pathname === '/community/approve') return handleCommunityModerate(request, env, origin, 'approved');
    if (method === 'POST' && pathname === '/community/reject')  return handleCommunityModerate(request, env, origin, 'rejected');
    if (method === 'GET'  && pathname.startsWith('/community/design/')) return handleCommunityDesign(request, env, origin, pathname.slice('/community/design/'.length));

    if (method === 'POST' && pathname === '/reviews/submit')   return handleReviewsSubmit(request, env, origin);
    if (method === 'GET'  && pathname === '/reviews/list')     return handleReviewsList(request, env, origin);
    if (method === 'GET'  && pathname === '/reviews/pending')  return handleReviewsPending(request, env, origin);
    if (method === 'POST' && pathname === '/reviews/approve')  return handleReviewsModerate(request, env, origin, 'approved');
    if (method === 'POST' && pathname === '/reviews/reject')   return handleReviewsModerate(request, env, origin, 'rejected');

    if (method === 'POST' && pathname === '/save-shader-state')           return handleSaveShaderState(request, env, origin);
    if (method === 'GET'  && pathname.startsWith('/get-shader-state/'))   return handleGetShaderState(request, env, origin);
    if (method === 'POST' && pathname === '/create-share')                return handleCreateShare(request, env, origin);

    // Must precede the share.brightfield.studio catch-all below
    if (method === 'GET' && pathname.startsWith('/img/')) return handleServeImage(request, env, ctx);

    // Custom domain: share.brightfield.studio/{id}
    if (method === 'GET' && url.hostname === 'share.brightfield.studio') return handleShare(request, env, pathname.slice(1));

    if (method === 'GET'  && pathname.startsWith('/share/')) return handleShare(request, env, pathname.slice(7));

    if (method === 'GET'  && pathname === '/admin-ui') return handleAdminUI(request, env);

    if (method === 'GET'  && pathname === '/admin/list-designs') return handleAdminListDesigns(request, env);
    if (method === 'POST' && pathname === '/admin/patch-design-url') return handleAdminPatchDesignUrl(request, env);
    if (method === 'GET'  && pathname === '/admin/gc-dry-run') return handleGcDryRun(request, env);

    if (method === 'GET'  && pathname === '/download-mockup') return handleDownloadMockup(request, env, origin);

    if (method === 'POST' && pathname === '/remove-bg') return handleRemoveBg(request, env, origin);

    if (method === 'POST' && pathname === '/save-preview')    return handleSavePreview(request, env, origin);
    if (method === 'POST' && pathname === '/create-product')  return handleCreateProduct(request, env, origin);

    // Shopify webhook — server-to-server, HMAC-authenticated (not browser CORS,
    // see handleOrderPaidWebhook). Registered on the orders/paid topic; see
    // wrangler.toml + PR description for the (manual, one-time) registration step.
    if (method === 'POST' && pathname === '/webhook/order-paid') return handleOrderPaidWebhook(request, env, ctx);

    return new Response('Not found', { status: 404 });
  },

  // Cloudflare Workers Cron Trigger (see wrangler.toml [triggers] crons).
  // Runs the abandoned-product / orphaned-R2-blob GC pass — see runGc() and
  // the "Garbage collection" section below for the full design and safety
  // model. Deletion is gated behind env.GC_DRY_RUN (see gcIsDryRun()) — unset
  // or anything other than "false" runs dry-run (log only, delete nothing).
  async scheduled(event, env, ctx) {
    await runScheduledGc(env);
  },
};

async function handleGenerateMockup(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!(await checkRateLimit(env, 'RATE_LIMITER_GENERATE_MOCKUP', request))) {
    return rateLimitedResponse(headers);
  }

  const { body, error, status } = await readLimitedJson(request, MAX_SINGLE_IMAGE_BODY_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });

  const { image, variant_id, deviceId, shader, productHandle, values, skipBgRemoval } = body;
  if (!image || !variant_id) {
    return new Response(JSON.stringify({ error: 'Missing image or variant_id' }), { status: 400, headers });
  }
  if (typeof image !== 'string' || image.length * 3 / 4 > MAX_IMAGE_BYTES) {
    return new Response(JSON.stringify({ error: 'Image too large' }), { status: 413, headers });
  }

  // 1. Decode base64 PNG and upload to R2
  const imageKey = `designs/${crypto.randomUUID()}.png`;
  let imageData;
  try { imageData = Uint8Array.from(atob(image), c => c.charCodeAt(0)); }
  catch { return new Response(JSON.stringify({ error: 'Invalid image encoding' }), { status: 400, headers }); }

  await env.MOCKUP_STAGING.put(imageKey, imageData, {
    httpMetadata: { contentType: 'image/png' }
  });

  // Served through the worker's /img/ route (Printful fetches this externally)
  const imageUrl = imgUrl(imageKey);

  try {
    // 2. Create Printful mockup task
    // Note: catch block returns a JSON error response; finally always cleans up R2
    const taskRes = await fetch(`${PRINTFUL_API}/mockup-generator/create-task/${PRODUCT_ID}`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        variant_ids: [Number(variant_id)],
        format: 'jpg',
        files: [{
          placement: 'front',
          image_url: imageUrl,
          position: {
            area_width:  PRINT_WIDTH,
            area_height: PRINT_HEIGHT,
            width:       PRINT_WIDTH,
            height:      PRINT_HEIGHT,
            top:  0,
            left: 0,
          }
        }]
      })
    });

    const taskJson = await taskRes.json();
    console.log('[mockup] Printful create-task response:', JSON.stringify(taskJson));
    if (taskJson.code !== 200) {
      throw new Error(taskJson.result || taskJson.error || JSON.stringify(taskJson));
    }

    const taskKey = taskJson.result.task_key;

    // 3. Poll for result (max 20 attempts, 1.5s apart)
    let mockupUrl = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const resultRes  = await fetch(`${PRINTFUL_API}/mockup-generator/task?task_key=${taskKey}`, {
        headers: { 'Authorization': `Bearer ${env.PRINTFUL_API_KEY}` }
      });
      const resultJson = await resultRes.json();
      console.log('[mockup] Printful poll result:', JSON.stringify(resultJson.result));
      const status     = resultJson.result?.status;

      if (status === 'completed') {
        mockupUrl = resultJson.result.mockups?.[0]?.mockup_url;
        break;
      }
      if (status === 'failed') {
        const detail = resultJson.result?.error || JSON.stringify(resultJson.result);
        throw new Error(`Printful mockup generation failed: ${detail}`);
      }
    }

    if (!mockupUrl) {
      throw new Error('Mockup generation timed out');
    }

    // 4. Re-host the Printful mockup in R2 so the URL doesn't expire
    const mockupImageRes = await fetch(mockupUrl);
    let downloadUrl = null;
    if (mockupImageRes.ok) {
      let mockupData        = await mockupImageRes.arrayBuffer();
      let mockupContentType = 'image/jpeg';
      let mockupExt         = 'jpg';

      // Remove background via Cloudflare Images (best-effort — falls back to original on failure)
      if (env.IMAGES && !skipBgRemoval) {
        try {
          const processed = await env.IMAGES
            .input(mockupData)
            .transform({ segment: 'foreground' })
            .output({ format: 'image/png' });
          mockupData        = await processed.response().arrayBuffer();
          mockupContentType = 'image/png';
          mockupExt         = 'png';
        } catch (imgErr) {
          console.error('Background removal failed, using original:', imgErr.message);
        }
      }

      const mockupKey = `mockups/${crypto.randomUUID()}.${mockupExt}`;
      await env.MOCKUP_STAGING.put(mockupKey, mockupData, {
        httpMetadata: { contentType: mockupContentType }
      });
      mockupUrl = imgUrl(mockupKey);
      const shaderSlug = (shader || '').replace(/[^a-z0-9-]/g, '') || 'design';
      downloadUrl = `${new URL(request.url).origin}/download-mockup?key=${encodeURIComponent(mockupKey)}&shader=${encodeURIComponent(shaderSlug)}`;
    }

    // 5. Keep the design file in R2 — merchant needs the URL to submit to Printful when fulfilling
    // 6. Save design entry for the device gallery (best-effort)
    let deviceToken = null;
    if (deviceId) {
      const entry = {
        id: crypto.randomUUID(),
        shader: shader || '',
        productHandle: productHandle || '',
        designUrl: imageUrl,
        mockupUrl,
        values: values || {},
        timestamp: Math.floor(Date.now() / 1000),
      };
      deviceToken = await saveDesignEntry(env, deviceId, entry).catch(() => null);
    }

    const responseBody = { mockup_url: mockupUrl, design_url: imageUrl };
    if (downloadUrl) responseBody.download_url = downloadUrl;
    // First-claim token for this deviceId (#544) — client persists it and sends
    // it back on future /delete-design and /community/like calls.
    if (deviceToken) responseBody.deviceToken = deviceToken;
    return new Response(JSON.stringify(responseBody), { status: 200, headers });

  } catch (err) {
    // Clean up orphaned R2 file on failure only
    env.MOCKUP_STAGING.delete(imageKey).catch(() => {});
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function handleDownloadMockup(request, env, origin) {
  const params = new URL(request.url).searchParams;
  const key    = params.get('key');
  const shader = (params.get('shader') || '').replace(/[^a-z0-9-]/g, '') || 'design';
  if (!key) return new Response('Missing key', { status: 400, headers: corsHeaders(origin) });
  const obj = await env.MOCKUP_STAGING.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  // Use client-supplied local datetime if present, otherwise fall back to UTC
  const dt = (params.get('dt') || '').replace(/[^a-z0-9-]/g, '');
  let datetime = dt;
  if (!datetime) {
    const now     = new Date();
    const year    = now.getUTCFullYear();
    const month   = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day     = String(now.getUTCDate()).padStart(2, '0');
    const h24     = now.getUTCHours();
    const ampm    = h24 >= 12 ? 'pm' : 'am';
    const hour    = h24 % 12 || 12;
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    datetime = `${year}-${month}-${day}-${hour}${minutes}${ampm}`;
  }
  const ext         = key.endsWith('.png') ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const filename = `my-${shader}-design--brightfield--${datetime}.${ext}`;
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders(origin),
    },
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleSavePreview(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!(await checkRateLimit(env, 'RATE_LIMITER_SAVE_PREVIEW', request))) {
    return rateLimitedResponse(headers);
  }

  const { body, error, status } = await readLimitedJson(request, MAX_PREVIEW_BODY_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });

  const { designImage, checkoutImage, mockupImage, deviceId, shader, productHandle, values } = body;
  if (!designImage || !mockupImage) {
    return new Response(JSON.stringify({ error: 'Missing designImage or mockupImage' }), { status: 400, headers });
  }
  for (const [name, img] of [['designImage', designImage], ['mockupImage', mockupImage], ['checkoutImage', checkoutImage]]) {
    if (img != null && (typeof img !== 'string' || img.length * 3 / 4 > MAX_IMAGE_BYTES)) {
      return new Response(JSON.stringify({ error: `${name} too large` }), { status: 413, headers });
    }
  }

  const designKey   = `designs/${crypto.randomUUID()}.png`;
  const mockupKey   = `mockups/${crypto.randomUUID()}.jpg`;
  const checkoutKey = checkoutImage ? `checkouts/${crypto.randomUUID()}.png` : null;

  let designData, mockupData, checkoutData;
  try {
    designData   = Uint8Array.from(atob(designImage), c => c.charCodeAt(0));
    mockupData   = Uint8Array.from(atob(mockupImage), c => c.charCodeAt(0));
    checkoutData = checkoutImage ? Uint8Array.from(atob(checkoutImage), c => c.charCodeAt(0)) : null;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid image encoding' }), { status: 400, headers });
  }

  const uploads = [
    env.MOCKUP_STAGING.put(designKey, designData, { httpMetadata: { contentType: 'image/png' } }),
    env.MOCKUP_STAGING.put(mockupKey, mockupData, { httpMetadata: { contentType: 'image/jpeg' } }),
  ];
  if (checkoutKey) uploads.push(env.MOCKUP_STAGING.put(checkoutKey, checkoutData, { httpMetadata: { contentType: 'image/png' } }));
  await Promise.all(uploads);

  const designUrl       = imgUrl(designKey);
  const mockupUrl       = imgUrl(mockupKey);
  const checkoutImageUrl = checkoutKey ? imgUrl(checkoutKey) : null;

  let savedId = null;
  let deviceToken = null;
  if (deviceId) {
    savedId = crypto.randomUUID();
    const entry = {
      id: savedId,
      shader: shader || '',
      productHandle: productHandle || '',
      designUrl,
      mockupUrl,
      values: values || {},
      timestamp: Math.floor(Date.now() / 1000),
    };
    deviceToken = await saveDesignEntry(env, deviceId, entry).catch(() => null);
  }

  const responseBody = { design_url: designUrl, mockup_url: mockupUrl, checkout_image_url: checkoutImageUrl, id: savedId };
  // First-claim token for this deviceId (#544) — client persists it and sends
  // it back on future /delete-design and /community/like calls.
  if (deviceToken) responseBody.deviceToken = deviceToken;
  return new Response(JSON.stringify(responseBody), { status: 200, headers });
}

// Picks the size variant matching requestedSize (a Size option value like 'M'); falls back to the first variant.
export function pickSizeVariant(sizeVariants, requestedSize) {
  const matched = requestedSize
    ? sizeVariants.find(v => v.selectedOptions?.some(o => o.name === 'Size' && o.value === requestedSize))
    : null;
  return matched || sizeVariants[0];
}

// Shared helper: creates a Shopify product, sets variant price, and publishes to Online Store.
// Returns { newProductId, newVariantId } (numeric strings).
async function createShopifyProduct(env, { designUrl, mockupUrl, checkoutImageUrl, shader, productTitle, price, tags, creatorName, values, submissionId, sourceProductHandle, requestedSize }) {
  const logPrefix = '[createShopifyProduct]';

  // Resize the mockup to ≤2000px wide so it stays under Shopify's 25 MP limit
  let shopifyImageUrl = null;
  const mediaSource = checkoutImageUrl || designUrl || mockupUrl;
  console.log(logPrefix, 'media source URL:', mediaSource);

  // Try IMAGES binding first; fall back to cf.image fetch; skip if both fail
  let resizedBuf = null;
  if (env.IMAGES) {
    try {
      const imgBuf = await fetchImageBytes(env, mediaSource);
      if (imgBuf) {
        const resized = await env.IMAGES
          .input(imgBuf)
          .transform({ width: 2000, fit: 'scale-down' })
          .output({ format: 'image/jpeg', quality: 85 });
        resizedBuf = await resized.response().arrayBuffer();
        console.log(logPrefix, 'IMAGES resize succeeded');
      } else {
        console.warn(logPrefix, 'media source unreadable (IMAGES path):', mediaSource);
      }
    } catch (err) {
      console.warn(logPrefix, 'IMAGES resize failed, trying cf.image fallback:', err.message, err.toString());
    }
  }

  if (!resizedBuf) {
    try {
      // cf.image needs a fetchable URL; our own /img/ URLs can't be self-fetched,
      // so fall back to the legacy R2 public domain for those
      const cfKey    = ownImageKey(env, mediaSource);
      const cfSource = cfKey && env.R2_PUBLIC_DOMAIN ? `https://${env.R2_PUBLIC_DOMAIN}/${cfKey}` : mediaSource;
      const cfRes = await fetch(cfSource, {
        cf: { image: { width: 2000, fit: 'scale-down', format: 'jpeg', quality: 85 } },
      });
      console.log(logPrefix, 'cf.image fetch status:', cfRes.status);
      if (cfRes.ok) {
        resizedBuf = await cfRes.arrayBuffer();
        console.log(logPrefix, 'cf.image resize succeeded');
      }
    } catch (err) {
      console.warn(logPrefix, 'cf.image resize failed, skipping media:', err.message);
    }
  }

  if (resizedBuf) {
    const imgKey = `product-images/${crypto.randomUUID()}.jpg`;
    await env.MOCKUP_STAGING.put(imgKey, resizedBuf, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    shopifyImageUrl = imgUrl(imgKey);
    console.log(logPrefix, 'media uploaded to R2:', shopifyImageUrl);
  } else {
    // Both resize methods failed — use the original R2 URL directly since it's already public
    shopifyImageUrl = mediaSource;
    console.warn(logPrefix, 'all resize methods failed — using original URL as product image:', shopifyImageUrl);
  }

  // Step 1: create the product (variants not accepted in ProductInput in 2025-01+)
  const createData = await shopifyAdmin(env,
    `mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
      productCreate(input: $input, media: $media) {
        product {
          id
          handle
          variants(first: 1) { edges { node { id inventoryItem { id } } } }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title:  productTitle,
        status: 'ACTIVE',
        vendor: 'Brightfield Studio',
        tags,
        descriptionHtml: '',
        metafields: [
          // Hide generated per-customer products from storefront search, the
          // sitemap, and search engines (noindex). They stay ACTIVE so the
          // buyer's cart/checkout links keep working.
          { namespace: 'seo',    key: 'hidden',                 type: 'number_integer',         value: '1' },
          { namespace: 'custom', key: 'design_url',             type: 'url',                    value: designUrl },
          { namespace: 'custom', key: 'mockup_url',             type: 'url',                    value: mockupUrl },
          { namespace: 'custom', key: 'shader',                 type: 'single_line_text_field', value: shader || '' },
          { namespace: 'custom', key: 'creator_name',           type: 'single_line_text_field', value: creatorName || '' },
          { namespace: 'custom', key: 'shader_values',          type: 'json',                   value: JSON.stringify(values || {}) },
          { namespace: 'custom', key: 'submission_id',          type: 'single_line_text_field', value: submissionId || '' },
          { namespace: 'custom', key: 'source_product_handle',  type: 'single_line_text_field', value: sourceProductHandle || '' },
        ],
      },
      media: shopifyImageUrl
        ? [{ originalSource: shopifyImageUrl, mediaContentType: 'IMAGE' }]
        : [],
    }
  );

  const userErrors = createData?.data?.productCreate?.userErrors;
  if (userErrors?.length) {
    console.error(logPrefix, 'userErrors:', JSON.stringify(userErrors));
    const err = new Error(userErrors[0].message);
    err.status = 422; // bad input, not a transport/infra failure — see handleCreateProduct's catch
    throw err;
  }

  const newProductGid    = createData?.data?.productCreate?.product?.id;
  const newProductHandle = createData?.data?.productCreate?.product?.handle;
  const newVariantNode   = createData?.data?.productCreate?.product?.variants?.edges?.[0]?.node;
  const newVariantGid = newVariantNode?.id;
  const inventoryItemGid = newVariantNode?.inventoryItem?.id;
  if (!newVariantGid) {
    console.error(logPrefix, 'no variant returned:', JSON.stringify(createData));
    const err = new Error('Product created but no variant returned');
    err.status = 422; // productCreate itself succeeded — a data-shape anomaly, not a transport failure
    throw err;
  }

  // Step 2: add Size option, which auto-creates one variant per size and removes the default Title variant
  const printfulSizes = await getPrintfulSizes(env);
  const SIZES = printfulSizes || CANONICAL_SIZE_ORDER;
  console.log(logPrefix, 'using sizes:', SIZES);
  let sizeVariants = [];
  try {
    const optData = await shopifyAdmin(env,
      `mutation CreateOptions($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
          product {
            variants(first: 20) { edges { node { id inventoryItem { id } selectedOptions { name value } } } }
          }
          userErrors { field message }
        }
      }`,
      {
        productId: newProductGid,
        options: [{ name: 'Size', values: SIZES.map(s => ({ name: s })) }],
        variantStrategy: 'CREATE',
      }
    );
    const optErrors = optData?.data?.productOptionsCreate?.userErrors;
    if (optErrors?.length) {
      console.warn(logPrefix, 'productOptionsCreate errors (non-fatal):', JSON.stringify(optErrors));
    }
    sizeVariants = (optData?.data?.productOptionsCreate?.product?.variants?.edges || [])
      .map(e => e.node)
      .filter(v => v.selectedOptions?.some(o => o.name === 'Size'));
    console.log(logPrefix, 'size variants created:', sizeVariants.length);
  } catch (err) {
    console.warn(logPrefix, 'productOptionsCreate failed (non-fatal):', err.message);
  }

  // Fall back to the original default variant if option creation failed
  if (!sizeVariants.length) {
    sizeVariants = [{ id: newVariantGid, inventoryItem: inventoryItemGid ? { id: inventoryItemGid } : null, selectedOptions: [] }];
  }

  const matchedSizeVariant = pickSizeVariant(sizeVariants, requestedSize);
  const requestedSizeFound = sizeVariants.some(v => v.selectedOptions?.some(o => o.name === 'Size' && o.value === requestedSize));
  if (requestedSize && !requestedSizeFound) {
    console.warn(logPrefix, 'requested size not found among created size variants:', requestedSize, '— falling back to first size variant');
  }
  const firstSizeVariantGid = matchedSizeVariant.id;

  // Step 2a: set price on all size variants
  const updateData = await shopifyAdmin(env,
    `mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }`,
    {
      productId: newProductGid,
      variants: sizeVariants.map(v => ({ id: v.id, price, inventoryPolicy: 'CONTINUE' })),
    }
  );

  const updateErrors = updateData?.data?.productVariantsBulkUpdate?.userErrors;
  if (updateErrors?.length) {
    console.error(logPrefix, 'variant update errors:', JSON.stringify(updateErrors));
    // Non-fatal: product exists, just price may be wrong
  }

  // Step 2b: set SKU on each inventory item (required by Printful before inventoryActivate)
  const skuPrefix = tags?.includes('community-design') ? 'COMMUNITY' : 'CUSTOM';
  const baseTimestamp = Date.now();
  for (const sv of sizeVariants) {
    const invGid = sv.inventoryItem?.id;
    if (!invGid) continue;
    const sizeLabel = sv.selectedOptions?.find(o => o.name === 'Size')?.value || 'ONE';
    const skuData = await shopifyAdmin(env,
      `mutation UpdateInventoryItem($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id sku }
          userErrors { field message }
        }
      }`,
      { id: invGid, input: { sku: `${skuPrefix}-${baseTimestamp}-${sizeLabel}` } }
    );
    const skuErrors = skuData?.data?.inventoryItemUpdate?.userErrors;
    if (skuErrors?.length) console.error(logPrefix, 'SKU update errors for', sizeLabel, ':', JSON.stringify(skuErrors));
    else console.log(logPrefix, 'SKU set:', skuData?.data?.inventoryItemUpdate?.inventoryItem?.sku);
  }

  // Step 2c: activate inventory at the Printful fulfillment service location for each size variant
  const printfulLocationId = await getPrintfulLocationId(env);
  console.log(logPrefix, 'Printful location ID:', printfulLocationId);
  if (printfulLocationId) {
    for (const sv of sizeVariants) {
      const invGid = sv.inventoryItem?.id;
      if (!invGid) continue;
      const activateData = await shopifyAdmin(env,
        `mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
          inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
            inventoryLevel { id }
            userErrors { field message }
          }
        }`,
        { inventoryItemId: invGid, locationId: printfulLocationId }
      );
      const activateErrors = activateData?.data?.inventoryActivate?.userErrors;
      if (activateErrors?.length) {
        console.error(logPrefix, 'inventoryActivate errors:', JSON.stringify(activateErrors));
      } else {
        console.log(logPrefix, 'inventory activated at Printful location for variant', sv.id);
      }
    }
  } else {
    console.warn(logPrefix, 'skipping inventoryActivate — missing locationId');
  }

  // Step 2d: re-apply inventoryPolicy:CONTINUE after inventoryActivate, which resets it to DENY
  const policyData = await shopifyAdmin(env,
    `mutation ResetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`,
    {
      productId: newProductGid,
      variants: sizeVariants.map(v => ({ id: v.id, inventoryPolicy: 'CONTINUE' })),
    }
  );
  const policyErrors = policyData?.data?.productVariantsBulkUpdate?.userErrors;
  if (policyErrors?.length) {
    console.error(logPrefix, 'inventoryPolicy re-apply errors:', JSON.stringify(policyErrors));
  } else {
    const policies = policyData?.data?.productVariantsBulkUpdate?.productVariants?.map(v => v.inventoryPolicy);
    console.log(logPrefix, 'inventoryPolicy re-applied:', policies);
  }

  // Step 2e: set tracked:false on each inventory item so the storefront never shows
  // "sold out". Printful-managed locations reject manual quantity edits, so setting
  // quantities is unreliable; untracked items are always purchasable regardless of policy.
  // Printful fulfillment relies on order webhooks, not Shopify inventory levels.
  for (const sv of sizeVariants) {
    const invGid = sv.inventoryItem?.id;
    if (!invGid) continue;
    const trackData = await shopifyAdmin(env,
      `mutation UntrackInventoryItem($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }`,
      { id: invGid, input: { tracked: false } }
    );
    const trackErrors = trackData?.data?.inventoryItemUpdate?.userErrors;
    if (trackErrors?.length) {
      console.error(logPrefix, 'inventoryItemUpdate tracked:false errors:', JSON.stringify(trackErrors));
    } else {
      console.log(logPrefix, 'inventory untracked for item', invGid);
    }
  }

  const newVariantId = firstSizeVariantGid.replace('gid://shopify/ProductVariant/', '');
  const newProductId = newProductGid.replace('gid://shopify/Product/', '');

  console.log(logPrefix, 'new product:', newProductId, 'new variant:', newVariantId);

  // Step 3: publish to Online Store. Try GraphQL first, fall back to REST.
  let published = false;
  try {
    const publicationId = await getOnlineStorePublicationId(env);
    console.log(logPrefix, 'Online Store publicationId:', publicationId);
    if (publicationId) {
      const pubData = await shopifyAdmin(env,
        `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            publishable { ... on Product { id status } }
            userErrors { field message }
          }
        }`,
        { id: newProductGid, input: [{ publicationId }] }
      );
      const pubErrors = pubData?.data?.publishablePublish?.userErrors;
      const result    = pubData?.data?.publishablePublish?.publishable;
      console.log(logPrefix, 'publishablePublish result:', JSON.stringify({ result, pubErrors }));
      if (!pubErrors?.length) published = true;
    }
  } catch (err) {
    console.warn(logPrefix, 'publishablePublish error:', err.message);
  }

  if (!published) {
    try {
      console.log(logPrefix, 'falling back to REST publish for product', newProductId);
      const pubRes = await fetch(
        `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products/${newProductId}.json`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': await getShopifyToken(env),
          },
          body: JSON.stringify({ product: { id: Number(newProductId), published: true } }),
        }
      );
      const pubText = await pubRes.text();
      if (!pubRes.ok) {
        console.warn(logPrefix, 'REST publish failed:', pubRes.status, pubText.slice(0, 300));
      } else {
        let pubData;
        try { pubData = JSON.parse(pubText); } catch { pubData = null; }
        console.log(logPrefix, 'REST publish ok — published_at:', pubData?.product?.published_at);
      }
    } catch (err) {
      console.warn(logPrefix, 'REST publish error:', err.message);
    }
  }

  // Step 4: assign to the Printful shipping profile ("US Flat Rate") so checkout
  // uses the correct shipping rate instead of the default "Standard" profile.
  try {
    const profileGid = 'gid://shopify/DeliveryProfile/94986600563';
    const spData = await shopifyAdmin(env,
      `mutation AssignShippingProfile($profileId: ID!, $variantsToAssociate: [ID!]!) {
        deliveryProfileUpdate(id: $profileId, profile: { variantsToAssociate: $variantsToAssociate }) {
          profile { id name }
          userErrors { field message }
        }
      }`,
      {
        profileId: profileGid,
        variantsToAssociate: sizeVariants.map(v => v.id),
      }
    );
    const spErrors = spData?.data?.deliveryProfileUpdate?.userErrors;
    if (spErrors?.length) {
      console.warn(logPrefix, 'shipping profile assign errors:', JSON.stringify(spErrors));
    } else {
      console.log(logPrefix, 'assigned to shipping profile:', spData?.data?.deliveryProfileUpdate?.profile?.name);
    }
  } catch (err) {
    console.warn(logPrefix, 'shipping profile assign error:', err.message);
  }

  return { newProductId, newVariantId, newProductHandle };
}

// Looks up the first variant of a product by handle. Returns { variantId, price, productTitle }.
async function getDefaultVariantForHandle(env, handle) {
  const data = await shopifyAdmin(env,
    `query GetProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        title
        variants(first: 1) { edges { node { id price } } }
      }
    }`,
    { handle }
  );
  const product = data?.data?.productByHandle;
  if (!product) return null;
  const variantNode = product.variants?.edges?.[0]?.node;
  if (!variantNode) return null;
  return {
    variantId:    variantNode.id.replace('gid://shopify/ProductVariant/', ''),
    price:        variantNode.price || '0.00',
    productTitle: product.title || 'Design',
  };
}

async function handleCreateProduct(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!(await checkRateLimit(env, 'RATE_LIMITER_CREATE_PRODUCT', request))) {
    return rateLimitedResponse(headers);
  }

  const { body, error, status } = await readLimitedJson(request, MAX_STATE_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });

  const { designUrl, mockupUrl, checkoutImageUrl, shader, productHandle, values, variantId, extraTags, createProductKey } = body;
  if (!designUrl || !mockupUrl || !variantId) {
    return new Response(JSON.stringify({ error: 'Missing designUrl, mockupUrl, or variantId' }), { status: 400, headers });
  }

  // Idempotency guard: a client-side timeout on this request doesn't mean
  // createShopifyProduct() failed server-side — it can finish creating a real
  // product just after the client gives up waiting. The client sends the same
  // createProductKey on every attempt for a given design (including a manual
  // retry after the "taking longer than expected" message), so a repeat
  // request returns the product already created instead of creating a
  // duplicate.
  const idempotencyKey = typeof createProductKey === 'string' && createProductKey ? createProductKey : null;
  if (idempotencyKey) {
    const cached = await readJson(env, `create-product-keys/${idempotencyKey}.json`);
    if (cached) {
      console.log('[create-product] idempotency hit — returning previously created product:', cached);
      return new Response(JSON.stringify(cached), { status: 200, headers });
    }
  }

  console.log('[create-product] variantId:', variantId, 'shader:', shader);
  const gid = `gid://shopify/ProductVariant/${variantId}`;

  // Fetch original variant price + parent product title. Wrapped in try/catch —
  // unlike the createShopifyProduct() call below, this one used to run unguarded,
  // so a network failure here threw an unhandled rejection out of the Worker's
  // fetch() handler instead of a CORS-headered JSON response, leaving the client
  // with an opaque network error it couldn't distinguish from a CORS failure.
  let variantData;
  try {
    variantData = await shopifyAdmin(env,
      `query GetVariant($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            title
            price
            selectedOptions { name value }
            product { title }
          }
        }
      }`,
      { id: gid }
    );
  } catch (err) {
    console.error('[create-product] variant lookup request failed:', err.message);
    return new Response(JSON.stringify({ error: 'Could not look up variant' }), { status: 502, headers });
  }

  const variant = variantData?.data?.node;
  if (!variant) {
    console.error('[create-product] variant lookup failed:', JSON.stringify(variantData));
    return new Response(JSON.stringify({ error: 'Could not look up variant' }), { status: 502, headers });
  }

  console.log('[create-product] source variant:', { title: variant.title, price: variant.price, product: variant.product?.title });
  const price = variant.price || '0.00';
  const requestedSize = variant.selectedOptions?.find(o => o.name === 'Size')?.value || null;

  let result;
  try {
    result = await createShopifyProduct(env, {
      designUrl,
      mockupUrl,
      checkoutImageUrl,
      shader,
      productTitle: `Custom ${variant.product?.title || 'Design'}`,
      price,
      tags: ['custom-design', `shader-${shader || 'unknown'}`, ...(Array.isArray(extraTags) ? extraTags : [])],
      values,
      sourceProductHandle: productHandle,
      requestedSize,
    });
  } catch (err) {
    // createShopifyProduct() runs ~15 sequential Admin API calls; a rejection can
    // mean Shopify rejected the input (err.status set to 422 at the throw site
    // above, already logged there) or that one of those calls failed at the
    // network/transport level partway through (no err.status — defaults to 502,
    // same classification as the GetVariant lookup failure above, not the
    // client's fault and worth a plain retry). Only log here for the unmarked
    // case — the 422 paths already logged their own detail before throwing.
    if (!err.status) console.error('[create-product] createShopifyProduct failed:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: err.status || 502, headers });
  }

  console.log('[create-product] returning variantId:', result.newVariantId);
  // handle lets the storefront poll /products/{handle}.js for availability
  // before POSTing /cart/add.js (see add-to-cart flow in main-product.liquid)
  const responseBody = { variantId: result.newVariantId, productId: result.newProductId, handle: result.newProductHandle };

  if (idempotencyKey) {
    // Non-fatal: if this write fails, the worst case is a future retry with
    // this key creates a duplicate product instead of hitting the cache —
    // no worse than before this guard existed.
    await writeJson(env, `create-product-keys/${idempotencyKey}.json`, responseBody).catch((err) => {
      console.warn('[create-product] failed to persist idempotency record (non-fatal):', err.message);
    });
  }

  return new Response(JSON.stringify(responseBody), { status: 200, headers });
}

async function handleListDesigns(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId');
  if (!deviceId) {
    return new Response(JSON.stringify([]), { status: 200, headers });
  }
  try {
    const obj = await env.MOCKUP_STAGING.get(`device-designs/${deviceId}.json`);
    if (!obj) return new Response(JSON.stringify([]), { status: 200, headers });
    const designs = JSON.parse(await obj.text());
    designs.forEach(d => rewriteLegacyImgUrls(env, d));
    return new Response(JSON.stringify(designs), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify([]), { status: 200, headers });
  }
}

async function handleDeleteDesign(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id, deviceId, deviceToken } = body;
  if (!id || !deviceId) {
    return new Response(JSON.stringify({ error: 'Missing id or deviceId' }), { status: 400, headers });
  }

  // #544: deviceId is client-supplied — require a signed deviceToken once this
  // deviceId has been claimed, so one device can't wipe another's gallery by
  // guessing/spoofing its UUID. See authorizeDeviceWrite() above.
  const auth = await authorizeDeviceWrite(env, deviceId, deviceToken);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'Invalid or missing deviceToken' }), { status: 401, headers });
  }

  const key = `device-designs/${deviceId}.json`;
  let designs = [];
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (obj) designs = JSON.parse(await obj.text());
  } catch { designs = []; }

  const filtered = designs.filter(function (d) { return d.id !== id; });
  await env.MOCKUP_STAGING.put(key, JSON.stringify(filtered), {
    httpMetadata: { contentType: 'application/json' },
  });

  const responseBody = { ok: true };
  if (auth.newToken) responseBody.deviceToken = auth.newToken;
  return new Response(JSON.stringify(responseBody), { status: 200, headers });
}

// ── Community helpers ────────────────────────────────────────────────────────

// Shopify App Bridge session token claim formats (confirmed against Shopify's own
// reference implementations: @shopify/shopify-api's decode-session-token.ts /
// session-utils.ts, and the shopify_api Ruby gem's jwt_payload.rb):
//   aud  — the app's client ID (API key), exact match.
//   dest — the shop's domain as a full origin, e.g. "https://{shop}.myshopify.com"
//          (session-utils.ts derives `shop` via `dest.replace(/^https:\/\//, '')`).
//   iss  — the shop's admin domain, e.g. "https://{shop}.myshopify.com/admin"
//          (jwt_payload.rb checks `iss.end_with?("/admin")`).
// Shopify's docs additionally require dest/iss to agree on the same shop, and both
// checked against the configured store — enforced below via exact string comparison.
async function verifyShopifySessionToken(token, clientSecret, clientId, storeDomain) {
  if (!token || !clientSecret) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    function b64urlToBytes(s) {
      const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    if (header.alg !== 'HS256') return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(clientSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), data);
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    if (payload.exp < Date.now() / 1000) return false;
    if (Date.now() / 1000 < payload.nbf) return false;

    if (!clientId || payload.aud !== clientId) return false;

    if (!storeDomain) return false;
    if (payload.dest !== `https://${storeDomain}`) return false;
    if (payload.iss !== `https://${storeDomain}/admin`) return false;

    return true;
  } catch {
    return false;
  }
}

// ── Webhook HMAC verification (orders/paid) ─────────────────────────────────
// A different scheme from verifyShopifySessionToken() above: that verifies an
// App Bridge session token — a JWS/JWT (HS256-signed header.payload.signature,
// base64url segments, exp/nbf/aud/dest/iss claims to check). Shopify webhook
// signing has none of that: it's a raw HMAC-SHA256 over the exact request body
// bytes, base64-encoded (standard base64, not base64url), sent whole in the
// X-Shopify-Hmac-Sha256 header, with no claims — just compare digests.
// https://shopify.dev/docs/apps/build/webhooks/subscribe/verify-a-webhook
async function verifyShopifyWebhookHmac(rawBody, headerValue, secret) {
  if (!rawBody || !headerValue || !secret) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    let binary = '';
    new Uint8Array(sigBuf).forEach(b => { binary += String.fromCharCode(b); });
    const computed = btoa(binary);
    return timingSafeEqualStrings(computed, headerValue);
  } catch {
    return false;
  }
}

// Constant-time comparison so a mismatching signature can't be distinguished by
// response-time timing. Both inputs are fixed-length base64 (44 chars for a
// SHA-256 digest) on the success path; short-circuiting on a length mismatch is
// safe since length alone doesn't reveal anything about the digest.
function timingSafeEqualStrings(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth === `Bearer ${env.ADMIN_TOKEN}`) return true;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return verifyShopifySessionToken(
    token,
    env.SHOPIFY_APP_CLIENT_SECRET,
    env.SHOPIFY_APP_CLIENT_ID,
    env.SHOPIFY_STORE_DOMAIN
  );
}

async function readJson(env, key) {
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (!obj) return null;
    return JSON.parse(await obj.text());
  } catch { return null; }
}

async function writeJson(env, key, data) {
  await env.MOCKUP_STAGING.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
}

// ── Device tokens (HMAC-signed deviceId) ─────────────────────────────────────
// `deviceId` (assets/recent-designs.js getDeviceId()) is a client-generated
// UUID stored in localStorage — pure client state the worker never used to
// verify. Because it's used as an R2 key namespace (device-designs/{id}.json)
// and a like-dedup key (community/likes/{submissionId}/{id}), a spoofed
// deviceId let anyone wipe another device's gallery or inflate/deflate a
// community submission's like count (#544).
//
// Fix: the first time a deviceId is used to save something (saveDesignEntry,
// called from handleGenerateMockup / handleSavePreview), the worker mints an
// HMAC-SHA256(deviceId) token and persists a "claim" record for that deviceId
// at device-tokens/{deviceId}.json. From then on, writes keyed on that
// deviceId (handleDeleteDesign, handleCommunityLike) require a valid
// deviceToken. DeviceIds that were already in use before this fix (no claim
// record yet) get a one-time migration grace period: the first
// delete/like request succeeds without a token, and mints+persists a claim
// right then so the deviceId is locked to signature verification afterward.

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// Returns a base64url HMAC-SHA256(deviceId) token, or null if DEVICE_ID_SECRET
// isn't configured (e.g. not yet set via `wrangler secret put` — fail open so
// deploys before the secret is set don't hard-break these endpoints).
async function signDeviceId(env, deviceId) {
  if (!deviceId || !env.DEVICE_ID_SECRET) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.DEVICE_ID_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(deviceId));
    return bytesToBase64Url(new Uint8Array(sig));
  } catch {
    return null;
  }
}

// Constant-time verification (crypto.subtle.verify, not === on strings) that
// `token` is a valid HMAC-SHA256(deviceId) — same pattern as
// verifyShopifySessionToken above.
async function verifyDeviceToken(env, deviceId, token) {
  if (!deviceId || !token || !env.DEVICE_ID_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.DEVICE_ID_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(token), new TextEncoder().encode(deviceId));
  } catch {
    return false;
  }
}

async function getDeviceClaim(env, deviceId) {
  return readJson(env, `device-tokens/${deviceId}.json`);
}

// Mints and persists a claim record for deviceId. Best-effort: returns null
// (and writes nothing) if signing isn't available, e.g. DEVICE_ID_SECRET
// hasn't been configured yet.
async function claimDeviceId(env, deviceId) {
  const token = await signDeviceId(env, deviceId);
  if (!token) return null;
  await writeJson(env, `device-tokens/${deviceId}.json`, { token, claimedAt: Math.floor(Date.now() / 1000) });
  return token;
}

// Authorization gate for /delete-design and /community/like. Returns
// { ok: true, newToken } — newToken is non-null only when a fresh claim was
// just minted and should be handed back to the client — or { ok: false } if
// an existing claim's token wasn't supplied or didn't verify.
async function authorizeDeviceWrite(env, deviceId, deviceToken) {
  const claim = await getDeviceClaim(env, deviceId);
  if (!claim) {
    // Never-claimed deviceId: legacy pre-fix device (or DEVICE_ID_SECRET not
    // yet configured). Allow this one request through and upgrade it to a
    // claimed deviceId going forward.
    return { ok: true, newToken: await claimDeviceId(env, deviceId) };
  }
  if (!(await verifyDeviceToken(env, deviceId, deviceToken))) {
    return { ok: false, newToken: null };
  }
  return { ok: true, newToken: null };
}

// ── Order fulfillment (orders/paid webhook) ─────────────────────────────────
// Automates what the merchant currently does by hand: copy the `_design_url`
// cart line-item property out of a paid order and upload it to Printful.
//
// Custom-design SKUs are distinguished from normal catalog SKUs by prefix (see
// createShopifyProduct()'s skuPrefix + inventoryItemUpdate call above):
// `CUSTOM-{timestamp}-{size}` for direct custom-design purchases,
// `COMMUNITY-{timestamp}-{size}` for community-gallery-approved designs turned
// into products. Both are handled identically here — the design_url metafield
// lives on the generated product either way.
const CUSTOM_SKU_RE = /^(CUSTOM|COMMUNITY)-(\d+)-(.+)$/;

// Parses a size-suffixed custom/community SKU. Returns null for a normal
// catalog SKU (or anything else that doesn't match), so callers can filter an
// order's line items down to just the custom-design ones.
export function parseCustomSku(sku) {
  if (typeof sku !== 'string') return null;
  const m = CUSTOM_SKU_RE.exec(sku);
  if (!m) return null;
  return { prefix: m[1], timestamp: m[2], size: m[3] };
}

// Classifies an order line item as 'custom' (SKU-prefixed, print file comes
// from the product's custom.design_url metafield), 'inhouse' (a regular,
// merchant-configured product identified by a printful.variant_id *variant*
// metafield — see docs/in-house-products.md for how the merchant sets this),
// 'inhouse-invalid' (that metafield is present but not a usable id, which
// should fail loudly rather than silently fall through to 'unrecognized'),
// or 'unrecognized' (an ordinary catalog item with neither signal — ignored,
// same as today). SKU match is checked first so a line item can never
// satisfy both.
export function classifyLineItem(li) {
  const skuInfo = parseCustomSku(li.sku);
  if (skuInfo) return { type: 'custom', skuInfo };

  const raw = li.variant?.metafield?.value;
  if (raw == null) return { type: 'unrecognized' };

  // Whitespace-only is treated the same as empty (metafield never set) rather
  // than as a broken value — an absent signal, not a merchant mistake.
  const trimmed = String(raw).trim();
  if (trimmed === '') return { type: 'unrecognized' };

  // Strict digits-only, deliberately not parseInt(): parseInt stops at the
  // first non-digit and returns what it got, so '4917503 (Black / M)' would
  // pass as 4917503 and — worse — '1e5' would pass as *1*, silently fulfilling
  // against Printful sync variant 1. The whole point of 'inhouse-invalid' is to
  // refuse the order loudly rather than fulfill the wrong garment, so anything
  // that isn't unambiguously an id is rejected. (Shopify's Integer metafield
  // type makes this unlikely from the admin UI, but the type isn't enforced for
  // values set via the API or a CSV import.)
  if (!/^\d+$/.test(trimmed)) return { type: 'inhouse-invalid', raw };

  const printfulVariantId = Number(trimmed);
  if (!Number.isSafeInteger(printfulVariantId) || printfulVariantId <= 0) {
    return { type: 'inhouse-invalid', raw };
  }
  return { type: 'inhouse', printfulVariantId };
}

// A pending claim older than this is assumed to belong to a delivery whose
// isolate crashed or was evicted before it could write a completed record or
// clean up after itself — sized generously vs. this handler's real runtime
// (an Admin GraphQL round trip plus a Printful order-create call), so a
// still-active delivery should never actually cross it.
const PRINTFUL_ORDER_CLAIM_STALE_MS = 2 * 60 * 1000;

// How many line items the order lookup fetches. This handler does not
// paginate; an order exceeding this is refused outright rather than
// partially fulfilled (see the hasNextPage check in handleOrderPaidWebhook).
const ORDER_LINE_ITEM_PAGE_SIZE = 100;

// Cap on the webhook body. This endpoint is public and unauthenticated until
// the HMAC check passes, and that check has to run over the whole body — so
// without a cap anyone can make the worker buffer and HMAC an arbitrarily
// large payload for free. An orders/paid payload is a few tens of KB even
// with a full page of line items; 256 KB is generous headroom.
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

// Where a refusal that needs a human is recorded. The 422 paths below release
// the idempotency claim so a redelivery can succeed once the underlying data
// is fixed — but if nobody fixes it, Shopify eventually stops redelivering and
// the order is simply never fulfilled, with nothing but a log line to show for
// it. That's a regression against the manual workflow this replaces, where a
// human was in the loop and would notice. These records are the durable trace:
// one object per stuck order, listable from R2 (or the admin UI) to answer
// "did anything paid fail to reach Printful?".
//
// Written only for refusals whose cause is the order's own data and that will
// not clear on their own. Deliberately NOT written for: non-PAID orders (a
// PENDING/AUTHORIZED order may legitimately become PAID and get redelivered),
// or 502s from Shopify/Printful (transient upstream failures that retry into
// success). The key is overwritten on each attempt, so a fixed-then-refused-
// again order doesn't accumulate objects.
async function recordFulfillmentFailure(env, shopifyOrderId, detail) {
  await writeJson(env, `printful-orders-failed/${shopifyOrderId}.json`, {
    shopifyOrderId,
    failedAt: Date.now(),
    ...detail,
  }).catch((err) => {
    console.error('[order-paid] failed to persist failure record for Shopify order', shopifyOrderId, ':', err.message);
  });
}

// Builds the diagnostic message for a rejected Printful order-create. Two
// things this does that `printfulJson.result || JSON.stringify(printfulJson)`
// did not:
//
//  1. Handles a non-string `result`. Printful usually puts the error text
//     there, but not always — and `new Error(someObject)` stringifies to
//     "[object Object]", discarding the only diagnostic available on the one
//     branch that actually needs one (the success path deliberately logs
//     almost nothing).
//  2. Strips `recipient` before falling back to serializing the whole body.
//     This message is both console.error'd and returned in the 502 response,
//     and Printful echoes the full recipient block — name, street address,
//     phone, email — back on some responses. Dumping it here would put the
//     same customer data into Cloudflare's logs that the success path was
//     changed to stop writing.
function formatPrintfulError(json) {
  if (typeof json?.result === 'string' && json.result) return json.result;
  if (typeof json?.error === 'string' && json.error) return json.error;
  if (typeof json?.error?.message === 'string' && json.error.message) return json.error.message;

  const redacted = { ...json };
  if (redacted.recipient) redacted.recipient = '[redacted]';
  if (redacted.result && typeof redacted.result === 'object' && redacted.result.recipient) {
    redacted.result = { ...redacted.result, recipient: '[redacted]' };
  }
  return JSON.stringify(redacted);
}

async function handleOrderPaidWebhook(request, env, ctx) {
  const headers = { 'Content-Type': 'application/json' };
  // No CORS headers: Shopify calls this server-to-server, not from a browser —
  // this endpoint is authenticated via HMAC (below), not Origin.

  // Reject an oversized body before reading it where the sender declared its
  // length. Content-Length is advisory (it can be absent on a chunked request,
  // or simply lie), so the actual byte count is re-checked after the read —
  // this just avoids buffering the obvious cases at all.
  const declaredLength = parseInt(request.headers.get('Content-Length'), 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    console.warn('[order-paid] rejected: body larger than', MAX_WEBHOOK_BODY_BYTES, 'bytes (Content-Length:', declaredLength + ')');
    return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers });
  }

  // HMAC verification must run over the exact raw body bytes, so read text()
  // (not json()) first — a Request body stream can only be consumed once, and
  // parsing to JSON and re-stringifying it would not reliably reproduce the
  // same bytes Shopify signed (key order, whitespace, unicode escaping).
  const rawBody = await request.text();
  // Byte length, not string length: a body of multi-byte characters is bigger
  // on the wire than its character count suggests.
  const actualLength = new TextEncoder().encode(rawBody).length;
  if (actualLength > MAX_WEBHOOK_BODY_BYTES) {
    console.warn('[order-paid] rejected: body larger than', MAX_WEBHOOK_BODY_BYTES, 'bytes (actual:', actualLength + ')');
    return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers });
  }
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256');
  const validHmac = await verifyShopifyWebhookHmac(rawBody, hmacHeader, env.SHOPIFY_WEBHOOK_SECRET);
  if (!validHmac) {
    console.warn('[order-paid] rejected: missing/invalid HMAC signature');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const shopifyOrderId = payload?.id;
  if (!shopifyOrderId) {
    return new Response(JSON.stringify({ error: 'Missing order id' }), { status: 400, headers });
  }

  // Idempotency: Shopify redelivers webhooks on timeouts/non-2xx responses, and
  // orders/paid can in principle fire more than once for the same order —
  // including two deliveries landing genuinely concurrently. A naive
  // read-then-write check (read "no existing record", do all the work, write
  // the record at the end) has a TOCTOU race: both deliveries can read "not
  // yet processed" before either has written anything, and both go on to
  // submit a Printful order for the same Shopify order.
  //
  // Claim the key up front with an R2 conditional write: `If-None-Match: *`,
  // so the put only succeeds if the key doesn't exist yet. This is the only
  // compare-and-swap in this worker — the other multi-writer key,
  // community/list.json, is still a plain read-modify-write (see
  // handleCommunitySubmit) and has the race described above.
  // The value starts as a `pending` placeholder and gets overwritten with the
  // completed record (containing printfulOrderId) once the Printful order is
  // actually created. Every exit path that isn't full success releases the
  // claim (best-effort) so a future redelivery isn't permanently blocked by
  // an attempt that didn't finish.
  const idempotencyKey = `printful-orders/${shopifyOrderId}.json`;

  // Identifies *this* delivery's claim. Without it, releasing was a bare
  // delete of whatever happened to be at the key — which is not necessarily
  // ours. Consider: this delivery stalls past PRINTFUL_ORDER_CLAIM_STALE_MS, a
  // second delivery correctly reclaims the stale claim and submits the order,
  // and then our Printful call fails — which it reliably does, because the
  // second delivery already consumed `external_id: shopify-{id}` and Printful
  // rejects the duplicate. Our 502 path would then delete the *other*
  // delivery's completed record, leaving a submitted order marked neither
  // completed nor failed: every later redelivery resubmits, Printful rejects
  // the duplicate again, and it never converges.
  const claimId = crypto.randomUUID();
  const claimValue = () => JSON.stringify({ status: 'pending', claimedAt: Date.now(), claimId });

  // Only ever deletes a claim this delivery still owns. A record that has been
  // completed, or re-claimed by someone else, is left alone.
  //
  // The read-then-delete isn't atomic (R2 delete takes no conditional), so a
  // reclaim landing in that window can still be stomped — but reaching it
  // requires our own claim to have already gone stale, which is the same
  // narrow window the staleness timeout already tolerates.
  const releaseClaim = async () => {
    try {
      const cur = await env.MOCKUP_STAGING.get(idempotencyKey);
      if (!cur) return;
      let rec = null;
      try { rec = JSON.parse(await cur.text()); } catch { rec = null; }
      if (rec?.status === 'pending' && rec.claimId === claimId) {
        await env.MOCKUP_STAGING.delete(idempotencyKey);
        return;
      }
      console.warn('[order-paid] not releasing idempotency claim for Shopify order', shopifyOrderId, '— it is no longer ours (status:', rec?.status + ')');
    } catch (err) {
      console.error('[order-paid] failed to release idempotency claim for Shopify order', shopifyOrderId, ':', err.message);
    }
  };

  const claimResult = await env.MOCKUP_STAGING.put(
    idempotencyKey,
    claimValue(),
    { httpMetadata: { contentType: 'application/json' }, onlyIf: new Headers({ 'If-None-Match': '*' }) }
  );

  if (!claimResult) {
    // Another delivery already claimed (or completed) this order — read
    // whatever's there now to decide how to respond.
    const existingObj = await env.MOCKUP_STAGING.get(idempotencyKey);
    let existing = null;
    if (existingObj) {
      try { existing = JSON.parse(await existingObj.text()); } catch { existing = null; }
    }

    // Completion is marked by an explicit `status`, not by the presence of
    // printfulOrderId — see the record written at the end of this handler for
    // why. `printfulOrderId` is still accepted as a completion signal so that
    // any record written before that marker existed is still honoured.
    if (existing?.status === 'completed' || existing?.printfulOrderId) {
      console.log('[order-paid] idempotency hit for Shopify order', shopifyOrderId, '— Printful order already created:', existing.printfulOrderId);
      return new Response(JSON.stringify({ ok: true, alreadyProcessed: true, printfulOrderId: existing.printfulOrderId }), { status: 200, headers });
    }

    // The key can also be *gone* by the time we read it: the delivery that
    // beat us to the claim released it (every exit path that isn't full
    // success does) in the window between our put failing and this get. That
    // isn't a stale claim — there's no record and no etag to condition a
    // reclaim on — so retry the same If-None-Match claim instead. Whoever
    // wins that retry owns the key; the loser returns 409 and lets Shopify
    // redeliver.
    const reclaimCondition = existingObj
      ? { etagMatches: existingObj.etag }
      : new Headers({ 'If-None-Match': '*' });

    if (existingObj) {
      const claimedAt = existing?.claimedAt;
      const stale = typeof claimedAt !== 'number' || (Date.now() - claimedAt) > PRINTFUL_ORDER_CLAIM_STALE_MS;

      if (!stale) {
        // A delivery is genuinely in-flight right now — don't race it. Shopify
        // redelivers non-2xx responses on its own schedule; by the time it
        // does, the in-flight delivery will have finished and the branch above
        // will short-circuit normally.
        console.log('[order-paid] claim already in flight for Shopify order', shopifyOrderId, '— returning 409 for redelivery');
        return new Response(JSON.stringify({ ok: false, retrying: true }), { status: 409, headers });
      }
      // Stale placeholder — the delivery that claimed it never finished.
      // Reclaim via a conditional put tied to its etag so we don't stomp a
      // fresh claim that appears between our get() and this put().
    }

    const reclaimResult = await env.MOCKUP_STAGING.put(
      idempotencyKey,
      claimValue(),
      { httpMetadata: { contentType: 'application/json' }, onlyIf: reclaimCondition }
    );
    if (!reclaimResult) {
      console.log('[order-paid] lost the race reclaiming the idempotency key for Shopify order', shopifyOrderId, '— returning 409 for redelivery');
      return new Response(JSON.stringify({ ok: false, retrying: true }), { status: 409, headers });
    }
    // Fall through — we now own the claim.
  }

  // Re-fetch the order via the Admin API rather than trusting the webhook
  // payload's own shape: design_url lives on the *product* (a metafield), not
  // the order, so it isn't in the payload at all regardless of shape; GraphQL
  // gets order + line items + the metafield in one consistent round trip.
  let orderData;
  try {
    orderData = await shopifyAdmin(env,
      `query GetOrderForFulfillment($id: ID!) {
        order(id: $id) {
          id
          name
          email
          displayFinancialStatus
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCode
            phone
          }
          customer { firstName lastName email }
          lineItems(first: ${ORDER_LINE_ITEM_PAGE_SIZE}) {
            pageInfo { hasNextPage }
            edges {
              node {
                sku
                quantity
                title
                product {
                  id
                  metafield(namespace: "custom", key: "design_url") { value }
                }
                variant {
                  id
                  metafield(namespace: "printful", key: "variant_id") { value }
                }
              }
            }
          }
        }
      }`,
      { id: `gid://shopify/Order/${shopifyOrderId}` }
    );
  } catch (err) {
    console.error('[order-paid] order lookup request failed:', err.message);
    await releaseClaim();
    return new Response(JSON.stringify({ error: 'Could not look up order' }), { status: 502, headers });
  }

  const order = orderData?.data?.order;
  if (!order) {
    console.error('[order-paid] order lookup failed:', JSON.stringify(orderData));
    await releaseClaim();
    return new Response(JSON.stringify({ error: 'Could not look up order' }), { status: 502, headers });
  }

  // The handler is registered on the orders/paid topic, but don't just trust
  // that — verify the order's actual payment state before submitting
  // anything to Printful. Don't persist a completed record here: an order in
  // a non-PAID state now (e.g. PENDING, AUTHORIZED) may legitimately become
  // PAID later and get redelivered, and it should be free to proceed then.
  if (order.displayFinancialStatus !== 'PAID') {
    console.warn('[order-paid] order', order.name, 'is not paid (financialStatus=' + order.displayFinancialStatus + ') — skipping Printful submission');
    await releaseClaim();
    return new Response(JSON.stringify({ error: 'Order is not paid', financialStatus: order.displayFinancialStatus }), { status: 422, headers });
  }

  // The line-item query fetches a single page. If the order has more, the
  // items beyond it were never seen here — classifying only what came back
  // would submit a subset and then write the completed idempotency record,
  // permanently under-fulfilling a paid order: exactly the failure the
  // all-or-nothing check below exists to prevent, just triggered by item
  // count instead of bad item data. Refuse the whole order instead so it
  // stays recoverable (claim released, redelivery re-runs it) once someone
  // pages through it manually or this handler learns to paginate.
  if (order.lineItems?.pageInfo?.hasNextPage) {
    console.error('[order-paid] order', order.name, 'has more than', ORDER_LINE_ITEM_PAGE_SIZE, 'line items — refusing rather than fulfilling only the first page');
    await releaseClaim();
    await recordFulfillmentFailure(env, shopifyOrderId, {
      shopifyOrderName: order.name,
      reason: 'too many line items',
      detail: `order has more than ${ORDER_LINE_ITEM_PAGE_SIZE} line items — needs manual fulfillment in Printful`,
    });
    return new Response(JSON.stringify({
      error: `Order has more than ${ORDER_LINE_ITEM_PAGE_SIZE} line items — needs manual fulfillment`,
      lineItemLimit: ORDER_LINE_ITEM_PAGE_SIZE,
    }), { status: 422, headers });
  }

  const lineItems = (order.lineItems?.edges || []).map(e => e.node);
  const classified = lineItems.map(li => ({ ...li, cls: classifyLineItem(li) }));
  const relevant = classified.filter(li => li.cls.type !== 'unrecognized');

  // Acceptance criteria: orders with nothing Printful-relevant (no custom/
  // community SKU and no printful.variant_id metafield on any line item) are
  // ignored entirely.
  if (!relevant.length) {
    console.log('[order-paid] no custom-design or in-house line items on order', order.name, '— ignoring');
    await releaseClaim();
    return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers });
  }

  // The size -> catalog-variant lookup only matters for custom/community
  // items — in-house items carry their own resolved Printful sync-variant id
  // directly via the printful.variant_id metafield, so skip the extra round
  // trip for orders that don't need it.
  const needsVariantMap = relevant.some(li => li.cls.type === 'custom');
  const variantMap = needsVariantMap ? await getPrintfulVariantMap(env) : null;
  if (needsVariantMap && !variantMap) {
    console.error('[order-paid] could not load Printful size -> variant map for order', order.name);
    await releaseClaim();
    return new Response(JSON.stringify({ error: 'Printful catalog lookup failed' }), { status: 502, headers });
  }

  const printfulItems = [];
  const skippedItems = [];
  for (const li of relevant) {
    if (li.cls.type === 'custom') {
      const designUrl = li.product?.metafield?.value;
      const printfulVariantId = variantMap[li.cls.skuInfo.size];
      if (!designUrl) {
        console.error('[order-paid] line item missing design_url metafield, skipping:', li.sku, li.product?.id);
        skippedItems.push({ sku: li.sku, reason: 'missing design_url metafield' });
        continue;
      }
      if (!printfulVariantId) {
        console.error('[order-paid] no Printful variant for size, skipping:', li.cls.skuInfo.size, li.sku);
        skippedItems.push({ sku: li.sku, reason: `no Printful variant for size ${li.cls.skuInfo.size}` });
        continue;
      }
      printfulItems.push({
        variant_id: printfulVariantId,
        quantity: li.quantity || 1,
        // Same files/position shape as the mockup-task call in
        // handleGenerateMockup above — Printful's order file-attachment shape
        // mirrors the mockup-generator one.
        files: [{
          placement: 'front',
          image_url: designUrl,
          position: {
            area_width:  PRINT_WIDTH,
            area_height: PRINT_HEIGHT,
            width:       PRINT_WIDTH,
            height:      PRINT_HEIGHT,
            top:  0,
            left: 0,
          },
        }],
      });
    } else if (li.cls.type === 'inhouse') {
      // No files[]: printful.variant_id points at a Printful *sync* variant
      // (set up via the native catalog-sync app), which already has its
      // print file attached server-side — unlike custom/community items,
      // there's no per-order design upload to attach here.
      printfulItems.push({
        sync_variant_id: li.cls.printfulVariantId,
        quantity: li.quantity || 1,
      });
    } else if (li.cls.type === 'inhouse-invalid') {
      console.error('[order-paid] invalid printful.variant_id metafield value, skipping:', li.cls.raw, li.sku);
      skippedItems.push({ sku: li.sku, reason: `invalid printful.variant_id metafield value: ${li.cls.raw}` });
    }
  }

  // All-or-nothing: if *any* Printful-relevant line item had a data problem
  // (missing/invalid metafield, unmapped size), submit nothing.
  //
  // Submitting just the valid subset would silently under-fulfill a paid
  // order — the customer paid for two shirts and receives one — and because
  // the success path writes the completed idempotency record, that shortfall
  // would be permanent: every redelivery afterwards short-circuits on
  // `alreadyProcessed` and the missing item is never revisited. The only
  // trace would be a `skipped` field in an R2 object nobody reads.
  //
  // Refusing the whole order instead keeps it recoverable: the claim is
  // released, so once the merchant fixes the offending product's metafield,
  // Shopify's own redelivery (or a manual replay) fulfills the order
  // completely. 422 rather than 502 because the upstreams are healthy — it's
  // the order's own data that needs a human.
  if (skippedItems.length || !printfulItems.length) {
    console.error('[order-paid] refusing to partially fulfill order', order.name, '— unusable line items:', JSON.stringify(skippedItems));
    await releaseClaim();
    await recordFulfillmentFailure(env, shopifyOrderId, {
      shopifyOrderName: order.name,
      reason: 'unusable line items',
      detail: 'refused rather than partially fulfilling — fix the offending product/variant metafield, then replay the webhook',
      skipped: skippedItems,
    });
    return new Response(JSON.stringify({ error: 'No valid line items', skipped: skippedItems }), { status: 422, headers });
  }

  const shipping = order.shippingAddress;
  if (!shipping) {
    console.error('[order-paid] order has Printful-relevant line items but no shipping address:', order.name);
    await releaseClaim();
    await recordFulfillmentFailure(env, shopifyOrderId, {
      shopifyOrderName: order.name,
      reason: 'missing shipping address',
      detail: 'order has Printful-relevant line items but no shipping address to send them to',
    });
    return new Response(JSON.stringify({ error: 'Missing shipping address' }), { status: 422, headers });
  }

  const recipientName = [shipping.firstName, shipping.lastName].filter(Boolean).join(' ')
    || [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ')
    || 'Customer';

  const printfulOrderBody = {
    external_id: `shopify-${shopifyOrderId}`,
    recipient: {
      name:         recipientName,
      address1:     shipping.address1 || '',
      address2:     shipping.address2 || '',
      city:         shipping.city || '',
      state_code:   shipping.provinceCode || shipping.province || '',
      country_code: shipping.countryCode || '',
      zip:          shipping.zip || '',
      phone:        shipping.phone || '',
      email:        order.email || order.customer?.email || '',
    },
    items: printfulItems,
    // Draft, not auto-confirmed — the merchant reviews it in the Printful
    // dashboard before it enters production. Per the ticket: don't auto-confirm
    // orders yet.
    confirm: false,
  };

  let printfulJson;
  try {
    const printfulRes = await fetch(`${PRINTFUL_API}/orders`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(printfulOrderBody),
    });
    printfulJson = await printfulRes.json();
    if (printfulJson.code !== 200) {
      // Only the failure branch surfaces the response body, and only via the
      // thrown message — see below for why the success response must not be
      // dumped, and formatPrintfulError() for what gets stripped out of it.
      throw new Error(formatPrintfulError(printfulJson));
    }
    // Log the id and status code, never the whole response: Printful echoes the
    // full `recipient` block back on success (name, street address, phone,
    // email), so dumping it here would write a customer's home address into
    // Cloudflare's logs on every single order.
    console.log('[order-paid] Printful order-create ok (code', printfulJson.code + ', id', printfulJson.result?.id + ', status', printfulJson.result?.status + ')');
  } catch (err) {
    console.error('[order-paid] Printful order creation failed for order', order.name, ':', err.message);
    await releaseClaim();
    return new Response(JSON.stringify({ error: 'Printful order creation failed: ' + err.message }), { status: 502, headers });
  }

  const printfulOrderId = printfulJson.result?.id;
  if (printfulOrderId == null) {
    // Printful accepted the order (code 200) but didn't hand back an id.
    // Nothing to do about it here — the order *was* created, so we must still
    // record completion or a redelivery would submit it twice — but flag it,
    // since the merchant has no id to look the draft up by.
    console.error('[order-paid] Printful accepted order', order.name, 'but returned no result.id — recording completion anyway to prevent a duplicate submission');
  }
  const record = {
    // Explicit completion marker. Do NOT infer this from printfulOrderId
    // being present: when Printful returns no result.id (above), that key is
    // dropped by JSON.stringify, and a record indistinguishable from a claim
    // with no `claimedAt` is treated as stale by the reclaim path — which
    // would resubmit the order to Printful a second time.
    status: 'completed',
    shopifyOrderId,
    shopifyOrderName: order.name,
    printfulOrderId,
    createdAt: Date.now(),
    skus: relevant.map(li => li.sku),
    // Breakdown by classification, so a merchant inspecting this record (or
    // R2 directly) can tell what kind of order this was without having to
    // cross-reference SKUs against Printful.
    lineItemTypes: relevant.reduce((acc, li) => {
      acc[li.cls.type] = (acc[li.cls.type] || 0) + 1;
      return acc;
    }, {}),
  };
  // Overwrite the pending claim with the completed record. This is what a
  // future redelivery's claim attempt (above) finds and short-circuits on.
  //
  // Deliberately unconditional, even though a stale-claim reclaim means we
  // can't be certain we still hold the key. The two failure directions are not
  // symmetric: writing over someone else's record costs at worst a confusing
  // record for an order that did reach Printful, whereas *not* writing loses
  // the only marker that this order was already submitted — and every later
  // redelivery would then resubmit it. A duplicate Printful order is the more
  // expensive mistake, so this write always lands.
  await writeJson(env, idempotencyKey, record).catch((err) => {
    console.error('[order-paid] failed to persist idempotency record for order', order.name, '— a redelivery could create a duplicate Printful order:', err.message);
  });

  // Clear any failure record from an earlier refused attempt: this order just
  // fulfilled completely, so leaving one behind would keep a resolved problem
  // sitting in the "needs a human" list forever. No-op when there isn't one.
  await env.MOCKUP_STAGING.delete(`printful-orders-failed/${shopifyOrderId}.json`).catch((err) => {
    console.error('[order-paid] failed to clear failure record for order', order.name, ':', err.message);
  });

  console.log('[order-paid] created Printful draft order', printfulOrderId, 'for Shopify order', order.name);
  // No `skipped` on this path: reaching here means nothing was skipped.
  return new Response(JSON.stringify({ ok: true, printfulOrderId }), { status: 200, headers });
}

// ── Community handlers ───────────────────────────────────────────────────────

async function handleCommunitySubmit(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const { body, error, status } = await readLimitedJson(request, MAX_STATE_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });

  const { shader, productHandle, designUrl, mockupUrl, checkoutImageUrl, values, creatorName, creatorEmail } = body;
  if (!mockupUrl || !creatorName || !shader) {
    return new Response(JSON.stringify({ error: 'Missing required fields: mockupUrl, creatorName, shader' }), { status: 400, headers });
  }
  if (values != null && !isPlainObject(values)) {
    return new Response(JSON.stringify({ error: 'Invalid values' }), { status: 400, headers });
  }

  const id = crypto.randomUUID();
  const submission = {
    id,
    shader,
    productHandle:    productHandle || '',
    designUrl:        designUrl || '',
    mockupUrl,
    checkoutImageUrl: checkoutImageUrl || '',
    values:           values || {},
    timestamp:        Math.floor(Date.now() / 1000),
    status:           'pending',
    creatorName,
    creatorEmail:     creatorEmail || '',
    likes:            0,
  };

  await writeJson(env, `community/submissions/${id}.json`, submission);

  const list = (await readJson(env, 'community/list.json')) || [];
  list.unshift(id);
  await writeJson(env, 'community/list.json', list);

  return new Response(JSON.stringify({ id }), { status: 201, headers });
}

async function handleCommunityList(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const url = new URL(request.url);
  const shaderFilter        = url.searchParams.get('shader');
  const productHandleFilter = url.searchParams.get('productHandle');

  const list = (await readJson(env, 'community/list.json')) || [];
  const ids = list.slice(0, 100);

  const submissions = (
    await Promise.all(ids.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === 'approved' && s.shopifyProductHandle);

  const filtered = submissions.filter(s => {
    if (shaderFilter        && s.shader        !== shaderFilter)        return false;
    if (productHandleFilter && s.productHandle !== productHandleFilter) return false;
    return true;
  });

  const sanitized = filtered.map(({ creatorEmail: _omit, ...rest }) => rewriteLegacyImgUrls(env, rest));
  return new Response(JSON.stringify(sanitized), { status: 200, headers });
}

async function handleCommunityLike(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id, deviceId, deviceToken } = body;
  if (!id || !deviceId) {
    return new Response(JSON.stringify({ error: 'Missing id or deviceId' }), { status: 400, headers });
  }

  // #544: deviceId is client-supplied — require a signed deviceToken once this
  // deviceId has been claimed, so one device can't inflate/deflate another
  // submission's like count by spoofing deviceIds. See authorizeDeviceWrite().
  const auth = await authorizeDeviceWrite(env, deviceId, deviceToken);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'Invalid or missing deviceToken' }), { status: 401, headers });
  }

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) {
    return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers });
  }

  const likeKey = `community/likes/${id}/${deviceId}`;
  const existing = await env.MOCKUP_STAGING.get(likeKey);
  let liked;

  if (!existing) {
    submission.likes = (submission.likes || 0) + 1;
    await env.MOCKUP_STAGING.put(likeKey, '1');
    liked = true;
  } else {
    submission.likes = Math.max(0, (submission.likes || 0) - 1);
    await env.MOCKUP_STAGING.delete(likeKey);
    liked = false;
  }

  await writeJson(env, `community/submissions/${id}.json`, submission);
  const responseBody = { likes: submission.likes, liked };
  if (auth.newToken) responseBody.deviceToken = auth.newToken;
  return new Response(JSON.stringify(responseBody), { status: 200, headers });
}

async function handleCommunityPending(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') || 'pending';

  const list = (await readJson(env, 'community/list.json')) || [];
  const submissions = (
    await Promise.all(list.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === statusFilter);
  submissions.forEach(s => rewriteLegacyImgUrls(env, s));

  return new Response(JSON.stringify(submissions), { status: 200, headers });
}

async function handleCommunityModerate(request, env, origin, newStatus) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers });
  }

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) {
    return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers });
  }

  submission.status = newStatus;

  if (newStatus === 'approved' && submission.productHandle) {
    try {
      const sourceVariant = await getDefaultVariantForHandle(env, submission.productHandle);
      if (sourceVariant) {
        const result = await createShopifyProduct(env, {
          designUrl:           submission.designUrl,
          mockupUrl:           submission.mockupUrl,
          checkoutImageUrl:    submission.checkoutImageUrl || '',
          shader:              submission.shader,
          productTitle:        `Community ${sourceVariant.productTitle.replace(/^Community\s+/, '')}`,
          price:               sourceVariant.price,
          tags:                ['community-design', `shader-${submission.shader || 'unknown'}`],
          creatorName:         submission.creatorName,
          values:              submission.values,
          submissionId:        id,
          sourceProductHandle: submission.productHandle,
        });
        submission.shopifyProductId     = result.newProductId;
        submission.shopifyVariantId     = result.newVariantId;
        submission.shopifyProductHandle = result.newProductHandle;
        console.log('[community/approve] created product', result.newProductId, 'handle', result.newProductHandle, 'for submission', id);
      } else {
        console.warn('[community/approve] could not resolve product handle:', submission.productHandle);
      }
    } catch (err) {
      console.error('[community/approve] product creation failed (non-fatal):', err.message);
    }
  }

  await writeJson(env, `community/submissions/${id}.json`, submission);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Community design by ID ───────────────────────────────────────────────────

async function handleCommunityDesign(request, env, origin, id) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!id) return new Response('Not found', { status: 404, headers });
  const sub = await readJson(env, `community/submissions/${id}.json`);
  if (!sub || sub.status !== 'approved') return new Response('Not found', { status: 404, headers });
  const { creatorEmail: _omit, ...sanitized } = sub;
  return new Response(JSON.stringify(rewriteLegacyImgUrls(env, sanitized)), { status: 200, headers });
}

// ── Reviews ──────────────────────────────────────────────────────────────────
// Metafield-based reviews (see issue #548). Same shape as the community-design
// flow above: an anonymous customer POSTs a submission, it's held as `pending`
// in R2, and an admin approves/rejects it. Reviews additionally get synced —
// on every approve/reject — onto the product's own metafields (custom.review_average,
// custom.review_count, custom.review_entries) so the storefront (product page,
// product card, and eventually Product JSON-LD) can render them with a plain
// Liquid read instead of a live API call at page-render time.
//
// A Judge.me/Loox-style app was the "usual default" per the ticket, but
// installing a third-party app requires interactive Partner/Admin access this
// automated workflow doesn't have — see the PR description for that tradeoff.

const REVIEW_NAME_MAX  = 80;
const REVIEW_BODY_MAX  = 2000;
const REVIEW_HANDLE_MAX = 200;
// Most recent approved reviews synced onto the product metafield. Older
// approved reviews still live in R2 (`reviews/list.json`) and count toward
// the average/count, they just don't all get mirrored onto the metafield.
const REVIEW_ENTRIES_LIMIT = 20;

async function handleReviewsSubmit(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!(await checkRateLimit(env, 'RATE_LIMITER_REVIEWS_SUBMIT', request))) {
    return rateLimitedResponse(headers);
  }

  const { body, error, status } = await readLimitedJson(request, MAX_STATE_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });

  // Honeypot: a hidden field real customers never see or fill (see the
  // submission form markup). A bot that fills every field gets a fake success
  // response instead of a 400 — nothing is stored, but it doesn't learn that
  // this field is the tell.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 201, headers });
  }

  const productHandle = typeof body.productHandle === 'string' ? body.productHandle.trim() : '';
  const authorName     = typeof body.authorName === 'string' ? body.authorName.trim() : '';
  const reviewBody      = typeof body.body === 'string' ? body.body.trim() : '';
  const rating         = Number(body.rating);

  if (!productHandle || productHandle.length > REVIEW_HANDLE_MAX) {
    return new Response(JSON.stringify({ error: 'Missing or invalid productHandle' }), { status: 400, headers });
  }
  if (!authorName || authorName.length > REVIEW_NAME_MAX) {
    return new Response(JSON.stringify({ error: `Name is required (max ${REVIEW_NAME_MAX} characters)` }), { status: 400, headers });
  }
  if (!reviewBody || reviewBody.length > REVIEW_BODY_MAX) {
    return new Response(JSON.stringify({ error: `Review text is required (max ${REVIEW_BODY_MAX} characters)` }), { status: 400, headers });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return new Response(JSON.stringify({ error: 'Rating must be a whole number from 1 to 5' }), { status: 400, headers });
  }

  const id = crypto.randomUUID();
  const submission = {
    id,
    productHandle,
    rating,
    authorName,
    body:      reviewBody,
    createdAt: Math.floor(Date.now() / 1000),
    status:    'pending',
  };

  await writeJson(env, `reviews/submissions/${id}.json`, submission);

  const list = (await readJson(env, 'reviews/list.json')) || [];
  list.unshift(id);
  await writeJson(env, 'reviews/list.json', list);

  return new Response(JSON.stringify({ id }), { status: 201, headers });
}

// Public: approved reviews for a single product, newest first.
async function handleReviewsList(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const url = new URL(request.url);
  const productHandle = url.searchParams.get('productHandle');
  if (!productHandle) {
    return new Response(JSON.stringify({ error: 'Missing productHandle' }), { status: 400, headers });
  }

  const list = (await readJson(env, 'reviews/list.json')) || [];
  const ids = list.slice(0, 200);
  const reviews = (
    await Promise.all(ids.map(id => readJson(env, `reviews/submissions/${id}.json`)))
  ).filter(r => r && r.status === 'approved' && r.productHandle === productHandle);

  return new Response(JSON.stringify(reviews), { status: 200, headers });
}

// Admin: moderation queue, mirrors handleCommunityPending.
async function handleReviewsPending(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') || 'pending';

  const list = (await readJson(env, 'reviews/list.json')) || [];
  const reviews = (
    await Promise.all(list.map(id => readJson(env, `reviews/submissions/${id}.json`)))
  ).filter(r => r && r.status === statusFilter);

  return new Response(JSON.stringify(reviews), { status: 200, headers });
}

// Looks up a product's GID by handle — same query shape as
// getDefaultVariantForHandle above, just returning the product id instead of
// its default variant.
async function getProductIdForHandle(env, handle) {
  const data = await shopifyAdmin(env,
    `query GetProductIdByHandle($handle: String!) {
      productByHandle(handle: $handle) { id }
    }`,
    { handle }
  );
  return data?.data?.productByHandle?.id || null;
}

// Recomputes the approved-review aggregate for a product and writes it onto
// the product's own metafields via metafieldsSet, so the storefront (product
// page + product card) can render it with a plain Liquid metafield read.
//
// Entirely best-effort / non-fatal: the R2 submission record is the source of
// truth for moderation state, so if this sync fails (missing Admin API creds,
// transient Shopify error, unresolved handle) the caller still returns 200 —
// the storefront numbers just lag until the next approve/reject on this
// product. Also skips outright when Admin API credentials aren't configured
// (e.g. local/test environments), the same fail-open shape as checkRateLimit.
async function syncReviewMetafields(env, productHandle) {
  if (!env.SHOPIFY_STORE_DOMAIN || !env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID || !env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET) {
    return;
  }

  try {
    const list = (await readJson(env, 'reviews/list.json')) || [];
    const approved = (
      await Promise.all(list.map(id => readJson(env, `reviews/submissions/${id}.json`)))
    ).filter(r => r && r.status === 'approved' && r.productHandle === productHandle);

    const count   = approved.length;
    const average = count
      ? Math.round((approved.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
      : 0;
    // `list.json` is unshifted on submit, so `approved` is already newest-first.
    // created_at is written as an ISO 8601 string, not the raw Unix timestamp
    // stored internally on the submission record — Shopify's Liquid `date`
    // filter is only unambiguously documented to accept 'now'/'today' or a
    // parseable date string, not a raw integer, and this value is rendered
    // straight through `| date: ...` in the product page reviews section.
    const entries = approved.slice(0, REVIEW_ENTRIES_LIMIT).map(r => ({
      rating:     r.rating,
      author:     r.authorName,
      body:       r.body,
      created_at: new Date(r.createdAt * 1000).toISOString(),
    }));

    const productId = await getProductIdForHandle(env, productHandle);
    if (!productId) {
      console.warn('[reviews] could not resolve product id for handle:', productHandle);
      return;
    }

    const result = await shopifyAdmin(env,
      `mutation SetReviewMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        metafields: [
          { ownerId: productId, namespace: 'custom', key: 'review_average', type: 'number_decimal',         value: String(average) },
          { ownerId: productId, namespace: 'custom', key: 'review_count',   type: 'number_integer',         value: String(count) },
          { ownerId: productId, namespace: 'custom', key: 'review_entries', type: 'json',                   value: JSON.stringify(entries) },
        ],
      }
    );
    const userErrors = result?.data?.metafieldsSet?.userErrors;
    if (userErrors?.length) {
      console.warn('[reviews] metafieldsSet userErrors:', JSON.stringify(userErrors));
    }
  } catch (err) {
    console.warn('[reviews] metafield sync failed (non-fatal):', err.message);
  }
}

// Admin: approve/reject, mirrors handleCommunityModerate.
async function handleReviewsModerate(request, env, origin, newStatus) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers });
  }

  const review = await readJson(env, `reviews/submissions/${id}.json`);
  if (!review) {
    return new Response(JSON.stringify({ error: 'Review not found' }), { status: 404, headers });
  }

  review.status = newStatus;
  await writeJson(env, `reviews/submissions/${id}.json`, review);

  // Re-syncs on both approve and reject: a re-moderation (e.g. un-approving a
  // review that was already synced onto the product) needs the metafield to
  // drop it too, not just future approvals to add it.
  await syncReviewMetafields(env, review.productHandle);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Share page ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildShareHtml(title, desc, shareUrl, imageUrl, productUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${shareUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Brightfield Studio" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <script>window.location.href = ${JSON.stringify(productUrl)};<\/script>
</head>
<body>
  <p>Redirecting to <a href="${escHtml(productUrl)}">Brightfield Studio</a>\u2026</p>
</body>
</html>`;
}

async function handleShare(request, env, id) {
  if (!id) return Response.redirect('https://brightfield.studio', 302);

  // Direct share (from Share button — image uploaded to shares/{id}.jpg)
  const shareObj = await env.MOCKUP_STAGING.get(`shares/${id}.json`);
  if (shareObj) {
    let meta;
    try { meta = JSON.parse(await shareObj.text()); }
    catch { return Response.redirect('https://brightfield.studio', 302); }
    const shaderLabel = (meta.shader || '').replace(/-/g, ' ');
    const title    = escHtml('A custom ' + shaderLabel + ' design from Brightfield Studio');
    const desc     = escHtml('Customize your own design at Brightfield Studio');
    const shareUrl = escHtml('https://share.brightfield.studio/' + id);
    const imageUrl = escHtml(rewriteLegacyImgUrl(env, meta.imageUrl || ''));
    const restorePayload = btoa(JSON.stringify({ values: meta.values, shader: meta.shader }));
    const productUrl = 'https://brightfield.studio/products/' + encodeURIComponent(meta.productHandle || '')
      + '?bfr=' + encodeURIComponent(restorePayload) + '#shader';
    return new Response(buildShareHtml(title, desc, shareUrl, imageUrl, productUrl), {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Community submission (existing path)
  const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
  if (!obj) return Response.redirect('https://brightfield.studio', 302);

  let design;
  try { design = JSON.parse(await obj.text()); } catch { return Response.redirect('https://brightfield.studio', 302); }
  if (design.status !== 'approved') return Response.redirect('https://brightfield.studio', 302);

  const shaderLabel = (design.shader || '').replace(/-/g, ' ');
  const title      = escHtml((design.creatorName || 'Anonymous') + "'s design on Brightfield Studio");
  const desc       = escHtml('A custom ' + shaderLabel + ' design created on Brightfield Studio');
  const shareUrl   = escHtml('https://share.brightfield.studio/' + id);
  const mockupUrl  = escHtml(rewriteLegacyImgUrl(env, design.mockupUrl || ''));
  const productUrl = design.shopifyProductHandle
    ? 'https://brightfield.studio/products/' + encodeURIComponent(design.shopifyProductHandle)
    : 'https://brightfield.studio/pages/community-design?id=' + encodeURIComponent(id);

  return new Response(buildShareHtml(title, desc, shareUrl, mockupUrl, productUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shopify Admin App UI ──────────────────────────────────────────────────────

async function handleAdminPatchDesignUrl(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { id, designUrl } = body;
  if (!id || !designUrl) return new Response(JSON.stringify({ error: 'Missing id or designUrl' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  submission.designUrl = designUrl;
  await writeJson(env, `community/submissions/${id}.json`, submission);

  return new Response(JSON.stringify({ ok: true, id, designUrl }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleAdminListDesigns(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const results = [];
  let cursor;
  do {
    const page = await env.MOCKUP_STAGING.list({ prefix: 'designs/', cursor, limit: 1000 });
    for (const obj of page.objects) {
      results.push({ key: obj.key, uploaded: obj.uploaded, size: obj.size });
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function handleAdminUI(request, env) {
  const clientId = env.SHOPIFY_APP_CLIENT_ID || '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Community Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="shopify-api-key" content="${clientId}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #202223; background: #f6f6f7; }
    .admin { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
    .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 1px solid #e1e3e5; }
    .tab { background: none; border: none; padding: 0.5rem 1rem; font-size: 0.875rem; color: #6d7175; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab.active { color: #202223; border-bottom-color: #008060; font-weight: 500; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; overflow: hidden; }
    .card-img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
    .card-info { padding: 0.5rem; font-size: 0.75rem; color: #6d7175; line-height: 1.4; }
    .card-info strong { display: block; font-size: 0.8125rem; color: #202223; margin-bottom: 0.15rem; font-weight: 500; }
    .card-actions { display: flex; gap: 0.5rem; padding: 0 0.5rem 0.5rem; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.375rem 0.75rem; font-size: 0.8125rem; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid; flex: 1; }
    .btn-primary { background: #008060; color: #fff; border-color: #008060; }
    .btn-outline { background: #fff; color: #202223; border-color: #c9cccf; }
    .status { color: #6d7175; font-size: 0.875rem; padding: 1.5rem 0; }
    .error { color: #d72c0d; }
    .remove-bg-form { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; }
    .remove-bg-form input { width: 100%; padding: 0.5rem 0.75rem; font-size: 0.875rem; border: 1px solid #c9cccf; border-radius: 6px; }
    .remove-bg-preview { margin-top: 1rem; }
    .remove-bg-preview img { max-width: 100%; max-height: 400px; border-radius: 8px; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; }
  </style>
</head>
<body>
  <div class="admin">
    <h1>Community Designs</h1>
    <div class="tabs">
      <button class="tab active" data-tab="pending">Pending</button>
      <button class="tab" data-tab="approved">Approved</button>
      <button class="tab" data-tab="rejected">Rejected</button>
      <button class="tab" data-tab="remove-bg">Bg Removal</button>
    </div>
    <div id="content"><p class="status">Loading…</p></div>
  </div>
  <script>
    var content = document.getElementById('content');
    var tabs = document.querySelectorAll('.tab');

    // Shopify passes a fresh id_token in the URL on every load (valid ~60s).
    // window.shopify.idToken() hangs in some environments, so we read from URL.
    // On 401, redirect to the Shopify admin app entry point so Shopify issues a fresh token.
    var _token = new URLSearchParams(location.search).get('id_token') || '';
    var _shop  = new URLSearchParams(location.search).get('shop') || '';
    var _shopSlug = _shop.replace('.myshopify.com', '');

    function authHeaders() {
      if (!_token) return null;
      return { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' };
    }

    function refreshApp() {
      var base = _shopSlug
        ? 'https://admin.shopify.com/store/' + _shopSlug + '/apps/community-admin'
        : location.href;
      location.replace(base);
    }

    function timeAgo(ts) {
      var diff = Math.floor((Date.now() - ts * 1000) / 1000);
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function esc(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function loadTab(tab) {
      if (tab === 'remove-bg') { renderRemoveBg(); return; }
      content.innerHTML = '<p class="status">Loading\u2026</p>';
      var headers = authHeaders();
      if (!headers) return;
      try {
        var endpoint = '/community/pending?status=' + tab;
        var r = await fetch(endpoint, { headers: headers });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        renderCards(await r.json(), tab);
      } catch (err) {
        content.innerHTML = '<p class="status error">Error: ' + esc(err.message) + '</p>';
      }
    }

    function renderRemoveBg() {
      content.innerHTML = '';
      var form = document.createElement('div');
      form.className = 'remove-bg-form';

      var row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '0.5rem';

      var input = document.createElement('input');
      input.type = 'text'; input.placeholder = 'Image URL (https://\u2026)';

      var btn = document.createElement('button');
      btn.className = 'btn btn-primary'; btn.textContent = 'Remove Background';
      btn.style.flex = '0 0 auto';

      row.appendChild(input); row.appendChild(btn);
      form.appendChild(row);
      content.appendChild(form);

      var preview = document.createElement('div');
      preview.className = 'remove-bg-preview';
      content.appendChild(preview);

      btn.addEventListener('click', function() { runRemoveBg(input.value.trim(), preview, btn); });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') runRemoveBg(input.value.trim(), preview, btn);
      });
    }

    async function runRemoveBg(url, preview, btn) {
      if (!url) return;
      var headers = authHeaders();
      if (!headers) return;
      preview.innerHTML = '<p class="status">Processing\u2026</p>';
      btn.disabled = true;
      try {
        var r = await fetch('/remove-bg', {
          method: 'POST', headers: headers, body: JSON.stringify({ url: url })
        });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        if (data.error) throw new Error(data.error);

        var imgSrc = 'data:image/png;base64,' + data.png;
        var img = document.createElement('img');
        img.src = imgSrc;

        var dlBtn = document.createElement('a');
        dlBtn.href = imgSrc;
        dlBtn.download = 'product-nobg.png';
        dlBtn.className = 'btn btn-outline';
        dlBtn.style.cssText = 'display:inline-flex;margin-top:0.75rem;flex:0 0 auto;';
        dlBtn.textContent = 'Download PNG';

        preview.innerHTML = '';
        preview.appendChild(img);
        preview.appendChild(dlBtn);
      } catch (err) {
        preview.innerHTML = '<p class="status error">Error: ' + esc(err.message) + '</p>';
      } finally {
        btn.disabled = false;
      }
    }

    function renderCards(designs, tab) {
      if (!designs || !designs.length) {
        content.innerHTML = '<p class="status">No ' + tab + ' designs.</p>';
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'cards';
      designs.forEach(function(d) {
        var card = document.createElement('div');
        card.className = 'card';
        var img = document.createElement('img');
        img.src = d.mockupUrl; img.alt = ''; img.className = 'card-img'; img.loading = 'lazy';
        var info = document.createElement('div');
        info.className = 'card-info';
        info.innerHTML = '<strong>' + esc(d.creatorName || 'Anonymous') + '</strong>' +
          esc(d.creatorEmail || '') + '<br>' +
          esc((d.shader || '').replace(/-/g, ' ')) + ' \u00b7 ' + timeAgo(d.timestamp);
        card.appendChild(img);
        card.appendChild(info);
        var actions = document.createElement('div');
        actions.className = 'card-actions';
        if (tab === 'pending' || tab === 'rejected') {
          var aBtn = document.createElement('button');
          aBtn.className = 'btn btn-primary'; aBtn.textContent = 'Approve';
          (function(id, a, c) {
            a.addEventListener('click', function() { moderate(id, 'approve', c); });
          }(d.id, aBtn, card));
          actions.appendChild(aBtn);
        }
        if (tab === 'pending' || tab === 'approved') {
          var rBtn = document.createElement('button');
          rBtn.className = 'btn btn-outline'; rBtn.textContent = 'Reject';
          (function(id, r, c) {
            r.addEventListener('click', function() { moderate(id, 'reject', c); });
          }(d.id, rBtn, card));
          actions.appendChild(rBtn);
        }
        card.appendChild(actions);
        grid.appendChild(card);
      });
      content.innerHTML = '';
      content.appendChild(grid);
    }

    async function moderate(id, action, cardEl) {
      var headers = authHeaders();
      if (!headers) return;
      try {
        var r = await fetch('/community/' + action, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ id: id })
        });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        cardEl.style.opacity = '0.3';
        cardEl.style.pointerEvents = 'none';
      } catch (err) { alert('Action failed: ' + err.message); }
    }

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        loadTab(tab.dataset.tab);
      });
    });

    loadTab('pending');
  <\/script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shader state sharing ─────────────────────────────────────────────────────

async function handleSaveShaderState(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const { body, error, status } = await readLimitedJson(request, MAX_STATE_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });
  if (!isPlainObject(body.state)) {
    return new Response(JSON.stringify({ error: 'Missing state' }), { status: 400, headers });
  }
  const id  = crypto.randomUUID();
  const key = `shader-states/${id}.json`;
  await env.MOCKUP_STAGING.put(key, JSON.stringify(body.state), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { createdAt: new Date().toISOString() },
  });
  return new Response(JSON.stringify({ id }), { status: 200, headers });
}

async function handleGetShaderState(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const id  = new URL(request.url).pathname.replace('/get-shader-state/', '');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers });
  const obj = await env.MOCKUP_STAGING.get(`shader-states/${id}.json`);
  if (!obj) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  const text = await obj.text();
  return new Response(text, { status: 200, headers });
}

async function handleCreateShare(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const { body, error, status } = await readLimitedJson(request, MAX_SINGLE_IMAGE_BODY_BYTES);
  if (error) return new Response(JSON.stringify({ error }), { status, headers });
  const { image, shader, productHandle, values } = body;
  if (!image || !productHandle) {
    return new Response(JSON.stringify({ error: 'Missing image or productHandle' }), { status: 400, headers });
  }
  if (typeof image !== 'string' || image.length * 3 / 4 > MAX_IMAGE_BYTES) {
    return new Response(JSON.stringify({ error: 'Image too large' }), { status: 413, headers });
  }
  if (typeof productHandle !== 'string' || productHandle.length > 256 ||
      (shader != null && (typeof shader !== 'string' || shader.length > 256))) {
    return new Response(JSON.stringify({ error: 'Invalid shader or productHandle' }), { status: 400, headers });
  }
  if (values != null && (!isPlainObject(values) || JSON.stringify(values).length > MAX_STATE_BYTES)) {
    return new Response(JSON.stringify({ error: 'Invalid values' }), { status: 400, headers });
  }
  let imageData;
  try { imageData = Uint8Array.from(atob(image), c => c.charCodeAt(0)); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid image encoding' }), { status: 400, headers });
  }
  // The share endpoint only ever receives canvas JPEGs; require the JPEG
  // signature so the public share URL can't host arbitrary file types.
  if (imageData.length < 3 || imageData[0] !== 0xFF || imageData[1] !== 0xD8 || imageData[2] !== 0xFF) {
    return new Response(JSON.stringify({ error: 'Image must be a JPEG' }), { status: 400, headers });
  }
  const id       = crypto.randomUUID();
  const imageKey = `shares/${id}.jpg`;
  const metaKey  = `shares/${id}.json`;
  await env.MOCKUP_STAGING.put(imageKey, imageData, { httpMetadata: { contentType: 'image/jpeg' } });
  const imageUrl = imgUrl(imageKey);
  await writeJson(env, metaKey, {
    id,
    shader:        shader        || '',
    productHandle: productHandle || '',
    values:        values        || {},
    imageUrl,
    timestamp:     Math.floor(Date.now() / 1000),
  });
  return new Response(
    JSON.stringify({ id, url: `https://share.brightfield.studio/${id}` }),
    { status: 201, headers }
  );
}

// ── Background removal utility ───────────────────────────────────────────────

async function handleRemoveBg(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!env.IMAGES) {
    return new Response(JSON.stringify({ error: 'IMAGES binding not configured' }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { url } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers });
  }

  let sourceData;
  try {
    sourceData = await fetchImageBytes(env, url);
    if (!sourceData) throw new Error('image not readable');
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to fetch image: ${err.message}` }), { status: 502, headers });
  }

  try {
    const processed = await env.IMAGES
      .input(sourceData)
      .transform({ segment: 'foreground' })
      .output({ format: 'image/png' });
    const pngBuffer = await processed.response().arrayBuffer();
    const bytes     = new Uint8Array(pngBuffer);
    let binary      = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64    = btoa(binary);
    return new Response(JSON.stringify({ png: base64 }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Background removal failed: ${err.message}` }), { status: 500, headers });
  }
}

// ── Device design gallery ────────────────────────────────────────────────────

// Saves a design entry for this deviceId's gallery, and — if this deviceId
// has never been claimed before — mints and persists its device-token claim
// (see "Device tokens" section above, #544). Returns the newly minted token
// (for the caller to hand back to the client) or null when either a claim
// already existed or DEVICE_ID_SECRET isn't configured yet.
async function saveDesignEntry(env, deviceId, entry) {
  const key = `device-designs/${deviceId}.json`;
  let designs = [];
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (obj) {
      designs = JSON.parse(await obj.text());
    }
  } catch { designs = []; }
  designs.unshift(entry);
  await env.MOCKUP_STAGING.put(key, JSON.stringify(designs), {
    httpMetadata: { contentType: 'application/json' },
  });

  const existingClaim = await getDeviceClaim(env, deviceId);
  if (existingClaim) return null;
  return claimDeviceId(env, deviceId);
}

// ── Garbage collection: abandoned generated products + orphaned R2 blobs ────
// See issue #550. createShopifyProduct() (above) permanently creates an
// ACTIVE, published Shopify product on every custom-design/community-design
// checkout attempt — no TTL, no cleanup. Most of these are abandoned carts
// that never convert to a real order. This runs on a daily Cron Trigger (see
// `scheduled` in the default export below and wrangler.toml [triggers]), and
// on demand (always dry-run) via GET /admin/gc-dry-run.
//
// Safety model:
//  - GC_DRY_RUN (env var) defaults to dry-run (unset, or anything other than
//    the literal string "false"). Must be explicitly set to "false" in
//    wrangler.toml [vars] to actually delete anything — see that file's
//    comment. This is a decision for whoever owns the deploy, not something
//    flipped automatically here.
//  - Every "would this be safe to delete" check fails closed: if we can't
//    positively verify a product has zero orders, or can't parse a date, we
//    keep it rather than risk deleting something live.
//  - Products with ANY matching order are never deleted, at any age — so an
//    R2 blob attached to a real order can only become orphaned if the
//    product referencing it was deleted while genuinely orderless, which
//    means no order ever pointed at it in the first place.
//  - The orders(query: "sku:...") query that gcProductHasOrder() relies on
//    only returns orders from the last ~60 days unless the app has the
//    `read_all_orders` scope (see Shopify's Admin GraphQL orders docs). For a
//    product old enough that this window is in question, an empty result
//    doesn't prove "no order" — it may just mean the order is out of view.
//    gcRunProductPass() gates on hasReadAllOrdersScope() +
//    GC_ORDER_VISIBILITY_SAFE_DAYS below to keep (not delete) those products
//    rather than trust a misleading empty result. See that constant's
//    comment for the full explanation.

// Named constant per project convention — see CLAUDE.md checklist ask for GC.
const GC_PRODUCT_MAX_AGE_DAYS = 30;

// Shopify's Admin GraphQL `orders` query only returns orders from the last 60
// days unless the app has been granted the separately-approved
// `read_all_orders` "protected customer data" scope (distinct from, and in
// addition to, plain `read_orders`) — see
// https://shopify.dev/docs/api/admin-graphql/latest/queries/orders. Without
// that scope, gcProductHasOrder()'s empty-result-means-no-order logic is only
// trustworthy for products created within that visible window; past it, an
// empty result could mean "no order" OR "an order exists but is outside the
// API's visibility window" — and this GC job cannot tell those apart. This is
// a few days inside the real 60-day cutoff as a safety margin. See
// hasReadAllOrdersScope() / its use in gcRunProductPass() below.
const GC_ORDER_VISIBILITY_SAFE_DAYS = 55;

// R2 blobs are swept more aggressively than products since most are pure
// upload staging, but still well clear of any realistic in-flight checkout
// (design upload -> create-product is a single request/response, seconds not
// hours) so this only needs to dodge concurrent-request races, not slow
// shoppers.
const GC_BLOB_MAX_AGE_DAYS = 2;

// Prefixes cross-referenced against every currently-live custom-design/
// community-design product's `custom.design_url` / `custom.mockup_url`
// metafields before deletion — those two metafields are the only place a
// design/mockup R2 URL is ever persisted long-term (see createShopifyProduct
// above). A blob under one of these prefixes survives as long as any live
// product still points at it, regardless of age.
const GC_REFERENCE_CHECKED_PREFIXES = ['designs/', 'mockups/'];

// Prefixes swept on age alone, no reference check — each is pure transient
// staging with no metafield or other durable reference once past the age
// cutoff:
//   product-images/     — a resized copy staged only so Shopify's
//     productCreate media step can fetch it; Shopify ingests its own copy to
//     its CDN within the same request, so this R2 copy is dead weight
//     immediately after product creation succeeds.
//   checkouts/           — only ever referenced via the `_checkout_image`
//     cart line-item property (see main-product.liquid / homepage-shader-
//     demo.liquid). The one extension that read that property back
//     (app/checkout-design-preview) was removed from the repo 2026-05-11 and
//     never shipped to production — nothing live consumes this today.
//   create-product-keys/ — /create-product idempotency records; only need to
//     survive a client-side retry window (minutes), not days.
const GC_AGE_ONLY_PREFIXES = ['product-images/', 'checkouts/', 'create-product-keys/'];

// Also deliberately NOT swept: printful-orders/ (order fulfillment idempotency
// records) and printful-orders-failed/ (orders refused as needing a human —
// see recordFulfillmentFailure). Both are small JSON objects written at most
// once per order, and both are load-bearing indefinitely: deleting an
// idempotency record would let a late Shopify redelivery submit a duplicate
// Printful order, and deleting a failure record would erase the only durable
// trace that a paid order never got fulfilled.
//
// Deliberately NOT swept, despite being one of the R2 prefixes this
// product family writes to: shader-states/ backs the standalone "Copy Link"
// share feature (save-shader-state / get-shader-state, used from
// homepage-shader-demo.liquid and main-product.liquid) — durable share links
// a visitor can bookmark or send to someone else, with no relationship to any
// product, cart, or order and no natural expiry. Sweeping it on the same
// cutoff as abandoned-cart staging assets would silently break old share
// links. See the PR description for this call-out — flagging it rather than
// guessing at a safe retention window for an unrelated live feature.

function gcIsDryRun(env) {
  return env.GC_DRY_RUN !== 'false';
}

// Shopify's search-syntax value quoting: wrap in double quotes and escape any
// literal backslash/quote inside the value. SKUs are always
// `CUSTOM-{timestamp}-{sizeLabel}` / `COMMUNITY-{timestamp}-{sizeLabel}` (see
// createShopifyProduct's SKU step) so this never actually fires in practice —
// it's defensive, not load-bearing.
function gcEscapeSearchValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const GC_LIST_CANDIDATE_PRODUCTS_QUERY = `
  query GCListCandidateProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "tag:custom-design OR tag:community-design") {
      edges {
        node {
          id
          title
          handle
          createdAt
          variants(first: 20) {
            edges { node { sku } }
          }
          designUrlMeta: metafield(namespace: "custom", key: "design_url") { value }
          mockupUrlMeta: metafield(namespace: "custom", key: "mockup_url") { value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Verified against Shopify's Admin GraphQL search syntax docs
// (https://shopify.dev/docs/api/admin-graphql/latest/queries/orders):
// "Filter by the product variant `sku` field... Example: `sku:ABC123`".
// Multiple values on one field combine with `OR` (documented the same way
// for e.g. `vendor:Snowdevil OR vendor:Icedevil`) so every size variant's SKU
// can be checked in a single request instead of one request per SKU.
const GC_CHECK_SKU_ORDERS_QUERY = `
  query GCCheckSkuOrders($skuQuery: String!) {
    orders(first: 1, query: $skuQuery) {
      edges { node { id name } }
    }
  }
`;

const GC_DELETE_PRODUCT_MUTATION = `
  mutation GCDeleteProduct($id: ID!) {
    productDelete(input: { id: $id }) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

// Standard, stable introspection query for the installed app's currently-
// granted access scopes — needs no special scope of its own to call. Used to
// detect whether `read_all_orders` is granted (see GC_ORDER_VISIBILITY_SAFE_DAYS
// above) so gcRunProductPass() knows whether the orders(query:) check below
// can be trusted for products older than Shopify's 60-day default visibility
// window.
const GC_SCOPE_CHECK_QUERY = `
  query GCScopeCheck {
    currentAppInstallation {
      accessScopes { handle }
    }
  }
`;

// Cached like _printfulSizes / _printfulLocationId above — check once per
// isolate lifetime, reuse for every product in the pass rather than firing
// an extra Admin API call per candidate. `null` means "not yet checked" so it
// stays distinguishable from a checked-and-false result; a fresh import (as
// tests do via vi.resetModules()) resets this the same way it resets those
// other module-level caches.
let _hasReadAllOrdersScope = null;

// Returns whether the app currently has the read_all_orders scope granted.
// Fails closed on any error or unexpected response shape — i.e. treats
// "couldn't verify" the same as "scope absent", never the permissive case.
async function hasReadAllOrdersScope(env) {
  if (_hasReadAllOrdersScope !== null) return _hasReadAllOrdersScope;
  try {
    const data = await shopifyAdmin(env, GC_SCOPE_CHECK_QUERY);
    if (data?.errors) {
      throw new Error(`scope check query failed: ${JSON.stringify(data.errors)}`);
    }
    const scopes = data?.data?.currentAppInstallation?.accessScopes;
    if (!Array.isArray(scopes)) {
      throw new Error('unexpected currentAppInstallation.accessScopes shape');
    }
    _hasReadAllOrdersScope = scopes.some(s => s?.handle === 'read_all_orders');
  } catch (err) {
    console.warn('[hasReadAllOrdersScope] failed — treating scope as absent (fail closed):', err.message);
    _hasReadAllOrdersScope = false;
  }
  return _hasReadAllOrdersScope;
}

// Returns true if ANY of the given SKUs appears on an existing order — a
// single combined query rather than one per SKU, so checking a product with
// several size variants still costs one Admin API call. Throws (rather than
// returning false) on a transport/GraphQL error so the caller can fail
// closed — see gcRunProductPass below.
async function gcProductHasOrder(env, skus) {
  if (!skus.length) {
    // No SKU at all to check against (e.g. inventoryItemUpdate never ran) —
    // can't positively rule out an order, so the caller must treat this the
    // same as "check failed" and keep the product.
    throw new Error('no SKUs to check');
  }
  const skuQuery = skus.map(s => `sku:"${gcEscapeSearchValue(s)}"`).join(' OR ');
  const data = await shopifyAdmin(env, GC_CHECK_SKU_ORDERS_QUERY, { skuQuery });
  if (data?.errors) {
    throw new Error(`orders query failed: ${JSON.stringify(data.errors)}`);
  }
  return (data?.data?.orders?.edges?.length || 0) > 0;
}

async function gcDeleteProduct(env, productGid) {
  const data = await shopifyAdmin(env, GC_DELETE_PRODUCT_MUTATION, { id: productGid });
  const userErrors = data?.data?.productDelete?.userErrors;
  if (data?.errors?.length || userErrors?.length) {
    throw new Error(`productDelete failed: ${JSON.stringify(data?.errors || userErrors)}`);
  }
  if (!data?.data?.productDelete?.deletedProductId) {
    throw new Error('productDelete returned no deletedProductId');
  }
  return data.data.productDelete.deletedProductId;
}

// Phase 1: page through every custom-design/community-design product, decide
// which are old + orderless enough to delete, and (unless dryRun) delete
// them. Returns { checked, deleted: [...], kept: [...], referencedKeys }
// where referencedKeys is the set of R2 keys still pointed at by a
// design_url/mockup_url metafield on a product that survives this pass — fed
// into gcSweepBlobs so a blob doesn't get swept out from under a live
// product just because it wasn't itself old enough to be a GC candidate.
async function gcRunProductPass(env, { dryRun }) {
  const result = { checked: 0, deleted: [], kept: [] };
  const referencedKeys = new Set();
  const cutoffMs = Date.now() - GC_PRODUCT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const orderVisibilityCutoffMs = Date.now() - GC_ORDER_VISIBILITY_SAFE_DAYS * 24 * 60 * 60 * 1000;

  let cursor = null;
  do {
    let data;
    try {
      data = await shopifyAdmin(env, GC_LIST_CANDIDATE_PRODUCTS_QUERY, { cursor });
    } catch (err) {
      result.errors = result.errors || [];
      result.errors.push(`products query failed: ${err.message}`);
      break;
    }
    if (data?.errors) {
      result.errors = result.errors || [];
      result.errors.push(`products query returned errors: ${JSON.stringify(data.errors)}`);
      break;
    }
    const conn = data?.data?.products;
    if (!conn) break;

    for (const edge of conn.edges) {
      const node = edge.node;
      result.checked++;

      const skus = (node.variants?.edges || []).map(e => e.node?.sku).filter(Boolean);
      const designKey = node.designUrlMeta?.value ? ownImageKey(env, node.designUrlMeta.value) : null;
      const mockupKey = node.mockupUrlMeta?.value ? ownImageKey(env, node.mockupUrlMeta.value) : null;
      const summary = { id: node.id, title: node.title, handle: node.handle, createdAt: node.createdAt, skus };

      const createdAtMs = Date.parse(node.createdAt);
      let eligible = false;
      let reason;
      if (!Number.isFinite(createdAtMs)) {
        reason = 'unparseable createdAt — kept for safety';
      } else if (createdAtMs > cutoffMs) {
        reason = 'not old enough';
      } else if (createdAtMs < orderVisibilityCutoffMs && !(await hasReadAllOrdersScope(env))) {
        // Older than Shopify's ~60-day default orders() visibility window and
        // we can't prove the app has read_all_orders — an empty orders()
        // result here would be indistinguishable from "no order exists", so
        // don't even ask; fail closed and keep it. See
        // GC_ORDER_VISIBILITY_SAFE_DAYS above.
        reason = 'cannot verify — product older than the Admin API order-visibility window without read_all_orders scope';
      } else {
        try {
          eligible = !(await gcProductHasOrder(env, skus));
          reason = eligible ? 'no matching order, past age cutoff' : 'has a matching order';
        } catch (err) {
          reason = `order check failed — kept for safety (${err.message})`;
        }
      }

      if (eligible) {
        if (dryRun) {
          result.deleted.push({ ...summary, reason: `${reason} (dry run — not deleted)` });
          // Dry run doesn't actually delete the product, but for the R2 sweep
          // we want the report to show what WOULD subsequently become
          // orphaned too — so its blobs are deliberately left out of
          // referencedKeys here.
        } else {
          try {
            await gcDeleteProduct(env, node.id);
            result.deleted.push({ ...summary, reason });
          } catch (err) {
            result.kept.push({ ...summary, reason: `delete failed — kept (${err.message})` });
            if (designKey) referencedKeys.add(designKey);
            if (mockupKey) referencedKeys.add(mockupKey);
          }
        }
      } else {
        result.kept.push({ ...summary, reason });
        if (designKey) referencedKeys.add(designKey);
        if (mockupKey) referencedKeys.add(mockupKey);
      }
    }

    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);

  return { ...result, referencedKeys };
}

// Phase 2: sweep R2 blobs under the GC-eligible prefixes. Reference-checked
// prefixes (designs/, mockups/) survive if their key is in referencedKeys;
// age-only prefixes are eligible purely on the uploaded timestamp. Mirrors
// the pagination shape of handleAdminListDesigns above (R2 .list() cursor/
// truncated).
async function gcSweepBlobs(env, { dryRun, referencedKeys }) {
  const result = { checked: 0, deleted: [], kept: [] };
  const cutoffMs = Date.now() - GC_BLOB_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const prefixes = [...GC_REFERENCE_CHECKED_PREFIXES, ...GC_AGE_ONLY_PREFIXES];

  for (const prefix of prefixes) {
    let cursor;
    do {
      const page = await env.MOCKUP_STAGING.list({ prefix, cursor, limit: 1000 });
      for (const obj of page.objects) {
        result.checked++;
        const uploadedMs = obj.uploaded instanceof Date ? obj.uploaded.getTime() : Date.parse(obj.uploaded);

        if (!Number.isFinite(uploadedMs) || uploadedMs > cutoffMs) {
          result.kept.push({ key: obj.key, reason: 'not old enough' });
          continue;
        }
        if (GC_REFERENCE_CHECKED_PREFIXES.includes(prefix) && referencedKeys.has(obj.key)) {
          result.kept.push({ key: obj.key, reason: 'referenced by a live product' });
          continue;
        }

        if (dryRun) {
          result.deleted.push({ key: obj.key, reason: 'orphaned, past age cutoff (dry run — not deleted)' });
        } else {
          try {
            await env.MOCKUP_STAGING.delete(obj.key);
            result.deleted.push({ key: obj.key, reason: 'orphaned, past age cutoff' });
          } catch (err) {
            result.kept.push({ key: obj.key, reason: `delete failed — kept (${err.message})` });
          }
        }
      }
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
  }

  return result;
}

// Entry point for both the daily Cron Trigger and GET /admin/gc-dry-run.
async function runGc(env, { dryRun }) {
  const report = {
    dryRun,
    startedAt: new Date().toISOString(),
    products: null,
    blobs: null,
  };
  const productPass = await gcRunProductPass(env, { dryRun });
  report.products = {
    checked: productPass.checked,
    deleted: productPass.deleted,
    kept:    productPass.kept,
    errors:  productPass.errors || [],
  };
  report.blobs = await gcSweepBlobs(env, { dryRun, referencedKeys: productPass.referencedKeys });
  report.finishedAt = new Date().toISOString();
  return report;
}

async function handleGcDryRun(request, env) {
  const headers = { 'Content-Type': 'application/json' };
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }
  try {
    // Always dry-run regardless of env.GC_DRY_RUN — this is a GET endpoint
    // for verifying what the scheduled job would do; it must never have a
    // side effect of its own.
    const report = await runGc(env, { dryRun: true });
    return new Response(JSON.stringify(report, null, 2), { status: 200, headers });
  } catch (err) {
    console.error('[gc-dry-run] failed:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function runScheduledGc(env) {
  const dryRun = gcIsDryRun(env);
  console.log('[gc] scheduled run starting — dryRun:', dryRun);
  try {
    const report = await runGc(env, { dryRun });
    console.log('[gc] scheduled run complete:', JSON.stringify({
      dryRun,
      products: {
        checked: report.products.checked,
        deleted: report.products.deleted.length,
        kept:    report.products.kept.length,
        errors:  report.products.errors,
      },
      blobs: {
        checked: report.blobs.checked,
        deleted: report.blobs.deleted.length,
        kept:    report.blobs.kept.length,
      },
    }));
  } catch (err) {
    console.error('[gc] scheduled run failed:', err.message, err.stack);
  }
}
