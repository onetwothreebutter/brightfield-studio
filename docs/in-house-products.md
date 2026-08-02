# In-house products

An "in-house" product is a merchant-designed listing with fixed shader
look(s) — as opposed to a **custom** or **community** product, which is
generated dynamically from a customer's own design via
`worker POST /create-product`. In-house products are ordinary Shopify
products the merchant creates and configures by hand.

A product can carry **one** design (the values baked into its shader snippet)
or **several** (saved value sets in a metafield, chosen by a Design product
option). See "Multiple designs on one product" below.

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

## Multiple designs on one product

One product can offer several fixed designs — all rendered by that product's
single `shader-[file]` tag, differing only in their saved control values.
(A design on a *different* shader needs a different product: `ShaderBase.create()`
binds one canvas at script load and has no teardown path.)

1. **Add a `Design` product option** in Shopify, one value per design. Variants
   become Design x Size. The option may be named anything — the storefront finds
   it by matching option values against the design entries, not by name.

2. **Save each design's values** in the product's `custom.inhouse_designs`
   metafield (namespace `custom`, key `inhouse_designs`, type JSON), a list of:

   ```json
   [
     {
       "option": "Chladni Bloom",
       "shader": "chladni",
       "values": { "u_freq": 7.5, "u_rotation": 0.7854, "u_a": [0.5, 0.5, 0.5] }
     }
   ]
   ```

   - `option` must match the Design option value **exactly** — that string is
     the join key.
   - `shader` must match the product's `shader-` tag. A mismatched entry is
     skipped entirely (the shader falls back to its snippet defaults) rather
     than applied partially, which would produce a hybrid look that's very hard
     to trace back to a typo here.
   - `values` is copied verbatim into `window._shaderState.values`, so it uses
     that shape rather than anything more readable: **colours are `[r,g,b]`
     floats** (literal colours in linear space, palette coefficients `u_a`–`u_d`
     passed straight through — see `snippets/shader-color-utils.liquid`) and
     **`toRadians` controls are in radians** (`0.7854`, not `45`). Don't
     hand-convert these; produce them with the Design Assistant's **Copy design
     JSON** button, which emits a ready-to-paste entry.

3. **Give each design its own Printful product** (step 3 above) and set
   `printful.variant_id` on **every** Design x Size variant (step 4). This is
   where the work multiplies: 4 designs x 6 sizes is 24 sync variant ids copied
   by hand.

4. **Assign each design's image to its variants** so the media gallery, the
   `og:image` on a `?variant=` deep link, and the schema.org `image` all follow
   the shopper's selection. `custom.mockup_url` is per-product and can only ever
   depict one design — leave it unset here, or it will contradict the selection.

The storefront reads all of this in `sections/main-product.liquid`, with the
pure selection logic in `assets/inhouse-designs.js` (`pickDesign`,
`mergeDesignValues`, `findDesignOption`). A product with no metafield renders
exactly as before.

## How order routing works

At add-to-cart, an in-house product's line item gets
`properties[_source] = inhouse`, from a hidden input in the product form in
`sections/main-product.liquid`. It suppresses the "custom design" badge in the
cart (`sections/main-cart.liquid:38`), and it is also the signal that a line
item was *meant* to reach Printful: if it carries `_source = inhouse` but no
`printful.variant_id`, `classifyLineItem()` (`worker/src/index.js`) reports it
as `inhouse-unconfigured` instead of treating it as an ordinary catalog item.
Without that check a forgotten metafield — the likeliest mistake once a product
has 24 variants — would silently never be fulfilled.

The routing signal itself is the `printful.variant_id` variant metafield from
step 4 above. A line item with it submits to Printful as
`{ sync_variant_id, quantity }` — no `files[]` — since the print file is already
attached to the sync variant from step 3, unlike custom/community items which
upload a design per order.

### When something is misconfigured

If **any** relevant line item is unusable (missing/invalid `printful.variant_id`,
missing `design_url`, unmapped size), the webhook submits **nothing** for that
order — partial fulfillment would silently under-ship a paid order and the
completed idempotency record would make it permanent.

It answers Shopify with **422** and writes no completed idempotency record, so
the order stays recoverable: fix the offending metafield and Shopify's own
redelivery (or a manual replay) fulfills it in full. It also writes a durable
failure record — see "Checking nothing got stuck" below. To catch these early,
**watch the Worker logs for `MISCONFIGURED`**.

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
   path fulfills a paid order. Doing it after is just cleanup. Switch off the
   automatic *order routing* only — the product sync must stay connected, since
   disconnecting it invalidates every `sync_variant_id` the metafields point at.

### Checking nothing got stuck

An order the webhook refuses (bad metafield, missing shipping address, a
custom-design size Printful doesn't stock in the garment color, more than 100
line items) is recorded at `printful-orders-failed/{orderId}.json` in the
worker's R2 bucket. Listing that prefix answers "did anything paid fail to
reach Printful?" — it should normally be empty. Successful orders leave an
idempotency record at `printful-orders/{orderId}.json`; neither prefix is
garbage-collected.

Records clear themselves once the order stops needing attention — either a
later redelivery fulfills it, or the order stops being Printful-relevant at all
(the metafield was removed rather than fixed, or the offending items were
refunded). So anything still listed is genuinely outstanding.

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
