const ALLOWED_ORIGINS = new Set([
  'https://brightfield.studio',
  'https://brightfield-2.myshopify.com',
  'http://127.0.0.1:9292',
]);
const PRINTFUL_API = 'https://api.printful.com';

// Bella + Canvas 3001 — product ID 71, front print area
const PRODUCT_ID   = 71;
const PRINT_WIDTH  = 1800;
const PRINT_HEIGHT = 2400;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : 'https://brightfield.studio',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url      = new URL(request.url);
    const method   = request.method;
    const pathname = url.pathname;

    if (method === 'POST' && pathname === '/generate-mockup') {
      return handleGenerateMockup(request, env, origin);
    }

    if (method === 'GET' && pathname === '/list-designs') {
      return handleListDesigns(request, env, origin);
    }

    if (method === 'POST' && pathname === '/community/submit')  return handleCommunitySubmit(request, env, origin);
    if (method === 'GET'  && pathname === '/community/list')    return handleCommunityList(request, env, origin);
    if (method === 'POST' && pathname === '/community/like')    return handleCommunityLike(request, env, origin);
    if (method === 'GET'  && pathname === '/community/pending') return handleCommunityPending(request, env, origin);
    if (method === 'POST' && pathname === '/community/approve') return handleCommunityModerate(request, env, origin, 'approved');
    if (method === 'POST' && pathname === '/community/reject')  return handleCommunityModerate(request, env, origin, 'rejected');

    return new Response('Not found', { status: 404 });
  }
};

async function handleGenerateMockup(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { image, variant_id, deviceId, shader, productHandle, values } = body;
  if (!image || !variant_id) {
    return new Response(JSON.stringify({ error: 'Missing image or variant_id' }), { status: 400, headers });
  }

  // 1. Decode base64 PNG and upload to R2
  const imageKey  = `designs/${crypto.randomUUID()}.png`;
  const imageData = Uint8Array.from(atob(image), c => c.charCodeAt(0));

  await env.MOCKUP_STAGING.put(imageKey, imageData, {
    httpMetadata: { contentType: 'image/png' }
  });

  // R2 public URL — requires the bucket to have public access enabled
  const imageUrl = `https://${env.R2_PUBLIC_DOMAIN}/${imageKey}`;

  try {
    // 2. Create Printful mockup task
    // Note: catch block returns a JSON error response; finally always cleans up R2
    const taskRes = await fetch(`${PRINTFUL_API}/mockup-generator/create-task/${PRODUCT_ID}`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        variant_ids: [Number(variant_id)],
        format: 'jpg',
        files: [{
          placement: 'front',
          image_url: imageUrl,
          position: {
            area_width:  PRINT_WIDTH,
            area_height: PRINT_HEIGHT,
            width:       PRINT_WIDTH,
            height:      PRINT_HEIGHT,
            top:  0,
            left: 0,
          }
        }]
      })
    });

    const taskJson = await taskRes.json();
    if (taskJson.code !== 200) {
      throw new Error(taskJson.result || taskJson.error || JSON.stringify(taskJson));
    }

    const taskKey = taskJson.result.task_key;

    // 3. Poll for result (max 20 attempts, 1.5s apart)
    let mockupUrl = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const resultRes  = await fetch(`${PRINTFUL_API}/mockup-generator/task?task_key=${taskKey}`, {
        headers: { 'Authorization': `Bearer ${env.PRINTFUL_API_KEY}` }
      });
      const resultJson = await resultRes.json();
      const status     = resultJson.result?.status;

      if (status === 'completed') {
        mockupUrl = resultJson.result.mockups?.[0]?.mockup_url;
        break;
      }
      if (status === 'failed') {
        const detail = resultJson.result?.error || JSON.stringify(resultJson.result);
        throw new Error(`Printful mockup generation failed: ${detail}`);
      }
    }

    if (!mockupUrl) {
      throw new Error('Mockup generation timed out');
    }

    // 4. Keep the design file in R2 — merchant needs the URL to submit to Printful when fulfilling
    // 5. Save design entry for the device gallery (best-effort)
    if (deviceId) {
      const entry = {
        id: crypto.randomUUID(),
        shader: shader || '',
        productHandle: productHandle || '',
        designUrl: imageUrl,
        mockupUrl,
        values: values || {},
        timestamp: Math.floor(Date.now() / 1000),
      };
      await saveDesignEntry(env, deviceId, entry).catch(() => {});
    }

    return new Response(JSON.stringify({ mockup_url: mockupUrl, design_url: imageUrl }), { status: 200, headers });

  } catch (err) {
    // Clean up orphaned R2 file on failure only
    env.MOCKUP_STAGING.delete(imageKey).catch(() => {});
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleListDesigns(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId');
  if (!deviceId) {
    return new Response(JSON.stringify([]), { status: 200, headers });
  }
  try {
    const obj = await env.MOCKUP_STAGING.get(`device-designs/${deviceId}.json`);
    if (!obj) return new Response(JSON.stringify([]), { status: 200, headers });
    const text = await obj.text();
    return new Response(text, { status: 200, headers });
  } catch {
    return new Response(JSON.stringify([]), { status: 200, headers });
  }
}

// ── Community helpers ────────────────────────────────────────────────────────

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

async function readJson(env, key) {
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (!obj) return null;
    return JSON.parse(await obj.text());
  } catch { return null; }
}

async function writeJson(env, key, data) {
  await env.MOCKUP_STAGING.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
}

// ── Community handlers ───────────────────────────────────────────────────────

async function handleCommunitySubmit(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { shader, productHandle, mockupUrl, values, creatorName, creatorEmail } = body;
  if (!mockupUrl || !creatorName || !shader) {
    return new Response(JSON.stringify({ error: 'Missing required fields: mockupUrl, creatorName, shader' }), { status: 400, headers });
  }

  const id = crypto.randomUUID();
  const submission = {
    id,
    shader,
    productHandle: productHandle || '',
    mockupUrl,
    values: values || {},
    timestamp: Math.floor(Date.now() / 1000),
    status: 'pending',
    creatorName,
    creatorEmail: creatorEmail || '',
    likes: 0,
  };

  await writeJson(env, `community/submissions/${id}.json`, submission);

  const list = (await readJson(env, 'community/list.json')) || [];
  list.unshift(id);
  await writeJson(env, 'community/list.json', list);

  return new Response(JSON.stringify({ id }), { status: 201, headers });
}

async function handleCommunityList(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const url = new URL(request.url);
  const shaderFilter = url.searchParams.get('shader');

  const list = (await readJson(env, 'community/list.json')) || [];
  const ids = list.slice(0, 100);

  const submissions = (
    await Promise.all(ids.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === 'approved');

  const filtered = shaderFilter
    ? submissions.filter(s => s.shader === shaderFilter)
    : submissions;

  const sanitized = filtered.map(({ creatorEmail: _omit, ...rest }) => rest);
  return new Response(JSON.stringify(sanitized), { status: 200, headers });
}

async function handleCommunityLike(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id, deviceId } = body;
  if (!id || !deviceId) {
    return new Response(JSON.stringify({ error: 'Missing id or deviceId' }), { status: 400, headers });
  }

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) {
    return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers });
  }

  const likeKey = `community/likes/${id}/${deviceId}`;
  const existing = await env.MOCKUP_STAGING.get(likeKey);
  let liked;

  if (!existing) {
    submission.likes = (submission.likes || 0) + 1;
    await env.MOCKUP_STAGING.put(likeKey, '1');
    liked = true;
  } else {
    submission.likes = Math.max(0, (submission.likes || 0) - 1);
    await env.MOCKUP_STAGING.delete(likeKey);
    liked = false;
  }

  await writeJson(env, `community/submissions/${id}.json`, submission);
  return new Response(JSON.stringify({ likes: submission.likes, liked }), { status: 200, headers });
}

async function handleCommunityPending(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const list = (await readJson(env, 'community/list.json')) || [];
  const submissions = (
    await Promise.all(list.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === 'pending');

  return new Response(JSON.stringify(submissions), { status: 200, headers });
}

async function handleCommunityModerate(request, env, origin, newStatus) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers });
  }

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) {
    return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers });
  }

  submission.status = newStatus;
  await writeJson(env, `community/submissions/${id}.json`, submission);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Device design gallery ────────────────────────────────────────────────────

async function saveDesignEntry(env, deviceId, entry) {
  const key = `device-designs/${deviceId}.json`;
  let designs = [];
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (obj) {
      designs = JSON.parse(await obj.text());
    }
  } catch { designs = []; }
  designs.unshift(entry);
  if (designs.length > 20) designs = designs.slice(0, 20);
  await env.MOCKUP_STAGING.put(key, JSON.stringify(designs), {
    httpMetadata: { contentType: 'application/json' },
  });
}
