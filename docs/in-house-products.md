# In-house products

An "in-house" product is a merchant-designed listing with a fixed shader
look — as opposed to a **custom** or **community** product, which is
generated dynamically from a customer's own design via
`worker POST /create-product`. In-house products are ordinary Shopify
products the merchant creates and configures by hand.

## End-to-end setup

1. **Design the look.** Open a shader-enabled product page with
   `?new-inhouse-design` appended to the URL. This unlocks the hidden
   "Design Assistant" tool (`sections/main-product.liquid`, gated by a
   `inhouse-design-assistant-enabled` localStorage flag) — tune the shader
   controls until the look is right, then use its **Copy** button and paste
   the values into that shader's `value:` fields in
   `snippets/shader-controls-[shader].liquid`. Deploy with `npm run push`,
   then verify on the live page without the `?new-inhouse-design` param.

2. **Create the Shopify product.** Set up the product and its variants
   normally in Shopify admin — this is a regular product, not something
   created through the worker's `/create-product` endpoint (that endpoint is
   exclusively for customer-generated custom/community products).

3. **Set up the product in Printful.** Configure the product/print file in
   Printful's dashboard via the native Shopify catalog-sync app, as usual.

4. **Set the `printful.variant_id` metafield (required for automated
   fulfillment).** For each Shopify variant, open Printful's dashboard and
   copy that variant's Printful **sync variant ID** — *not* the generic
   catalog variant ID shown in Printful's public catalog browser, these are
   different ID spaces and mixing them up is the most common mistake here.
   Paste it into that variant's `printful.variant_id` metafield (namespace
   `printful`, key `variant_id`, type Integer) in Shopify admin's Custom
   Data editor. This is the signal the `orders/paid` webhook
   (`handleOrderPaidWebhook` in `worker/src/index.js`) uses to route a paid
   order to Printful — without it, the line item is treated as an ordinary
   catalog item and skipped by that automation entirely.

5. **Publish the product.**

## How order routing works

At add-to-cart, an in-house product's line item gets
`properties[_source] = inhouse` (`sections/main-product.liquid:282`). This
is cosmetic only — it suppresses the "custom design" badge in the cart
(`sections/main-cart.liquid:38`) — and plays no role in Printful routing.
The actual routing signal read by the `orders/paid` webhook is the
`printful.variant_id` variant metafield from step 4 above
(`classifyLineItem()` in `worker/src/index.js`). A line item with that
metafield submits to Printful as `{ sync_variant_id, quantity }` — no
`files[]` — since the print file is already attached to the sync variant
from step 3, unlike custom/community items which upload a design per order.

## One-time infrastructure setup

The webhook this routing depends on isn't live by default. Before it will
fulfill any in-house (or custom/community) order, the one-time cutover
checklist must be completed once per environment: provisioning
`SHOPIFY_WEBHOOK_SECRET`, registering the `orders/paid` webhook subscription
in Shopify admin, and — specifically for in-house products — disabling
Printful's native automatic order-routing for them once the new path is
verified working (running both at once double-submits every order). See
the implementation plan this automation shipped under for the full ordered
checklist; don't re-derive it from scratch on a future in-house product's
first order.
