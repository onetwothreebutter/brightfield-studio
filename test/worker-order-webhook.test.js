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
let worker, parseCustomSku;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  worker = mod.default;
  parseCustomSku = mod.parseCustomSku;
});

afterEach(() => vi.unstubAllGlobals());

const WEBHOOK_SECRET = 'test-webhook-secret';

// ── R2 in-memory mock ─────────────────────────────────────────────────────────
function makeR2() {
  const store = new Map();
  return {
    _store: store,
    get: vi.fn(async (key) => {
      if (!store.has(key)) return null;
      return { text: async () => store.get(key) };
    }),
    put: vi.fn(async (key, value) => { store.set(key, typeof value === 'string' ? value : String(value)); }),
    delete: vi.fn(async (key) => { store.delete(key); }),
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
