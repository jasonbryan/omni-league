// Smoke spec (#13): the prerendered placeholder home `/`. #15 runs it against previews with
// E2E_BASE_URL, where the local-build-only checks are skipped.
import { expectAccessible } from './support/a11y';
import { LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';

const HEADING = /<h1\b[^>]*>\s*Omni League\s*<\/h1>/;

test.describe('smoke: placeholder home', () => {
  test('raw server HTML of / is 200 and contains the h1', async ({ request }) => {
    const { status, headers, html } = await fetchRawHtml(request, '/');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(html).toMatch(HEADING);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('/ shows the h1 and has a non-empty title (2.4.2)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
      await expect(page).toHaveTitle(/\S/);
    });
  });

  test('/ loads, shows the h1, and passes the axe helper', async ({ page, consoleGuard }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    // On the local development build, scan the hydrated page, not the server HTML alone.
    if (!remoteBaseUrl) await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expectAccessible(page);
  });

  test('/ hydrates (dev-mode "Angular hydrated <n> component(s)" log)', async ({
    page,
    consoleGuard,
  }) => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    await page.goto('/');
    await expect
      .poll(() => consoleGuard.hydrated, {
        message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
      })
      .toBe(true);
  });

  test('a malformed URL gets a plain-text 400 with no stack trace or path', async ({ request }) => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    const response = await request.get('/%E0%A4%A');
    const body = await response.text();
    expect(response.status()).toBe(400);
    expect(response.headers()['content-type']).toMatch(/^text\/plain\b/);
    expect(body).toContain('Bad Request');
    expect(body).not.toMatch(/\bat /); // stack frame
    expect(body).not.toMatch(/\w+Error\b|stack/i);
    expect(body).not.toMatch(/(?:\/[\w.@-]+){2,}|[A-Za-z]:\\|node_modules|\.m?[jt]s\b/); // file path
  });
});
