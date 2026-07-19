// One-off backfill: set the `seo.hidden` metafield on every generated
// per-customer product (tagged custom-design or community-design) so they
// disappear from storefront search, the sitemap, and search engines.
// New products get the metafield at creation time (worker/src/index.js),
// so this only needs to run once against the existing catalog.
//
// Usage:
//   SHOPIFY_CUSTOM_DESIGN_CLIENT_ID=... SHOPIFY_CUSTOM_DESIGN_CLIENT_SECRET=... \
//     node scripts/backfill-hide-custom-products.mjs [--dry-run]
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

// Collect all generated products that don't already have seo.hidden set
const targets = [];
let cursor = null;
for (;;) {
  const data = await admin(
    `query GeneratedProducts($cursor: String) {
      products(first: 100, after: $cursor, query: "tag:custom-design OR tag:community-design") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            hidden: metafield(namespace: "seo", key: "hidden") { value }
          }
        }
      }
    }`,
    { cursor }
  );
  const { edges, pageInfo } = data.products;
  for (const { node } of edges) {
    if (node.hidden?.value === '1') continue;
    targets.push(node);
  }
  if (!pageInfo.hasNextPage) break;
  cursor = pageInfo.endCursor;
}

console.log(`${targets.length} product(s) to hide${DRY_RUN ? ' (dry run — no writes)' : ''}`);
for (const t of targets) console.log(`  ${t.handle}  (${t.title})`);
if (DRY_RUN || targets.length === 0) process.exit(0);

// metafieldsSet accepts at most 25 metafields per call
let done = 0;
for (let i = 0; i < targets.length; i += 25) {
  const batch = targets.slice(i, i + 25);
  const data = await admin(
    `mutation HideProducts($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      metafields: batch.map((t) => ({
        ownerId: t.id,
        namespace: 'seo',
        key: 'hidden',
        type: 'number_integer',
        value: '1',
      })),
    }
  );
  const errs = data.metafieldsSet.userErrors;
  if (errs?.length) throw new Error('userErrors: ' + JSON.stringify(errs));
  done += batch.length;
  console.log(`Hidden ${done}/${targets.length}`);
}

console.log('Done.');
