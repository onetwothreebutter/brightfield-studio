import { test, expect } from '@playwright/test';

const PRODUCT_PATH = '/products/rise-shirt';

test.describe('Shader share link', () => {
  test('Copy Link button copies a URL containing ?s= and #shader', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(PRODUCT_PATH);
    await page.locator('.media-tab[data-tab="shader"]').click();
    await page.locator('.shader-control__copy-link-btn').waitFor();

    await page.locator('.shader-control__copy-link-btn').click();
    await expect(page.locator('.shader-control__copy-link-btn')).toHaveText('Copied!');

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('?s=');
    expect(copied).toContain('#shader');
    expect(copied).toContain(PRODUCT_PATH);
  });

  test('?s= URL restores shader state and auto-opens shader tab', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Page 1: load product, read a control value, copy the link
    await page.goto(PRODUCT_PATH);
    await page.locator('.media-tab[data-tab="shader"]').click();
    await page.locator('.shader-control__copy-link-btn').waitFor();

    const originalValue = await page.locator('[data-param-key="u_rows"]').inputValue();
    await page.locator('.shader-control__copy-link-btn').click();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());

    // Page 2: open the shared URL
    const page2 = await context.newPage();
    await page2.goto(sharedUrl);

    // Shader tab auto-opens via #shader hash
    await expect(page2.locator('.media-tab[data-tab="shader"]')).toHaveClass(/is-active/, { timeout: 5000 });

    // Control value matches
    const restoredValue = await page2.locator('[data-param-key="u_rows"]').inputValue();
    expect(restoredValue).toBe(originalValue);

    // ?s= is stripped from URL after restore
    expect(page2.url()).not.toContain('?s=');
    expect(page2.url()).toContain('#shader');
  });
});
