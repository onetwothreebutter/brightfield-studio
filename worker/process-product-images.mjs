#!/usr/bin/env node
/**
 * Batch background removal for product images.
 *
 * Usage:
 *   ADMIN_TOKEN=xxx node process-product-images.mjs [--worker <url>] <image-url> [<image-url> ...]
 *
 * Options:
 *   --worker <url>   Worker base URL (default: https://brightfield-mockup-worker.eric-d-johnson.workers.dev)
 *   --out    <dir>   Output directory (default: ./bg-removed)
 *
 * Example:
 *   ADMIN_TOKEN=xxx node process-product-images.mjs \
 *     https://files.cdn.printful.com/products/71/product_1.jpg \
 *     https://files.cdn.printful.com/products/71/product_2.jpg
 *
 * Each processed image is saved as <output-dir>/<original-filename>.png
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const WORKER_DEFAULT = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';

function parseArgs(argv) {
  const args   = argv.slice(2);
  let workerUrl = WORKER_DEFAULT;
  let outDir    = './bg-removed';
  const urls    = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--worker' && args[i + 1]) { workerUrl = args[++i]; }
    else if (args[i] === '--out' && args[i + 1]) { outDir = args[++i]; }
    else if (args[i].startsWith('http')) { urls.push(args[i]); }
    else { console.warn(`Unknown argument: ${args[i]}`); }
  }

  return { workerUrl, outDir, urls };
}

async function removeBg(workerUrl, imageUrl, adminToken) {
  const res = await fetch(`${workerUrl}/remove-bg`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ url: imageUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Worker returned ${res.status}: ${text}`);
  }

  const { png, error } = await res.json();
  if (error) throw new Error(error);
  return Buffer.from(png, 'base64');
}

async function main() {
  const { workerUrl, outDir, urls } = parseArgs(process.argv);
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    console.error('Error: ADMIN_TOKEN environment variable is required.');
    process.exit(1);
  }

  if (urls.length === 0) {
    console.error('Error: provide at least one image URL as an argument.');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  for (const url of urls) {
    const rawName = basename(new URL(url).pathname).replace(/\.[^.]+$/, '');
    const outFile = join(outDir, `${rawName}.png`);
    process.stdout.write(`Processing ${url} ... `);
    try {
      const pngBuffer = await removeBg(workerUrl, url, adminToken);
      writeFileSync(outFile, pngBuffer);
      console.log(`saved → ${outFile}`);
      passed++;
    } catch (err) {
      console.error(`FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${passed} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
