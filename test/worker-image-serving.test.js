// @vitest-environment node
//
// Coverage for GET /img/{key} — images are served through the worker instead of
// the pub-*.r2.dev dev domain (rate-limited, intermittently fails in production)
// — and for the legacy-URL rewriting that read endpoints apply to entries stored
// before the /img/ route existed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/src/index.js';

afterEach(() => vi.unstubAllGlobals());

// ── R2 in-memory mock (with binary reads, unlike the other suites') ───────────
function makeR2() {
  const store = new Map();
  return {
    _store: store,
    put: vi.fn(async (key, value, opts = {}) => {
      store.set(key, { value: String(value), httpMetadata: opts.httpMetadata });
    }),
    get: vi.fn(async (key) => {
      if (!store.has(key)) return null;
      const { value, httpMetadata } = store.get(key);
      return {
        httpMetadata,
        text:        async () => value,
        arrayBuffer: async () => new TextEncoder().encode(value).buffer,
      };
    }),
    delete: vi.fn(async (key) => { store.delete(key); }),
  };
}

function makeEnv(overrides = {}) {
  return { MOCKUP_STAGING: makeR2(), R2_PUBLIC_DOMAIN: 'r2.example.com', ...overrides };
}

function get(path) {
  return new Request(`https://worker.example.com${path}`, { method: 'GET' });
}

// IMAGES binding stub whose chain records the transform options
function makeImages(outputBytes = 'resized-bytes') {
  const calls = { transform: null, output: null };
  const chain = {
    input:     vi.fn(() => chain),
    transform: vi.fn((opts) => { calls.transform = opts; return chain; }),
    output:    vi.fn((opts) => { calls.output = opts; return chain; }),
    response:  () => new Response(outputBytes),
  };
  return { binding: chain, calls };
}

describe('GET /img/{key}', () => {
  it('serves a stored mockup with its content type and immutable cache headers', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('mockups/abc.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });

    const res = await worker.fetch(get('/img/mockups/abc.jpg'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('jpeg-bytes');
  });

  it('returns 404 for a missing object', async () => {
    const res = await worker.fetch(get('/img/mockups/nope.jpg'), makeEnv());
    expect(res.status).toBe(404);
  });

  it('refuses non-image keys and prefixes outside the allowlist', async () => {
    const env = makeEnv();
    // JSON blobs must stay private even when they exist in the bucket
    await env.MOCKUP_STAGING.put('device-designs/dev-1.json', '[{"secret":1}]');
    await env.MOCKUP_STAGING.put('community/submissions/abc.json', '{"creatorEmail":"x@y.z"}');
    await env.MOCKUP_STAGING.put('shares/abc.json', '{"values":{}}');

    for (const path of [
      '/img/device-designs/dev-1.json',
      '/img/community/submissions/abc.json',
      '/img/shares/abc.json',
      '/img/mockups/%2e%2e/device-designs/dev-1.json',
      '/img/mockups/%zz.jpg', // malformed %-encoding must 404, not throw
    ]) {
      const res = await worker.fetch(get(path), env);
      expect(res.status, path).toBe(404);
    }
  });

  it('resizes via the IMAGES binding when ?w= is given', async () => {
    const { binding, calls } = makeImages('small-bytes');
    const env = makeEnv({ IMAGES: binding });
    await env.MOCKUP_STAGING.put('mockups/abc.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });

    const res = await worker.fetch(get('/img/mockups/abc.jpg?w=320'), env);
    expect(res.status).toBe(200);
    expect(calls.transform).toMatchObject({ width: 320 });
    // Source format is preserved (PNG mockups carry alpha)
    expect(calls.output).toMatchObject({ format: 'image/jpeg' });
    expect(await res.text()).toBe('small-bytes');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('caps ?w= at 2000 and ignores invalid values', async () => {
    const { binding, calls } = makeImages();
    const env = makeEnv({ IMAGES: binding });
    await env.MOCKUP_STAGING.put('mockups/abc.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });

    await worker.fetch(get('/img/mockups/abc.jpg?w=99999'), env);
    expect(calls.transform).toMatchObject({ width: 2000 });

    const res = await worker.fetch(get('/img/mockups/abc.jpg?w=banana'), env);
    expect(await res.text()).toBe('jpeg-bytes'); // original, no transform
  });

  it('serves the original bytes when the resize fails', async () => {
    const binding = {
      input: () => { throw new Error('transform exploded'); },
    };
    const env = makeEnv({ IMAGES: binding });
    await env.MOCKUP_STAGING.put('mockups/abc.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });

    const res = await worker.fetch(get('/img/mockups/abc.jpg?w=320'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    // The full-res fallback must not get pinned under the thumbnail cache key
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves the original when no IMAGES binding is configured', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('mockups/abc.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });

    const res = await worker.fetch(get('/img/mockups/abc.jpg?w=320'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('legacy pub-*.r2.dev URL rewriting', () => {
  it('rewrites stored URLs in /list-designs responses', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('device-designs/dev-1.json', JSON.stringify([{
      id: 'd1',
      designUrl: 'https://r2.example.com/designs/a.png',
      mockupUrl: 'https://r2.example.com/mockups/a.jpg',
      values: {},
    }]));

    const res = await worker.fetch(get('/list-designs?deviceId=dev-1'), env);
    const [entry] = await res.json();
    expect(entry.designUrl).toBe('https://share.brightfield.studio/img/designs/a.png');
    expect(entry.mockupUrl).toBe('https://share.brightfield.studio/img/mockups/a.jpg');
  });

  it('leaves third-party URLs alone', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('device-designs/dev-1.json', JSON.stringify([{
      id: 'd1',
      mockupUrl: 'https://files.printful.com/mockup.jpg',
    }]));

    const res = await worker.fetch(get('/list-designs?deviceId=dev-1'), env);
    const [entry] = await res.json();
    expect(entry.mockupUrl).toBe('https://files.printful.com/mockup.jpg');
  });

  it('rewrites mockup URLs in /community/list responses', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('community/list.json', JSON.stringify(['sub-1']));
    await env.MOCKUP_STAGING.put('community/submissions/sub-1.json', JSON.stringify({
      id: 'sub-1',
      shader: 'rise-shirt',
      status: 'approved',
      shopifyProductHandle: 'community-rise-1',
      mockupUrl: 'https://r2.example.com/mockups/b.jpg',
      creatorName: 'Sam',
      creatorEmail: 'sam@example.com',
    }));

    const res = await worker.fetch(get('/community/list'), env);
    const [sub] = await res.json();
    expect(sub.mockupUrl).toBe('https://share.brightfield.studio/img/mockups/b.jpg');
    expect(sub.creatorEmail).toBeUndefined();
  });

  it('rewrites the og:image on share pages', async () => {
    const env = makeEnv();
    await env.MOCKUP_STAGING.put('shares/share-1.json', JSON.stringify({
      id: 'share-1',
      shader: 'rise-shirt',
      productHandle: 'dot-rise',
      imageUrl: 'https://r2.example.com/shares/share-1.jpg',
      values: {},
    }));

    const res = await worker.fetch(get('/share/share-1'), env);
    const html = await res.text();
    expect(html).toContain('https://share.brightfield.studio/img/shares/share-1.jpg');
    expect(html).not.toContain('r2.example.com');
  });
});
