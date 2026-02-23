// Usage: PRINTFUL_API_KEY=xxx node fetch-printfiles.mjs
// Fetches the printfile + placement specs for product 71 (Bella+Canvas 3001), variant 4012 (White/M)

const apiKey = process.env.PRINTFUL_API_KEY;
if (!apiKey) {
  console.error('Set PRINTFUL_API_KEY env var first');
  process.exit(1);
}

const PRODUCT_ID = 71;
const VARIANT_ID = 4012;

const res = await fetch(
  `https://api.printful.com/mockup-generator/printfiles/${PRODUCT_ID}?variant_ids[]=${VARIANT_ID}`,
  { headers: { Authorization: `Bearer ${apiKey}` } }
);

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
