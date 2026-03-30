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

  test('#share= URL auto-opens shader tab and replaces hash with #shader', async ({ page }) => {
    // Mock the worker fetch so the test doesn't depend on a live network call
    await page.route('**/get-shader-state/**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`${PRODUCT_PATH}#share=xyz789`);
    await page.waitForLoadState('domcontentloaded');

    // Shader tab auto-opens via #share= hash
    await expect(page.locator('.media-tab[data-tab="shader"]')).toHaveClass(/is-active/, { timeout: 8000 });

    // #share= is replaced with #shader after the restore fetch completes
    await expect(page).toHaveURL(/#shader/, { timeout: 10000 });
    expect(page.url()).not.toContain('#share=');
  });
});
