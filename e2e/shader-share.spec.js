import { test, expect } from '@playwright/test';

const PRODUCT_PATH = '/products/dot-rise';

test.describe('Shader share link', () => {
  test('Share button copies a share URL to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.route('**/create-share', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://share.brightfield.studio/abc123' }),
      });
    });

    await page.goto(PRODUCT_PATH);
    await page.locator('.media-tab[data-tab="shader"]').click();
    await page.locator('.shader-control__share-btn').waitFor();
    await page.locator('.shader-control__share-btn').click();

    await expect(page.locator('.shader-control__share-btn')).toHaveText('Copied!', { timeout: 10000 });

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe('https://share.brightfield.studio/abc123');
  });

  test('#share= URL restores shader state and auto-opens shader tab', async ({ page, context }) => {
    const mockState = { u_rows: 42 };

    await page.route('**/get-shader-state/xyz789', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockState),
      });
    });

    const shareUrl = `${new URL(PRODUCT_PATH, 'https://brightfield.studio').pathname}#share=xyz789`;
    await page.goto(shareUrl);

    // Shader tab auto-opens via #share= hash
    await expect(page.locator('.media-tab[data-tab="shader"]')).toHaveClass(/is-active/, { timeout: 5000 });

    // Control value matches the restored state (wait for async fetch to apply)
    await expect(page.locator('[data-param-key="u_rows"]')).toHaveValue(String(mockState.u_rows), { timeout: 5000 });

    // #share= is replaced with #shader after restore
    expect(page.url()).not.toContain('#share=');
    expect(page.url()).toContain('#shader');
  });
});
