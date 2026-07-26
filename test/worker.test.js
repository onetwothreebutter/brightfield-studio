// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import worker, { pickSizeVariant } from '../worker/src/index.js';

// ── Mock R2 bucket ────────────────────────────────────────────────────────────
// Models etags + conditional put() (the `onlyIf` option) so tests can exercise
// the community/list.json compare-and-swap logic (#551) for real, rather than
// just always succeeding regardless of what onlyIf says.

function makeR2() {
  const store = new Map(); // key -> string value (kept raw for _store compat)
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
    async get(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { text: async () => val, etag: etags.get(key) };
    },
    async head(key) {
      if (!store.has(key)) return null;
      return { etag: etags.get(key) };
    },
    async put(key, value, options = {}) {
      // Mirrors real R2: on a failed conditional, return null and don't write.
      if (!conditionsPass(key, options.onlyIf)) return null;
      store.set(key, typeof value === 'string' ? value : String(value));
      const etag = `etag-${++etagCounter}`;
      etags.set(key, etag);
      return { key, etag };
    },
    async delete(key) {
      store.delete(key);
      etags.delete(key);
    },
    _store: store,
  };
}

function makeEnv(r2 = makeR2()) {
  return { MOCKUP_STAGING: r2, ADMIN_TOKEN: 'test-secret' };
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

// ── Shopify App Bridge session token (JWT) helpers ─────────────────────────────
// Mints HS256-signed test JWTs shaped like real Shopify session tokens, using the
// Web Crypto API (crypto.subtle) available globally in the Node test environment.

const TEST_CLIENT_SECRET = 'test-client-secret';
const TEST_CLIENT_ID     = 'test-client-id';
const TEST_STORE_DOMAIN  = 'brightfield-2.myshopify.com';

function base64url(bytesOrString) {
  const bytes = typeof bytesOrString === 'string'
    ? new TextEncoder().encode(bytesOrString)
    : bytesOrString;
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signHS256(headerB64, payloadB64, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  return base64url(new Uint8Array(sig));
}

// Builds an HS256 JWT. Pass `secret` to control the signing key (defaults to the
// "real" test client secret so most tests only need to override payload claims).
async function mintSessionToken(payloadOverrides = {}, secret = TEST_CLIENT_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${TEST_STORE_DOMAIN}/admin`,
    dest: `https://${TEST_STORE_DOMAIN}`,
    aud: TEST_CLIENT_ID,
    sub: '1',
    exp: now + 60,
    nbf: now - 10,
    iat: now - 10,
    jti: 'test-jti',
    sid: 'test-sid',
    ...payloadOverrides,
  };
  const headerB64  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64url(JSON.stringify(payload));
  const sigB64      = await signHS256(headerB64, payloadB64, secret);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function makeAdminEnv(r2 = makeR2()) {
  return {
    MOCKUP_STAGING: r2,
    ADMIN_TOKEN: 'test-secret',
    SHOPIFY_APP_CLIENT_SECRET: TEST_CLIENT_SECRET,
    SHOPIFY_APP_CLIENT_ID: TEST_CLIENT_ID,
    SHOPIFY_STORE_DOMAIN: TEST_STORE_DOMAIN,
  };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function submitDesign(env, overrides = {}) {
  const res = await worker.fetch(
    post('/community/submit', {
      shader: 'rise-shirt',
      productHandle: 'rise-shirt',
      mockupUrl: 'https://example.com/m.jpg',
      creatorName: 'Jane',
      creatorEmail: 'jane@example.com',
      values: {},
      ...overrides,
    }),
    env
  );
  return res.json();
}

// Approves a submission and sets shopifyProductHandle (Shopify API unavailable in tests).
async function approveDesign(env, id, handle = 'test-product') {
  await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
  const key = `community/submissions/${id}.json`;
  const raw = await env.MOCKUP_STAGING.get(key);
  const sub = JSON.parse(await raw.text());
  sub.shopifyProductHandle = handle;
  await env.MOCKUP_STAGING.put(key, JSON.stringify(sub));
}

// ── /community/submit ─────────────────────────────────────────────────────────

describe('POST /community/submit', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 201 with an id', async () => {
    const res = await worker.fetch(
      post('/community/submit', { shader: 'rise-shirt', mockupUrl: 'https://x.com/m.jpg', creatorName: 'Jane' }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes submission to R2 with status pending and likes 0', async () => {
    const { id } = await submitDesign(env);
    const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
    const submission = JSON.parse(await obj.text());
    expect(submission.status).toBe('pending');
    expect(submission.likes).toBe(0);
    expect(submission.creatorEmail).toBe('jane@example.com');
  });

  it('prepends id to community/list.json', async () => {
    const { id: id1 } = await submitDesign(env);
    const { id: id2 } = await submitDesign(env);
    const obj = await env.MOCKUP_STAGING.get('community/list.json');
    const list = JSON.parse(await obj.text());
    expect(list[0]).toBe(id2);
    expect(list[1]).toBe(id1);
  });

  it('returns 400 when mockupUrl is missing', async () => {
    const res = await worker.fetch(
      post('/community/submit', { shader: 'rise-shirt', creatorName: 'Jane' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 413 when the payload exceeds the size cap', async () => {
    const res = await worker.fetch(
      post('/community/submit', {
        shader: 'rise-shirt', mockupUrl: 'https://x.com/m.jpg', creatorName: 'Jane',
        values: { blob: 'x'.repeat(70 * 1024) },
      }),
      env
    );
    expect(res.status).toBe(413);
  });

  it('returns 400 when values is not a plain object', async () => {
    const res = await worker.fetch(
      post('/community/submit', {
        shader: 'rise-shirt', mockupUrl: 'https://x.com/m.jpg', creatorName: 'Jane',
        values: ['nope'],
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when creatorName is missing', async () => {
    const res = await worker.fetch(
      post('/community/submit', { shader: 'rise-shirt', mockupUrl: 'https://x.com/m.jpg' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when shader is missing', async () => {
    const res = await worker.fetch(
      post('/community/submit', { mockupUrl: 'https://x.com/m.jpg', creatorName: 'Jane' }),
      env
    );
    expect(res.status).toBe(400);
  });

  // Regression test for #551: two submissions racing to read-modify-write
  // community/list.json used to silently drop one id when the second write
  // clobbered the first. The R2 conditional-write mock enforces onlyIf for
  // real, so this only passes if appendToCommunityList() actually retries
  // on a failed compare-and-swap instead of overwriting blind.
  it('does not drop an id when two submissions race concurrently', async () => {
    const results = await Promise.all([
      submitDesign(env, { creatorName: 'Racer A' }),
      submitDesign(env, { creatorName: 'Racer B' }),
    ]);
    const ids = results.map(r => r.id).sort();

    const obj = await env.MOCKUP_STAGING.get('community/list.json');
    const list = JSON.parse(await obj.text());
    expect(list.length).toBe(2);
    expect([...list].sort()).toEqual(ids);
  });

  it('does not drop an id across several concurrent submissions', async () => {
    // Kept within the 5-retry budget (see COMMUNITY_LIST_WRITE_RETRIES): with
    // zero network jitter, this in-memory mock makes every racer contend in
    // lockstep each round, so an N-way dead-simultaneous tie can need up to
    // N-1 retries for the last straggler — worse than the real-world
    // contention (staggered by actual request latency) this retry count is
    // sized for. 4 stays comfortably inside that budget while still proving
    // more than a 2-way race resolves without dropping anyone.
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => submitDesign(env, { creatorName: `Racer ${i}` }))
    );
    const ids = results.map(r => r.id).sort();

    const obj = await env.MOCKUP_STAGING.get('community/list.json');
    const list = JSON.parse(await obj.text());
    expect(list.length).toBe(4);
    expect([...list].sort()).toEqual(ids);
  });
});

// ── /community/list ───────────────────────────────────────────────────────────

describe('GET /community/list', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns empty array when no submissions exist', async () => {
    const res = await worker.fetch(get('/community/list'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('only returns approved submissions', async () => {
    const { id } = await submitDesign(env);
    // still pending — should not appear
    let res = await worker.fetch(get('/community/list'), env);
    expect(await res.json()).toHaveLength(0);

    // approve it and set shopifyProductHandle
    await approveDesign(env, id);
    res = await worker.fetch(get('/community/list'), env);
    expect(await res.json()).toHaveLength(1);
  });

  it('omits approved submissions without a shopifyProductHandle', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    // shopifyProductHandle not set (Shopify product creation failed)
    const res = await worker.fetch(get('/community/list'), env);
    expect(await res.json()).toHaveLength(0);
  });

  it('strips creatorEmail from results', async () => {
    const { id } = await submitDesign(env);
    await approveDesign(env, id);
    const [design] = await (await worker.fetch(get('/community/list'), env)).json();
    expect(design.creatorEmail).toBeUndefined();
    expect(design.creatorName).toBe('Jane');
  });

  it('filters by ?shader= when provided', async () => {
    const { id: id1 } = await submitDesign(env, { shader: 'rise-shirt' });
    const { id: id2 } = await submitDesign(env, { shader: 'echo-text' });
    await approveDesign(env, id1, 'rise-shirt-community');
    await approveDesign(env, id2, 'echo-text-community');

    const res = await worker.fetch(get('/community/list?shader=rise-shirt'), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].shader).toBe('rise-shirt');
  });

  it('returns [] when ?shader= matches nothing', async () => {
    const { id } = await submitDesign(env, { shader: 'rise-shirt' });
    await approveDesign(env, id, 'rise-shirt-community');
    const res = await worker.fetch(get('/community/list?shader=other'), env);
    expect(await res.json()).toEqual([]);
  });

  it('filters by ?productHandle= when provided', async () => {
    const { id: id1 } = await submitDesign(env, { shader: 'rise-shirt', productHandle: 'product-a' });
    const { id: id2 } = await submitDesign(env, { shader: 'rise-shirt', productHandle: 'product-b' });
    await approveDesign(env, id1, 'community-product-a');
    await approveDesign(env, id2, 'community-product-b');

    const res = await worker.fetch(get('/community/list?shader=rise-shirt&productHandle=product-a'), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].productHandle).toBe('product-a');
  });

  // Pagination regression tests for #551: the old handler always sliced the
  // first 100 ids, so any approved submission beyond the 100 most recent
  // site-wide (regardless of filter) was permanently unreachable. Exercise
  // the cursor/limit mechanism directly with a small ?limit= so the test
  // doesn't need 100+ fixtures to prove pages beyond the first are reachable.
  it('paginates via ?limit= and exposes X-Community-Next-Cursor when more results remain', async () => {
    for (let i = 0; i < 3; i++) {
      const { id } = await submitDesign(env, { creatorName: `Creator ${i}` });
      await approveDesign(env, id, `product-${i}`);
    }

    const res = await worker.fetch(get('/community/list?limit=2'), env);
    const results = await res.json();
    expect(results).toHaveLength(2);
    expect(res.headers.get('X-Community-Next-Cursor')).toBe('2');
  });

  it('omits X-Community-Next-Cursor on the last page and reaches items past the default 100-item window via ?cursor=', async () => {
    for (let i = 0; i < 3; i++) {
      const { id } = await submitDesign(env, { creatorName: `Creator ${i}` });
      await approveDesign(env, id, `product-${i}`);
    }

    const first = await worker.fetch(get('/community/list?limit=2'), env);
    const firstResults = await first.json();
    const nextCursor = first.headers.get('X-Community-Next-Cursor');
    expect(nextCursor).toBe('2');

    const second = await worker.fetch(get(`/community/list?limit=2&cursor=${nextCursor}`), env);
    const secondResults = await second.json();
    expect(secondResults).toHaveLength(1);
    expect(second.headers.get('X-Community-Next-Cursor')).toBeNull();

    // The item on the second page is a design that a naive top-100 slice
    // would still have found today (only 3 total) — the important part is
    // that walking cursors surfaces every submission with no gaps/dupes.
    const allIds = firstResults.concat(secondResults).map(r => r.id).sort();
    expect(new Set(allIds).size).toBe(3);
  });

  it('default response (no cursor/limit) matches the old top-100 behavior with no next-cursor header', async () => {
    const { id } = await submitDesign(env);
    await approveDesign(env, id);
    const res = await worker.fetch(get('/community/list'), env);
    expect(await res.json()).toHaveLength(1);
    expect(res.headers.get('X-Community-Next-Cursor')).toBeNull();
  });
});

// ── /community/like ───────────────────────────────────────────────────────────

describe('POST /community/like', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('increments likes and returns liked: true on first call', async () => {
    const { id } = await submitDesign(env);
    const res = await worker.fetch(post('/community/like', { id, deviceId: 'dev-1' }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ likes: 1, liked: true });
  });

  it('decrements likes and returns liked: false on second call (toggle)', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/like', { id, deviceId: 'dev-1' }), env);
    const res = await worker.fetch(post('/community/like', { id, deviceId: 'dev-1' }), env);
    const body = await res.json();
    expect(body).toEqual({ likes: 0, liked: false });
  });

  it('tracks likes independently per deviceId', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/like', { id, deviceId: 'dev-1' }), env);
    const res = await worker.fetch(post('/community/like', { id, deviceId: 'dev-2' }), env);
    expect((await res.json()).likes).toBe(2);
  });

  it('returns 400 when id is missing', async () => {
    const res = await worker.fetch(post('/community/like', { deviceId: 'dev-1' }), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when deviceId is missing', async () => {
    const res = await worker.fetch(post('/community/like', { id: 'some-id' }), env);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await worker.fetch(post('/community/like', { id: 'no-such-id', deviceId: 'dev-1' }), env);
    expect(res.status).toBe(404);
  });
});

// ── /community/pending ────────────────────────────────────────────────────────

describe('GET /community/pending', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth header', async () => {
    const res = await worker.fetch(get('/community/pending'), env);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const res = await worker.fetch(get('/community/pending', { Authorization: 'Bearer wrong' }), env);
    expect(res.status).toBe(401);
  });

  it('returns only pending submissions', async () => {
    const { id: pending } = await submitDesign(env, { creatorName: 'Alice' });
    const { id: approved } = await submitDesign(env, { creatorName: 'Bob' });
    await worker.fetch(post('/community/approve', { id: approved }, adminHeaders()), env);

    const res = await worker.fetch(get('/community/pending', adminHeaders()), env);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(pending);
  });

  it('includes creatorEmail for admin view', async () => {
    await submitDesign(env);
    const res = await worker.fetch(get('/community/pending', adminHeaders()), env);
    const [item] = await res.json();
    expect(item.creatorEmail).toBe('jane@example.com');
  });
});

// ── /community/approve ────────────────────────────────────────────────────────

describe('POST /community/approve', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(post('/community/approve', { id: 'x' }), env);
    expect(res.status).toBe(401);
  });

  it('sets status to approved', async () => {
    const { id } = await submitDesign(env);
    const res = await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('approved');
  });

  it('returns 404 for unknown id', async () => {
    const res = await worker.fetch(post('/community/approve', { id: 'no-such' }, adminHeaders()), env);
    expect(res.status).toBe(404);
  });
});

// ── /community/reject ─────────────────────────────────────────────────────────

describe('POST /community/reject', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(post('/community/reject', { id: 'x' }), env);
    expect(res.status).toBe(401);
  });

  it('sets status to rejected', async () => {
    const { id } = await submitDesign(env);
    const res = await worker.fetch(post('/community/reject', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);

    const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('rejected');
  });

  it('returns 404 for unknown id', async () => {
    const res = await worker.fetch(post('/community/reject', { id: 'no-such' }, adminHeaders()), env);
    expect(res.status).toBe(404);
  });
});

// ── /community/pending?status= ────────────────────────────────────────────────

describe('GET /community/pending?status=', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns only approved submissions when status=approved', async () => {
    const { id: pending } = await submitDesign(env, { creatorName: 'Alice' });
    const { id: approved } = await submitDesign(env, { creatorName: 'Bob' });
    await worker.fetch(post('/community/approve', { id: approved }, adminHeaders()), env);

    const res = await worker.fetch(get('/community/pending?status=approved', adminHeaders()), env);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(approved);
    void pending;
  });

  it('returns only rejected submissions when status=rejected', async () => {
    const { id: pending } = await submitDesign(env, { creatorName: 'Alice' });
    const { id: rejected } = await submitDesign(env, { creatorName: 'Carol' });
    await worker.fetch(post('/community/reject', { id: rejected }, adminHeaders()), env);

    const res = await worker.fetch(get('/community/pending?status=rejected', adminHeaders()), env);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(rejected);
    void pending;
  });

  it('returns 401 without auth', async () => {
    const res = await worker.fetch(get('/community/pending?status=approved'), env);
    expect(res.status).toBe(401);
  });
});

// ── re-moderate (approve rejected / reject approved) ─────────────────────────

describe('re-moderation', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('can reject an already-approved design', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);

    const res = await worker.fetch(post('/community/reject', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('rejected');
  });

  it('can approve an already-rejected design', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/reject', { id }, adminHeaders()), env);

    const res = await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    expect(res.status).toBe(200);
    const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
    expect(JSON.parse(await obj.text()).status).toBe('approved');
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('includes Authorization in Access-Control-Allow-Headers', async () => {
    const res = await worker.fetch(
      new Request('http://worker/community/list', { method: 'OPTIONS' }),
      env
    );
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });
});

// ── /save-shader-state + /get-shader-state ────────────────────────────────────

describe('POST /save-shader-state', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns 200 with a UUID id', async () => {
    const res = await worker.fetch(
      post('/save-shader-state', { state: { u_rows: 23, u_color_mode: '0' } }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores the state in R2 under shader-states/{id}.json', async () => {
    const res = await worker.fetch(
      post('/save-shader-state', { state: { u_rows: 42 } }),
      env
    );
    const { id } = await res.json();
    const obj = await env.MOCKUP_STAGING.get(`shader-states/${id}.json`);
    const stored = JSON.parse(await obj.text());
    expect(stored.u_rows).toBe(42);
  });

  it('returns 400 when state is missing', async () => {
    const res = await worker.fetch(post('/save-shader-state', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when state is not an object', async () => {
    const res = await worker.fetch(post('/save-shader-state', { state: 'bad' }), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when state is an array', async () => {
    const res = await worker.fetch(post('/save-shader-state', { state: [1, 2, 3] }), env);
    expect(res.status).toBe(400);
  });

  it('returns 413 when the payload exceeds the size cap', async () => {
    const res = await worker.fetch(
      post('/save-shader-state', { state: { blob: 'x'.repeat(70 * 1024) } }),
      env
    );
    expect(res.status).toBe(413);
  });

  it('includes CORS headers', async () => {
    const res = await worker.fetch(
      new Request('http://worker/save-shader-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://brightfield.studio' },
        body: JSON.stringify({ state: { u_rows: 1 } }),
      }),
      env
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brightfield.studio');
  });
});

describe('GET /get-shader-state/:id', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('returns the stored state', async () => {
    const saveRes = await worker.fetch(
      post('/save-shader-state', { state: { u_rows: 99, u_a: '#ff0000' } }),
      env
    );
    const { id } = await saveRes.json();

    const res = await worker.fetch(get(`/get-shader-state/${id}`), env);
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state.u_rows).toBe(99);
    expect(state.u_a).toBe('#ff0000');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await worker.fetch(get('/get-shader-state/no-such'), env);
    expect(res.status).toBe(404);
  });
});

// ── /create-share ─────────────────────────────────────────────────────────────

describe('POST /create-share', () => {
  let env;
  // Minimal JPEG: signature bytes followed by padding.
  const jpegBase64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]).toString('base64');
  const pngBase64  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]).toString('base64');

  beforeEach(() => {
    env = makeEnv();
    env.R2_PUBLIC_DOMAIN = 'cdn.example.com';
  });

  it('returns 201 and stores image + metadata for a valid JPEG', async () => {
    const res = await worker.fetch(
      post('/create-share', { image: jpegBase64, shader: 'rise-shirt', productHandle: 'rise-shirt', values: { u_rows: 3 } }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe(`https://share.brightfield.studio/${body.id}`);
    expect(env.MOCKUP_STAGING._store.has(`shares/${body.id}.jpg`)).toBe(true);
    const meta = JSON.parse(env.MOCKUP_STAGING._store.get(`shares/${body.id}.json`));
    expect(meta.values.u_rows).toBe(3);
  });

  it('returns 400 when image or productHandle is missing', async () => {
    const res = await worker.fetch(post('/create-share', { image: jpegBase64 }), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-JPEG image', async () => {
    const res = await worker.fetch(
      post('/create-share', { image: pngBase64, productHandle: 'rise-shirt' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid base64', async () => {
    const res = await worker.fetch(
      post('/create-share', { image: '!!!not-base64!!!', productHandle: 'rise-shirt' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 413 when the image exceeds the size cap', async () => {
    // Passes the body cap but exceeds the 8 MB decoded-image cap.
    const res = await worker.fetch(
      post('/create-share', { image: 'A'.repeat(11_200_000), productHandle: 'rise-shirt' }),
      env
    );
    expect(res.status).toBe(413);
  });

  it('returns 400 when values is not a plain object', async () => {
    const res = await worker.fetch(
      post('/create-share', { image: jpegBase64, productHandle: 'rise-shirt', values: [1, 2] }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for an oversized productHandle', async () => {
    const res = await worker.fetch(
      post('/create-share', { image: jpegBase64, productHandle: 'x'.repeat(300) }),
      env
    );
    expect(res.status).toBe(400);
  });
});

// ── /delete-design ────────────────────────────────────────────────────────────

async function seedDesigns(env, deviceId, designs) {
  await env.MOCKUP_STAGING.put(
    `device-designs/${deviceId}.json`,
    JSON.stringify(designs),
  );
}

describe('POST /delete-design', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('removes the design with the matching id', async () => {
    await seedDesigns(env, 'dev-1', [
      { id: 'aaa', shader: 'rise-shirt' },
      { id: 'bbb', shader: 'circle-on-line' },
    ]);

    const res = await worker.fetch(post('/delete-design', { id: 'aaa', deviceId: 'dev-1' }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const obj = await env.MOCKUP_STAGING.get('device-designs/dev-1.json');
    const remaining = JSON.parse(await obj.text());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('bbb');
  });

  it('returns ok when id is not found (idempotent)', async () => {
    await seedDesigns(env, 'dev-2', [{ id: 'aaa', shader: 'rise-shirt' }]);

    const res = await worker.fetch(post('/delete-design', { id: 'no-such', deviceId: 'dev-2' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const obj = await env.MOCKUP_STAGING.get('device-designs/dev-2.json');
    const remaining = JSON.parse(await obj.text());
    expect(remaining).toHaveLength(1);
  });

  it('returns 400 when id or deviceId is missing', async () => {
    const res = await worker.fetch(post('/delete-design', { id: 'aaa' }), env);
    expect(res.status).toBe(400);
  });
});

describe('pickSizeVariant', () => {
  const sizeVariants = [
    { id: 'gid://shopify/ProductVariant/1', selectedOptions: [{ name: 'Size', value: 'XS' }] },
    { id: 'gid://shopify/ProductVariant/2', selectedOptions: [{ name: 'Size', value: 'M' }] },
    { id: 'gid://shopify/ProductVariant/3', selectedOptions: [{ name: 'Size', value: 'L' }] },
  ];

  it('returns the variant matching requestedSize', () => {
    expect(pickSizeVariant(sizeVariants, 'M').id).toBe('gid://shopify/ProductVariant/2');
  });

  it('falls back to the first variant when requestedSize is not found', () => {
    expect(pickSizeVariant(sizeVariants, '2XL').id).toBe('gid://shopify/ProductVariant/1');
  });

  it('falls back to the first variant when requestedSize is null', () => {
    expect(pickSizeVariant(sizeVariants, null).id).toBe('gid://shopify/ProductVariant/1');
  });
});

// ── Shopify session token (JWT) admin auth ────────────────────────────────────
// requireAdmin() accepts either the static ADMIN_TOKEN bearer, or an HS256 App
// Bridge session token whose aud/dest/iss/nbf/exp all check out. GET /community/pending
// is a requireAdmin-gated endpoint that needs no other setup, so it's used as the
// harness for exercising verifyShopifySessionToken end-to-end.

describe('admin auth via Shopify session token (JWT)', () => {
  let env;
  beforeEach(() => { env = makeAdminEnv(); });

  it('accepts a valid session token with correct aud/dest/iss/nbf', async () => {
    const token = await mintSessionToken();
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('still accepts the static ADMIN_TOKEN bearer fallback', async () => {
    const res = await worker.fetch(get('/community/pending', adminHeaders()), env);
    expect(res.status).toBe(200);
  });

  it('rejects a token with the wrong aud (different app)', async () => {
    const token = await mintSessionToken({ aud: 'some-other-client-id' });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a token missing aud entirely', async () => {
    const token = await mintSessionToken({ aud: undefined });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong dest (different shop)', async () => {
    const token = await mintSessionToken({ dest: 'https://some-other-shop.myshopify.com' });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong iss (different shop admin domain)', async () => {
    const token = await mintSessionToken({ iss: 'https://some-other-shop.myshopify.com/admin' });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a dest that is missing the https:// scheme', async () => {
    // Some tooling emits bare domains — real App Bridge tokens never do, but the
    // comparison must be exact rather than a loose "contains" check.
    const token = await mintSessionToken({ dest: TEST_STORE_DOMAIN });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose nbf is in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintSessionToken({ nbf: now + 3600 });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('accepts a token whose nbf is exactly now-or-past', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintSessionToken({ nbf: now - 1 });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(200);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintSessionToken({ exp: now - 60 });
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await mintSessionToken({}, 'not-the-real-secret');
    const res = await worker.fetch(get('/community/pending', bearerHeaders(token)), env);
    expect(res.status).toBe(401);
  });

  it('rejects a missing Authorization header', async () => {
    const res = await worker.fetch(get('/community/pending'), env);
    expect(res.status).toBe(401);
  });
});
