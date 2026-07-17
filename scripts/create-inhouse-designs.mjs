// Renders the in-house design variations defined in designs/<shader>.designs.json
// and (with --create) publishes each as its own Shopify product via the worker.
//
// Usage:
//   node scripts/create-inhouse-designs.mjs --shader contour-pareidolia            # dry-run: contact sheet only
//   node scripts/create-inhouse-designs.mjs --shader contour-pareidolia --create   # create real products
//
// Options:
//   --shader <name>      required; picks designs/<name>.designs.json
//   --create             actually create products (default is dry-run)
//   --only <slug>        limit to a single design
//   --worker-url <url>   override the mockup worker (default: production)
//   --out <dir>          preview output dir (default: design-previews)
//
// --create needs ADMIN_TOKEN in the environment (falls back to worker/.dev.vars).
// Re-running --create is safe: the createProductKey is deterministic
// (inhouse-<shader>-<slug>-v<version>), so the worker returns the already-created
// product instead of a duplicate. Bump a design's "version" to publish it anew.

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
const STOREFRONT = 'https://brightfield.studio';
const PRINT_AREA = [0.30, 0.165, 0.40, 0.45]; // matches data-print-area in main-product.liquid
const EXPORT_W = 1800;
const EXPORT_H = 2400;

function parseArgs(argv) {
  const args = { create: false, workerUrl: DEFAULT_WORKER_URL, out: 'design-previews' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--create') args.create = true;
    else if (a === '--shader') args.shader = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--worker-url') args.workerUrl = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.shader) throw new Error('Missing required --shader <name>');
  return args;
}

async function loadDesigns(shader) {
  const file = path.join(REPO_ROOT, 'designs', `${shader}.designs.json`);
  const spec = JSON.parse(await readFile(file, 'utf8'));
  if (spec.shader !== shader) throw new Error(`${file}: "shader" is ${spec.shader}, expected ${shader}`);
  if (!spec.sourceProductHandle) throw new Error(`${file}: missing sourceProductHandle`);
  if (!Array.isArray(spec.designs) || spec.designs.length === 0) throw new Error(`${file}: no designs`);
  const slugs = new Set();
  for (const d of spec.designs) {
    for (const field of ['slug', 'title', 'version', 'values']) {
      if (d[field] == null) throw new Error(`${file}: design missing "${field}": ${JSON.stringify(d).slice(0, 80)}`);
    }
    if (slugs.has(d.slug)) throw new Error(`${file}: duplicate slug "${d.slug}"`);
    slugs.add(d.slug);
  }
  return spec;
}

// Minimal static server over the repo root so test-shaders.html can load assets/*.
function startStaticServer() {
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  };
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const filePath = path.join(REPO_ROOT, urlPath === '/' ? '/test-shaders.html' : urlPath);
      if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Renders one design in the harness: injects values, exports the print PNG, and
// composites the shirt mockup + checkout thumbnail with the same math as the
// product page's "Preview on Shirt" flow (sections/main-product.liquid).
async function renderDesign(page, baseUrl, shader, design) {
  await page.goto(`${baseUrl}/test-shaders.html?shader=${encodeURIComponent(shader)}`);
  await page.waitForFunction(() =>
    window._shaderExport &&
    window._shaderState &&
    document.getElementById('shader-gui-body') &&
    document.getElementById('shader-gui-body').children.length > 0
  , null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);

  const unknown = await page.evaluate((values) =>
    Object.keys(values).filter((k) => !(k in window._shaderState.values))
  , design.values);
  if (unknown.length) throw new Error(`${design.slug}: unknown control keys: ${unknown.join(', ')}`);

  return page.evaluate(async ({ values, printArea, exportW, exportH }) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));

    Object.assign(window._shaderState.values, values);
    window._shaderState.textDirty = true;
    window._shaderState.snapValues = true;
    await raf(); await raf(); await raf();

    const fullValues = JSON.parse(JSON.stringify(window._shaderState.values));

    const designB64 = await new Promise((resolve) => window._shaderExport(exportW, exportH, resolve));

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + src));
      img.src = src;
    });
    const designImg = await loadImage('data:image/png;base64,' + designB64);
    const shirtImg = await loadImage('/assets/shirt-template.png');

    // Shirt mockup — same sizing/contain math as main-product.liquid's doComposite()
    const srcW = designImg.naturalWidth, srcH = designImg.naturalHeight;
    const designAspect = srcW / srcH;
    const areaAspect = printArea[2] / printArea[3];
    const shirtNW = shirtImg.naturalWidth, shirtNH = shirtImg.naturalHeight;
    let tW, tH;
    if (designAspect > areaAspect) {
      tW = Math.round(srcW / printArea[2]);
      tH = Math.round(tW * shirtNH / shirtNW);
    } else {
      tH = Math.round(srcH / printArea[3]);
      tW = Math.round(tH * shirtNW / shirtNH);
    }
    const canvas = document.createElement('canvas');
    canvas.width = tW; canvas.height = tH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, tW, tH); // JPEG has no alpha — avoid black where the template is transparent
    ctx.drawImage(shirtImg, 0, 0, tW, tH);
    const px = Math.round(printArea[0] * tW), py = Math.round(printArea[1] * tH);
    const pw = Math.round(printArea[2] * tW), ph = Math.round(printArea[3] * tH);
    let drawW, drawH, drawX, drawY;
    if (designAspect > areaAspect) {
      drawW = pw; drawH = pw / designAspect;
      drawX = px; drawY = py + Math.round((ph - drawH) / 2);
    } else {
      drawH = ph; drawW = ph * designAspect;
      drawX = px + Math.round((pw - drawW) / 2); drawY = py;
    }
    ctx.drawImage(designImg, drawX, drawY, drawW, drawH);
    const mockupB64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];

    // Checkout thumbnail — 600×600 design on black, as on the product page
    const co = document.createElement('canvas');
    co.width = 600; co.height = 600;
    const coCtx = co.getContext('2d');
    coCtx.fillStyle = '#000';
    coCtx.fillRect(0, 0, 600, 600);
    let coW, coH, coX, coY;
    if (designAspect > 1) {
      coW = 600; coH = Math.round(600 / designAspect); coX = 0; coY = Math.round((600 - coH) / 2);
    } else {
      coH = 600; coW = Math.round(600 * designAspect); coX = Math.round((600 - coW) / 2); coY = 0;
    }
    coCtx.drawImage(designImg, coX, coY, coW, coH);
    const checkoutB64 = co.toDataURL('image/png').split(',')[1];

    return { designB64, mockupB64, checkoutB64, fullValues };
  }, { values: design.values, printArea: PRINT_AREA, exportW: EXPORT_W, exportH: EXPORT_H });
}

async function writePreviews(outDir, shader, results) {
  const dir = path.join(REPO_ROOT, outDir, shader);
  await mkdir(dir, { recursive: true });
  for (const r of results) {
    await writeFile(path.join(dir, `${r.design.slug}-design.png`), Buffer.from(r.designB64, 'base64'));
    await writeFile(path.join(dir, `${r.design.slug}-mockup.jpg`), Buffer.from(r.mockupB64, 'base64'));
    await writeFile(path.join(dir, `${r.design.slug}-checkout.png`), Buffer.from(r.checkoutB64, 'base64'));
  }

  const cards = results.map((r) => `
    <section class="card">
      <h2>${r.design.title} <code>${r.design.slug} v${r.design.version}</code></h2>
      <div class="row">
        <figure class="dark"><img src="${r.design.slug}-design.png" alt=""><figcaption>design · dark</figcaption></figure>
        <figure class="light"><img src="${r.design.slug}-design.png" alt=""><figcaption>design · light</figcaption></figure>
        <figure><img src="${r.design.slug}-mockup.jpg" alt=""><figcaption>shirt mockup</figcaption></figure>
        <figure class="dark"><img src="${r.design.slug}-checkout.png" alt=""><figcaption>checkout 600×600</figcaption></figure>
      </div>
      <details><summary>values</summary><pre>${JSON.stringify(r.design.values, null, 2)}</pre></details>
    </section>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${shader} — in-house designs</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 2rem; background: #f4f4f4; color: #111; }
  .card { background: #fff; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 2rem; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  h2 code { font-size: .7em; color: #777; font-weight: normal; }
  .row { display: flex; gap: 1rem; flex-wrap: wrap; }
  figure { margin: 0; }
  figure img { width: 240px; height: auto; display: block; border-radius: 4px; }
  figure.dark img { background: #111; }
  figure.light img { background: #fff; border: 1px solid #ddd; }
  figcaption { font-size: .75rem; color: #777; margin-top: .25rem; }
  pre { font-size: .75rem; overflow-x: auto; background: #f8f8f8; padding: .75rem; border-radius: 4px; }
</style></head><body>
<h1>${shader} — in-house design drafts</h1>
${cards}
</body></html>`;
  const indexPath = path.join(dir, 'index.html');
  await writeFile(indexPath, html);
  return indexPath;
}

async function getAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const devVars = await readFile(path.join(REPO_ROOT, 'worker', '.dev.vars'), 'utf8');
    const line = devVars.split('\n').find((l) => l.startsWith('ADMIN_TOKEN='));
    if (line) return line.slice('ADMIN_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  } catch {}
  throw new Error('ADMIN_TOKEN not set and not found in worker/.dev.vars');
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${data.error || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function createProducts(args, spec, results) {
  const adminToken = await getAdminToken();

  // Preflight A: the worker must have the inhouse-aware deploy — an older worker
  // would silently ignore inhouse/productTitle and mint a mis-titled product.
  const versionRes = await fetch(`${args.workerUrl}/inhouse/version`);
  if (!versionRes.ok) {
    throw new Error(`Worker at ${args.workerUrl} does not support in-house creation yet ` +
      `(GET /inhouse/version → ${versionRes.status}). Merge/deploy the worker change first.`);
  }

  // Preflight B: source variant to copy price + size behavior from.
  const productRes = await fetch(`${STOREFRONT}/products/${spec.sourceProductHandle}.js`);
  if (!productRes.ok) throw new Error(`Could not fetch source product ${spec.sourceProductHandle} (${productRes.status})`);
  const sourceProduct = await productRes.json();
  const variantId = sourceProduct.variants?.[0]?.id;
  if (!variantId) throw new Error(`Source product ${spec.sourceProductHandle} has no variants`);

  const created = [];
  for (const r of results) {
    const d = r.design;
    process.stdout.write(`  ${d.slug} v${d.version}: uploading images… `);
    const saved = await postJson(`${args.workerUrl}/save-preview`, {
      designImage: r.designB64,
      checkoutImage: r.checkoutB64,
      mockupImage: r.mockupB64,
      shader: spec.shader,
      productHandle: spec.sourceProductHandle,
      values: r.fullValues,
      // no deviceId: keeps these out of the Recent Designs strip
    });

    process.stdout.write('creating product… ');
    const product = await postJson(`${args.workerUrl}/create-product`, {
      designUrl: saved.design_url,
      mockupUrl: saved.mockup_url,
      checkoutImageUrl: saved.checkout_image_url,
      shader: spec.shader,
      productHandle: spec.sourceProductHandle,
      values: r.fullValues,
      variantId,
      inhouse: true,
      productTitle: d.title,
      descriptionHtml: d.descriptionHtml || '',
      designSlug: d.slug,
      createProductKey: `inhouse-${spec.shader}-${d.slug}-v${d.version}`,
    }, { Authorization: `Bearer ${adminToken}` });

    if (product.productTitle !== d.title) {
      throw new Error(`${d.slug}: worker returned title "${product.productTitle}" instead of "${d.title}" — ` +
        `is the deployed worker up to date?`);
    }
    created.push({ slug: d.slug, ...product });
    console.log(product.idempotent ? 'already existed ✓' : 'created ✓');
    if (product.linked === false) {
      console.warn(`  WARNING: ${d.slug} was created but not linked into ${spec.sourceProductHandle}'s ` +
        `inhouse_designs metafield — it won't appear in the product-page design picker. Check worker logs.`);
    }
  }

  console.log('\nProducts:');
  for (const c of created) {
    console.log(`  ${c.slug}${c.idempotent ? ' (existing)' : ''}`);
    console.log(`    admin:      https://brightfield-2.myshopify.com/admin/products/${c.productId}`);
    console.log(`    storefront: ${STOREFRONT}/products/${c.handle}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = await loadDesigns(args.shader);
  const designs = args.only ? spec.designs.filter((d) => d.slug === args.only) : spec.designs;
  if (designs.length === 0) throw new Error(`No design matches --only ${args.only}`);

  const { server, port } = await startStaticServer();
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
    for (const design of designs) {
      console.log(`Rendering ${design.slug}…`);
      const rendered = await renderDesign(page, `http://127.0.0.1:${port}`, args.shader, design);
      results.push({ design, ...rendered });
    }
  } finally {
    await browser.close();
    server.close();
  }

  const indexPath = await writePreviews(args.out, args.shader, results);
  console.log(`\nContact sheet: ${indexPath}`);

  if (args.create) {
    console.log('\nCreating products via worker…');
    await createProducts(args, spec, results);
  } else {
    console.log('Dry run — no products created. Re-run with --create to publish.');
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
