// Test script: send a proper-sized PNG to the Worker and verify the full pipeline
// Usage: node test-upload.mjs
//
// Generates a 1800×2400 px magenta PNG (matches Printful printfile for product 71 front)
// using raw PNG encoding — no external dependencies required.

import zlib from 'node:zlib';

const WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
const VARIANT_ID = 4012; // Bella + Canvas 3001, White / M

// Generate a solid magenta 1800×2400 PNG in pure Node.js
function makeSolidPng(width, height, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  // compression, filter, interlace = 0
  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    let crc = 0xffffffff;
    for (const byte of [...typeBuf, ...data]) {
      crc ^= byte;
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crcBuf.writeInt32BE(~crc);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // Raw pixel data: each row starts with a filter byte (0 = None), then RGB per pixel
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    raw[base] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3]     = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  const idat = makeChunk('IDAT', zlib.deflateSync(raw));
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, makeChunk('IHDR', ihdr), idat, iend]);
}

console.log('Generating 1800×2400 test PNG (magenta)...');
const pngBuf = makeSolidPng(1800, 2400, 255, 0, 255);
const TEST_PNG_BASE64 = pngBuf.toString('base64');
console.log(`PNG size: ${(pngBuf.length / 1024).toFixed(1)} KB`);

console.log('Posting to', WORKER_URL + '/generate-mockup');
console.log('Variant ID:', VARIANT_ID);
console.log('Waiting for Printful mockup generation (this may take ~15s)...\n');

const res = await fetch(WORKER_URL + '/generate-mockup', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ image: TEST_PNG_BASE64, variant_id: VARIANT_ID }),
});

const data = await res.json();

if (data.mockup_url) {
  console.log('✅ Success!');
  console.log('Mockup URL:', data.mockup_url);
} else {
  console.log('❌ Failed:', JSON.stringify(data, null, 2));
}
