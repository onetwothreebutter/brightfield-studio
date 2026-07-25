// @vitest-environment node
//
// Coverage for the metafield-based reviews flow (issue #548): POST /reviews/submit,
// GET /reviews/list, GET /reviews/pending, POST /reviews/approve, POST /reviews/reject,
// and the best-effort metafieldsSet sync that mirrors approved reviews onto the
// product's own metafields. Mirrors the patterns in test/worker.test.js (community
// design submission/moderation) and test/worker-create-product.test.js (Shopify
// Admin API fetch mocking).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getShopifyToken caches its token in a module-level `let`, not per-request state —
// re-import fresh per test (like worker-create-product.test.js) so that cache can't
// leak between tests that stub `fetch` differently.
let worker;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  worker = mod.default;
});

afterEach(() => vi.unstubAllGlobals());

// ── Mock R2 bucket ────────────────────────────────────────────────────────────

function makeR2() {
  const store = new Map();
  return {
    _store: store,
    async get(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { text: async () => val };
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? value : String(value));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function makeEnv(overrides = {}) {
  return { MOCKUP_STAGING: makeR2(), ADMIN_TOKEN: 'test-secret', ...overrides };
}

function makeShopifyEnv(overrides = {}) {
  return makeEnv({
    SHOPIFY_STORE_DOMAIN: 'brightfield-2.myshopify.com',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_ID: 'client-id',
    SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET: 'client-secret',
    ...overrides,
  });
}

function post(path, body, headers = {}) {
  return new Request(`http://worker${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function get(path, headers = {}) {
  return new Request(`http://worker${path}`, { headers });
}

function adminHeaders() {
  return { Authorization: 'Bearer test-secret' };
}

function reviewBody(overrides = {}) {
  return {
    productHandle: 'rise-shirt',
    rating: 5,
    authorName: 'Jane',
    body: 'Great shirt, fits true to size.',
    ...overrides,
  };
}

async function submitReview(env, overrides = {}) {
  const res = await worker.fetch(post('/reviews/submit', reviewBody(overrides)), env);
  return res.json();
}

function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// Router-style fetch mock covering the Admin API calls syncReviewMetafields makes:
// the OAuth token endpoint, the productByHandle lookup, and the metafieldsSet
// mutation. `overrides` lets individual tests force one step to fail.
function makeShopifyFetch(overrides = {}) {
  const calls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push({ url: u, opts });

    if (u.includes('/admin/oauth/access_token')) {
      return jsonRes({ access_token: 'test-token', expires_in: 3600 });
    }

    const body = JSON.parse(opts.body);
    const query = body.query || '';

    if (query.includes('query GetProductIdByHandle')) {
      if (overrides.handleNotFound) return jsonRes({ data: { productByHandle: null } });
      return jsonRes({ data: { productByHandle: { id: 'gid://shopify/Product/555' } } });
    }

    if (query.includes('mutation SetReviewMetafields')) {
      if (overrides.metafieldsSetUserErrors) {
        return jsonRes({ data: { metafieldsSet: { metafields: [], userErrors: overrides.metafieldsSetUserErrors } } });
      }
      if (overrides.metafieldsSetTransportFails) {
        throw new TypeError('Network connection lost');
      }
      return jsonRes({ data: { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }], userErrors: [] } } });
    }

    throw new Error('Unmocked fetch in test: ' + u + ' body=' + (opts.body || ''));
  });
  fn.calls = calls;
  return fn;
}

// ── POST /reviews/submit ──────────────────────────────────────────────────────

describe('POST /reviews/submit', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 201 with an id', async () => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody()), env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes the submission to R2 with status pending', async () => {
    const { id } = await submitReview(env);
    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    const submission = JSON.parse(await obj.text());
    expect(submission.status).toBe('pending');
    expect(submission.productHandle).toBe('rise-shirt');
    expect(submission.rating).toBe(5);
    expect(submission.authorName).toBe('Jane');
    expect(submission.body).toBe('Great shirt, fits true to size.');
    expect(typeof submission.createdAt).toBe('number');
  });

  it('trims whitespace from authorName and body before storing', async () => {
    const { id } = await submitReview(env, { authorName: '  Jane  ', body: '  Great fit.  ' });
    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    const submission = JSON.parse(await obj.text());
    expect(submission.authorName).toBe('Jane');
    expect(submission.body).toBe('Great fit.');
  });

  it('prepends id to reviews/list.json', async () => {
    const { id: id1 } = await submitReview(env);
    const { id: id2 } = await submitReview(env);
    const obj = await env.MOCKUP_STAGING.get('reviews/list.json');
    const list = JSON.parse(await obj.text());
    expect(list[0]).toBe(id2);
    expect(list[1]).toBe(id1);
  });

  it('returns 400 when productHandle is missing', async () => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ productHandle: undefined })), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when productHandle exceeds 200 characters', async () => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ productHandle: 'x'.repeat(201) })), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when authorName is missing or blank', async () => {
    const res1 = await worker.fetch(post('/reviews/submit', reviewBody({ authorName: undefined })), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(post('/reviews/submit', reviewBody({ authorName: '   ' })), env);
    expect(res2.status).toBe(400);
  });

  it('returns 400 when authorName exceeds 80 characters', async () => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ authorName: 'x'.repeat(81) })), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing or blank', async () => {
    const res1 = await worker.fetch(post('/reviews/submit', reviewBody({ body: undefined })), env);
    expect(res1.status).toBe(400);
    const res2 = await worker.fetch(post('/reviews/submit', reviewBody({ body: '   ' })), env);
    expect(res2.status).toBe(400);
  });

  it('returns 400 when body exceeds 2000 characters', async () => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ body: 'x'.repeat(2001) })), env);
    expect(res.status).toBe(400);
  });

  it.each([0, 6, -1, 3.5, NaN, undefined, 'five'])('returns 400 for an invalid rating (%s)', async (rating) => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ rating })), env);
    expect(res.status).toBe(400);
  });

  it.each([1, 2, 3, 4, 5])('accepts a valid integer rating of %s', async (rating) => {
    const res = await worker.fetch(post('/reviews/submit', reviewBody({ rating })), env);
    expect(res.status).toBe(201);
  });

  it('returns 413 when the payload exceeds the size cap', async () => {
    const res = await worker.fetch(
      post('/reviews/submit', reviewBody({ body: 'x'.repeat(70 * 1024) })),
      env
    );
    expect(res.status).toBe(413);
  });

  // ── Honeypot ─────────────────────────────────────────────────────────────

  it('returns a fake 201 without storing anything when the honeypot field is filled', async () => {
    const res = await worker.fetch(
      post('/reviews/submit', { ...reviewBody(), company: 'Acme Bot Co' }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await env.MOCKUP_STAGING.get('reviews/list.json');
    expect(list).toBeNull();
  });

  // ── Rate limiting (RATE_LIMITER_REVIEWS_SUBMIT binding) ─────────────────────

  it('succeeds normally when the rate limiter reports under-limit', async () => {
    const rateEnv = makeEnv({ RATE_LIMITER_REVIEWS_SUBMIT: { limit: vi.fn(async () => ({ success: true })) } });
    const res = await worker.fetch(post('/reviews/submit', reviewBody()), rateEnv);
    expect(res.status).toBe(201);
    expect(rateEnv.RATE_LIMITER_REVIEWS_SUBMIT.limit).toHaveBeenCalledWith({ key: expect.any(String) });
  });

  it('returns 429 with a JSON error when the rate limiter reports over-limit', async () => {
    const rateEnv = makeEnv({ RATE_LIMITER_REVIEWS_SUBMIT: { limit: vi.fn(async () => ({ success: false })) } });
    const res = await worker.fetch(post('/reviews/submit', reviewBody()), rateEnv);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('fails open (request succeeds) when the rate limiter binding throws', async () => {
    const rateEnv = makeEnv({
      RATE_LIMITER_REVIEWS_SUBMIT: { limit: vi.fn(async () => { throw new Error('binding misconfigured'); }) },
    });
    const res = await worker.fetch(post('/reviews/submit', reviewBody()), rateEnv);
    expect(res.status).toBe(201);
  });
});

// ── GET /reviews/list ──────────────────────────────────────────────────────────

describe('GET /reviews/list', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 400 when productHandle is missing', async () => {
    const res = await worker.fetch(get('/reviews/list'), env);
    expect(res.status).toBe(400);
  });

  it('returns [] when no reviews exist for the product', async () => {
    const res = await worker.fetch(get('/reviews/list?productHandle=rise-shirt'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('only returns approved reviews', async () => {
    const { id } = await submitReview(env);
    let res = await worker.fetch(get('/reviews/list?productHandle=rise-shirt'), env);
    expect(await res.json()).toHaveLength(0);

    await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    res = await worker.fetch(get('/reviews/list?productHandle=rise-shirt'), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].authorName).toBe('Jane');
  });

  it('excludes reviews for a different productHandle', async () => {
    const { id: id1 } = await submitReview(env, { productHandle: 'rise-shirt' });
    const { id: id2 } = await submitReview(env, { productHandle: 'echo-text' });
    await worker.fetch(post('/reviews/approve', { id: id1 }, adminHeaders()), env);
    await worker.fetch(post('/reviews/approve', { id: id2 }, adminHeaders()), env);

    const res = await worker.fetch(get('/reviews/list?productHandle=rise-shirt'), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].productHandle).toBe('rise-shirt');
  });

  it('excludes rejected reviews', async () => {
    const { id } = await submitReview(env);
    await worker.fetch(post('/reviews/reject', { id }, adminHeaders()), env);
    const res = await worker.fetch(get('/reviews/list?productHandle=rise-shirt'), env);
    expect(await res.json()).toEqual([]);
  });
});

// ── GET /reviews/pending ───────────────────────────────────────────────────────

describe('GET /reviews/pending', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(get('/reviews/pending'), env);
    expect(res.status).toBe(401);
  });

  it('returns only pending reviews by default', async () => {
    const { id: pending }  = await submitReview(env, { authorName: 'Alice' });
    const { id: approved } = await submitReview(env, { authorName: 'Bob' });
    await worker.fetch(post('/reviews/approve', { id: approved }, adminHeaders()), env);

    const res = await worker.fetch(get('/reviews/pending', adminHeaders()), env);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(pending);
  });

  it('filters by ?status=approved', async () => {
    const { id: pending }  = await submitReview(env, { authorName: 'Alice' });
    const { id: approved } = await submitReview(env, { authorName: 'Bob' });
    await worker.fetch(post('/reviews/approve', { id: approved }, adminHeaders()), env);

    const res = await worker.fetch(get('/reviews/pending?status=approved', adminHeaders()), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(approved);
    void pending;
  });

  it('filters by ?status=rejected', async () => {
    const { id: rejected } = await submitReview(env, { authorName: 'Carol' });
    await worker.fetch(post('/reviews/reject', { id: rejected }, adminHeaders()), env);

    const res = await worker.fetch(get('/reviews/pending?status=rejected', adminHeaders()), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(rejected);
  });
});

// ── POST /reviews/approve ─────────────────────────────────────────────────────

describe('POST /reviews/approve', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(post('/reviews/approve', { id: 'x' }), env);
    expect(res.status).toBe(401);
  });

  it('sets status to approved', async () => {
    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('approved');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await worker.fetch(post('/reviews/approve', { id: 'no-such' }, adminHeaders()), env);
    expect(res.status).toBe(404);
  });

  it('does not throw when Shopify Admin credentials are not configured (sync skipped)', async () => {
    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
  });
});

// ── POST /reviews/reject ───────────────────────────────────────────────────────

describe('POST /reviews/reject', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(post('/reviews/reject', { id: 'x' }), env);
    expect(res.status).toBe(401);
  });

  it('sets status to rejected', async () => {
    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/reject', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);

    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('rejected');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await worker.fetch(post('/reviews/reject', { id: 'no-such' }, adminHeaders()), env);
    expect(res.status).toBe(404);
  });
});

// ── re-moderation ──────────────────────────────────────────────────────────────

describe('reviews re-moderation', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('can reject an already-approved review', async () => {
    const { id } = await submitReview(env);
    await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    const res = await worker.fetch(post('/reviews/reject', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('rejected');
  });

  it('can approve an already-rejected review', async () => {
    const { id } = await submitReview(env);
    await worker.fetch(post('/reviews/reject', { id }, adminHeaders()), env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    const obj = await env.MOCKUP_STAGING.get(`reviews/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('approved');
  });
});

// ── Metafield sync (syncReviewMetafields via /reviews/approve, /reviews/reject) ──

describe('review metafield sync', () => {
  it('does not call fetch when Shopify Admin credentials are not configured', async () => {
    const env = makeEnv(); // no SHOPIFY_* creds
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { id } = await submitReview(env);
    await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('syncs average, count, and entries onto the product metafields on approve', async () => {
    const env = makeShopifyEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { id } = await submitReview(env, { rating: 4, authorName: 'Jane', body: 'Nice fit.' });
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);

    const call = fetchMock.calls.find(c => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation SetReviewMetafields'));
    expect(call).toBeDefined();
    const vars = JSON.parse(call.opts.body).variables;
    const byKey = Object.fromEntries(vars.metafields.map(m => [m.key, m]));

    expect(byKey.review_average.value).toBe('4');
    expect(byKey.review_count.value).toBe('1');
    expect(byKey.review_average.ownerId).toBe('gid://shopify/Product/555');
    const entries = JSON.parse(byKey.review_entries.value);
    expect(entries).toEqual([{ rating: 4, author: 'Jane', body: 'Nice fit.', created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }]);
  });

  it('averages across multiple approved reviews for the same product', async () => {
    const env = makeShopifyEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { id: id1 } = await submitReview(env, { rating: 5 });
    const { id: id2 } = await submitReview(env, { rating: 3 });
    await worker.fetch(post('/reviews/approve', { id: id1 }, adminHeaders()), env);
    await worker.fetch(post('/reviews/approve', { id: id2 }, adminHeaders()), env);

    const calls = fetchMock.calls.filter(c => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation SetReviewMetafields'));
    const lastVars = JSON.parse(calls[calls.length - 1].opts.body).variables;
    const byKey = Object.fromEntries(lastVars.metafields.map(m => [m.key, m]));
    expect(byKey.review_count.value).toBe('2');
    expect(byKey.review_average.value).toBe('4'); // (5 + 3) / 2 = 4
  });

  it('excludes reviews for other products from the aggregate', async () => {
    const env = makeShopifyEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { id: id1 } = await submitReview(env, { productHandle: 'rise-shirt', rating: 5 });
    const { id: id2 } = await submitReview(env, { productHandle: 'echo-text', rating: 1 });
    await worker.fetch(post('/reviews/approve', { id: id1 }, adminHeaders()), env);
    await worker.fetch(post('/reviews/approve', { id: id2 }, adminHeaders()), env);

    const calls = fetchMock.calls.filter(c => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation SetReviewMetafields'));
    const riseShirtCall = calls.find(c => JSON.parse(c.opts.body).variables.metafields[0].ownerId === 'gid://shopify/Product/555');
    const vars = JSON.parse(riseShirtCall.opts.body).variables;
    const byKey = Object.fromEntries(vars.metafields.map(m => [m.key, m]));
    // Only the first approve (rise-shirt, rating 5) should be reflected in that call
    expect(byKey.review_count.value).toBe('1');
    expect(byKey.review_average.value).toBe('5');
  });

  it('re-syncs (drops from the aggregate) when an already-approved review is rejected', async () => {
    const env = makeShopifyEnv();
    const fetchMock = makeShopifyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { id } = await submitReview(env, { rating: 5 });
    await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    await worker.fetch(post('/reviews/reject', { id }, adminHeaders()), env);

    const calls = fetchMock.calls.filter(c => c.url.includes('graphql.json') && JSON.parse(c.opts.body).query.includes('mutation SetReviewMetafields'));
    const lastVars = JSON.parse(calls[calls.length - 1].opts.body).variables;
    const byKey = Object.fromEntries(lastVars.metafields.map(m => [m.key, m]));
    expect(byKey.review_count.value).toBe('0');
    expect(byKey.review_average.value).toBe('0');
  });

  it('does not fail the approve request when the product handle cannot be resolved', async () => {
    const env = makeShopifyEnv();
    vi.stubGlobal('fetch', makeShopifyFetch({ handleNotFound: true }));

    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
  });

  it('does not fail the approve request when metafieldsSet returns userErrors', async () => {
    const env = makeShopifyEnv();
    vi.stubGlobal('fetch', makeShopifyFetch({ metafieldsSetUserErrors: [{ field: ['value'], message: 'bad value' }] }));

    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
  });

  it('does not fail the approve request when the Admin API call fails at the transport level', async () => {
    const env = makeShopifyEnv();
    vi.stubGlobal('fetch', makeShopifyFetch({ metafieldsSetTransportFails: true }));

    const { id } = await submitReview(env);
    const res = await worker.fetch(post('/reviews/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
  });
});
