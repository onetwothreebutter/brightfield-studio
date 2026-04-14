// Usage: PRINTFUL_API_KEY=xxx node fetch-printfiles.mjs
// Lists all variants for product 71 (Bella+Canvas 3001) and their variant IDs.
// Current default: 4017 (Black/M)

const apiKey = process.env.PRINTFUL_API_KEY;
if (!apiKey) {
  console.error('Set PRINTFUL_API_KEY env var first');
  process.exit(1);
}

const PRODUCT_ID = 71;

const res = await fetch(
  `https://api.printful.com/catalog/products/${PRODUCT_ID}`,
  { headers: { Authorization: `Bearer ${apiKey}` } }
);

const data = await res.json();
const variants = data.result?.variants || [];

console.log(`\nAll variants for product ${PRODUCT_ID} (${data.result?.product?.title || 'unknown'}):\n`);
console.log('ID\t\tColor\t\t\tSize');
console.log('─'.repeat(60));
for (const v of variants) {
  console.log(`${v.id}\t\t${v.color?.padEnd(24) ?? '?'}\t${v.size}`);
}
