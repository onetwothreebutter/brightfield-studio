// Deletes every Shopify product tagged `e2e-test`.
//
// The Playwright e2e suite (e2e/design-to-cart.spec.js) tags every product it
// creates via the worker's /create-product endpoint with `e2e-test` so they
// can be identified after the fact. Nothing was ever deleting them, so they
// accumulated as real, published products in the live catalog. This script
// is meant to run as a cleanup step after the e2e job, with `if: always()`
// so it runs even when the tests fail.
//
// Idempotent: matching zero products is not an error, and it's safe to run
// repeatedly (e.g. re-run locally after a bad e2e run).
//
// Needs the custom-design app's credentials (Admin API product read/write
// scope) — NOT the theme-push app's SHOPIFY_CLIENT_ID/SECRET used elsewhere
// in this workflow, which is theme-scoped only and can't query/delete
// products. Same pair the worker already uses in production (see
// SHOPIFY_CUSTOM_DESIGN_CLIENT_ID/SECRET in worker/wrangler.toml).
//
// Usage:
//   SHOPIFY_CUSTOM_DESIGN_CLIENT_ID=... SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET=... node scripts/cleanup-e2e-products.mjs [--dry-run]
//
// Optional: SHOPIFY_STORE_DOMAIN (defaults to brightfield-2.myshopify.com)

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'brightfield-2.myshopify.com';
const CLIENT_ID = process.env.SHOPIFY_CUSTOM_DESIGN_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SHOPIFY_CUSTOM_DESIGN_CLIENT_ID / SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get token: ' + JSON.stringify(data));
  return data.access_token;
}

const token = await getToken();

async function admin(query, variables) {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data?.errors) throw new Error('GraphQL errors: ' + JSON.stringify(data.errors));
  return data.data;
}

// A single page of 250 is almost certainly enough for one e2e run's worth of
// orphaned products; pagination is included for safety if a backlog builds up.
const targets = [];
let cursor = null;
for (;;) {
  const data = await admin(
    `query E2eProducts($cursor: String) {
      products(first: 250, after: $cursor, query: "tag:e2e-test") {
        pageInfo { hasNextPage endCursor }
        edges {
          node { id title handle }
        }
      }
    }`,
    { cursor }
  );
  const { edges, pageInfo } = data.products;
  for (const { node } of edges) targets.push(node);
  if (!pageInfo.hasNextPage) break;
  cursor = pageInfo.endCursor;
}

console.log(`${targets.length} e2e-test product(s) found${DRY_RUN ? ' (dry run — no deletes)' : ''}`);
for (const t of targets) console.log(`  ${t.id}  ${t.handle}  (${t.title})`);

if (DRY_RUN || targets.length === 0) {
  console.log('Done.');
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const t of targets) {
  const data = await admin(
    `mutation DeleteE2eProduct($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }`,
    { input: { id: t.id } }
  );
  const errs = data.productDelete.userErrors;
  if (errs?.length) {
    console.error(`  Failed to delete ${t.handle} (${t.id}): ${JSON.stringify(errs)}`);
    failed += 1;
    continue;
  }
  done += 1;
  console.log(`Deleted ${done}/${targets.length}: ${t.handle} (${t.id})`);
}

console.log('Done.');
// Partial failures only logged above otherwise — a non-zero exit here is what
// actually surfaces them as a failed CI step instead of a silent green run.
if (failed > 0) {
  console.error(`${failed} product(s) failed to delete — see errors above.`);
  process.exit(1);
}
