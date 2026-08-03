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
`properties[_source] = inhouse`, from a hidden input in the product form in
`sections/main-product.liquid`. This is cosmetic only — `main-cart.liquid`
reads it to suppress the "custom design" badge in the cart — and plays no
role in Printful routing.
The actual routing signal read by the `orders/paid` webhook is the
`printful.variant_id` variant metafield from step 4 above
(`classifyLineItem()` in `worker/src/index.js`). A line item with that
metafield submits to Printful as `{ sync_variant_id, quantity }` — no
`files[]` — since the print file is already attached to the sync variant
from step 3, unlike custom/community items which upload a design per order.

## One-time infrastructure setup

The webhook this routing depends on isn't live by default. Do these once per
environment, **in this order** — the sequencing is the point, not the
individual steps.

1. **Create the `printful.variant_id` metafield definition.** Shopify admin →
   Settings → Custom data → Variants. Namespace `printful`, key `variant_id`,
   type Integer. Without the definition, step 4 of the setup above has nowhere
   to put the id.

2. **Provision the webhook signing secret.**
   `npx wrangler secret put SHOPIFY_WEBHOOK_SECRET` from `worker/`. This is
   *not* `SHOPIFY_APP_CLIENT_SECRET` — see the note in `worker/wrangler.toml`.

3. **Register the webhook subscription.** Shopify admin → Settings →
   Notifications → Webhooks. Topic `orders/paid`, format JSON, URL
   `https://<worker-domain>/webhook/order-paid`, signed with the secret from
   step 2. Requests that don't verify are rejected with 401, so a mismatched
   secret shows up as every delivery failing, not as silent misbehaviour.

4. **Verify end-to-end with a real order, while Printful's native routing is
   still on.** Place a test order containing one in-house item and one
   custom-design item. Two things need confirming against a real Printful
   account, neither of which the test suite can cover: that a
   `sync_variant_id` item is accepted with no `files[]`, and that one
   `items[]` array can mix a `variant_id` item with a `sync_variant_id` one.
   Expect a **duplicate** draft during this step — native routing and the
   webhook are both live, by design. Both arrive as drafts (`confirm: false`),
   so nothing enters production without the merchant confirming it; that is
   what makes the overlap safe to sit in rather than something to rush past.

5. **Only then, disable Printful's native automatic order-routing for in-house
   products.** Doing this before step 4 passes leaves a window where neither
   path fulfills a paid order. Doing it after is just cleanup.

### Checking nothing got stuck

An order the webhook refuses (bad metafield, missing shipping address, more
than 100 line items) is recorded at `printful-orders-failed/{orderId}.json` in
the worker's R2 bucket, and cleared automatically if a later redelivery
succeeds. Listing that prefix answers "did anything paid fail to reach
Printful?" — it should normally be empty. Successful orders leave an
idempotency record at `printful-orders/{orderId}.json`; neither prefix is
garbage-collected.

Orders **Printful itself rejects** land in the same place, with
`reason: "Printful rejected the order"` and Printful's own diagnostic in
`detail`. These are worth checking first after the cutover, because the common
causes are setup mistakes rather than one-off bad orders: a
`printful.variant_id` holding a catalog variant id instead of a sync variant
id (the step-4 mixup — it's all digits, so the webhook can't catch it before
submitting), or a shipping address Shopify stored without a province code.
A rejection is retried by Shopify like any other failure, so fixing the cause
lets a redelivery fulfill the order and clear the record.

A third `reason` you may see is `"unrecognized financial status"`. The webhook
fulfills orders whose `displayFinancialStatus` is `PAID` or
`PARTIALLY_REFUNDED`, and quietly declines the states that either resolve
themselves (`PENDING`, `AUTHORIZED`, `PARTIALLY_PAID`) or are correctly never
fulfilled (`REFUNDED`, `VOIDED`, `EXPIRED`). Anything else — a value Shopify
added later, say — can't be sorted into either group, so it is refused *and*
recorded rather than guessed at. Check whether the order was actually paid and
fulfill it by hand if so.

## Refunds

A refund issued before the webhook runs (or before a redelivery of it) reduces
what gets produced: the handler submits each line item's `currentQuantity` —
units still owed after refunds and removals — not the quantity originally
ordered. An item refunded down to zero is dropped from the Printful order, and
an order whose only Printful-relevant items were all refunded is ignored
outright, leaving no failure record: there is simply nothing to make.

Refunds issued *after* the draft reaches Printful are not tracked here. The
draft still needs cancelling in the Printful dashboard by hand — which the
merchant is reviewing before confirming anyway.
