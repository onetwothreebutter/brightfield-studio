// @vitest-environment node
//
// Coverage for /save-preview and /create-product — the two endpoints behind the
// custom-shader-design Add to Cart flow (see sections/main-product.liquid). These
// had zero test coverage before: createShopifyProduct() alone drives ~15 sequential
// Shopify Admin API calls, several of which are only best-effort (logged, not
// fatal), so it's the most failure-prone part of the checkout path and the part
// least protected against regressions.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getShopifyToken/getPrintfulSizes/getOnlineStorePublicationId/getPrintfulLocationId
// are cached in module-level `let` variables, not per-request state. Re-importing
// the module fresh for every test (instead of importing once at the top) keeps
// those caches from leaking between tests.
let worker, pickSizeVariant;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  worker = mod.default;
  pickSizeVariant = mod.pickSizeVariant;
});

afterEach(() => vi.unstubAllGlobals());

// ── R2 in-memory mock ─────────────────────────────────────────────────────────
function makeR2() {
  const store = new Map();
  return {
    _store: store,
    get:    vi.fn(async (key) => {
      if (!store.has(key)) return null;
      return { text: async () => store.get(key) };
    }),
    put:    vi.fn(async (key, value) => { store.set(key, typeof value === 'string' ? value : String(value)); }),
    // Was a no-op stub, unlike the real R2 binding and the other makeR2 mocks in
    // this suite (worker.test.js, worker-designs.test.js) — a test that put()s a
    // key, delete()s it, then get()s it again would have silently seen the stale
    // value instead of null.
    delete: vi.fn(async (key) => { store.delete(key); }),
  };
}

function makeEnv(overrides = {}) {
  return {
    MOCKUP_STAGING:      makeR2(),
    R2_PUBLIC_DOMAIN:    'r2.example.com',
    SHOPIFY_STORE_DOMAIN: 'brightfield-2.myshopify.com',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_ID:     'client-id',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET: 'client-secret',
    PRINTFUL_API_KEY: 'printful-key',
    ...overrides,
  };
}

function makeRequest(method, path, body, origin = 'https://brightfield-2.myshopify.com', headers = {}) {
  const init = { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://worker.example.com${path}`, init);
}

function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// Router-style fetch mock covering every call createShopifyProduct/handleCreateProduct
// makes: the OAuth token endpoint, Printful sizes, the product media fetch, and every
// Shopify Admin GraphQL mutation/query in the chain. `overrides` lets individual tests
// force one step to fail without hand-rolling the whole chain each time.
function makeShopifyFetch(overrides = {}) {
  const calls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push({ url: u, opts });

    if (u.includes('/admin/oauth/access_token')) {
      return jsonRes({ access_token: 'test-token', expires_in: 3600 });
    }
    if (u.startsWith('https://api.printful.com/products/')) {
      if (overrides.printfulSizesFail) return { ok: false, status: 500 };
      return jsonRes({ result: { variants: [{ size: 'S' }, { size: 'M' }, { size: 'L' }] } });
    }
    // Media resize fetch (cf.image path) — force it to fail so createShopifyProduct
    // falls back to using the original media URL directly; keeps the mock focused
    // on the Admin API chain instead of image-resize plumbing.
    if (!u.includes('/admin/api/')) {
      return { ok: false, status: 500 };
    }

    const body = JSON.parse(opts.body);
    const query = body.query || '';

    if (query.includes('mutation CreateProduct')) {
      if (overrides.createProductTransportFails) {
        throw new TypeError('Network connection lost');
      }
      if (overrides.productCreateUserErrors) {
        return jsonRes({ data: { productCreate: { product: null, userErrors: overrides.productCreateUserErrors } } });
      }
      if (overrides.productCreateNoVariant) {
        return jsonRes({ data: { productCreate: {
          product: { id: 'gid://shopify/Product/999', handle: 'custom-design-999', variants: { edges: [] } },
          userErrors: [],
        } } });
      }
      return jsonRes({ data: { productCreate: {
        product: {
          id: 'gid://shopify/Product/999',
          handle: 'custom-design-999',
          variants: { edges: [{ node: {
            id: 'gid://shopify/ProductVariant/9991',
            inventoryItem: { id: 'gid://shopify/InventoryItem/8881' },
          } }] },
        },
        userErrors: [],
      } } });
    }

    if (query.includes('mutation CreateOptions')) {
      if (overrides.optionsCreateFails) {
        return jsonRes({ data: { productOptionsCreate: { product: null, userErrors: [{ field: 'options', message: 'boom' }] } } });
      }
      return jsonRes({ data: { productOptionsCreate: { product: {
        variants: { edges: [
          { node: { id: 'gid://shopify/ProductVariant/9991', inventoryItem: { id: 'gid://shopify/InventoryItem/8881' }, selectedOptions: [{ name: 'Size', value: 'S' }] } },
          { node: { id: 'gid://shopify/ProductVariant/9992', inventoryItem: { id: 'gid://shopify/InventoryItem/8882' }, selectedOptions: [{ name: 'Size', value: 'M' }] } },
          { node: { id: 'gid://shopify/ProductVariant/9993', inventoryItem: { id: 'gid://shopify/InventoryItem/8883' }, selectedOptions: [{ name: 'Size', value: 'L' }] } },
        ] },
      }, userErrors: [] } } });
    }

    if (query.includes('mutation UpdateVariants')) {
      return jsonRes({ data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } } });
    }
    if (query.includes('mutation ResetInventoryPolicy')) {
      return jsonRes({ data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } } });
    }
    if (query.includes('mutation UpdateInventoryItem')) {
      return jsonRes({ data: { inventoryItemUpdate: { inventoryItem: { id: 'inv', sku: 'CUSTOM-1' }, userErrors: [] } } });
    }
    if (query.includes('mutation UntrackInventoryItem')) {
      return jsonRes({ data: { inventoryItemUpdate: { inventoryItem: { id: 'inv', tracked: false }, userErrors: [] } } });
    }
    if (query.includes('mutation ActivateInventory')) {
      return jsonRes({ data: { inventoryActivate: { inventoryLevel: { id: 'lvl' }, userErrors: [] } } });
    }
    if (query.includes('publications(')) {
      return jsonRes({ data: { publications: { edges: [{ node: { id: 'gid://shopify/Publication/1', name: 'Online Store' } }] } } });
    }
    if (query.includes('mutation Publish')) {
      if (overrides.publishFails) {
        return jsonRes({ data: { publishablePublish: { publishable: null, userErrors: [{ field: 'id', message: 'nope' }] } } });
      }
      return jsonRes({ data: { publishablePublish: { publishable: { id: 'gid://shopify/Product/999', status: 'ACTIVE' }, userErrors: [] } } });
    }
    if (query.includes('fulfillmentServices')) {
      return jsonRes({ data: { shop: { fulfillmentServices: [{ handle: 'printful', serviceName: 'Printful', location: { id: 'gid://shopify/Location/1' } }] } } });
    }
    if (query.includes('mutation AssignShippingProfile')) {
      return jsonRes({ data: { deliveryProfileUpdate: { profile: { id: 'p', name: 'US Flat Rate' }, userErrors: [] } } });
    }
    if (query.includes('query GetVariant')) {
      if (overrides.variantLookupFails) {
        return jsonRes({ data: { node: null } });
      }
      return jsonRes({ data: { node: {
        title: 'Medium',
        price: '25.00',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        product: { title: 'Dot Rise' },
      } } });
    }

    // REST publish fallback
    if (u.includes('/admin/api/2025-01/products/') && u.endsWith('.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ product: { published_at: '2026-01-01T00:00:00Z' } }) };
    }

    throw new Error('Unmocked fetch in test: ' + u + ' body=' + (opts.body || ''));
  });
  fn.calls = calls;
  return fn;
}

function createProductBody(overrides = {}) {
  return {
    designUrl:        'https://r2.example.com/designs/abc.png',
    mockupUrl:        'https://r2.example.com/mockups/abc.jpg',
    checkoutImageUrl: 'https://r2.example.com/checkouts/abc.png',
    shader:           'rise-shirt',
    productHandle:    'dot-rise',
    values:           { u_speed: 1.2 },
    variantId:        '111111',
    ...overrides,
  };
}

// ── POST /save-preview ────────────────────────────────────────────────────────

describe('POST /save-preview', () => {
  it('returns 400 when designImage or mockupImage is missing', async () => {
    const res = await worker.fetch(makeRequest('POST', '/save-preview', { mockupImage: btoa('m') }), makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('https://worker.example.com/save-preview', {
      method: 'POST',
      headers: { Origin: 'https://brightfield-2.myshopify.com', 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('uploads design, mockup, and checkout images and returns their R2 URLs', async () => {
    const env = makeEnv();
    const res = await worker.fetch(makeRequest('POST', '/save-preview', {
      designImage:   btoa('design-bytes'),
      mockupImage:   btoa('mockup-bytes'),
      checkoutImage: btoa('checkout-bytes'),
      shader:        'rise-shirt',
      productHandle: 'dot-rise',
      values:        { u_speed: 1.2 },
    }), env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.design_url).toContain('r2.example.com/designs/');
    expect(body.mockup_url).toContain('r2.example.com/mockups/');
    expect(body.checkout_image_url).toContain('r2.example.com/checkouts/');
    expect(env.MOCKUP_STAGING.put).toHaveBeenCalledTimes(3);
  });

  it('saves a device-designs entry and returns an id when deviceId is present', async () => {
    const env = makeEnv();
    const res = await worker.fetch(makeRequest('POST', '/save-preview', {
      designImage: btoa('d'),
      mockupImage: btoa('m'),
      deviceId:    'dev-1',
      shader:      'rise-shirt',
    }), env);

    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(env.MOCKUP_STAGING._store.has(`device-designs/dev-1.json`)).toBe(true);
  });

  it('does not save a device-designs entry and returns id: null when deviceId is absent', async () => {
    const env = makeEnv();
    const res = await worker.fetch(makeRequest('POST', '/save-preview', {
      designImage: btoa('d'),
      mockupImage: btoa('m'),
    }), env);

    const body = await res.json();
    expect(body.id).toBeNull();
    expect([...env.MOCKUP_STAGING._store.keys()].some((k) => k.startsWith('device-designs/'))).toBe(false);
  });
});

// ── POST /create-product ──────────────────────────────────────────────────────

describe('POST /create-product', () => {
  it('returns 400 when designUrl, mockupUrl, or variantId is missing', async () => {
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody({ variantId: undefined })), makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('https://worker.example.com/create-product', {
      method: 'POST',
      headers: { Origin: 'https://brightfield-2.myshopify.com', 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 502 when the source variant lookup fails', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch({ variantLookupFails: true }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(502);
  });

  it('happy path: creates the product, sizes, price, and returns the new variant', async () => {
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.productId).toBe('999');
    expect(body.handle).toBe('custom-design-999');
    // Size 'M' was requested (selectedOptions on the source variant) — should match
    // the M-size variant created by productOptionsCreate, not just the first one.
    expect(body.variantId).toBe('9992');

    // Price + tags carried from the source variant into the new product
    const createCall = fetchMock.calls.find((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    const createVars = JSON.parse(createCall.opts.body).variables;
    expect(createVars.input.title).toBe('Custom Dot Rise');
    expect(createVars.input.tags).toEqual(expect.arrayContaining(['custom-design', 'shader-rise-shirt']));

    const priceCall = fetchMock.calls.find((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation UpdateVariants'));
    const priceVars = JSON.parse(priceCall.opts.body).variables;
    expect(priceVars.variants.every((v) => v.price === '25.00')).toBe(true);
  });

  it('returns the cached product on a repeat request with the same createProductKey instead of creating a duplicate', async () => {
    // Regression test: a client-side timeout on /create-product doesn't mean
    // createShopifyProduct() failed server-side — it may have finished just as
    // the client gave up and retried with the same key.
    const env = makeEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const body = createProductBody({ createProductKey: 'key-abc-123' });
    const first = await worker.fetch(makeRequest('POST', '/create-product', body), env);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await worker.fetch(makeRequest('POST', '/create-product', body), env);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    // Same product, plus the idempotent marker so callers can tell a cache hit
    // from a fresh creation
    expect(secondBody).toEqual({ ...firstBody, idempotent: true });

    // Only the first request should have actually run productCreate — the
    // repeat should be served from the idempotency cache, not create a
    // second Shopify product.
    const createCalls = fetchMock.calls.filter((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    expect(createCalls).toHaveLength(1);
  });

  it('creates a distinct product for a different createProductKey (no false-positive cache hit)', async () => {
    const env = makeEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(makeRequest('POST', '/create-product', createProductBody({ createProductKey: 'key-one' })), env);
    await worker.fetch(makeRequest('POST', '/create-product', createProductBody({ createProductKey: 'key-two' })), env);

    const createCalls = fetchMock.calls.filter((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    expect(createCalls).toHaveLength(2);
  });

  it('creates a distinct product on every request when no createProductKey is provided (backward compatible)', async () => {
    const env = makeEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), env);
    await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), env);

    const createCalls = fetchMock.calls.filter((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    expect(createCalls).toHaveLength(2);
  });

  it('merges extraTags (used by E2E tests to tag disposable products) into the product tags', async () => {
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(makeRequest('POST', '/create-product', createProductBody({ extraTags: ['e2e-test'] })), makeEnv());

    const createCall = fetchMock.calls.find((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    const createVars = JSON.parse(createCall.opts.body).variables;
    expect(createVars.input.tags).toEqual(expect.arrayContaining(['e2e-test']));
  });

  it('returns 422 with the Shopify error message when productCreate reports userErrors', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch({ productCreateUserErrors: [{ field: ['title'], message: 'Title cannot be blank' }] }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Title cannot be blank');
  });

  it('returns 422 when productCreate succeeds but returns no variant', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch({ productCreateNoVariant: true }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(422);
  });

  // createShopifyProduct() runs ~15 sequential Admin API calls; only the first
  // (productCreate) is exercised here, but any of them failing at the transport
  // level (not a Shopify userErrors response) should classify the same way — a
  // 502, matching the GetVariant lookup's classification above, not a 422 as if
  // the customer's input were the problem.
  it('returns 502 (not 422) when a call inside createShopifyProduct fails at the transport level', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch({ createProductTransportFails: true }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Network connection lost');
  });

  it('falls back to the default variant when productOptionsCreate (size setup) fails non-fatally', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch({ optionsCreateFails: true }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    // The size-option step is best-effort — a failure there should not abort the
    // whole product creation, since the shopper still gets an addable product.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.variantId).toBe('9991'); // original default variant, no Size option
  });

  it('falls back to REST publish when the GraphQL publishablePublish call fails', async () => {
    const fetchMock = makeShopifyFetch({ publishFails: true });
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(200);

    const restPublishCall = fetchMock.calls.find((c) => c.url.includes('/admin/api/2025-01/products/999.json') && c.opts.method === 'PUT');
    expect(restPublishCall).toBeDefined();
  });

  // ── In-house branch (scripts/create-inhouse-designs.mjs) ──────────────────
  // inhouse: true lets an admin-authenticated caller set the product title,
  // description, and inhouse-design tag. The endpoint is public, so this branch
  // must be locked behind requireAdmin and must never leak into the anonymous path.

  const ADMIN = 'test-admin-token';
  const authHeader = { Authorization: `Bearer ${ADMIN}` };

  function inhouseBody(overrides = {}) {
    return createProductBody({
      shader: 'contour-pareidolia',
      productHandle: 'contour-pareidolia',
      inhouse: true,
      productTitle: 'Contour Pareidolia — High Desert',
      descriptionHtml: '<p>A dense topographic study.</p>',
      ...overrides,
    });
  }

  it('rejects inhouse: true without admin auth (403, no Shopify calls)', async () => {
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(makeRequest('POST', '/create-product', inhouseBody()), makeEnv({ ADMIN_TOKEN: ADMIN }));
    expect(res.status).toBe(403);
    // Fail loudly, never fall through to minting a mis-titled "Custom …" product
    expect(fetchMock.calls.filter((c) => c.url.includes('graphql.json'))).toHaveLength(0);
  });

  it('rejects inhouse: true with admin auth but no productTitle (400)', async () => {
    vi.stubGlobal('fetch', makeShopifyFetch());
    const res = await worker.fetch(
      makeRequest('POST', '/create-product', inhouseBody({ productTitle: '  ' }), undefined, authHeader),
      makeEnv({ ADMIN_TOKEN: ADMIN })
    );
    expect(res.status).toBe(400);
  });

  it('authenticated inhouse request sets title, description, inhouse-design tag, INHOUSE SKUs, and mockup media', async () => {
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(
      makeRequest('POST', '/create-product', inhouseBody(), undefined, authHeader),
      makeEnv({ ADMIN_TOKEN: ADMIN })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.productTitle).toBe('Contour Pareidolia — High Desert');

    const createCall = fetchMock.calls.find((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    const createVars = JSON.parse(createCall.opts.body).variables;
    expect(createVars.input.title).toBe('Contour Pareidolia — High Desert');
    expect(createVars.input.descriptionHtml).toBe('<p>A dense topographic study.</p>');
    expect(createVars.input.tags).toEqual(expect.arrayContaining(['inhouse-design', 'shader-contour-pareidolia']));
    expect(createVars.input.tags).not.toContain('custom-design');
    // Featured image = shirt mockup (collection-grid merchandising), not the
    // design-on-black checkout image the anonymous path uses
    expect(createVars.media[0].originalSource).toBe('https://r2.example.com/mockups/abc.jpg');

    const skuCalls = fetchMock.calls.filter((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation UpdateInventoryItem'));
    expect(skuCalls.length).toBeGreaterThan(0);
    for (const c of skuCalls) {
      expect(JSON.parse(c.opts.body).variables.input.sku).toMatch(/^INHOUSE-/);
    }
  });

  it('marks the idempotency-cache response so re-runs can tell "created" from "already existed"', async () => {
    const env = makeEnv({ ADMIN_TOKEN: ADMIN });
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const body = inhouseBody({ createProductKey: 'inhouse-contour-pareidolia-high-desert-v1' });
    const first = await worker.fetch(makeRequest('POST', '/create-product', body, undefined, authHeader), env);
    const firstBody = await first.json();
    expect(firstBody.idempotent).toBeUndefined();

    const second = await worker.fetch(makeRequest('POST', '/create-product', body, undefined, authHeader), env);
    const secondBody = await second.json();
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.productTitle).toBe(firstBody.productTitle);

    const createCalls = fetchMock.calls.filter((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    expect(createCalls).toHaveLength(1);
  });

  it('ignores productTitle/descriptionHtml on anonymous requests (regression pin for the public path)', async () => {
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    // No inhouse flag, no auth — the title/description fields must have no effect
    const res = await worker.fetch(makeRequest('POST', '/create-product',
      createProductBody({ productTitle: 'Evil Title', descriptionHtml: '<p>spam</p>' })), makeEnv());
    expect(res.status).toBe(200);

    const createCall = fetchMock.calls.find((c) => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation CreateProduct'));
    const createVars = JSON.parse(createCall.opts.body).variables;
    expect(createVars.input.title).toBe('Custom Dot Rise');
    expect(createVars.input.descriptionHtml).toBe('');
    expect(createVars.input.tags).toContain('custom-design');
    expect(createVars.input.tags).not.toContain('inhouse-design');
  });

  it('serves GET /inhouse/version as the deploy preflight', async () => {
    const res = await worker.fetch(makeRequest('GET', '/inhouse/version'), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
  });

  it('returns a clean 502 (not an unhandled rejection) when the initial variant lookup request fails outright', async () => {
    // Regression test: the GetVariant lookup used to run outside any try/catch,
    // so a transport-level failure (as opposed to a valid-but-empty response)
    // threw out of the Worker's fetch() handler entirely — the browser would see
    // an opaque network/CORS error instead of the JSON error body the client-side
    // retry logic parses.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = url.toString();
      if (u.includes('/admin/oauth/access_token')) return jsonRes({ access_token: 'test-token', expires_in: 3600 });
      throw new Error('network unreachable');
    }));
    const res = await worker.fetch(makeRequest('POST', '/create-product', createProductBody()), makeEnv());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Could not look up variant');
  });
});
