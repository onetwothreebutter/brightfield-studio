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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

    if (method === 'POST' && pathname === '/delete-design') {
      return handleDeleteDesign(request, env, origin);
    }

    if (method === 'POST' && pathname === '/community/submit')  return handleCommunitySubmit(request, env, origin);
    if (method === 'GET'  && pathname === '/community/list')    return handleCommunityList(request, env, origin);
    if (method === 'POST' && pathname === '/community/like')    return handleCommunityLike(request, env, origin);
    if (method === 'GET'  && pathname === '/community/pending') return handleCommunityPending(request, env, origin);
    if (method === 'POST' && pathname === '/community/approve') return handleCommunityModerate(request, env, origin, 'approved');
    if (method === 'POST' && pathname === '/community/reject')  return handleCommunityModerate(request, env, origin, 'rejected');

    if (method === 'POST' && pathname === '/save-shader-state')           return handleSaveShaderState(request, env, origin);
    if (method === 'GET'  && pathname.startsWith('/get-shader-state/'))   return handleGetShaderState(request, env, origin);
    if (method === 'POST' && pathname === '/create-share')                return handleCreateShare(request, env, origin);

    // Custom domain: share.brightfield.studio/{id}
    if (method === 'GET' && url.hostname === 'share.brightfield.studio') return handleShare(request, env, pathname.slice(1));

    if (method === 'GET'  && pathname.startsWith('/share/')) return handleShare(request, env, pathname.slice(7));

    if (method === 'GET'  && pathname === '/admin-ui') return handleAdminUI(request, env);

    if (method === 'GET'  && pathname === '/download-mockup') return handleDownloadMockup(request, env, origin);

    if (method === 'POST' && pathname === '/remove-bg') return handleRemoveBg(request, env, origin);

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

  const { image, variant_id, deviceId, shader, productHandle, values, skipBgRemoval } = body;
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
    console.log('[mockup] Printful create-task response:', JSON.stringify(taskJson));
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
      console.log('[mockup] Printful poll result:', JSON.stringify(resultJson.result));
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

    // 4. Re-host the Printful mockup in R2 so the URL doesn't expire
    const mockupImageRes = await fetch(mockupUrl);
    let downloadUrl = null;
    if (mockupImageRes.ok) {
      let mockupData        = await mockupImageRes.arrayBuffer();
      let mockupContentType = 'image/jpeg';
      let mockupExt         = 'jpg';

      // Remove background via Cloudflare Images (best-effort — falls back to original on failure)
      if (env.IMAGES && !skipBgRemoval) {
        try {
          const processed = await env.IMAGES
            .input(mockupData)
            .transform({ segment: 'foreground' })
            .output({ format: 'image/png' });
          mockupData        = await processed.response().arrayBuffer();
          mockupContentType = 'image/png';
          mockupExt         = 'png';
        } catch (imgErr) {
          console.error('Background removal failed, using original:', imgErr.message);
        }
      }

      const mockupKey = `mockups/${crypto.randomUUID()}.${mockupExt}`;
      await env.MOCKUP_STAGING.put(mockupKey, mockupData, {
        httpMetadata: { contentType: mockupContentType }
      });
      mockupUrl = `https://${env.R2_PUBLIC_DOMAIN}/${mockupKey}`;
      const shaderSlug = (shader || '').replace(/[^a-z0-9-]/g, '') || 'design';
      downloadUrl = `${new URL(request.url).origin}/download-mockup?key=${encodeURIComponent(mockupKey)}&shader=${encodeURIComponent(shaderSlug)}`;
    }

    // 5. Keep the design file in R2 — merchant needs the URL to submit to Printful when fulfilling
    // 6. Save design entry for the device gallery (best-effort)
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

    const responseBody = { mockup_url: mockupUrl, design_url: imageUrl };
    if (downloadUrl) responseBody.download_url = downloadUrl;
    return new Response(JSON.stringify(responseBody), { status: 200, headers });

  } catch (err) {
    // Clean up orphaned R2 file on failure only
    env.MOCKUP_STAGING.delete(imageKey).catch(() => {});
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function handleDownloadMockup(request, env, origin) {
  const params = new URL(request.url).searchParams;
  const key    = params.get('key');
  const shader = (params.get('shader') || '').replace(/[^a-z0-9-]/g, '') || 'design';
  if (!key) return new Response('Missing key', { status: 400, headers: corsHeaders(origin) });
  const obj = await env.MOCKUP_STAGING.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  // Use client-supplied local datetime if present, otherwise fall back to UTC
  const dt = (params.get('dt') || '').replace(/[^a-z0-9-]/g, '');
  let datetime = dt;
  if (!datetime) {
    const now     = new Date();
    const year    = now.getUTCFullYear();
    const month   = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day     = String(now.getUTCDate()).padStart(2, '0');
    const h24     = now.getUTCHours();
    const ampm    = h24 >= 12 ? 'pm' : 'am';
    const hour    = h24 % 12 || 12;
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    datetime = `${year}-${month}-${day}-${hour}${minutes}${ampm}`;
  }
  const ext         = key.endsWith('.png') ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const filename = `my-${shader}-design--brightfield--${datetime}.${ext}`;
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders(origin),
    },
  });
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

async function handleDeleteDesign(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { id, deviceId } = body;
  if (!id || !deviceId) {
    return new Response(JSON.stringify({ error: 'Missing id or deviceId' }), { status: 400, headers });
  }

  const key = `device-designs/${deviceId}.json`;
  let designs = [];
  try {
    const obj = await env.MOCKUP_STAGING.get(key);
    if (obj) designs = JSON.parse(await obj.text());
  } catch { designs = []; }

  const filtered = designs.filter(function (d) { return d.id !== id; });
  await env.MOCKUP_STAGING.put(key, JSON.stringify(filtered), {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Community helpers ────────────────────────────────────────────────────────

async function verifyShopifySessionToken(token, clientSecret) {
  if (!token || !clientSecret) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    function b64urlToBytes(s) {
      const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    if (header.alg !== 'HS256') return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(clientSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), data);
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    if (payload.exp < Date.now() / 1000) return false;

    return true;
  } catch {
    return false;
  }
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth === `Bearer ${env.ADMIN_TOKEN}`) return true;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return verifyShopifySessionToken(token, env.SHOPIFY_APP_CLIENT_SECRET);
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
  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') || 'pending';

  const list = (await readJson(env, 'community/list.json')) || [];
  const submissions = (
    await Promise.all(list.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === statusFilter);

  return new Response(JSON.stringify(submissions), { status: 200, headers });
}

async function handleCommunityModerate(request, env, origin, newStatus) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!await requireAdmin(request, env)) {
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

// ── Share page ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildShareHtml(title, desc, shareUrl, imageUrl, productUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${shareUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Brightfield Studio" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <script>window.location.href = ${JSON.stringify(productUrl)};<\/script>
</head>
<body>
  <p>Redirecting to <a href="${escHtml(productUrl)}">Brightfield Studio</a>\u2026</p>
</body>
</html>`;
}

async function handleShare(request, env, id) {
  if (!id) return Response.redirect('https://brightfield.studio', 302);

  // Direct share (from Share button — image uploaded to shares/{id}.jpg)
  const shareObj = await env.MOCKUP_STAGING.get(`shares/${id}.json`);
  if (shareObj) {
    let meta;
    try { meta = JSON.parse(await shareObj.text()); }
    catch { return Response.redirect('https://brightfield.studio', 302); }
    const shaderLabel = (meta.shader || '').replace(/-/g, ' ');
    const title    = escHtml('A custom ' + shaderLabel + ' design from Brightfield Studio');
    const desc     = escHtml('Customize your own design at Brightfield Studio');
    const shareUrl = escHtml('https://share.brightfield.studio/' + id);
    const imageUrl = escHtml(meta.imageUrl || '');
    const restorePayload = btoa(JSON.stringify({ values: meta.values, shader: meta.shader }));
    const productUrl = 'https://brightfield.studio/products/' + encodeURIComponent(meta.productHandle || '')
      + '?bfr=' + encodeURIComponent(restorePayload) + '#shader';
    return new Response(buildShareHtml(title, desc, shareUrl, imageUrl, productUrl), {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Community submission (existing path)
  const obj = await env.MOCKUP_STAGING.get(`community/submissions/${id}.json`);
  if (!obj) return Response.redirect('https://brightfield.studio', 302);

  let design;
  try { design = JSON.parse(await obj.text()); } catch { return Response.redirect('https://brightfield.studio', 302); }
  if (design.status !== 'approved') return Response.redirect('https://brightfield.studio', 302);

  const shaderLabel = (design.shader || '').replace(/-/g, ' ');
  const title      = escHtml((design.creatorName || 'Anonymous') + "'s design on Brightfield Studio");
  const desc       = escHtml('A custom ' + shaderLabel + ' design created on Brightfield Studio');
  const shareUrl   = escHtml('https://share.brightfield.studio/' + id);
  const mockupUrl  = escHtml(design.mockupUrl || '');
  const restorePayload = btoa(JSON.stringify({
    values: design.values,
    shader: design.shader,
    creatorName: design.creatorName || null,
  }));
  const productUrl = 'https://brightfield.studio/products/' + encodeURIComponent(design.productHandle || '')
    + '?bfr=' + encodeURIComponent(restorePayload) + '#shader';

  return new Response(buildShareHtml(title, desc, shareUrl, mockupUrl, productUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shopify Admin App UI ──────────────────────────────────────────────────────

function handleAdminUI(request, env) {
  const clientId = env.SHOPIFY_APP_CLIENT_ID || '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Community Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="shopify-api-key" content="${clientId}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #202223; background: #f6f6f7; }
    .admin { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
    .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 1px solid #e1e3e5; }
    .tab { background: none; border: none; padding: 0.5rem 1rem; font-size: 0.875rem; color: #6d7175; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab.active { color: #202223; border-bottom-color: #008060; font-weight: 500; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; overflow: hidden; }
    .card-img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
    .card-info { padding: 0.5rem; font-size: 0.75rem; color: #6d7175; line-height: 1.4; }
    .card-info strong { display: block; font-size: 0.8125rem; color: #202223; margin-bottom: 0.15rem; font-weight: 500; }
    .card-actions { display: flex; gap: 0.5rem; padding: 0 0.5rem 0.5rem; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.375rem 0.75rem; font-size: 0.8125rem; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid; flex: 1; }
    .btn-primary { background: #008060; color: #fff; border-color: #008060; }
    .btn-outline { background: #fff; color: #202223; border-color: #c9cccf; }
    .status { color: #6d7175; font-size: 0.875rem; padding: 1.5rem 0; }
    .error { color: #d72c0d; }
    .remove-bg-form { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; }
    .remove-bg-form input { width: 100%; padding: 0.5rem 0.75rem; font-size: 0.875rem; border: 1px solid #c9cccf; border-radius: 6px; }
    .remove-bg-preview { margin-top: 1rem; }
    .remove-bg-preview img { max-width: 100%; max-height: 400px; border-radius: 8px; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; }
  </style>
</head>
<body>
  <div class="admin">
    <h1>Community Designs</h1>
    <div class="tabs">
      <button class="tab active" data-tab="pending">Pending</button>
      <button class="tab" data-tab="approved">Approved</button>
      <button class="tab" data-tab="rejected">Rejected</button>
      <button class="tab" data-tab="remove-bg">Bg Removal</button>
    </div>
    <div id="content"><p class="status">Loading…</p></div>
  </div>
  <script>
    var content = document.getElementById('content');
    var tabs = document.querySelectorAll('.tab');

    // Shopify passes a fresh id_token in the URL on every load (valid ~60s).
    // window.shopify.idToken() hangs in some environments, so we read from URL.
    // On 401, redirect to the Shopify admin app entry point so Shopify issues a fresh token.
    var _token = new URLSearchParams(location.search).get('id_token') || '';
    var _shop  = new URLSearchParams(location.search).get('shop') || '';
    var _shopSlug = _shop.replace('.myshopify.com', '');

    function authHeaders() {
      if (!_token) return null;
      return { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' };
    }

    function refreshApp() {
      var base = _shopSlug
        ? 'https://admin.shopify.com/store/' + _shopSlug + '/apps/community-admin'
        : location.href;
      location.replace(base);
    }

    function timeAgo(ts) {
      var diff = Math.floor((Date.now() - ts * 1000) / 1000);
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function esc(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function loadTab(tab) {
      if (tab === 'remove-bg') { renderRemoveBg(); return; }
      content.innerHTML = '<p class="status">Loading\u2026</p>';
      var headers = authHeaders();
      if (!headers) return;
      try {
        var endpoint = '/community/pending?status=' + tab;
        var r = await fetch(endpoint, { headers: headers });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        renderCards(await r.json(), tab);
      } catch (err) {
        content.innerHTML = '<p class="status error">Error: ' + esc(err.message) + '</p>';
      }
    }

    function renderRemoveBg() {
      content.innerHTML = '';
      var form = document.createElement('div');
      form.className = 'remove-bg-form';

      var row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '0.5rem';

      var input = document.createElement('input');
      input.type = 'text'; input.placeholder = 'Image URL (https://\u2026)';

      var btn = document.createElement('button');
      btn.className = 'btn btn-primary'; btn.textContent = 'Remove Background';
      btn.style.flex = '0 0 auto';

      row.appendChild(input); row.appendChild(btn);
      form.appendChild(row);
      content.appendChild(form);

      var preview = document.createElement('div');
      preview.className = 'remove-bg-preview';
      content.appendChild(preview);

      btn.addEventListener('click', function() { runRemoveBg(input.value.trim(), preview, btn); });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') runRemoveBg(input.value.trim(), preview, btn);
      });
    }

    async function runRemoveBg(url, preview, btn) {
      if (!url) return;
      var headers = authHeaders();
      if (!headers) return;
      preview.innerHTML = '<p class="status">Processing\u2026</p>';
      btn.disabled = true;
      try {
        var r = await fetch('/remove-bg', {
          method: 'POST', headers: headers, body: JSON.stringify({ url: url })
        });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        if (data.error) throw new Error(data.error);

        var imgSrc = 'data:image/png;base64,' + data.png;
        var img = document.createElement('img');
        img.src = imgSrc;

        var dlBtn = document.createElement('a');
        dlBtn.href = imgSrc;
        dlBtn.download = 'product-nobg.png';
        dlBtn.className = 'btn btn-outline';
        dlBtn.style.cssText = 'display:inline-flex;margin-top:0.75rem;flex:0 0 auto;';
        dlBtn.textContent = 'Download PNG';

        preview.innerHTML = '';
        preview.appendChild(img);
        preview.appendChild(dlBtn);
      } catch (err) {
        preview.innerHTML = '<p class="status error">Error: ' + esc(err.message) + '</p>';
      } finally {
        btn.disabled = false;
      }
    }

    function renderCards(designs, tab) {
      if (!designs || !designs.length) {
        content.innerHTML = '<p class="status">No ' + tab + ' designs.</p>';
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'cards';
      designs.forEach(function(d) {
        var card = document.createElement('div');
        card.className = 'card';
        var img = document.createElement('img');
        img.src = d.mockupUrl; img.alt = ''; img.className = 'card-img'; img.loading = 'lazy';
        var info = document.createElement('div');
        info.className = 'card-info';
        info.innerHTML = '<strong>' + esc(d.creatorName || 'Anonymous') + '</strong>' +
          esc(d.creatorEmail || '') + '<br>' +
          esc((d.shader || '').replace(/-/g, ' ')) + ' \u00b7 ' + timeAgo(d.timestamp);
        card.appendChild(img);
        card.appendChild(info);
        var actions = document.createElement('div');
        actions.className = 'card-actions';
        if (tab === 'pending' || tab === 'rejected') {
          var aBtn = document.createElement('button');
          aBtn.className = 'btn btn-primary'; aBtn.textContent = 'Approve';
          (function(id, a, c) {
            a.addEventListener('click', function() { moderate(id, 'approve', c); });
          }(d.id, aBtn, card));
          actions.appendChild(aBtn);
        }
        if (tab === 'pending' || tab === 'approved') {
          var rBtn = document.createElement('button');
          rBtn.className = 'btn btn-outline'; rBtn.textContent = 'Reject';
          (function(id, r, c) {
            r.addEventListener('click', function() { moderate(id, 'reject', c); });
          }(d.id, rBtn, card));
          actions.appendChild(rBtn);
        }
        card.appendChild(actions);
        grid.appendChild(card);
      });
      content.innerHTML = '';
      content.appendChild(grid);
    }

    async function moderate(id, action, cardEl) {
      var headers = authHeaders();
      if (!headers) return;
      try {
        var r = await fetch('/community/' + action, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ id: id })
        });
        if (r.status === 401) { refreshApp(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        cardEl.style.opacity = '0.3';
        cardEl.style.pointerEvents = 'none';
      } catch (err) { alert('Action failed: ' + err.message); }
    }

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        loadTab(tab.dataset.tab);
      });
    });

    loadTab('pending');
  <\/script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shader state sharing ─────────────────────────────────────────────────────

async function handleSaveShaderState(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }
  if (!body.state || typeof body.state !== 'object') {
    return new Response(JSON.stringify({ error: 'Missing state' }), { status: 400, headers });
  }
  const id  = Math.random().toString(36).slice(2, 8);
  const key = `shader-states/${id}.json`;
  await env.MOCKUP_STAGING.put(key, JSON.stringify(body.state), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { createdAt: new Date().toISOString() },
  });
  return new Response(JSON.stringify({ id }), { status: 200, headers });
}

async function handleGetShaderState(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const id  = new URL(request.url).pathname.replace('/get-shader-state/', '');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers });
  const obj = await env.MOCKUP_STAGING.get(`shader-states/${id}.json`);
  if (!obj) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  const text = await obj.text();
  return new Response(text, { status: 200, headers });
}

async function handleCreateShare(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }
  const { image, shader, productHandle, values } = body;
  if (!image || !productHandle) {
    return new Response(JSON.stringify({ error: 'Missing image or productHandle' }), { status: 400, headers });
  }
  const id       = crypto.randomUUID();
  const imageKey = `shares/${id}.jpg`;
  const metaKey  = `shares/${id}.json`;
  const imageData = Uint8Array.from(atob(image), c => c.charCodeAt(0));
  await env.MOCKUP_STAGING.put(imageKey, imageData, { httpMetadata: { contentType: 'image/jpeg' } });
  const imageUrl = `https://${env.R2_PUBLIC_DOMAIN}/${imageKey}`;
  await writeJson(env, metaKey, {
    id,
    shader:        shader        || '',
    productHandle: productHandle || '',
    values:        values        || {},
    imageUrl,
    timestamp:     Math.floor(Date.now() / 1000),
  });
  return new Response(
    JSON.stringify({ id, url: `https://share.brightfield.studio/${id}` }),
    { status: 201, headers }
  );
}

// ── Background removal utility ───────────────────────────────────────────────

async function handleRemoveBg(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!await requireAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!env.IMAGES) {
    return new Response(JSON.stringify({ error: 'IMAGES binding not configured' }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { url } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers });
  }

  let sourceData;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sourceData = await res.arrayBuffer();
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to fetch image: ${err.message}` }), { status: 502, headers });
  }

  try {
    const processed = await env.IMAGES
      .input(sourceData)
      .transform({ segment: 'foreground' })
      .output({ format: 'image/png' });
    const pngBuffer = await processed.response().arrayBuffer();
    const base64    = btoa(String.fromCharCode(...new Uint8Array(pngBuffer)));
    return new Response(JSON.stringify({ png: base64 }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Background removal failed: ${err.message}` }), { status: 500, headers });
  }
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
