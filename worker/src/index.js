const ALLOWED_ORIGIN = 'https://brightfield-2.myshopify.com';
const PRINTFUL_API   = 'https://api.printful.com';

// Bella + Canvas 3001 — product ID 71, front print area
const PRODUCT_ID   = 71;
const PRINT_WIDTH  = 1800;
const PRINT_HEIGHT = 2400;

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://127.0.0.1:9292';
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/generate-mockup') {
      return handleGenerateMockup(request, env, origin);
    }

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

  const { image, variant_id } = body;
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

    return new Response(JSON.stringify({ mockup_url: mockupUrl }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, imageUrl }), { status: 500, headers });
  } finally {
    // 4. Clean up R2 — fire and forget
    env.MOCKUP_STAGING.delete(imageKey).catch(() => {});
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
