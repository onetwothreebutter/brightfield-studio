// @vitest-environment node
//
// Coverage for issue #550 — garbage collection of abandoned custom-design/
// community-design products and their orphaned R2 blobs. Exercises:
//   - GET /admin/gc-dry-run (always dry-run, admin-gated, on-demand report)
//   - the scheduled() Cron Trigger handler (gated by env.GC_DRY_RUN)
//   - the per-SKU order-check query shape (exact search syntax matters —
//     see PR description for how it was verified against Shopify's docs)
//   - fail-closed behavior: anything unverifiable is kept, never deleted
//   - R2 blob sweep: reference-checked prefixes (designs/, mockups/) survive
//     when pointed at by a live product's metafields; age-only prefixes
//     (product-images/, checkouts/, create-product-keys/) don't; shader-states/
//     is never touched at all (unrelated durable share-link feature).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let worker;

beforeEach(async () => {
  // getShopifyToken() caches in a module-level `let` — re-import fresh per
  // test so that cache (and any other module state) can't leak between tests,
  // same reasoning as worker-create-product.test.js.
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  worker = mod.default;
});

afterEach(() => vi.unstubAllGlobals());

// ── R2 mock with .list() support ─────────────────────────────────────────────
// The other test files' makeR2() mocks don't implement .list() (GC is the
// first thing in this worker that needs to enumerate R2 objects by prefix
// with an uploaded timestamp), so this one is purpose-built for that.
function makeGcR2(objects = []) {
  const store = new Map(objects.map(o => [o.key, o]));
  return {
    _store: store,
    list: vi.fn(async ({ prefix, cursor, limit }) => {
      const all = Array.from(store.values())
        .filter(o => o.key.startsWith(prefix))
        .sort((a, b) => a.key.localeCompare(b.key));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + (limit || 1000));
      const truncated = start + (limit || 1000) < all.length;
      return {
        objects: page.map(o => ({ key: o.key, uploaded: o.uploaded, size: o.size || 100 })),
        truncated,
        cursor: truncated ? String(start + (limit || 1000)) : undefined,
      };
    }),
    delete: vi.fn(async (key) => { store.delete(key); }),
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  };
}

function makeEnv(overrides = {}) {
  return {
    MOCKUP_STAGING: makeGcR2(),
    ADMIN_TOKEN: 'test-secret',
    SHOPIFY_STORE_DOMAIN: 'brightfield-2.myshopify.com',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_ID: 'client-id',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET: 'client-secret',
    R2_PUBLIC_DOMAIN: 'r2.example.com',
    ...overrides,
  };
}

function adminHeaders() {
  return { Authorization: 'Bearer test-secret' };
}

function getReq(path, headers = {}) {
  return new Request(`https://worker.example.com${path}`, { headers });
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// gid helper
const gid = (n) => `gid://shopify/Product/${n}`;

// Builds a product node for the GCListCandidateProducts response shape.
function productNode({ id, createdAt, skus = [], designUrl = null, mockupUrl = null, title = 'Custom Design' }) {
  return {
    id: gid(id),
    title,
    handle: `custom-design-${id}`,
    createdAt,
    variants: { edges: skus.map(sku => ({ node: { sku } })) },
    designUrlMeta: designUrl ? { value: designUrl } : null,
    mockupUrlMeta: mockupUrl ? { value: mockupUrl } : null,
  };
}

// Router-style fetch mock covering the OAuth token endpoint and the three
// GraphQL operations runGc() makes: GCListCandidateProducts, GCCheckSkuOrders,
// GCDeleteProduct.
//   products      — array of product nodes (single page unless `pageSize` given)
//   ordersForSkus — function(skuQueryString) => boolean, decides whether the
//                   combined `sku:"A" OR sku:"B"` query "matches" an order
//   ordersQueryFails — if true, every orders query returns a GraphQL error
//   deleteFails   — if true, every productDelete mutation fails
function makeGcFetch({ products = [], pageSize = 250, ordersForSkus = () => false, ordersQueryFails = false, deleteFails = false } = {}) {
  const deleteCalls = [];
  const orderQueryCalls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('/admin/oauth/access_token')) {
      return jsonRes({ access_token: 'test-token', expires_in: 3600 });
    }
    if (!u.includes('/admin/api/')) {
      return { ok: false, status: 500 };
    }
    const body = JSON.parse(opts.body);
    const query = body.query || '';
    const variables = body.variables || {};

    if (query.includes('GCListCandidateProducts')) {
      const cursor = variables.cursor ? Number(variables.cursor) : 0;
      const page = products.slice(cursor, cursor + pageSize);
      const hasNextPage = cursor + pageSize < products.length;
      return jsonRes({
        data: {
          products: {
            edges: page.map(node => ({ node })),
            pageInfo: { hasNextPage, endCursor: hasNextPage ? String(cursor + pageSize) : null },
          },
        },
      });
    }

    if (query.includes('GCCheckSkuOrders')) {
      orderQueryCalls.push(variables.skuQuery);
      if (ordersQueryFails) {
        return jsonRes({ errors: [{ message: 'Throttled' }] });
      }
      const matched = ordersForSkus(variables.skuQuery);
      return jsonRes({
        data: { orders: { edges: matched ? [{ node: { id: 'gid://shopify/Order/1', name: '#1001' } }] : [] } },
      });
    }

    if (query.includes('GCDeleteProduct')) {
      deleteCalls.push(variables.id);
      if (deleteFails) {
        return jsonRes({ data: { productDelete: { deletedProductId: null, userErrors: [{ field: 'id', message: 'boom' }] } } });
      }
      return jsonRes({ data: { productDelete: { deletedProductId: variables.id, userErrors: [] } } });
    }

    throw new Error('Unmocked GraphQL query in test: ' + query.slice(0, 60));
  });
  fn.deleteCalls = deleteCalls;
  fn.orderQueryCalls = orderQueryCalls;
  return fn;
}

// ── GET /admin/gc-dry-run — auth ──────────────────────────────────────────────

describe('GET /admin/gc-dry-run — auth', () => {
  it('returns 401 without an admin token', async () => {
    vi.stubGlobal('fetch', makeGcFetch());
    const res = await worker.fetch(getReq('/admin/gc-dry-run'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 200 with a valid admin bearer token', async () => {
    vi.stubGlobal('fetch', makeGcFetch());
    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    expect(res.status).toBe(200);
  });
});

// ── GET /admin/gc-dry-run — product pass ──────────────────────────────────────

describe('GET /admin/gc-dry-run — product pass', () => {
  it('deletes-in-report a product that is old with no matching order, without calling productDelete', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 1, createdAt: daysAgoIso(45), skus: ['CUSTOM-1111-M'] })],
      ordersForSkus: () => false,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.dryRun).toBe(true);
    expect(report.products.checked).toBe(1);
    expect(report.products.deleted).toHaveLength(1);
    expect(report.products.deleted[0].id).toBe(gid(1));
    expect(report.products.deleted[0].reason).toMatch(/dry run/);
    expect(report.products.kept).toHaveLength(0);
    // The whole point of dry-run: never actually calls productDelete.
    expect(shopifyFetch.deleteCalls).toHaveLength(0);
  });

  it('keeps a product younger than the age cutoff without even checking orders', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 2, createdAt: daysAgoIso(5), skus: ['CUSTOM-2222-M'] })],
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.kept).toHaveLength(1);
    expect(report.products.kept[0].reason).toBe('not old enough');
    expect(report.products.deleted).toHaveLength(0);
    // No order check should have run at all for a too-young product.
    expect(shopifyFetch.orderQueryCalls).toHaveLength(0);
  });

  it('keeps an old product that has a matching order', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 3, createdAt: daysAgoIso(45), skus: ['CUSTOM-3333-M'] })],
      ordersForSkus: (q) => q.includes('CUSTOM-3333-M'),
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.kept).toHaveLength(1);
    expect(report.products.kept[0].reason).toBe('has a matching order');
    expect(report.products.deleted).toHaveLength(0);
  });

  it('checks every size variant SKU in a single combined query (one Admin API call per product)', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 4, createdAt: daysAgoIso(45), skus: ['CUSTOM-4444-S', 'CUSTOM-4444-M', 'CUSTOM-4444-L'] })],
      ordersForSkus: () => false,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());

    expect(shopifyFetch.orderQueryCalls).toHaveLength(1);
    const q = shopifyFetch.orderQueryCalls[0];
    expect(q).toContain('sku:"CUSTOM-4444-S"');
    expect(q).toContain('sku:"CUSTOM-4444-M"');
    expect(q).toContain('sku:"CUSTOM-4444-L"');
    expect(q).toMatch(/ OR /);
  });

  it('quotes SKU values in the search query (verified syntax: sku:"VALUE", per Shopify Admin GraphQL orders search docs)', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 5, createdAt: daysAgoIso(45), skus: ['CUSTOM-1699999999999-M'] })],
    });
    vi.stubGlobal('fetch', shopifyFetch);

    await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());

    expect(shopifyFetch.orderQueryCalls[0]).toBe('sku:"CUSTOM-1699999999999-M"');
  });

  it('keeps a product (does not delete) when the order check itself fails — fail closed', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 6, createdAt: daysAgoIso(45), skus: ['CUSTOM-6666-M'] })],
      ordersQueryFails: true,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.deleted).toHaveLength(0);
    expect(report.products.kept).toHaveLength(1);
    expect(report.products.kept[0].reason).toMatch(/order check failed/);
  });

  it('keeps a product with no SKU on any variant — cannot verify, fail closed', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 7, createdAt: daysAgoIso(45), skus: [] })],
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.deleted).toHaveLength(0);
    expect(report.products.kept).toHaveLength(1);
    expect(report.products.kept[0].reason).toMatch(/order check failed/);
    expect(shopifyFetch.orderQueryCalls).toHaveLength(0); // never even reached the orders query
  });

  it('keeps a product with an unparseable createdAt rather than guessing its age', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 8, createdAt: 'not-a-date', skus: ['CUSTOM-8888-M'] })],
    });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.kept).toHaveLength(1);
    expect(report.products.kept[0].reason).toMatch(/unparseable createdAt/);
  });

  it('pages through multiple pages of candidate products', async () => {
    const products = Array.from({ length: 3 }, (_, i) =>
      productNode({ id: 100 + i, createdAt: daysAgoIso(45), skus: [`CUSTOM-${100 + i}-M`] })
    );
    const shopifyFetch = makeGcFetch({ products, pageSize: 1, ordersForSkus: () => false });
    vi.stubGlobal('fetch', shopifyFetch);

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv());
    const report = await res.json();

    expect(report.products.checked).toBe(3);
    expect(report.products.deleted).toHaveLength(3);
  });
});

// ── GET /admin/gc-dry-run — R2 blob sweep ────────────────────────────────────

describe('GET /admin/gc-dry-run — R2 blob sweep', () => {
  it('reports an orphaned, old designs/ blob as deletable without deleting it', async () => {
    const r2 = makeGcR2([
      { key: 'designs/orphan.png', uploaded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    vi.stubGlobal('fetch', makeGcFetch({ products: [] }));

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    expect(report.blobs.deleted.map(b => b.key)).toContain('designs/orphan.png');
    expect(r2.delete).not.toHaveBeenCalled();
  });

  it('keeps a designs/ blob referenced by a live (kept) product metafield', async () => {
    const r2 = makeGcR2([
      { key: 'designs/live.png', uploaded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    const products = [
      productNode({
        id: 9,
        createdAt: daysAgoIso(45),
        skus: ['CUSTOM-9999-M'],
        designUrl: 'https://share.brightfield.studio/img/designs/live.png',
      }),
    ];
    vi.stubGlobal('fetch', makeGcFetch({ products, ordersForSkus: (q) => q.includes('CUSTOM-9999-M') })); // has an order -> kept

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    const keptKeys = report.blobs.kept.map(b => b.key);
    expect(keptKeys).toContain('designs/live.png');
    expect(report.blobs.deleted.map(b => b.key)).not.toContain('designs/live.png');
  });

  it('does NOT keep a designs/ blob whose only referencing product is itself being deleted this run', async () => {
    const r2 = makeGcR2([
      { key: 'designs/about-to-be-orphaned.png', uploaded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    const products = [
      productNode({
        id: 10,
        createdAt: daysAgoIso(45),
        skus: ['CUSTOM-1010-M'],
        designUrl: 'https://share.brightfield.studio/img/designs/about-to-be-orphaned.png',
      }),
    ];
    vi.stubGlobal('fetch', makeGcFetch({ products, ordersForSkus: () => false })); // no order -> deleted

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    expect(report.products.deleted).toHaveLength(1);
    expect(report.blobs.deleted.map(b => b.key)).toContain('designs/about-to-be-orphaned.png');
  });

  it('keeps a designs/ blob that is not old enough regardless of reference', async () => {
    const r2 = makeGcR2([
      { key: 'designs/too-new.png', uploaded: new Date() }, // uploaded just now
    ]);
    vi.stubGlobal('fetch', makeGcFetch({ products: [] }));

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    const kept = report.blobs.kept.find(b => b.key === 'designs/too-new.png');
    expect(kept).toBeDefined();
    expect(kept.reason).toBe('not old enough');
  });

  it('sweeps age-only prefixes (product-images/, checkouts/, create-product-keys/) purely on age, no reference check', async () => {
    const r2 = makeGcR2([
      { key: 'product-images/old.jpg', uploaded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      { key: 'checkouts/old.png', uploaded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      { key: 'create-product-keys/old.json', uploaded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    ]);
    vi.stubGlobal('fetch', makeGcFetch({ products: [] }));

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    const deletedKeys = report.blobs.deleted.map(b => b.key);
    expect(deletedKeys).toContain('product-images/old.jpg');
    expect(deletedKeys).toContain('checkouts/old.png');
    expect(deletedKeys).toContain('create-product-keys/old.json');
  });

  it('never lists or touches shader-states/ — unrelated durable share-link feature, excluded by design', async () => {
    const r2 = makeGcR2([
      { key: 'shader-states/some-share-link.json', uploaded: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    ]);
    vi.stubGlobal('fetch', makeGcFetch({ products: [] }));

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    const allKeys = [...report.blobs.deleted, ...report.blobs.kept].map(b => b.key);
    expect(allKeys).not.toContain('shader-states/some-share-link.json');
    // Confirm .list() was never even called with that prefix.
    expect(r2.list).not.toHaveBeenCalledWith(expect.objectContaining({ prefix: 'shader-states/' }));
  });

  it('paginates R2 .list() across multiple pages per prefix', async () => {
    const objects = Array.from({ length: 3 }, (_, i) => ({
      key: `designs/orphan-${i}.png`,
      uploaded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    }));
    const r2 = makeGcR2(objects);
    // Force one object per .list() page to exercise the cursor/truncated loop.
    const originalList = r2.list.getMockImplementation();
    r2.list.mockImplementation((opts) => originalList({ ...opts, limit: 1 }));
    vi.stubGlobal('fetch', makeGcFetch({ products: [] }));

    const res = await worker.fetch(getReq('/admin/gc-dry-run', adminHeaders()), makeEnv({ MOCKUP_STAGING: r2 }));
    const report = await res.json();

    expect(r2.list.mock.calls.length).toBeGreaterThan(1);
    const deletedKeys = report.blobs.deleted.map(b => b.key);
    expect(deletedKeys).toEqual(expect.arrayContaining(['designs/orphan-0.png', 'designs/orphan-1.png', 'designs/orphan-2.png']));
  });
});

// ── scheduled() — Cron Trigger handler ───────────────────────────────────────

describe('scheduled() — Cron Trigger handler', () => {
  it('defaults to dry-run (GC_DRY_RUN unset) — never calls productDelete or R2 delete', async () => {
    const r2 = makeGcR2([
      { key: 'designs/orphan.png', uploaded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 11, createdAt: daysAgoIso(45), skus: ['CUSTOM-1111-M'] })],
      ordersForSkus: () => false,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    await worker.scheduled({}, makeEnv({ MOCKUP_STAGING: r2 }), {});

    expect(shopifyFetch.deleteCalls).toHaveLength(0);
    expect(r2.delete).not.toHaveBeenCalled();
  });

  it('treats any GC_DRY_RUN value other than the exact string "false" as dry-run', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 12, createdAt: daysAgoIso(45), skus: ['CUSTOM-1212-M'] })],
      ordersForSkus: () => false,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    await worker.scheduled({}, makeEnv({ GC_DRY_RUN: 'true' }), {});
    expect(shopifyFetch.deleteCalls).toHaveLength(0);
  });

  it('actually deletes when GC_DRY_RUN is the literal string "false"', async () => {
    const r2 = makeGcR2([
      { key: 'product-images/old.jpg', uploaded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    ]);
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 13, createdAt: daysAgoIso(45), skus: ['CUSTOM-1313-M'] })],
      ordersForSkus: () => false,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    await worker.scheduled({}, makeEnv({ MOCKUP_STAGING: r2, GC_DRY_RUN: 'false' }), {});

    expect(shopifyFetch.deleteCalls).toEqual([gid(13)]);
    expect(r2.delete).toHaveBeenCalledWith('product-images/old.jpg');
  });

  it('does not delete a product when live (GC_DRY_RUN=false) and productDelete itself fails', async () => {
    const shopifyFetch = makeGcFetch({
      products: [productNode({ id: 14, createdAt: daysAgoIso(45), skus: ['CUSTOM-1414-M'] })],
      ordersForSkus: () => false,
      deleteFails: true,
    });
    vi.stubGlobal('fetch', shopifyFetch);

    // Should not throw even though the delete mutation fails server-side.
    await expect(worker.scheduled({}, makeEnv({ GC_DRY_RUN: 'false' }), {})).resolves.toBeUndefined();
  });

  it('never throws out of scheduled() even when the products query itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/admin/oauth/access_token')) return jsonRes({ access_token: 'tok', expires_in: 3600 });
      throw new TypeError('network down');
    }));

    await expect(worker.scheduled({}, makeEnv({ GC_DRY_RUN: 'false' }), {})).resolves.toBeUndefined();
  });
});
