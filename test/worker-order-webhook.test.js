// @vitest-environment node
//
// Coverage for POST /webhook/order-paid — the Shopify orders/paid webhook that
// automates Printful order submission for custom-design line items (previously
// a manual copy-paste from each paid order into Printful). Exercises: HMAC
// signature verification, non-custom orders being ignored, the happy path
// (correct size -> Printful variant mapping, draft order with confirm:false),
// idempotent redelivery, and the failure/skip paths (missing metafield,
// unmapped size, missing shipping address, upstream errors).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getPrintfulSizes/getPrintfulVariantMap/getShopifyToken etc. are cached in
// module-level `let` variables, not per-request state. Re-importing the module
// fresh for every test (instead of importing once at the top) keeps those
// caches from leaking between tests.
let worker, parseCustomSku, classifyLineItem;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  worker = mod.default;
  parseCustomSku = mod.parseCustomSku;
  classifyLineItem = mod.classifyLineItem;
});

afterEach(() => vi.unstubAllGlobals());

const WEBHOOK_SECRET = 'test-webhook-secret';

// ── R2 in-memory mock ─────────────────────────────────────────────────────────
// Models etags + conditional put() (the `onlyIf` option). test/worker.test.js's
// R2 mock does not — nothing else in the worker uses conditional writes — so
// this one is deliberately richer: without honouring onlyIf, every put would
// succeed regardless of the condition and the claim/reclaim race tests below
// would pass against a handler with no idempotency at all. Needed to exercise
// handleOrderPaidWebhook's claim-then-complete flow (#586 review: TOCTOU race
// in the original read-then-write check) for real.
function makeR2() {
  const store = new Map();
  const etags = new Map(); // key -> etag string
  let etagCounter = 0;

  function conditionsPass(key, onlyIf) {
    if (!onlyIf) return true;
    const exists = store.has(key);
    const currentEtag = etags.get(key);

    if (typeof Headers !== 'undefined' && onlyIf instanceof Headers) {
      const ifNoneMatch = onlyIf.get('If-None-Match');
      if (ifNoneMatch === '*') return !exists;
      const ifMatch = onlyIf.get('If-Match');
      if (ifMatch) return exists && currentEtag === ifMatch.replace(/^"|"$/g, '');
      return true;
    }

    if (onlyIf.etagMatches != null) return exists && currentEtag === onlyIf.etagMatches;
    if (onlyIf.etagDoesNotMatch != null) return !exists || currentEtag !== onlyIf.etagDoesNotMatch;
    return true;
  }

  return {
    _store: store,
    get: vi.fn(async (key) => {
      if (!store.has(key)) return null;
      return { text: async () => store.get(key), etag: etags.get(key) };
    }),
    put: vi.fn(async (key, value, options = {}) => {
      // Mirrors real R2: on a failed conditional, return null and don't write.
      if (!conditionsPass(key, options.onlyIf)) return null;
      store.set(key, typeof value === 'string' ? value : String(value));
      const etag = `etag-${++etagCounter}`;
      etags.set(key, etag);
      return { key, etag };
    }),
    delete: vi.fn(async (key) => { store.delete(key); etags.delete(key); }),
  };
}

function makeEnv(overrides = {}) {
  return {
    MOCKUP_STAGING: makeR2(),
    SHOPIFY_STORE_DOMAIN: 'brightfield-2.myshopify.com',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_ID: 'client-id',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET: 'client-secret',
    PRINTFUL_API_KEY: 'printful-key',
    SHOPIFY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  };
}

async function signHmacBase64(rawBody, secret) {
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
  return btoa(binary);
}

async function webhookRequest(payload, { secret = WEBHOOK_SECRET, badSignature = false, omitSignature = false } = {}) {
  const rawBody = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (!omitSignature) {
    headers['X-Shopify-Hmac-Sha256'] = badSignature
      ? 'not-a-real-signature=='
      : await signHmacBase64(rawBody, secret);
  }
  return new Request('https://worker.example.com/webhook/order-paid', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// Router-style fetch mock covering every upstream call the webhook handler
// makes: the Shopify OAuth token endpoint, the order-lookup GraphQL query, the
// Printful catalog (size -> variant id), and Printful's order-create endpoint.
function makeUpstreamFetch(overrides = {}) {
  const calls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push({ url: u, opts });

    if (u.includes('/admin/oauth/access_token')) {
      return jsonRes({ access_token: 'test-token', expires_in: 3600 });
    }

    if (u === 'https://api.printful.com/products/71') {
      if (overrides.printfulCatalogFails) return { ok: false, status: 500 };
      return jsonRes({
        result: {
          variants: [
            { id: 4010, size: 'S', color: 'Black' },
            { id: 4017, size: 'M', color: 'Black' },
            { id: 4020, size: 'L', color: 'Black' },
            { id: 4030, size: 'XL', color: 'Black' },
            // 3XL only exists in White in this mocked catalog (no Black
            // variant) — exercises the any-color fallback fill in
            // getPrintfulVariantMap() when the target color is missing a size.
            { id: 5099, size: '3XL', color: 'White' },
          ],
        },
      });
    }

    if (u === 'https://api.printful.com/orders') {
      if (overrides.printfulOrderTransportFails) {
        throw new TypeError('Network connection lost');
      }
      const body = JSON.parse(opts.body);
      calls.printfulOrderBody = body;
      if (overrides.printfulOrderFails) {
        return jsonRes({ code: 400, result: 'Invalid recipient' });
      }
      if (overrides.printfulOrderRejectsWithRecipient) {
        // Printful echoes the recipient block back on some rejections — the
        // shape formatPrintfulError() has to strip before the message reaches
        // the logs, the 502 body, or the failure record.
        return jsonRes({
          code: 400,
          result: {
            reason: 'Invalid shipping destination',
            recipient: body.recipient,
          },
        });
      }
      if (overrides.printfulOrderOmitsId) {
        // Accepted (code 200) but no result.id — the shape that used to make
        // the completed record indistinguishable from a stale claim.
        return jsonRes({ code: 200, result: { external_id: body.external_id, status: 'draft' } });
      }
      return jsonRes({ code: 200, result: { id: 99881, external_id: body.external_id, status: 'draft' } });
    }

    if (u.includes('/admin/api/')) {
      const body = JSON.parse(opts.body);
      const query = body.query || '';
      if (query.includes('query GetOrderForFulfillment')) {
        if (overrides.orderLookupTransportFails) {
          throw new TypeError('Network connection lost');
        }
        if (overrides.orderNotFound) {
          return jsonRes({ data: { order: null } });
        }
        return jsonRes({ data: { order: overrides.order ?? defaultOrder() } });
      }
      throw new Error('Unmocked Admin API query in test: ' + query);
    }

    throw new Error('Unmocked fetch in test: ' + u);
  });
  fn.calls = calls;
  return fn;
}

function defaultOrder(overrides = {}) {
  return {
    id: 'gid://shopify/Order/555000111',
    name: '#1042',
    email: 'buyer@example.com',
    displayFinancialStatus: 'PAID',
    shippingAddress: {
      firstName: 'Jane',
      lastName: 'Doe',
      address1: '123 Main St',
      address2: '',
      city: 'Portland',
      province: 'Oregon',
      provinceCode: 'OR',
      zip: '97201',
      country: 'United States',
      countryCode: 'US',
      phone: '5035551234',
    },
    customer: { firstName: 'Jane', lastName: 'Doe', email: 'buyer@example.com' },
    lineItems: {
      edges: [
        {
          node: {
            sku: 'CUSTOM-1699999999999-M',
            quantity: 1,
            title: 'Custom Dot Rise',
            product: {
              id: 'gid://shopify/Product/9001',
              metafield: { value: 'https://share.brightfield.studio/img/designs/abc.png' },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

// A regular (non-custom, non-community) catalog line item carrying a
// printful.variant_id *variant* metafield — the in-house routing signal.
function inhouseLineItem(overrides = {}) {
  return {
    sku: 'TEE-BLK-M',
    quantity: 1,
    title: 'Rise Shirt (Black, M)',
    product: { id: 'gid://shopify/Product/8001', metafield: null },
    variant: { id: 'gid://shopify/ProductVariant/9001', metafield: { value: '4917503' } },
    ...overrides,
  };
}

// ── parseCustomSku ───────────────────────────────────────────────────────────

describe('parseCustomSku', () => {
  it('parses a CUSTOM sku', () => {
    expect(parseCustomSku('CUSTOM-1699999999999-M')).toEqual({ prefix: 'CUSTOM', timestamp: '1699999999999', size: 'M' });
  });

  it('parses a COMMUNITY sku', () => {
    expect(parseCustomSku('COMMUNITY-1699999999999-2XL')).toEqual({ prefix: 'COMMUNITY', timestamp: '1699999999999', size: '2XL' });
  });

  it('returns null for a normal catalog sku', () => {
    expect(parseCustomSku('SHIRT-BLK-M')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseCustomSku(undefined)).toBeNull();
    expect(parseCustomSku(null)).toBeNull();
  });
});

// ── classifyLineItem ─────────────────────────────────────────────────────────

describe('classifyLineItem', () => {
  it('classifies a custom SKU as custom, even with a variant metafield also present', () => {
    const li = { sku: 'CUSTOM-1699999999999-M', variant: { metafield: { value: '4917503' } } };
    const cls = classifyLineItem(li);
    expect(cls.type).toBe('custom');
    expect(cls.skuInfo).toEqual({ prefix: 'CUSTOM', timestamp: '1699999999999', size: 'M' });
  });

  it('classifies a valid numeric printful.variant_id metafield as inhouse', () => {
    const cls = classifyLineItem(inhouseLineItem());
    expect(cls).toEqual({ type: 'inhouse', printfulVariantId: 4917503 });
  });

  it('classifies a missing metafield as unrecognized', () => {
    expect(classifyLineItem(inhouseLineItem({ variant: null })).type).toBe('unrecognized');
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: null } })).type).toBe('unrecognized');
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: '' } } })).type).toBe('unrecognized');
  });

  it('classifies a non-numeric or non-positive metafield value as inhouse-invalid', () => {
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: 'not-a-number' } } })).type).toBe('inhouse-invalid');
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: '0' } } })).type).toBe('inhouse-invalid');
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: '-5' } } })).type).toBe('inhouse-invalid');
  });

  // parseInt() stops at the first non-digit and returns whatever it collected,
  // so these all used to classify as a valid 'inhouse' id and get submitted to
  // Printful. '1e5' is the dangerous one: it became sync variant *1* — a real
  // id, silently fulfilling the wrong garment. Refusing loudly is the whole
  // point of 'inhouse-invalid'.
  it('rejects a value with trailing garbage rather than parsing a prefix out of it', () => {
    const cases = ['1e5', '4917503 (Black / M)', '4917503abc', '49.99', '0x10', '12,345'];
    for (const value of cases) {
      const cls = classifyLineItem(inhouseLineItem({ variant: { metafield: { value } } }));
      expect(cls, `expected ${JSON.stringify(value)} to be refused`).toEqual({ type: 'inhouse-invalid', raw: value });
    }
  });

  it('rejects an id too large to round-trip exactly', () => {
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: '9'.repeat(30) } } })).type).toBe('inhouse-invalid');
  });

  it('treats a whitespace-only value as an unset metafield, not a broken one', () => {
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: '   ' } } })).type).toBe('unrecognized');
  });

  it('accepts a well-formed id with incidental surrounding whitespace', () => {
    expect(classifyLineItem(inhouseLineItem({ variant: { metafield: { value: ' 4917503\n' } } })))
      .toEqual({ type: 'inhouse', printfulVariantId: 4917503 });
  });
});

// ── POST /webhook/order-paid — HMAC verification ────────────────────────────

describe('POST /webhook/order-paid — HMAC verification', () => {
  it('rejects a request with no signature header', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch());
    const req = await webhookRequest(defaultOrder(), { omitSignature: true });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('rejects a request with a bad signature', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch());
    const req = await webhookRequest(defaultOrder(), { badSignature: true });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('rejects when SHOPIFY_WEBHOOK_SECRET is not configured', async () => {
    const env = makeEnv({ SHOPIFY_WEBHOOK_SECRET: undefined });
    vi.stubGlobal('fetch', makeUpstreamFetch());
    const req = await webhookRequest(defaultOrder());
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('rejects when the signature was computed with the wrong secret', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch());
    const req = await webhookRequest(defaultOrder(), { secret: 'wrong-secret' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('accepts a correctly-signed request', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch());
    const req = await webhookRequest({ id: 555000111 });
    const res = await worker.fetch(req, env);
    expect(res.status).not.toBe(401);
  });
});

// ── POST /webhook/order-paid — non-custom orders ────────────────────────────

describe('POST /webhook/order-paid — non-custom orders', () => {
  it('ignores an order with no custom-design line items', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: { sku: 'SHIRT-BLK-M', quantity: 1, title: 'Catalog Shirt', product: { id: 'gid://shopify/Product/1', metafield: null } } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = await webhookRequest({ id: 555000111 });
    const res = await worker.fetch(req, env);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ignored).toBe(true);
    // No Printful order call should have been made.
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });
});

// ── POST /webhook/order-paid — happy path ───────────────────────────────────

describe('POST /webhook/order-paid — happy path', () => {
  it('creates a draft Printful order with the correct size -> variant mapping', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    const req = await webhookRequest({ id: 555000111 });
    const res = await worker.fetch(req, env);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.printfulOrderId).toBe(99881);

    const printfulBody = fetchMock.calls.printfulOrderBody;
    expect(printfulBody.confirm).toBe(false);
    expect(printfulBody.external_id).toBe('shopify-555000111');
  });

  it('maps the SKU size suffix to the matching Printful catalog variant id', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    const req = await webhookRequest({ id: 555000111 }); // default order line item is size M
    await worker.fetch(req, env);

    const printfulBody = fetchMock.calls.printfulOrderBody;
    expect(printfulBody.items).toHaveLength(1);
    expect(printfulBody.items[0].variant_id).toBe(4017); // Black/M from the mocked catalog
    expect(printfulBody.items[0].files[0].image_url).toBe('https://share.brightfield.studio/img/designs/abc.png');
    expect(printfulBody.items[0].files[0].placement).toBe('front');
  });

  it('sends the shipping address as the Printful recipient', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(await webhookRequest({ id: 555000111 }), env);

    const recipient = fetchMock.calls.printfulOrderBody.recipient;
    expect(recipient.name).toBe('Jane Doe');
    expect(recipient.address1).toBe('123 Main St');
    expect(recipient.city).toBe('Portland');
    expect(recipient.state_code).toBe('OR');
    expect(recipient.country_code).toBe('US');
    expect(recipient.zip).toBe('97201');
    expect(recipient.email).toBe('buyer@example.com');
  });

  it('handles COMMUNITY-prefixed SKUs the same as CUSTOM', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: {
          sku: 'COMMUNITY-1699999999999-L',
          quantity: 2,
          title: 'Community Design',
          product: { id: 'gid://shopify/Product/9002', metafield: { value: 'https://share.brightfield.studio/img/designs/def.png' } },
        } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
    const printfulBody = fetchMock.calls.printfulOrderBody;
    expect(printfulBody.items[0].variant_id).toBe(4020); // Black/L
    expect(printfulBody.items[0].quantity).toBe(2);
  });

  it('picks the target color when a size has both a Black and non-Black variant', async () => {
    // Size S exists as both Black (4010) and — in the default catalog above —
    // no other color, so this just confirms the straightforward case; the
    // fallback case (a size with *no* Black variant at all) is covered next.
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: {
          sku: 'CUSTOM-1699999999999-S',
          quantity: 1,
          title: 'Custom Dot Rise',
          product: { id: 'gid://shopify/Product/9003', metafield: { value: 'https://share.brightfield.studio/img/designs/ghi.png' } },
        } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(fetchMock.calls.printfulOrderBody.items[0].variant_id).toBe(4010);
  });

  it('falls back to a non-target color when the target color has no variant for that size', async () => {
    // 3XL only exists as White (5099) in the mocked catalog — no Black variant
    // at all — so getPrintfulVariantMap()'s pass-2 fallback should fill it in
    // rather than treating the size as unmapped.
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: {
          sku: 'CUSTOM-1699999999999-3XL',
          quantity: 1,
          title: 'Custom Dot Rise',
          product: { id: 'gid://shopify/Product/9006', metafield: { value: 'https://share.brightfield.studio/img/designs/jkl.png' } },
        } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
    expect(fetchMock.calls.printfulOrderBody.items[0].variant_id).toBe(5099);
  });
});

// ── POST /webhook/order-paid — in-house line items ──────────────────────────

describe('POST /webhook/order-paid — in-house line items', () => {
  it('creates a Printful order item with sync_variant_id and no files for a valid metafield', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [{ node: inhouseLineItem() }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);

    // No catalog lookup needed for a pure in-house order — the metafield
    // already carries the resolved Printful sync variant id.
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/products/71')).toBe(false);

    const item = fetchMock.calls.printfulOrderBody.items[0];
    expect(item.sync_variant_id).toBe(4917503);
    expect(item.quantity).toBe(1);
    expect(item.files).toBeUndefined();
  });

  it('ignores an order whose only line item has no printful.variant_id metafield (ordinary catalog item)', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [{ node: inhouseLineItem({ variant: null }) }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ignored).toBe(true);
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });

  it('returns 422 with a clear reason when the printful.variant_id metafield is invalid, not a silent ignore', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: inhouseLineItem({ variant: { metafield: { value: 'not-a-number' } } }) }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.skipped[0].reason).toMatch(/invalid printful\.variant_id metafield/);
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });

  it('submits a single Printful order covering both a custom and an in-house line item', async () => {
    const env = makeEnv();
    const customNode = {
      sku: 'CUSTOM-1699999999999-M',
      quantity: 1,
      title: 'Custom Dot Rise',
      product: { id: 'gid://shopify/Product/9001', metafield: { value: 'https://share.brightfield.studio/img/designs/abc.png' } },
    };
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [{ node: customNode }, { node: inhouseLineItem() }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);

    const items = fetchMock.calls.printfulOrderBody.items;
    expect(items).toHaveLength(2);

    const customItem = items.find(i => i.variant_id != null);
    const inhouseItem = items.find(i => i.sync_variant_id != null);
    expect(customItem.files[0].image_url).toBe('https://share.brightfield.studio/img/designs/abc.png');
    expect(inhouseItem.sync_variant_id).toBe(4917503);
    expect(inhouseItem.files).toBeUndefined();

    // One order, one idempotency record covering both SKUs.
    expect(fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length).toBe(1);
    const stored = JSON.parse(env.MOCKUP_STAGING._store.get('printful-orders/555000111.json'));
    expect(stored.skus.sort()).toEqual(['CUSTOM-1699999999999-M', 'TEE-BLK-M'].sort());
    expect(stored.lineItemTypes).toEqual({ custom: 1, inhouse: 1 });
  });

  it('treats a deleted-variant line item (variant is null) as unrecognized rather than crashing', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: { sku: 'TEE-BLK-M', quantity: 1, title: 'Rise Shirt', product: { id: 'gid://shopify/Product/8001', metafield: null }, variant: null } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ignored).toBe(true);
  });
});

// ── POST /webhook/order-paid — idempotency ──────────────────────────────────

describe('POST /webhook/order-paid — idempotency', () => {
  it('does not create a second Printful order on redelivery', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    const first = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(first.status).toBe(200);
    const orderCallsAfterFirst = fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length;
    expect(orderCallsAfterFirst).toBe(1);

    const second = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const secondJson = await second.json();
    expect(second.status).toBe(200);
    expect(secondJson.alreadyProcessed).toBe(true);
    expect(secondJson.printfulOrderId).toBe(99881);

    const orderCallsAfterSecond = fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length;
    expect(orderCallsAfterSecond).toBe(1); // unchanged — no duplicate order created
  });

  // Regression test for the #586 review's TOCTOU finding: two deliveries for
  // the same order racing through the original read-then-write idempotency
  // check could both read "not yet processed" and both submit a Printful
  // order. The R2 conditional-write mock enforces onlyIf for real, so this
  // only passes if handleOrderPaidWebhook actually claims the idempotency key
  // up front instead of just checking-then-writing at the end.
  it('creates only one Printful order when two deliveries race concurrently', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    const [resA, resB] = await Promise.all([
      worker.fetch(await webhookRequest({ id: 555000111 }), env),
      worker.fetch(await webhookRequest({ id: 555000111 }), env),
    ]);

    const orderCalls = fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length;
    expect(orderCalls).toBe(1); // never more than one Printful order created

    const jsonA = await resA.json();
    const jsonB = await resB.json();

    // With this in-memory mock's synchronous execution and no real network
    // latency, one delivery (A, invoked first) claims the key and runs the
    // full handler to completion — including writing the completed record —
    // before the other's own claim attempt happens. So B doesn't observe the
    // pending placeholder at all; it finds the already-completed record and
    // takes the plain idempotency-hit path (200, alreadyProcessed) rather
    // than the 409-retry path (which is reached only when B's read lands
    // while A's claim is still pending — exercised by the stale-claim test
    // below via a pre-seeded pending record instead of true concurrency).
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(jsonA.printfulOrderId).toBe(99881);
    expect(jsonB.printfulOrderId).toBe(99881);
    expect(jsonB.alreadyProcessed).toBe(true);

    // The final idempotency record reflects the single successful order.
    const stored = JSON.parse(env.MOCKUP_STAGING._store.get('printful-orders/555000111.json'));
    expect(stored.printfulOrderId).toBe(99881);
  });

  // Regression test: completion used to be inferred from the record carrying a
  // printfulOrderId. When Printful accepts an order but returns no result.id,
  // JSON.stringify drops that key — leaving a completed record that has no
  // `claimedAt` either, which the reclaim path below classifies as a stale
  // claim and reprocesses, submitting the same order to Printful twice.
  it('does not resubmit on redelivery when Printful returned no order id', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({ printfulOrderOmitsId: true });
    vi.stubGlobal('fetch', fetchMock);

    const first = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(first.status).toBe(200);

    const stored = JSON.parse(env.MOCKUP_STAGING._store.get('printful-orders/555000111.json'));
    expect(stored.status).toBe('completed');
    expect(stored.printfulOrderId).toBeUndefined();

    const second = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyProcessed).toBe(true);

    // The whole point: still exactly one Printful order.
    expect(fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length).toBe(1);
  });

  it('still honours a legacy record that predates the explicit status marker', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    await env.MOCKUP_STAGING.put(
      'printful-orders/555000111.json',
      JSON.stringify({ shopifyOrderId: 555000111, printfulOrderId: 99881, createdAt: Date.now() })
    );

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyProcessed).toBe(true);
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });

  // The concurrency test above never actually observes a pending (not yet
  // completed) claim — in this mock's execution, the first delivery finishes
  // and writes the completed record before the second even attempts its own
  // claim. Cover the "genuinely in-flight" 409 branch directly instead, by
  // pre-seeding a fresh (non-stale) pending claim as if a real concurrent
  // delivery were still mid-flight.
  it('returns 409 without creating a Printful order when a claim is actively in-flight', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    await env.MOCKUP_STAGING.put(
      'printful-orders/555000111.json',
      JSON.stringify({ status: 'pending', claimedAt: Date.now() })
    );

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ ok: false, retrying: true });
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });

  it('reclaims a stale pending claim and completes successfully', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    // Pre-seed a pending claim old enough to be considered abandoned (crashed
    // isolate / evicted before finishing) — must not permanently block future
    // redeliveries for this order.
    await env.MOCKUP_STAGING.put(
      'printful-orders/555000111.json',
      JSON.stringify({ status: 'pending', claimedAt: Date.now() - 5 * 60 * 1000 })
    );

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.printfulOrderId).toBe(99881);

    const orderCalls = fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length;
    expect(orderCalls).toBe(1);

    const stored = JSON.parse(env.MOCKUP_STAGING._store.get('printful-orders/555000111.json'));
    expect(stored.printfulOrderId).toBe(99881);
  });

  // Regression test: the claim can be *gone* by the time the losing delivery
  // reads it, because every exit path that isn't full success releases it —
  // and the ignore path (ordinary catalog order) claims and releases within
  // milliseconds, so this window is routine, not exotic. The reclaim path
  // used to dereference the missing record's etag unconditionally, throwing a
  // TypeError out of the handler and 500ing the request with no log line.
  it('re-claims the key when the previous claim was released mid-read, instead of crashing', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    // A concurrent delivery holds the claim, so our conditional put fails...
    await env.MOCKUP_STAGING.put(
      'printful-orders/555000111.json',
      JSON.stringify({ status: 'pending', claimedAt: Date.now() })
    );
    // ...and releases it in the window before we read it back.
    const realGet = env.MOCKUP_STAGING.get;
    env.MOCKUP_STAGING.get = vi.fn(async (key) => {
      env.MOCKUP_STAGING.get = realGet; // only the first read races
      await env.MOCKUP_STAGING.delete(key);
      return null;
    });

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.printfulOrderId).toBe(99881);
    expect(fetchMock.calls.filter(c => c.url === 'https://api.printful.com/orders').length).toBe(1);

    const stored = JSON.parse(env.MOCKUP_STAGING._store.get('printful-orders/555000111.json'));
    expect(stored.status).toBe('completed');
  });

  it('returns 409 rather than racing when another delivery re-claims a released key first', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    await env.MOCKUP_STAGING.put(
      'printful-orders/555000111.json',
      JSON.stringify({ status: 'pending', claimedAt: Date.now() })
    );
    // The key is released before our read, then immediately re-claimed by a
    // third delivery before our own retry lands — our retry must lose.
    const realGet = env.MOCKUP_STAGING.get;
    env.MOCKUP_STAGING.get = vi.fn(async (key) => {
      env.MOCKUP_STAGING.get = realGet;
      await env.MOCKUP_STAGING.delete(key);
      await env.MOCKUP_STAGING.put(key, JSON.stringify({ status: 'pending', claimedAt: Date.now() }));
      return null;
    });

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, retrying: true });
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });
});

// ── POST /webhook/order-paid — payment verification ─────────────────────────

describe('POST /webhook/order-paid — payment verification', () => {
  it('returns 422 and does not submit to Printful when the order is not paid', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({ displayFinancialStatus: 'PENDING' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toMatch(/not paid/i);
    expect(json.financialStatus).toBe('PENDING');

    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);

    // The idempotency claim must be released, not left as a completed
    // record — this order may legitimately become PAID later and should be
    // free to proceed on a future redelivery.
    expect(env.MOCKUP_STAGING._store.has('printful-orders/555000111.json')).toBe(false);
  });
});

// ── POST /webhook/order-paid — partial-fulfillment refusal ──────────────────
// An order is submitted to Printful in full or not at all. Submitting only the
// valid subset would under-fulfill a paid order permanently: the success path
// writes the completed idempotency record, so every later redelivery
// short-circuits on `alreadyProcessed` and the dropped item is never revisited.

describe('POST /webhook/order-paid — partial fulfillment', () => {
  function mixedValidAndBrokenOrder() {
    return defaultOrder({
      lineItems: { edges: [
        { node: {
          sku: 'CUSTOM-1699999999999-M',
          quantity: 1,
          title: 'Custom Dot Rise',
          product: { id: 'gid://shopify/Product/9001', metafield: { value: 'https://share.brightfield.studio/img/designs/abc.png' } },
        } },
        { node: {
          sku: 'CUSTOM-1700000000000-L',
          quantity: 1,
          title: 'Custom Dot Rise 2',
          product: { id: 'gid://shopify/Product/9002', metafield: null }, // no design_url
        } },
      ] },
    });
  }

  it('submits nothing when one of several line items is unusable', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({ order: mixedValidAndBrokenOrder() });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.skipped[0].sku).toBe('CUSTOM-1700000000000-L');
    // The valid sibling item must not have been submitted on its own.
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });

  it('leaves the order recoverable — no idempotency record, and a later redelivery succeeds once fixed', async () => {
    const env = makeEnv();
    const broken = makeUpstreamFetch({ order: mixedValidAndBrokenOrder() });
    vi.stubGlobal('fetch', broken);

    await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    // Claim released: nothing recorded, so the order isn't permanently stuck.
    expect(env.MOCKUP_STAGING._store.has('printful-orders/555000111.json')).toBe(false);

    // Merchant fixes the missing metafield; Shopify redelivers.
    const fixedOrder = mixedValidAndBrokenOrder();
    fixedOrder.lineItems.edges[1].node.product.metafield = { value: 'https://share.brightfield.studio/img/designs/def.png' };
    const fixed = makeUpstreamFetch({ order: fixedOrder });
    vi.stubGlobal('fetch', fixed);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
    // Now the whole order goes through — both items, one Printful order.
    expect(fixed.calls.printfulOrderBody.items).toHaveLength(2);
    expect(fixed.calls.filter(c => c.url === 'https://api.printful.com/orders').length).toBe(1);
  });

  // Same invariant, triggered by item count rather than item data: the order
  // lookup fetches one page of line items, so an order with more than that
  // would have submitted only the first page and then written the completed
  // idempotency record — permanently under-fulfilling it.
  it('refuses an order whose line items overflow a single lookup page', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { pageInfo: { hasNextPage: true }, edges: defaultOrder().lineItems.edges },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toMatch(/more than 100 line items/);
    // Nothing submitted, and the claim released so a fix-and-replay can work.
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
    expect(env.MOCKUP_STAGING._store.has('printful-orders/555000111.json')).toBe(false);
  });

  it('proceeds normally when the line items fit in a single page', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { pageInfo: { hasNextPage: false }, edges: defaultOrder().lineItems.edges },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
    expect(fetchMock.calls.printfulOrderBody.items).toHaveLength(1);
  });

  it('refuses a mixed order where the in-house item has an invalid metafield', async () => {
    const env = makeEnv();
    const customNode = {
      sku: 'CUSTOM-1699999999999-M',
      quantity: 1,
      title: 'Custom Dot Rise',
      product: { id: 'gid://shopify/Product/9001', metafield: { value: 'https://share.brightfield.studio/img/designs/abc.png' } },
    };
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [
        { node: customNode },
        { node: inhouseLineItem({ variant: { metafield: { value: 'not-a-number' } } }) },
      ] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
    expect(fetchMock.calls.some(c => c.url === 'https://api.printful.com/orders')).toBe(false);
  });
});

// ── POST /webhook/order-paid — failure records ──────────────────────────────
// A 422 refusal releases the idempotency claim so a fixed order can be
// redelivered — but if nobody fixes it, Shopify stops redelivering and the
// paid order is never fulfilled. These records are the only durable trace that
// that happened; without them the sole signal is a console line nobody reads.

describe('POST /webhook/order-paid — failure records', () => {
  const FAILED_KEY = 'printful-orders-failed/555000111.json';

  function failureRecord(env) {
    const raw = env.MOCKUP_STAGING._store.get(FAILED_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  it('records a durable failure when an order is refused for unusable line items', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [
        { node: { sku: 'CUSTOM-1700000000000-L', quantity: 1, title: 'Custom Dot Rise 2',
                  product: { id: 'gid://shopify/Product/9002', metafield: null } } },
      ] } }),
    }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);

    const rec = failureRecord(env);
    expect(rec).not.toBeNull();
    expect(rec.reason).toBe('unusable line items');
    expect(rec.shopifyOrderName).toBe('#1042');
    expect(rec.skipped[0].sku).toBe('CUSTOM-1700000000000-L');
    expect(typeof rec.failedAt).toBe('number');
  });

  it('records a failure for a missing shipping address and for page overflow', async () => {
    const noAddress = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ order: defaultOrder({ shippingAddress: null }) }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), noAddress)).status).toBe(422);
    expect(failureRecord(noAddress).reason).toBe('missing shipping address');

    const overflow = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({
      order: defaultOrder({ lineItems: { pageInfo: { hasNextPage: true }, edges: defaultOrder().lineItems.edges } }),
    }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), overflow)).status).toBe(422);
    expect(failureRecord(overflow).reason).toBe('too many line items');
  });

  it('does not record a failure for a not-yet-paid order or a call that never completed', async () => {
    // Transient by nature: a PENDING order may legitimately become PAID and be
    // redelivered, and a call that never reached a verdict may well succeed on
    // the next try — neither needs a human.
    const unpaid = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ order: defaultOrder({ displayFinancialStatus: 'PENDING' }) }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), unpaid)).status).toBe(422);
    expect(failureRecord(unpaid)).toBeNull();

    const printfulDown = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulOrderTransportFails: true }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), printfulDown)).status).toBe(502);
    expect(failureRecord(printfulDown)).toBeNull();

    const shopifyDown = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ orderLookupTransportFails: true }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), shopifyDown)).status).toBe(502);
    expect(failureRecord(shopifyDown)).toBeNull();
  });

  it('records a durable failure when Printful rejects the order, despite the 502', async () => {
    // A rejection is not an outage. Printful answered and evaluated this
    // specific order — and the usual reasons it says no (a state_code it won't
    // accept, a catalog variant id where a sync variant id belongs, an
    // external_id a previous delivery already consumed) are permanent
    // properties of the order that no redelivery will change. Without a record
    // here, Shopify exhausts its retries and the paid order is gone with
    // nothing but a log line.
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulOrderFails: true }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);

    const rec = failureRecord(env);
    expect(rec).not.toBeNull();
    expect(rec.reason).toBe('Printful rejected the order');
    expect(rec.shopifyOrderName).toBe('#1042');
    expect(rec.printfulCode).toBe(400);
    // The diagnostic Printful gave is what makes the record actionable.
    expect(rec.detail).toContain('Invalid recipient');
  });

  it('clears a Printful-rejection failure record once a redelivery succeeds', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulOrderFails: true }));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), env)).status).toBe(502);
    expect(failureRecord(env)).not.toBeNull();

    // The rejection released the claim, so a redelivery is free to retry — and
    // once whatever Printful objected to is fixed, it fulfills and the record
    // must not linger.
    vi.stubGlobal('fetch', makeUpstreamFetch({}));
    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), env)).status).toBe(200);
    expect(failureRecord(env)).toBeNull();
  });

  it('does not leak the recipient into the failure record when Printful echoes it back', async () => {
    // Same redaction the 502 body and the logs get — this record is one more
    // place a customer's street address must not land.
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulOrderRejectsWithRecipient: true }));

    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), env)).status).toBe(502);

    const rec = failureRecord(env);
    expect(rec.reason).toBe('Printful rejected the order');
    expect(JSON.stringify(rec)).not.toContain('123 Main St');
    expect(JSON.stringify(rec)).not.toContain('5035551234');
  });

  it('writes the failure record before releasing the claim', async () => {
    // Ordering, not just presence. Releasing first opens a window where a
    // concurrent redelivery claims the order, fulfills it, and deletes a
    // failure record that hasn't been written yet — after which this write
    // recreates it, leaving a "needs a human" record for an order that
    // actually reached Printful. Holding the claim across the write closes it.
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ order: defaultOrder({ shippingAddress: null }) }));

    expect((await worker.fetch(await webhookRequest({ id: 555000111 }), env)).status).toBe(422);

    const put = env.MOCKUP_STAGING.put;
    const del = env.MOCKUP_STAGING.delete;
    const failWriteIdx = put.mock.calls.findIndex(([key]) => key === FAILED_KEY);
    const claimDeleteIdx = del.mock.calls.findIndex(([key]) => key === 'printful-orders/555000111.json');
    expect(failWriteIdx).toBeGreaterThanOrEqual(0);
    expect(claimDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(put.mock.invocationCallOrder[failWriteIdx])
      .toBeLessThan(del.mock.invocationCallOrder[claimDeleteIdx]);
  });

  it('clears the failure record once the fixed order fulfills', async () => {
    const env = makeEnv();
    const brokenOrder = defaultOrder({ lineItems: { edges: [
      { node: { sku: 'CUSTOM-1700000000000-L', quantity: 1, title: 'Custom Dot Rise 2',
                product: { id: 'gid://shopify/Product/9002', metafield: null } } },
    ] } });
    vi.stubGlobal('fetch', makeUpstreamFetch({ order: brokenOrder }));
    await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(failureRecord(env)).not.toBeNull();

    // Merchant fixes the metafield; Shopify redelivers.
    vi.stubGlobal('fetch', makeUpstreamFetch({ order: defaultOrder() }));
    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);

    expect(res.status).toBe(200);
    // A resolved problem must not stay in the "needs a human" list.
    expect(failureRecord(env)).toBeNull();
  });
});

// ── POST /webhook/order-paid — logging hygiene ──────────────────────────────

describe('POST /webhook/order-paid — logging', () => {
  it('never logs the recipient block Printful echoes back on success', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/admin/oauth/access_token')) return jsonRes({ access_token: 't', expires_in: 3600 });
      if (u === 'https://api.printful.com/products/71') return jsonRes({ result: { variants: [{ id: 4017, size: 'M', color: 'Black' }] } });
      if (u === 'https://api.printful.com/orders') {
        // Printful's real success response echoes the full recipient.
        return jsonRes({ code: 200, result: { id: 99881, status: 'draft', recipient: {
          name: 'Jane Doe', address1: '123 Main St', city: 'Portland', zip: '97201',
          phone: '5035551234', email: 'buyer@example.com',
        } } });
      }
      if (u.includes('/admin/api/')) return jsonRes({ data: { order: defaultOrder() } });
      throw new Error('Unmocked fetch in test: ' + u);
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
      expect(res.status).toBe(200);

      const logged = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(logged).not.toMatch(/123 Main St/);
      expect(logged).not.toMatch(/5035551234/);
      expect(logged).not.toMatch(/buyer@example\.com/);
      // The operationally useful part is still there.
      expect(logged).toMatch(/99881/);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ── POST /webhook/order-paid — body size cap ────────────────────────────────
// The HMAC check has to run over the whole body, so an uncapped read lets an
// unauthenticated caller make the worker buffer and hash anything it sends.

describe('POST /webhook/order-paid — body size cap', () => {
  it('rejects an oversized body on Content-Length alone, before reading it', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    const req = await webhookRequest({ id: 555000111 });
    // A lying Content-Length is enough — the point is to bail before the read.
    const headers = new Headers(req.headers);
    headers.set('Content-Length', String(4 * 1024 * 1024));
    const res = await worker.fetch(
      new Request(req.url, { method: 'POST', headers, body: await req.text() }),
      env
    );

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized body whose Content-Length is absent or understated', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch();
    vi.stubGlobal('fetch', fetchMock);

    // Correctly signed, so this can only be caught by the post-read byte check.
    const res = await worker.fetch(
      await webhookRequest({ id: 555000111, padding: 'x'.repeat(300 * 1024) }),
      env
    );

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a normal-sized signed payload', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch());

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(200);
  });
});

// ── POST /webhook/order-paid — failure / skip paths ─────────────────────────

describe('POST /webhook/order-paid — failure and skip paths', () => {
  it('returns 422 when the line item product has no design_url metafield', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: {
          sku: 'CUSTOM-1699999999999-M',
          quantity: 1,
          title: 'Custom Dot Rise',
          product: { id: 'gid://shopify/Product/9004', metafield: null },
        } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.skipped[0].reason).toMatch(/design_url/);
  });

  it('returns 422 when the SKU size has no Printful catalog match', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({
      order: defaultOrder({
        lineItems: { edges: [{ node: {
          sku: 'CUSTOM-1699999999999-7XL',
          quantity: 1,
          title: 'Custom Dot Rise',
          product: { id: 'gid://shopify/Product/9005', metafield: { value: 'https://share.brightfield.studio/img/designs/abc.png' } },
        } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.skipped[0].reason).toMatch(/no Printful variant/);
  });

  it('returns 422 when the order has no shipping address', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({ order: defaultOrder({ shippingAddress: null }) });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
  });

  it('returns 502 when the order lookup fails at the transport level', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ orderLookupTransportFails: true }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);
  });

  it('returns 502 when the order is not found', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ orderNotFound: true }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);
  });

  it('returns 502 when the Printful catalog lookup fails', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulCatalogFails: true }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);
  });

  it('returns 502 and does not persist an idempotency record when Printful order creation fails', async () => {
    const env = makeEnv();
    const fetchMock = makeUpstreamFetch({ printfulOrderFails: true });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);
    expect(env.MOCKUP_STAGING._store.has('printful-orders/555000111.json')).toBe(false);
  });

  it('returns 502 when the Printful order-create call fails at the transport level', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({ printfulOrderTransportFails: true }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);
  });
});

// ── POST /webhook/order-paid — claim ownership on release ───────────────────
// Releasing the idempotency claim used to be a bare delete of whatever was at
// the key, which isn't necessarily this delivery's claim. The damaging case:
// this delivery stalls past the staleness timeout, a second delivery reclaims
// and submits the order, and then this one's Printful call fails — reliably,
// since the second delivery already consumed `external_id: shopify-{id}` — and
// its 502 path deletes the *other* delivery's completed record. The order is
// then marked neither completed nor failed, and every later redelivery
// resubmits into the same duplicate rejection forever.

describe('POST /webhook/order-paid — claim ownership', () => {
  const KEY = 'printful-orders/555000111.json';

  // Runs the handler to a Printful failure, but has another delivery replace
  // the record at the idempotency key while our call is in flight.
  async function failAfterRecordReplacedWith(env, replacement) {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/admin/oauth/access_token')) return jsonRes({ access_token: 't', expires_in: 3600 });
      if (u === 'https://api.printful.com/products/71') {
        return jsonRes({ result: { variants: [{ id: 4017, size: 'M', color: 'Black' }] } });
      }
      if (u === 'https://api.printful.com/orders') {
        // Simulates the concurrent delivery that reclaimed our stale claim and
        // got there first — it owns the key now, whatever state it's in.
        await env.MOCKUP_STAGING.put(KEY, JSON.stringify(replacement));
        // ...and Printful rejects ours as a duplicate external_id.
        return jsonRes({ code: 400, result: 'Order with this external_id already exists' });
      }
      if (u.includes('/admin/api/')) return jsonRes({ data: { order: defaultOrder() } });
      throw new Error('Unmocked fetch in test: ' + u);
    }));

    return worker.fetch(await webhookRequest({ id: 555000111 }), env);
  }

  it('does not delete another delivery’s completed record when our own submission fails', async () => {
    const env = makeEnv();
    const res = await failAfterRecordReplacedWith(env, {
      status: 'completed', shopifyOrderId: 555000111, printfulOrderId: 77777, createdAt: Date.now(),
    });

    expect(res.status).toBe(502);

    // The other delivery's completed record must survive — it is the only
    // marker that this order already reached Printful.
    const stored = JSON.parse(env.MOCKUP_STAGING._store.get(KEY));
    expect(stored.status).toBe('completed');
    expect(stored.printfulOrderId).toBe(77777);
  });

  it('does not delete another delivery’s in-flight claim when our own submission fails', async () => {
    const env = makeEnv();
    const res = await failAfterRecordReplacedWith(env, {
      status: 'pending', claimedAt: Date.now(), claimId: 'some-other-delivery',
    });

    expect(res.status).toBe(502);

    // Deleting this would let a third delivery claim the key and submit a
    // second order while the second delivery is still working.
    const stored = JSON.parse(env.MOCKUP_STAGING._store.get(KEY));
    expect(stored.status).toBe('pending');
    expect(stored.claimId).toBe('some-other-delivery');
  });

  it('still releases the claim it does own, so a refused order stays recoverable', async () => {
    // The guard must not over-correct into never releasing: this is the
    // ordinary refusal path, where releasing is what makes a fix-and-replay
    // work at all.
    const env = makeEnv();
    vi.stubGlobal('fetch', makeUpstreamFetch({
      order: defaultOrder({ lineItems: { edges: [{ node: {
        sku: 'CUSTOM-1700000000000-L', quantity: 1, title: 'Custom Dot Rise 2',
        product: { id: 'gid://shopify/Product/9002', metafield: null },
      } }] } }),
    }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(422);
    expect(env.MOCKUP_STAGING._store.has(KEY)).toBe(false);
  });
});

// ── POST /webhook/order-paid — Printful error formatting ────────────────────

describe('POST /webhook/order-paid — Printful error reporting', () => {
  function printfulErrorResponse(errBody) {
    return vi.fn(async (url, opts = {}) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/admin/oauth/access_token')) return jsonRes({ access_token: 't', expires_in: 3600 });
      if (u === 'https://api.printful.com/products/71') {
        return jsonRes({ result: { variants: [{ id: 4017, size: 'M', color: 'Black' }] } });
      }
      if (u === 'https://api.printful.com/orders') return jsonRes(errBody);
      if (u.includes('/admin/api/')) return jsonRes({ data: { order: defaultOrder() } });
      throw new Error('Unmocked fetch in test: ' + u);
    });
  }

  it('keeps the diagnostic when Printful returns a non-string result', async () => {
    // `new Error(someObject)` stringifies to "[object Object]", which threw
    // away the only diagnostic on the one branch that reports one.
    const env = makeEnv();
    vi.stubGlobal('fetch', printfulErrorResponse({
      code: 400,
      result: { reason: 'variant_id 4017 is unavailable', field: 'items[0]' },
    }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.error).not.toMatch(/\[object Object\]/);
    expect(json.error).toMatch(/variant_id 4017 is unavailable/);
  });

  it('redacts the recipient Printful echoes back in an error body', async () => {
    // Same customer data the success path was changed to stop logging — the
    // failure path serializes the response, so it has to strip it too.
    const env = makeEnv();
    vi.stubGlobal('fetch', printfulErrorResponse({
      code: 400,
      result: {
        reason: 'Invalid shipping destination',
        recipient: { name: 'Jane Doe', address1: '123 Main St', phone: '5035551234', email: 'buyer@example.com' },
      },
    }));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
      const json = await res.json();
      const logged = errSpy.mock.calls.map(args => args.join(' ')).join('\n');

      for (const sink of [json.error, logged]) {
        expect(sink).not.toMatch(/123 Main St/);
        expect(sink).not.toMatch(/5035551234/);
        expect(sink).not.toMatch(/buyer@example\.com/);
      }
      // The actionable part still comes through.
      expect(json.error).toMatch(/Invalid shipping destination/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('still uses the plain string result when Printful sends one', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', printfulErrorResponse({ code: 400, result: 'Invalid recipient' }));

    const res = await worker.fetch(await webhookRequest({ id: 555000111 }), env);
    expect((await res.json()).error).toMatch(/Invalid recipient/);
  });
});
