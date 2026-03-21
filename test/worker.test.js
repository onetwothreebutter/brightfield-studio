// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../worker/src/index.js';

// ── Mock R2 bucket ────────────────────────────────────────────────────────────

function makeR2() {
  const store = new Map();
  return {
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

    // approve it
    await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    res = await worker.fetch(get('/community/list'), env);
    expect(await res.json()).toHaveLength(1);
  });

  it('strips creatorEmail from results', async () => {
    const { id } = await submitDesign(env);
    await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    const [design] = await (await worker.fetch(get('/community/list'), env)).json();
    expect(design.creatorEmail).toBeUndefined();
    expect(design.creatorName).toBe('Jane');
  });

  it('filters by ?shader= when provided', async () => {
    const { id: id1 } = await submitDesign(env, { shader: 'rise-shirt' });
    const { id: id2 } = await submitDesign(env, { shader: 'echo-text' });
    await worker.fetch(post('/community/approve', { id: id1 }, adminHeaders()), env);
    await worker.fetch(post('/community/approve', { id: id2 }, adminHeaders()), env);

    const res = await worker.fetch(get('/community/list?shader=rise-shirt'), env);
    const results = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0].shader).toBe('rise-shirt');
  });

  it('returns [] when ?shader= matches nothing', async () => {
    const { id } = await submitDesign(env, { shader: 'rise-shirt' });
    await worker.fetch(post('/community/approve', { id }, adminHeaders()), env);
    const res = await worker.fetch(get('/community/list?shader=other'), env);
    expect(await res.json()).toEqual([]);
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
      { id: 'bbb', shader: 'line-circle' },
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
