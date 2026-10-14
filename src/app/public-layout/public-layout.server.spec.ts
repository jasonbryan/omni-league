import { ChangeDetectionStrategy, Component } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { snapshotDomGlobals } from '../core/data/convex/testing/dom-globals';
import { App } from '../app';
import { provideSpartanHlm } from '../ui/utils';
import { PublicLayout } from './public-layout';

@Component({
  selector: 'app-public-layout-server-test-page',
  imports: [PublicLayout],
  template: `
    <app-public-layout>
      <h1>Page heading</h1>
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestPage {}

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
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
          provideRouter([{ path: '**', component: TestPage }]),
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

describe('PublicLayout server render', () => {
  it('renders the skip link, the top bar with "Sign in", the page, and the footer, with no sidebar or menu button', async () => {
    const html = await render();
    const body = new DOMParser().parseFromString(html, 'text/html').body;

    expect(body.querySelector('a')?.textContent.trim()).toBe('Skip to main content');
    expect(body.querySelector('a')?.getAttribute('href')).toBe('/organizations/test#main');
    expect([...body.querySelectorAll('header a')].map((a) => a.textContent.trim())).toEqual([
      'Omni League',
      'Sign in',
    ]);
    const signIn = body.querySelector('header a[routerlink="/sign-in"]');
    const href = new URL(signIn?.getAttribute('href') ?? '', 'http://localhost');
    expect(`${href.pathname}${href.search}`).toBe('/sign-in?returnTo=%2Forganizations%2Ftest');
    expect(body.querySelector('main#main[tabindex="-1"] h1')?.textContent).toBe('Page heading');
    expect(
      [...body.querySelectorAll('footer nav[aria-label="Footer"] a')].map((a) =>
        a.textContent.trim(),
      ),
    ).toEqual(['Your account', 'Create an organization', 'Sign in to manage']);

    expect(html).not.toContain('Open navigation');
    expect(body.querySelector('aside, button, [role="dialog"]')).toBeNull();
    expect(body.querySelector('header a[routerlink="/app"]')).toBeNull();
    expect(html).not.toContain('Account:');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('y=1');
  });

  it('has exactly one header, one main, and one footer, with the footer links in a "Footer" navigation', async () => {
    const html = await render();
    const body = new DOMParser().parseFromString(html, 'text/html').body;

    expect(body.querySelectorAll('header')).toHaveLength(1);
    expect(body.querySelectorAll('main')).toHaveLength(1);
    expect(body.querySelector('main')?.id).toBe('main');
    expect(body.querySelectorAll('footer')).toHaveLength(1);
    expect(body.querySelectorAll('nav')).toHaveLength(1);
    expect(body.querySelector('footer nav')?.getAttribute('aria-label')).toBe('Footer');
  });
});
