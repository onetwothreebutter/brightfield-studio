const ALLOWED_ORIGINS = new Set([
  'https://brightfield.studio',
  'https://brightfield-2.myshopify.com',
]);
const PRINTFUL_API = 'https://api.printful.com';

// Bella + Canvas 3001 — product ID 71, front print area
const PRODUCT_ID   = 71;
const PRINT_WIDTH  = 1800;
const PRINT_HEIGHT = 2400;

let _shopifyToken = null;
let _shopifyTokenExpiry = 0;
let _onlineStorePublicationId = null;
let _printfulLocationId = null;
let _printfulSizes = null;

async function getShopifyToken(env) {
  if (_shopifyToken && Date.now() < _shopifyTokenExpiry) return _shopifyToken;
  const tokenUrl = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;
  console.log('[getShopifyToken] POST', tokenUrl);
  console.log('[getShopifyToken] client_id present:', !!env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID);
  console.log('[getShopifyToken] client_secret present:', !!env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID,
      client_secret: env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  const rawText = await res.text();
  console.log('[getShopifyToken] status:', res.status);
  console.log('[getShopifyToken] response (first 500 chars):', rawText.slice(0, 500));
  let data;
  try { data = JSON.parse(rawText); }
  catch { throw new Error(`Token endpoint returned non-JSON (status ${res.status}): ${rawText.slice(0, 200)}`); }
  if (!data.access_token) throw new Error('Failed to get Shopify token: ' + JSON.stringify(data));
  _shopifyToken = data.access_token;
  _shopifyTokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  return _shopifyToken;
}

async function shopifyAdmin(env, query, variables) {
  const token = await getShopifyToken(env);
  const res = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const data = await res.json();
  if (data?.errors) console.error('[shopifyAdmin] errors:', JSON.stringify(data.errors));
  return data;
}

async function getOnlineStorePublicationId(env) {
  if (_onlineStorePublicationId) return _onlineStorePublicationId;
  const data = await shopifyAdmin(env, `query { publications(first: 20) { edges { node { id name } } } }`);
  const edges = data?.data?.publications?.edges || [];
  console.log('[publications] available:', edges.map(e => e.node.name));
  const match = edges.find(e => e.node.name === 'Online Store');
  if (match) _onlineStorePublicationId = match.node.id;
  return _onlineStorePublicationId;
}

async function getPrintfulLocationId(env) {
  if (_printfulLocationId) return _printfulLocationId;
  const data = await shopifyAdmin(env, `query { shop { fulfillmentServices { handle serviceName location { id } } } }`);
  const services = data?.data?.shop?.fulfillmentServices || [];
  console.log('[fulfillmentServices] available:', services.map(s => s.handle));
  const match = services.find(s => s.handle?.toLowerCase().includes('printful') || s.serviceName?.toLowerCase().includes('printful'));
  if (match?.location?.id) _printfulLocationId = match.location.id;
  return _printfulLocationId;
}

const CANONICAL_SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

async function getPrintfulSizes(env) {
  if (_printfulSizes) return _printfulSizes;
  try {
    const res = await fetch(`${PRINTFUL_API}/products/${PRODUCT_ID}`, {
      headers: env.PRINTFUL_API_KEY ? { 'Authorization': `Bearer ${env.PRINTFUL_API_KEY}` } : {},
    });
    if (!res.ok) {
      console.warn('[getPrintfulSizes] non-OK response:', res.status);
      return null;
    }
    const data = await res.json();
    const variants = data?.result?.variants || [];
    const seen = new Set();
    for (const v of variants) {
      if (v.size) seen.add(v.size);
    }
    // Sort by canonical garment order; unknown sizes appended at end
    const known = CANONICAL_SIZE_ORDER.filter(s => seen.has(s));
    const unknown = [...seen].filter(s => !CANONICAL_SIZE_ORDER.includes(s));
    const sizes = [...known, ...unknown];
    if (sizes.length) {
      _printfulSizes = sizes;
      console.log('[getPrintfulSizes] sizes from Printful (sorted):', sizes);
    }
    return _printfulSizes;
  } catch (err) {
    console.warn('[getPrintfulSizes] error (non-fatal):', err.message);
    return null;
  }
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { const u = new URL(origin); return u.hostname === '127.0.0.1' || u.hostname === 'localhost'; }
  catch { return false; }
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
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
    if (method === 'GET'  && pathname.startsWith('/community/design/')) return handleCommunityDesign(request, env, origin, pathname.slice('/community/design/'.length));

    if (method === 'POST' && pathname === '/save-shader-state')           return handleSaveShaderState(request, env, origin);
    if (method === 'GET'  && pathname.startsWith('/get-shader-state/'))   return handleGetShaderState(request, env, origin);
    if (method === 'POST' && pathname === '/create-share')                return handleCreateShare(request, env, origin);

    // Custom domain: share.brightfield.studio/{id}
    if (method === 'GET' && url.hostname === 'share.brightfield.studio') return handleShare(request, env, pathname.slice(1));

    if (method === 'GET'  && pathname.startsWith('/share/')) return handleShare(request, env, pathname.slice(7));

    if (method === 'GET'  && pathname === '/admin-ui') return handleAdminUI(request, env);

    if (method === 'GET'  && pathname === '/admin/list-designs') return handleAdminListDesigns(request, env);
    if (method === 'POST' && pathname === '/admin/patch-design-url') return handleAdminPatchDesignUrl(request, env);

    if (method === 'GET'  && pathname === '/download-mockup') return handleDownloadMockup(request, env, origin);

    if (method === 'POST' && pathname === '/remove-bg') return handleRemoveBg(request, env, origin);

    if (method === 'POST' && pathname === '/save-preview')    return handleSavePreview(request, env, origin);
    if (method === 'POST' && pathname === '/create-product')  return handleCreateProduct(request, env, origin);

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

async function handleSavePreview(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { designImage, checkoutImage, mockupImage, deviceId, shader, productHandle, values } = body;
  if (!designImage || !mockupImage) {
    return new Response(JSON.stringify({ error: 'Missing designImage or mockupImage' }), { status: 400, headers });
  }

  const designKey   = `designs/${crypto.randomUUID()}.png`;
  const mockupKey   = `mockups/${crypto.randomUUID()}.jpg`;
  const checkoutKey = checkoutImage ? `checkouts/${crypto.randomUUID()}.png` : null;

  const designData   = Uint8Array.from(atob(designImage), c => c.charCodeAt(0));
  const mockupData   = Uint8Array.from(atob(mockupImage), c => c.charCodeAt(0));
  const checkoutData = checkoutImage ? Uint8Array.from(atob(checkoutImage), c => c.charCodeAt(0)) : null;

  const uploads = [
    env.MOCKUP_STAGING.put(designKey, designData, { httpMetadata: { contentType: 'image/png' } }),
    env.MOCKUP_STAGING.put(mockupKey, mockupData, { httpMetadata: { contentType: 'image/jpeg' } }),
  ];
  if (checkoutKey) uploads.push(env.MOCKUP_STAGING.put(checkoutKey, checkoutData, { httpMetadata: { contentType: 'image/png' } }));
  await Promise.all(uploads);

  const designUrl       = `https://${env.R2_PUBLIC_DOMAIN}/${designKey}`;
  const mockupUrl       = `https://${env.R2_PUBLIC_DOMAIN}/${mockupKey}`;
  const checkoutImageUrl = checkoutKey ? `https://${env.R2_PUBLIC_DOMAIN}/${checkoutKey}` : null;

  let savedId = null;
  if (deviceId) {
    savedId = crypto.randomUUID();
    const entry = {
      id: savedId,
      shader: shader || '',
      productHandle: productHandle || '',
      designUrl,
      mockupUrl,
      values: values || {},
      timestamp: Math.floor(Date.now() / 1000),
    };
    await saveDesignEntry(env, deviceId, entry).catch(() => {});
  }

  return new Response(JSON.stringify({ design_url: designUrl, mockup_url: mockupUrl, checkout_image_url: checkoutImageUrl, id: savedId }), { status: 200, headers });
}

// Shared helper: creates a Shopify product, sets variant price, and publishes to Online Store.
// Returns { newProductId, newVariantId } (numeric strings).
async function createShopifyProduct(env, { designUrl, mockupUrl, checkoutImageUrl, shader, productTitle, price, tags, creatorName, values, submissionId, sourceProductHandle }) {
  const logPrefix = '[createShopifyProduct]';

  // Resize the mockup to ≤2000px wide so it stays under Shopify's 25 MP limit
  let shopifyImageUrl = null;
  const mediaSource = checkoutImageUrl || designUrl || mockupUrl;
  console.log(logPrefix, 'media source URL:', mediaSource);

  // Try IMAGES binding first; fall back to cf.image fetch; skip if both fail
  let resizedBuf = null;
  if (env.IMAGES) {
    try {
      const imgRes = await fetch(mediaSource);
      console.log(logPrefix, 'media fetch status (IMAGES path):', imgRes.status);
      if (imgRes.ok) {
        const imgBuf = await imgRes.arrayBuffer();
        const resized = await env.IMAGES
          .input(imgBuf)
          .transform({ width: 2000, fit: 'scale-down' })
          .output({ format: 'image/jpeg', quality: 85 });
        resizedBuf = await resized.response().arrayBuffer();
        console.log(logPrefix, 'IMAGES resize succeeded');
      }
    } catch (err) {
      console.warn(logPrefix, 'IMAGES resize failed, trying cf.image fallback:', err.message, err.toString());
    }
  }

  if (!resizedBuf) {
    try {
      const cfRes = await fetch(mediaSource, {
        cf: { image: { width: 2000, fit: 'scale-down', format: 'jpeg', quality: 85 } },
      });
      console.log(logPrefix, 'cf.image fetch status:', cfRes.status);
      if (cfRes.ok) {
        resizedBuf = await cfRes.arrayBuffer();
        console.log(logPrefix, 'cf.image resize succeeded');
      }
    } catch (err) {
      console.warn(logPrefix, 'cf.image resize failed, skipping media:', err.message);
    }
  }

  if (resizedBuf) {
    const imgKey = `product-images/${crypto.randomUUID()}.jpg`;
    await env.MOCKUP_STAGING.put(imgKey, resizedBuf, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    shopifyImageUrl = `https://${env.R2_PUBLIC_DOMAIN}/${imgKey}`;
    console.log(logPrefix, 'media uploaded to R2:', shopifyImageUrl);
  } else {
    // Both resize methods failed — use the original R2 URL directly since it's already public
    shopifyImageUrl = mediaSource;
    console.warn(logPrefix, 'all resize methods failed — using original URL as product image:', shopifyImageUrl);
  }

  // Step 1: create the product (variants not accepted in ProductInput in 2025-01+)
  const createData = await shopifyAdmin(env,
    `mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
      productCreate(input: $input, media: $media) {
        product {
          id
          handle
          variants(first: 1) { edges { node { id inventoryItem { id } } } }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title:  productTitle,
        status: 'ACTIVE',
        vendor: 'Brightfield Studio',
        tags,
        descriptionHtml: '',
        metafields: [
          { namespace: 'custom', key: 'design_url',             type: 'url',                    value: designUrl },
          { namespace: 'custom', key: 'mockup_url',             type: 'url',                    value: mockupUrl },
          { namespace: 'custom', key: 'shader',                 type: 'single_line_text_field', value: shader || '' },
          { namespace: 'custom', key: 'creator_name',           type: 'single_line_text_field', value: creatorName || '' },
          { namespace: 'custom', key: 'shader_values',          type: 'json',                   value: JSON.stringify(values || {}) },
          { namespace: 'custom', key: 'submission_id',          type: 'single_line_text_field', value: submissionId || '' },
          { namespace: 'custom', key: 'source_product_handle',  type: 'single_line_text_field', value: sourceProductHandle || '' },
        ],
      },
      media: shopifyImageUrl
        ? [{ originalSource: shopifyImageUrl, mediaContentType: 'IMAGE' }]
        : [],
    }
  );

  const userErrors = createData?.data?.productCreate?.userErrors;
  if (userErrors?.length) {
    console.error(logPrefix, 'userErrors:', JSON.stringify(userErrors));
    throw new Error(userErrors[0].message);
  }

  const newProductGid    = createData?.data?.productCreate?.product?.id;
  const newProductHandle = createData?.data?.productCreate?.product?.handle;
  const newVariantNode   = createData?.data?.productCreate?.product?.variants?.edges?.[0]?.node;
  const newVariantGid = newVariantNode?.id;
  const inventoryItemGid = newVariantNode?.inventoryItem?.id;
  if (!newVariantGid) {
    console.error(logPrefix, 'no variant returned:', JSON.stringify(createData));
    throw new Error('Product created but no variant returned');
  }

  // Step 2: add Size option, which auto-creates one variant per size and removes the default Title variant
  const printfulSizes = await getPrintfulSizes(env);
  const SIZES = printfulSizes || CANONICAL_SIZE_ORDER;
  console.log(logPrefix, 'using sizes:', SIZES);
  let sizeVariants = [];
  try {
    const optData = await shopifyAdmin(env,
      `mutation CreateOptions($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
          product {
            variants(first: 20) { edges { node { id inventoryItem { id } selectedOptions { name value } } } }
          }
          userErrors { field message }
        }
      }`,
      {
        productId: newProductGid,
        options: [{ name: 'Size', values: SIZES.map(s => ({ name: s })) }],
        variantStrategy: 'CREATE',
      }
    );
    const optErrors = optData?.data?.productOptionsCreate?.userErrors;
    if (optErrors?.length) {
      console.warn(logPrefix, 'productOptionsCreate errors (non-fatal):', JSON.stringify(optErrors));
    }
    sizeVariants = (optData?.data?.productOptionsCreate?.product?.variants?.edges || [])
      .map(e => e.node)
      .filter(v => v.selectedOptions?.some(o => o.name === 'Size'));
    console.log(logPrefix, 'size variants created:', sizeVariants.length);
  } catch (err) {
    console.warn(logPrefix, 'productOptionsCreate failed (non-fatal):', err.message);
  }

  // Fall back to the original default variant if option creation failed
  if (!sizeVariants.length) {
    sizeVariants = [{ id: newVariantGid, inventoryItem: inventoryItemGid ? { id: inventoryItemGid } : null, selectedOptions: [] }];
  }

  const firstSizeVariantGid = sizeVariants[0].id;

  // Step 2a: set price on all size variants
  const updateData = await shopifyAdmin(env,
    `mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }`,
    {
      productId: newProductGid,
      variants: sizeVariants.map(v => ({ id: v.id, price, inventoryPolicy: 'CONTINUE' })),
    }
  );

  const updateErrors = updateData?.data?.productVariantsBulkUpdate?.userErrors;
  if (updateErrors?.length) {
    console.error(logPrefix, 'variant update errors:', JSON.stringify(updateErrors));
    // Non-fatal: product exists, just price may be wrong
  }

  // Step 2b: set SKU on each inventory item (required by Printful before inventoryActivate)
  const skuPrefix = tags?.includes('community-design') ? 'COMMUNITY' : 'CUSTOM';
  const baseTimestamp = Date.now();
  for (const sv of sizeVariants) {
    const invGid = sv.inventoryItem?.id;
    if (!invGid) continue;
    const sizeLabel = sv.selectedOptions?.find(o => o.name === 'Size')?.value || 'ONE';
    const skuData = await shopifyAdmin(env,
      `mutation UpdateInventoryItem($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id sku }
          userErrors { field message }
        }
      }`,
      { id: invGid, input: { sku: `${skuPrefix}-${baseTimestamp}-${sizeLabel}` } }
    );
    const skuErrors = skuData?.data?.inventoryItemUpdate?.userErrors;
    if (skuErrors?.length) console.error(logPrefix, 'SKU update errors for', sizeLabel, ':', JSON.stringify(skuErrors));
    else console.log(logPrefix, 'SKU set:', skuData?.data?.inventoryItemUpdate?.inventoryItem?.sku);
  }

  // Step 2c: activate inventory at the Printful fulfillment service location for each size variant
  const printfulLocationId = await getPrintfulLocationId(env);
  console.log(logPrefix, 'Printful location ID:', printfulLocationId);
  if (printfulLocationId) {
    for (const sv of sizeVariants) {
      const invGid = sv.inventoryItem?.id;
      if (!invGid) continue;
      const activateData = await shopifyAdmin(env,
        `mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
          inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
            inventoryLevel { id }
            userErrors { field message }
          }
        }`,
        { inventoryItemId: invGid, locationId: printfulLocationId }
      );
      const activateErrors = activateData?.data?.inventoryActivate?.userErrors;
      if (activateErrors?.length) {
        console.error(logPrefix, 'inventoryActivate errors:', JSON.stringify(activateErrors));
      } else {
        console.log(logPrefix, 'inventory activated at Printful location for variant', sv.id);
      }
    }
  } else {
    console.warn(logPrefix, 'skipping inventoryActivate — missing locationId');
  }

  // Step 2d: re-apply inventoryPolicy:CONTINUE after inventoryActivate, which resets it to DENY
  const policyData = await shopifyAdmin(env,
    `mutation ResetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`,
    {
      productId: newProductGid,
      variants: sizeVariants.map(v => ({ id: v.id, inventoryPolicy: 'CONTINUE' })),
    }
  );
  const policyErrors = policyData?.data?.productVariantsBulkUpdate?.userErrors;
  if (policyErrors?.length) {
    console.error(logPrefix, 'inventoryPolicy re-apply errors:', JSON.stringify(policyErrors));
  } else {
    const policies = policyData?.data?.productVariantsBulkUpdate?.productVariants?.map(v => v.inventoryPolicy);
    console.log(logPrefix, 'inventoryPolicy re-applied:', policies);
  }

  // Step 2e: set tracked:false on each inventory item so the storefront never shows
  // "sold out". Printful-managed locations reject manual quantity edits, so setting
  // quantities is unreliable; untracked items are always purchasable regardless of policy.
  // Printful fulfillment relies on order webhooks, not Shopify inventory levels.
  for (const sv of sizeVariants) {
    const invGid = sv.inventoryItem?.id;
    if (!invGid) continue;
    const trackData = await shopifyAdmin(env,
      `mutation UntrackInventoryItem($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }`,
      { id: invGid, input: { tracked: false } }
    );
    const trackErrors = trackData?.data?.inventoryItemUpdate?.userErrors;
    if (trackErrors?.length) {
      console.error(logPrefix, 'inventoryItemUpdate tracked:false errors:', JSON.stringify(trackErrors));
    } else {
      console.log(logPrefix, 'inventory untracked for item', invGid);
    }
  }

  const newVariantId = firstSizeVariantGid.replace('gid://shopify/ProductVariant/', '');
  const newProductId = newProductGid.replace('gid://shopify/Product/', '');

  console.log(logPrefix, 'new product:', newProductId, 'new variant:', newVariantId);

  // Step 3: publish to Online Store. Try GraphQL first, fall back to REST.
  let published = false;
  try {
    const publicationId = await getOnlineStorePublicationId(env);
    console.log(logPrefix, 'Online Store publicationId:', publicationId);
    if (publicationId) {
      const pubData = await shopifyAdmin(env,
        `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            publishable { ... on Product { id status } }
            userErrors { field message }
          }
        }`,
        { id: newProductGid, input: [{ publicationId }] }
      );
      const pubErrors = pubData?.data?.publishablePublish?.userErrors;
      const result    = pubData?.data?.publishablePublish?.publishable;
      console.log(logPrefix, 'publishablePublish result:', JSON.stringify({ result, pubErrors }));
      if (!pubErrors?.length) published = true;
    }
  } catch (err) {
    console.warn(logPrefix, 'publishablePublish error:', err.message);
  }

  if (!published) {
    try {
      console.log(logPrefix, 'falling back to REST publish for product', newProductId);
      const pubRes = await fetch(
        `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products/${newProductId}.json`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': await getShopifyToken(env),
          },
          body: JSON.stringify({ product: { id: Number(newProductId), published: true } }),
        }
      );
      const pubText = await pubRes.text();
      if (!pubRes.ok) {
        console.warn(logPrefix, 'REST publish failed:', pubRes.status, pubText.slice(0, 300));
      } else {
        let pubData;
        try { pubData = JSON.parse(pubText); } catch { pubData = null; }
        console.log(logPrefix, 'REST publish ok — published_at:', pubData?.product?.published_at);
      }
    } catch (err) {
      console.warn(logPrefix, 'REST publish error:', err.message);
    }
  }

  // Step 4: assign to the Printful shipping profile ("US Flat Rate") so checkout
  // uses the correct shipping rate instead of the default "Standard" profile.
  try {
    const profileGid = 'gid://shopify/DeliveryProfile/94986600563';
    const spData = await shopifyAdmin(env,
      `mutation AssignShippingProfile($profileId: ID!, $variantsToAssociate: [ID!]!) {
        deliveryProfileUpdate(id: $profileId, profile: { variantsToAssociate: $variantsToAssociate }) {
          profile { id name }
          userErrors { field message }
        }
      }`,
      {
        profileId: profileGid,
        variantsToAssociate: sizeVariants.map(v => v.id),
      }
    );
    const spErrors = spData?.data?.deliveryProfileUpdate?.userErrors;
    if (spErrors?.length) {
      console.warn(logPrefix, 'shipping profile assign errors:', JSON.stringify(spErrors));
    } else {
      console.log(logPrefix, 'assigned to shipping profile:', spData?.data?.deliveryProfileUpdate?.profile?.name);
    }
  } catch (err) {
    console.warn(logPrefix, 'shipping profile assign error:', err.message);
  }

  return { newProductId, newVariantId, newProductHandle };
}

// Looks up the first variant of a product by handle. Returns { variantId, price, productTitle }.
async function getDefaultVariantForHandle(env, handle) {
  const data = await shopifyAdmin(env,
    `query GetProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        title
        variants(first: 1) { edges { node { id price } } }
      }
    }`,
    { handle }
  );
  const product = data?.data?.productByHandle;
  if (!product) return null;
  const variantNode = product.variants?.edges?.[0]?.node;
  if (!variantNode) return null;
  return {
    variantId:    variantNode.id.replace('gid://shopify/ProductVariant/', ''),
    price:        variantNode.price || '0.00',
    productTitle: product.title || 'Design',
  };
}

async function handleCreateProduct(request, env, origin) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { designUrl, mockupUrl, checkoutImageUrl, shader, productHandle, values, variantId, extraTags } = body;
  if (!designUrl || !mockupUrl || !variantId) {
    return new Response(JSON.stringify({ error: 'Missing designUrl, mockupUrl, or variantId' }), { status: 400, headers });
  }

  console.log('[create-product] variantId:', variantId, 'shader:', shader);
  const gid = `gid://shopify/ProductVariant/${variantId}`;

  // Fetch original variant price + parent product title
  const variantData = await shopifyAdmin(env,
    `query GetVariant($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          title
          price
          product { title }
        }
      }
    }`,
    { id: gid }
  );

  const variant = variantData?.data?.node;
  if (!variant) {
    console.error('[create-product] variant lookup failed:', JSON.stringify(variantData));
    return new Response(JSON.stringify({ error: 'Could not look up variant' }), { status: 502, headers });
  }

  console.log('[create-product] source variant:', { title: variant.title, price: variant.price, product: variant.product?.title });
  const price = variant.price || '0.00';

  let result;
  try {
    result = await createShopifyProduct(env, {
      designUrl,
      mockupUrl,
      checkoutImageUrl,
      shader,
      productTitle: `Custom ${variant.product?.title || 'Design'}`,
      price,
      tags: ['custom-design', `shader-${shader || 'unknown'}`, ...(Array.isArray(extraTags) ? extraTags : [])],
      values,
      sourceProductHandle: productHandle,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 422, headers });
  }

  console.log('[create-product] returning variantId:', result.newVariantId);
  return new Response(JSON.stringify({ variantId: result.newVariantId, productId: result.newProductId }), { status: 200, headers });
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

  const { shader, productHandle, designUrl, mockupUrl, checkoutImageUrl, values, creatorName, creatorEmail } = body;
  if (!mockupUrl || !creatorName || !shader) {
    return new Response(JSON.stringify({ error: 'Missing required fields: mockupUrl, creatorName, shader' }), { status: 400, headers });
  }

  const id = crypto.randomUUID();
  const submission = {
    id,
    shader,
    productHandle:    productHandle || '',
    designUrl:        designUrl || '',
    mockupUrl,
    checkoutImageUrl: checkoutImageUrl || '',
    values:           values || {},
    timestamp:        Math.floor(Date.now() / 1000),
    status:           'pending',
    creatorName,
    creatorEmail:     creatorEmail || '',
    likes:            0,
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
  const shaderFilter        = url.searchParams.get('shader');
  const productHandleFilter = url.searchParams.get('productHandle');

  const list = (await readJson(env, 'community/list.json')) || [];
  const ids = list.slice(0, 100);

  const submissions = (
    await Promise.all(ids.map(id => readJson(env, `community/submissions/${id}.json`)))
  ).filter(s => s && s.status === 'approved' && s.shopifyProductHandle);

  const filtered = submissions.filter(s => {
    if (shaderFilter        && s.shader        !== shaderFilter)        return false;
    if (productHandleFilter && s.productHandle !== productHandleFilter) return false;
    return true;
  });

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

  if (newStatus === 'approved' && submission.productHandle) {
    try {
      const sourceVariant = await getDefaultVariantForHandle(env, submission.productHandle);
      if (sourceVariant) {
        const result = await createShopifyProduct(env, {
          designUrl:           submission.designUrl,
          mockupUrl:           submission.mockupUrl,
          checkoutImageUrl:    submission.checkoutImageUrl || '',
          shader:              submission.shader,
          productTitle:        `Community ${sourceVariant.productTitle.replace(/^Community\s+/, '')}`,
          price:               sourceVariant.price,
          tags:                ['community-design', `shader-${submission.shader || 'unknown'}`],
          creatorName:         submission.creatorName,
          values:              submission.values,
          submissionId:        id,
          sourceProductHandle: submission.productHandle,
        });
        submission.shopifyProductId     = result.newProductId;
        submission.shopifyVariantId     = result.newVariantId;
        submission.shopifyProductHandle = result.newProductHandle;
        console.log('[community/approve] created product', result.newProductId, 'handle', result.newProductHandle, 'for submission', id);
      } else {
        console.warn('[community/approve] could not resolve product handle:', submission.productHandle);
      }
    } catch (err) {
      console.error('[community/approve] product creation failed (non-fatal):', err.message);
    }
  }

  await writeJson(env, `community/submissions/${id}.json`, submission);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Community design by ID ───────────────────────────────────────────────────

async function handleCommunityDesign(request, env, origin, id) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (!id) return new Response('Not found', { status: 404, headers });
  const sub = await readJson(env, `community/submissions/${id}.json`);
  if (!sub || sub.status !== 'approved') return new Response('Not found', { status: 404, headers });
  const { creatorEmail: _omit, ...sanitized } = sub;
  return new Response(JSON.stringify(sanitized), { status: 200, headers });
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
  const productUrl = design.shopifyProductHandle
    ? 'https://brightfield.studio/products/' + encodeURIComponent(design.shopifyProductHandle)
    : 'https://brightfield.studio/pages/community-design?id=' + encodeURIComponent(id);

  return new Response(buildShareHtml(title, desc, shareUrl, mockupUrl, productUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shopify Admin App UI ──────────────────────────────────────────────────────

async function handleAdminPatchDesignUrl(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { id, designUrl } = body;
  if (!id || !designUrl) return new Response(JSON.stringify({ error: 'Missing id or designUrl' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const submission = await readJson(env, `community/submissions/${id}.json`);
  if (!submission) return new Response(JSON.stringify({ error: 'Submission not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  submission.designUrl = designUrl;
  await writeJson(env, `community/submissions/${id}.json`, submission);

  return new Response(JSON.stringify({ ok: true, id, designUrl }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleAdminListDesigns(request, env) {
  const isAdmin = await requireAdmin(request, env);
  if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const results = [];
  let cursor;
  do {
    const page = await env.MOCKUP_STAGING.list({ prefix: 'designs/', cursor, limit: 1000 });
    for (const obj of page.objects) {
      results.push({ key: obj.key, uploaded: obj.uploaded, size: obj.size });
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

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
    const bytes     = new Uint8Array(pngBuffer);
    let binary      = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64    = btoa(binary);
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
  await env.MOCKUP_STAGING.put(key, JSON.stringify(designs), {
    httpMetadata: { contentType: 'application/json' },
  });
}
