import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index.js';

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

function makeEnv(r2 = makeR2()) {
  return { MOCKUP_STAGING: r2, PRINTFUL_API_KEY: 'test-key', R2_PUBLIC_DOMAIN: 'r2.example.com' };
}

function makeRequest(method, path, body, origin = 'https://brightfield-2.myshopify.com') {
  const init = { method, headers: { Origin: origin, 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`https://worker.example.com${path}`, init);
}

// Printful API mock — returns a completed mockup on the first poll
function makePrintfulFetch(mockupUrl = 'https://printful.com/mockup.jpg') {
  return vi.fn(async (url) => {
    if (url.includes('create-task')) {
      return { json: async () => ({ code: 200, result: { task_key: 'task-abc' } }) };
    }
    if (url.includes('task?task_key')) {
      return { json: async () => ({ result: { status: 'completed', mockups: [{ mockup_url: mockupUrl }] } }) };
    }
    if (url === mockupUrl) {
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    throw new Error('Unexpected fetch: ' + url);
  });
}

afterEach(() => vi.unstubAllGlobals());

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

// ── POST /generate-mockup — validation ─────────────────────────────────────────

describe('POST /generate-mockup — validation', () => {
  it('returns 413 when the raw body exceeds the size cap', async () => {
    const res = await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: 'A'.repeat(11_500_000),
      variant_id: 4017,
    }), makeEnv());
    expect(res.status).toBe(413);
  });

  it('returns 413 when the image exceeds the decoded-image cap', async () => {
    // Passes the body cap but exceeds the 8 MB decoded-image cap.
    const res = await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: 'A'.repeat(11_200_000),
      variant_id: 4017,
    }), makeEnv());
    expect(res.status).toBe(413);
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('https://worker.example.com/generate-mockup', {
      method: 'POST',
      headers: { Origin: 'https://brightfield-2.myshopify.com', 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 (not an unhandled exception) for a syntactically invalid base64 image', async () => {
    // '!' is not a valid base64 character — atob() throws on it. Passes the
    // string-type and size checks (it's short), so this only ever hits the
    // atob() call itself.
    const res = await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: '!'.repeat(100),
      variant_id: 4017,
    }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid image encoding');
  });
});

// ── POST /generate-mockup — design saving ─────────────────────────────────────

describe('POST /generate-mockup — design saving', () => {
  const MOCKUP_URL = 'https://printful.com/mockup.jpg';

  beforeEach(() => {
    vi.stubGlobal('fetch', makePrintfulFetch(MOCKUP_URL));
  });

  it('saves a design entry to R2 when deviceId is present', async () => {
    const r2 = makeR2();
    await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: btoa('fake-png'),
      variant_id: 4017,
      deviceId: 'dev-1',
      shader: 'echo-text',
      productHandle: 'echo-text-shirt',
      values: { u_speed: 1.5 },
    }), makeEnv(r2));

    const saveCall = r2.put.mock.calls.find(([k]) => k.startsWith('device-designs/'));
    expect(saveCall).toBeDefined();

    const saved = JSON.parse(saveCall[1]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      shader: 'echo-text',
      productHandle: 'echo-text-shirt',
      mockupUrl: expect.stringContaining('share.brightfield.studio/img/mockups/'),
      values: { u_speed: 1.5 },
    });
    expect(saved[0].id).toBeTruthy();
    expect(saved[0].timestamp).toBeGreaterThan(0);
  });

  it('does NOT write device-designs when deviceId is absent', async () => {
    const r2 = makeR2();
    await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: btoa('fake-png'),
      variant_id: 4017,
    }), makeEnv(r2));

    const designSave = r2.put.mock.calls.find(([k]) => k.startsWith('device-designs/'));
    expect(designSave).toBeUndefined();
  });

  it('prepends new entry so newest is first', async () => {
    const r2 = makeR2();
    const existing = [{ id: 'old', shader: 'circle-on-line', timestamp: 1000 }];
    r2._store.set('device-designs/dev-2.json', JSON.stringify(existing));

    await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: btoa('fake-png'),
      variant_id: 4017,
      deviceId: 'dev-2',
      shader: 'echo-text',
      productHandle: 'echo-text-shirt',
      values: {},
    }), makeEnv(r2));

    const saveCall = r2.put.mock.calls.find(([k]) => k === 'device-designs/dev-2.json');
    const saved = JSON.parse(saveCall[1]);
    expect(saved[0].shader).toBe('echo-text');    // newest first
    expect(saved[1].shader).toBe('circle-on-line');  // old entry preserved
  });

  it('keeps all designs without trimming', async () => {
    const r2 = makeR2();
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: String(i), shader: 'old' }));
    r2._store.set('device-designs/dev-3.json', JSON.stringify(existing));

    await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: btoa('fake-png'),
      variant_id: 4017,
      deviceId: 'dev-3',
      shader: 'echo-text',
      productHandle: 'echo-text-shirt',
      values: {},
    }), makeEnv(r2));

    const saveCall = r2.put.mock.calls.find(([k]) => k === 'device-designs/dev-3.json');
    expect(JSON.parse(saveCall[1])).toHaveLength(21);
  });

  it('still returns mockup_url and design_url on success', async () => {
    const r2 = makeR2();
    const res = await worker.fetch(makeRequest('POST', '/generate-mockup', {
      image: btoa('fake-png'),
      variant_id: 4017,
      deviceId: 'dev-4',
      shader: 'echo-text',
      productHandle: 'echo-text-shirt',
      values: {},
    }), makeEnv(r2));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mockup_url).toContain('share.brightfield.studio/img/mockups/');
    expect(body.design_url).toContain('share.brightfield.studio/img/designs/');
  });
});
