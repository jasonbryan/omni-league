import { DOCUMENT } from '@angular/common';
import { REQUEST, RESPONSE_INIT, inject } from '@angular/core';
import {
  Meta,
  bootstrapApplication,
  provideClientHydration,
  type BootstrapContext,
} from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { App } from '../app';
import { routes } from '../app.routes';
import {
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  CONVEX_URL,
  provideConvex,
  type ConvexHttpClientLike,
} from '../core/data/convex';
import { snapshotDomGlobals } from '../core/data/convex/testing/dom-globals';
import { provideSpartanHlm } from '../ui/utils';
import { GULF_COAST } from './testing/pages';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each
// test (see dom-globals.ts).
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
});
afterEach(() => {
  restoreDomGlobals();
});

/**
 * `Meta` with its tags created in the render's own document. `Meta` creates them through the root
 * DOM adapter, which @angular/common sets once per process (`_DOM ??= adapter`): in this shared
 * unit-test worker that is the browser adapter, whose jsdom elements domino's head rejects. A real
 * server sets only domino's adapter, so the app itself needs no such provider.
 */
function metaInRenderDocument(): Meta {
  const meta = new Meta();
  const doc = inject(DOCUMENT);
  Object.assign(meta, {
    _dom: {
      createElement: (tag: string) => doc.createElement(tag),
      remove: (el: Element) => {
        el.remove();
      },
    },
  });
  return meta;
}

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const ORIGIN = 'https://omni.example';

interface Rendered {
  html: string;
  body: HTMLElement;
  head: HTMLHeadElement;
  responseInit: { status?: number; headers: Headers };
  queries: unknown[];
}

/**
 * Renders `path` through the app's real routes the way `@angular/ssr` does for a Server route:
 * REQUEST is the request, and RESPONSE_INIT starts with the route's headers.
 */
async function render(
  path: string,
  query: (args: unknown) => Promise<unknown>,
  timeoutMs = 5000,
): Promise<Rendered> {
  const queries: unknown[] = [];
  const client: ConvexHttpClientLike = {
    query: ((_fn: unknown, args: unknown) => {
      queries.push(args);
      return query(args);
    }) as ConvexHttpClientLike['query'],
  };
  const responseInit = {
    status: undefined as number | undefined,
    headers: new Headers({
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': PUBLIC_PAGE_CACHE,
    }),
  };
  const url = `${ORIGIN}${path}`;
  const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(
      App,
      {
        providers: [
          provideServerRendering(),
          provideRouter(routes),
          provideClientHydration(),
          provideConvex(),
          provideSpartanHlm(),
          { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
          { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: () => client },
          { provide: CONVEX_SERVER_QUERY_TIMEOUT_MS, useValue: timeoutMs },
          { provide: Meta, useFactory: metaInRenderDocument },
        ],
      },
      context,
    );
  const html = await renderApplication(bootstrap, {
    document:
      '<!doctype html><html><head><title>Omni League</title><base href="/"></head><body><app-root></app-root></body></html>',
    url,
    allowedHosts: ['omni.example'],
    platformProviders: [
      { provide: REQUEST, useValue: new Request(url) },
      { provide: RESPONSE_INIT, useValue: responseInit },
    ],
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { html, body: doc.body, head: doc.head, responseInit, queries };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const meta = (head: HTMLHeadElement, property: string) =>
  head.querySelector(`meta[property="${property}"]`)?.getAttribute('content');

describe('OrganizationPage server render', () => {
  it('renders the page, meta, and sidebar from the query, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/organizations/gulf-coast-sport-social?ott=SECRET&x=1',
      () => Promise.resolve(GULF_COAST),
    );

    expect(queries).toEqual([{ slug: 'gulf-coast-sport-social' }]);
    expect(responseInit.status).toBeUndefined(); // 200
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    expect(head.querySelector('title')?.textContent).toBe(
      'Gulf Coast Sport & Social | Omni League',
    );
    expect(meta(head, 'og:title')).toBe('Gulf Coast Sport & Social');
    expect(meta(head, 'og:description')).toBe(
      'Leagues and locations of Gulf Coast Sport & Social on Omni League.',
    );
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}/organizations/gulf-coast-sport-social`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(
      `${ORIGIN}/organizations/gulf-coast-sport-social`,
    );

    expect(text(body.querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
    expect([...body.querySelectorAll('main dl dd')].map(text)).toEqual(['5', '3', '3']);

    const nav = body.querySelector('nav[aria-label="Gulf Coast Sport & Social"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelectorAll('[id]')).toHaveLength(0);
    const fragmentLinks = [...(nav?.querySelectorAll('a[href*="#"]') ?? [])].map((a) =>
      a.getAttribute('href'),
    );
    expect(fragmentLinks).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => `/organizations/gulf-coast-sport-social#league-${n}`),
      ...[1, 2, 3].map((n) => `/organizations/gulf-coast-sport-social#location-${n}`),
    ]);
    for (const href of fragmentLinks) {
      expect(body.querySelector(`main [id="${href?.split('#')[1]}"]`), href ?? '').not.toBeNull();
    }
    expect(body.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();

    // Neither the token nor any other query parameter reaches the cacheable HTML (PR #90).
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('renders the not-found view with status 404, the public Cache-Control, and no sidebar', async () => {
    const { body, head, responseInit } = await render('/organizations/does-not-exist', () =>
      Promise.resolve(null),
    );
    expect(responseInit.status).toBe(404);
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main h1'))).toBe('Page not found');
    expect(body.querySelector('nav')).toBeNull();
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the query fails', async () => {
    const { html, body, head, responseInit } = await render(
      '/organizations/gulf-coast-sport-social?ott=SECRET',
      () => Promise.reject(new Error('connect ECONNREFUSED internal-db.corp.example:443')),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social',
    );
    expect(body.querySelector('nav')).toBeNull();
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the query times out', async () => {
    const { body, responseInit } = await render(
      '/organizations/gulf-coast-sport-social',
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
  });
});
