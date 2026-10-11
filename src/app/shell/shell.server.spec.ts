import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { snapshotDomGlobals } from '../core/data/convex/testing/dom-globals';
import { provideSpartanHlm } from '../ui/utils';
import { App } from '../app';
import { SidebarTestPage } from './testing/test-pages';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each
// test (see dom-globals.ts).
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
});
afterEach(() => {
  restoreDomGlobals();
});

function render(): Promise<string> {
  const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(
      App,
      {
        providers: [
          provideServerRendering(),
          provideRouter([{ path: '**', component: SidebarTestPage }]),
          provideSpartanHlm(),
        ],
      },
      context,
    );
  return renderApplication(bootstrap, {
    document:
      '<!doctype html><html><head><base href="/"></head><body><app-root></app-root></body></html>',
    url: 'http://localhost/organizations/test?ott=SECRET&y=1',
    allowedHosts: ['localhost'],
  });
}

describe('Shell server render', () => {
  it('renders the sidebar in the desktop column and a closed menu button, with no dialog', async () => {
    const html = await render();
    const body = new DOMParser().parseFromString(html, 'text/html').body;

    const navs = body.querySelectorAll('nav[aria-label="Test organization"]');
    expect(navs).toHaveLength(1);
    const main = body.querySelector('main#main');
    expect(main?.previousElementSibling?.contains(navs[0])).toBe(true);

    const button = body.querySelector('button[aria-label="Open navigation"]');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.hasAttribute('aria-controls')).toBe(false);
    expect(body.querySelector('[role="dialog"]')).toBeNull();
    // The sheet is imported on the first press in the browser, never on the server.
    expect(body.querySelector('app-shell-sheet, hlm-sheet')).toBeNull();
    expect(html).not.toContain('Close navigation');

    // The server HTML never holds the query string (PR #90): the CDN may store it, and a query
    // string can carry a one-time token. The browser adds the query after hydration.
    expect(body.querySelector('a')?.getAttribute('href')).toBe('/organizations/test#main');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('y=1');
  });

  // #63: every public page renders "Sign in" for everyone, whoever asks (no auth code runs on the
  // server), and its returnTo is the path alone, for the same reason: the CDN may store the HTML.
  it('renders the Sign in link with the path as returnTo and no query string', async () => {
    const html = await render();
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    // The router writes the server's links with the request's origin, as for the brand link.
    const link = body.querySelector('header a[routerlink="/sign-in"]');
    expect(link?.textContent.trim()).toBe('Sign in');
    const href = new URL(link?.getAttribute('href') ?? '', 'http://localhost');
    expect(`${href.pathname}${href.search}`).toBe('/sign-in?returnTo=%2Forganizations%2Ftest');
    expect(body.querySelector('header a[routerlink="/app"]')).toBeNull();
    expect(html).not.toContain('Account:');
  });
});
