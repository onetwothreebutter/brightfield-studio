import { describe, it, expect, vi } from 'vitest';
import worker from '../worker/src/index.js';

// Coverage for the device design gallery: GET /list-designs, plus the
// saveDesignEntry semantics reached through POST /save-preview. Validation,
// URL shapes, first-time deviceToken minting, and rate limiting for
// /save-preview are pinned in test/worker-create-product.test.js; the tests
// here pin only what no other suite does.

// ── R2 in-memory mock ─────────────────────────────────────────────────────────
function makeR2() {
  const store = new Map();
  return {
    _store: store,
    get:    vi.fn(async (key) => {
      if (!store.has(key)) return null;
      return { text: async () => store.get(key) };
    }),
    put:    vi.fn(async (key, value) => { store.set(key, String(value)); }),
    // Was a no-op stub — see the same fix in worker-create-product.test.js. A test
    // that put()s a key, delete()s it, then get()s it again would have silently
    // seen the stale value instead of null.
    delete: vi.fn(async (key) => { store.delete(key); }),
  };
}

function makeEnv(r2 = makeR2(), overrides = {}) {
  return { MOCKUP_STAGING: r2, PRINTFUL_API_KEY: 'test-key', R2_PUBLIC_DOMAIN: 'r2.example.com', ...overrides };
}

function makeRequest(method, path, body, origin = 'https://brightfield-2.myshopify.com') {
  const init = { method, headers: { Origin: origin, 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`https://worker.example.com${path}`, init);
}

// ── GET /list-designs ─────────────────────────────────────────────────────────

describe('GET /list-designs', () => {
  it('returns [] when deviceId query param is absent', async () => {
    const res = await worker.fetch(makeRequest('GET', '/list-designs'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns [] when no R2 entry exists for the deviceId', async () => {
    const res = await worker.fetch(makeRequest('GET', '/list-designs?deviceId=unknown-id'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns stored designs for a known deviceId', async () => {
    const r2 = makeR2();
    const designs = [{ id: '1', shader: 'echo-text', mockupUrl: 'https://x.jpg' }];
    r2._store.set('device-designs/dev-abc.json', JSON.stringify(designs));

    const res = await worker.fetch(makeRequest('GET', '/list-designs?deviceId=dev-abc'), makeEnv(r2));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(designs);
  });

  it('includes CORS Allow-Origin for a known origin', async () => {
    const res = await worker.fetch(makeRequest('GET', '/list-designs'), makeEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brightfield-2.myshopify.com');
  });

  it('allows GET in CORS Allow-Methods', async () => {
    const preflight = new Request('https://worker.example.com/list-designs', {
      method: 'OPTIONS',
      headers: { Origin: 'https://brightfield-2.myshopify.com' },
    });
    const res = await worker.fetch(preflight, makeEnv());
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

// ── POST /save-preview — design entry semantics ───────────────────────────────
// Ported from the deleted /generate-mockup suite; both routes shared
// saveDesignEntry(), and /save-preview is the surviving caller.

function saveBody(extra = {}) {
  return {
    designImage: btoa('fake-png'),
    mockupImage: btoa('fake-jpg'),
    shader: 'echo-text',
    productHandle: 'echo-text-shirt',
    values: {},
    ...extra,
  };
}

describe('POST /save-preview — design entry semantics', () => {
  it('prepends the new entry so newest is first', async () => {
    const r2 = makeR2();
    const existing = [{ id: 'old', shader: 'circle-on-line', timestamp: 1000 }];
    r2._store.set('device-designs/dev-2.json', JSON.stringify(existing));

    await worker.fetch(makeRequest('POST', '/save-preview', saveBody({ deviceId: 'dev-2' })), makeEnv(r2));

    const saveCall = r2.put.mock.calls.find(([k]) => k === 'device-designs/dev-2.json');
    expect(saveCall).toBeDefined();
    const saved = JSON.parse(saveCall[1]);
    expect(saved[0].shader).toBe('echo-text');       // newest first
    expect(saved[1].shader).toBe('circle-on-line');  // old entry preserved
  });

  it('keeps all designs without trimming', async () => {
    const r2 = makeR2();
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: String(i), shader: 'old' }));
    r2._store.set('device-designs/dev-3.json', JSON.stringify(existing));

    await worker.fetch(makeRequest('POST', '/save-preview', saveBody({ deviceId: 'dev-3' })), makeEnv(r2));

    const saveCall = r2.put.mock.calls.find(([k]) => k === 'device-designs/dev-3.json');
    expect(JSON.parse(saveCall[1])).toHaveLength(21);
  });

  it('does not mint a second token (or include deviceToken) once a deviceId is already claimed', async () => {
    const r2 = makeR2();
    r2._store.set('device-tokens/dev-existing.json', JSON.stringify({ token: 'old-token', claimedAt: 1 }));

    const res = await worker.fetch(
      makeRequest('POST', '/save-preview', saveBody({ deviceId: 'dev-existing' })),
      makeEnv(r2, { DEVICE_ID_SECRET: 'test-secret' })
    );

    const body = await res.json();
    expect(body.deviceToken).toBeUndefined();
    expect(r2.put.mock.calls.some(([k]) => k === 'device-tokens/dev-existing.json')).toBe(false);
  });

  it('omits deviceToken (fails open, no crash) when DEVICE_ID_SECRET is not configured', async () => {
    const r2 = makeR2();
    const res = await worker.fetch(
      makeRequest('POST', '/save-preview', saveBody({ deviceId: 'dev-nosecret' })),
      makeEnv(r2) // no DEVICE_ID_SECRET override
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceToken).toBeUndefined();
  });
});
