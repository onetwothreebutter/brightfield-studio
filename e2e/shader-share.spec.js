import { test, expect } from '@playwright/test';

const PRODUCT_PATH = '/products/dot-rise';

test.describe('Shader share link', () => {
  test('Copy Link button copies a URL containing #share= and no ?s=', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.route('**/save-shader-state', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'abc123' }) });
    });

    await page.goto(PRODUCT_PATH);
    await page.locator('.media-tab[data-tab="shader"]').click();
    await page.locator('.shader-control__copy-link-btn').waitFor();
    await page.locator('.shader-control__copy-link-btn').click();

    // Button goes Saving… → Copied!
    await expect(page.locator('.shader-control__copy-link-btn')).toHaveText('Copied!', { timeout: 5000 });

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('#share=abc123');
    expect(copied).toContain(PRODUCT_PATH);
    expect(copied).not.toContain('?s=');
    expect(copied).not.toContain('#s=');
  });

  test('#share= URL restores shader state and auto-opens shader tab', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Page 1: capture the current state, mock save → id
    let capturedState;
    await page.route('**/save-shader-state', async route => {
      const body = await route.request().postDataJSON();
      capturedState = body.state;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'xyz789' }) });
    });

    await page.goto(PRODUCT_PATH);
    await page.locator('.media-tab[data-tab="shader"]').click();
    await page.locator('.shader-control__copy-link-btn').waitFor();

    const originalValue = await page.locator('[data-param-key="u_rows"]').inputValue();
    await page.locator('.shader-control__copy-link-btn').click();
    await expect(page.locator('.shader-control__copy-link-btn')).toHaveText('Copied!', { timeout: 5000 });

    // Page 2: mock GET, navigate to #share= URL
    const page2 = await context.newPage();
    await page2.route('**/get-shader-state/xyz789', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capturedState) });
    });

    const shareUrl = page.url().replace(/#.*/, '') + '#share=xyz789';
    await page2.goto(shareUrl);

    // Shader tab auto-opens via #share= hash
    await expect(page2.locator('.media-tab[data-tab="shader"]')).toHaveClass(/is-active/, { timeout: 5000 });

    // Control value matches
    const restoredValue = await page2.locator('[data-param-key="u_rows"]').inputValue();
    expect(restoredValue).toBe(originalValue);

    // #share= is replaced with #shader after restore
    expect(page2.url()).not.toContain('#share=');
    expect(page2.url()).toContain('#shader');
  });
});
