import { test, expect } from '@playwright/test';

const PRODUCT_PATH = '/products/dot-rise';

test.describe('Custom design add-to-cart flow', () => {
  test('can create a custom shader design and add it to cart', async ({ page }) => {
    test.setTimeout(180000);

    // Fail fast if the page shows an alert — without this, alert() is auto-dismissed
    // and waitForURL silently times out with no indication of what went wrong.
    page.on('dialog', async dialog => {
      const msg = dialog.message();
      await dialog.dismiss();
      throw new Error(`Unexpected alert: "${msg}"`);
    });

    // Surface all browser console output in the test log — the add-to-cart retry
    // loop logs attempt-by-attempt detail via console.log/warn, which is invisible
    // in CI unless we forward it. That detail is what makes Cloudflare-vs-Shopify
    // failures distinguishable after the fact instead of showing only the final error.
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error') console.error('[browser]', msg.text());
      else if (type === 'warning') console.warn('[browser]', msg.text());
      else console.log('[browser]', msg.text());
    });

    // Tag products created during E2E tests so they can be bulk-deleted later
    // (Shopify admin → Products → filter by tag "e2e-test")
    await page.route('**/create-product', async route => {
      const req = route.request();
      const body = JSON.parse(req.postData() || '{}');
      body.extraTags = ['e2e-test'];
      await route.continue({ postData: JSON.stringify(body) });
    });

    // Note on 429 challenges: brightfield.studio is DNS-only to Shopify, so the
    // merchant Cloudflare zone never proxies storefront traffic — no header-based
    // WAF bypass is possible (an earlier X-E2E-Token scheme was inert). The 429
    // "Verifying your connection" pages come from Shopify's own platform bot
    // protection, which challenges rapid repeat POSTs to /cart/add.js from
    // datacenter IPs. The storefront avoids that signature by polling product
    // availability (GET) and POSTing to /cart/add.js once — see main-product.liquid.

    await page.goto(PRODUCT_PATH);

    // Switch to shader tab
    await page.locator('.product-customize-btn[data-tab="shader"]').click();

    // Wait for shader controls to appear
    await page.locator('#shader-gui-body').waitFor();

    // Give the WebGL canvas time to render before exporting
    await page.locator('#shader-canvas').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);

    // Click "Preview on Shirt"
    await page.locator('#shader-preview-btn').click();

    // Wait for mockup modal — save-preview + compositing can take several seconds
    await page.locator('#mockup-modal').waitFor({ state: 'visible', timeout: 30000 });

    // Select the first available (non-disabled) size option.
    // index:0 may be a sold-out variant; selecting it would cause /cart/add.js
    // to fail with a "sold out" error after all retries.
    const firstEnabledValue = await page.locator('#mockup-size-select option:not([disabled])').first().getAttribute('value');
    await page.locator('#mockup-size-select').selectOption(firstEnabledValue);

    // Place the order — triggers real /create-product worker call + /cart/add.js
    await page.locator('#mockup-modal-order').click();

    // /create-product does multiple sequential Shopify API calls; allow extra time
    // for CI environments where Shopify API latency can be higher than local.
    // A successful add no longer redirects immediately — it shows a "Continue to
    // Cart" step (with an optional, secondary gallery-submission prompt) so the
    // sale isn't sharing top billing with the gallery ask.
    await page.locator('#mockup-modal-continue').waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#mockup-modal-continue').click();

    await page.waitForURL('**/cart', { timeout: 30000 });

    // Cart item should show the "Custom Design" badge
    await expect(page.locator('.cart-item__custom-badge')).toBeVisible();
  });
});
