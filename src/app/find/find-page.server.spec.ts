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
import { getFunctionName, type FunctionReference } from 'convex/server';
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
import { PUBLIC_FRAME, publicFrame } from '../public-layout/testing/frame';
import { provideSpartanHlm } from '../ui/utils';
import { at, COED_RESULTS, NO_RESULTS, OPEN_DAY } from './testing/find-data';
import { NO_ORGANIZATIONS, ORGANIZATIONS, organizationsPage } from './testing/organizations-data';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(OPEN_DAY));
});
afterEach(() => {
  vi.useRealTimers();
  restoreDomGlobals();
});

/**
 * `Meta` with its tags created in the render's own document. `Meta` creates them through the root DOM adapter, which @angular/common sets once per process
 * (`_DOM ??= adapter`): in this shared unit-test worker that is the browser adapter, whose jsdom elements domino's head rejects.
 * A real server sets only domino's adapter, so the app itself needs no such provider.
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
const SERVER_ERROR = 'This page is temporarily unavailable';
const ORGANIZATIONS_QUERY = 'search:organizations';
const CONNECTION_REFUSED = 'connect ECONNREFUSED internal-db.corp.example:443';

interface Rendered {
  html: string;
  body: HTMLElement;
  head: HTMLHeadElement;
  responseInit: { status?: number; headers: Headers };
  queries: { name: string; args: unknown }[];
}

async function render(
  path: string,
  query: (name: string, args: unknown) => Promise<unknown> = (name) =>
    Promise.resolve(name === ORGANIZATIONS_QUERY ? ORGANIZATIONS : COED_RESULTS),
  timeoutMs = 5000,
): Promise<Rendered> {
  const queries: { name: string; args: unknown }[] = [];
  const client: ConvexHttpClientLike = {
    query: ((fn: FunctionReference<'query'>, args: unknown) => {
      const name = getFunctionName(fn);
      queries.push({ name, args });
      return query(name, args);
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
const meta = (head: HTMLHeadElement, selector: string) =>
  head.querySelector(selector)?.getAttribute('content') ?? null;

describe('FindPage server render', () => {
  it('renders /leagues with the form and the organizations, asks no search, and answers 200 with the public Cache-Control', async () => {
    const { body, head, responseInit, queries } = await render('/leagues');
    expect(queries).toEqual([{ name: ORGANIZATIONS_QUERY, args: { page: 1 } }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(head.querySelector('title')?.textContent).toBe('Find a league | Omni League');
    expect(text(body.querySelector('main h1'))).toBe('Find a league');
    expect(
      body.querySelector('main form[role="search"][action="/leagues"] input[name="q"]'),
    ).not.toBeNull();
    expect(body.querySelector('main section[aria-labelledby="results-heading"]')).toBeNull();
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Front Range Rec Sports',
      'Gulf Coast Sport & Social',
      'Saguaro Valley Softball',
    ]);
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/leagues`,
    );
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
  });

  it('renders page 2 of the organizations with the canonical /leagues?page=2, and no other parameter in the HTML', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/leagues?page=2&ott=SECRET&utm_source=CANARYabc',
      (name, args) =>
        Promise.resolve(
          name === ORGANIZATIONS_QUERY ? organizationsPage((args as { page: number }).page) : null,
        ),
    );
    expect(queries).toEqual([{ name: ORGANIZATIONS_QUERY, args: { page: 2 } }]);
    expect(responseInit.status).toBeUndefined();
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Club 6',
      'Club 7',
    ]);
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/leagues?page=2`,
    );
    expect(meta(head, 'meta[property="og:url"]')).toBe(`${ORIGIN}/leagues?page=2`);
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('CANARYabc');
    expect(html).not.toContain('ott=');
  });

  it.each(['?page=0', '?page=abc', '?page=2&page=3'])(
    '%s asks page 1 of the organizations with 200 and the canonical /leagues',
    async (query) => {
      const { head, responseInit, queries } = await render(`/leagues${query}`);
      expect(queries).toEqual([{ name: ORGANIZATIONS_QUERY, args: { page: 1 } }]);
      expect(responseInit.status).toBeUndefined();
      expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${ORIGIN}/leagues`,
      );
    },
  );

  it('renders the empty text with no page control when no organization has a published league', async () => {
    const { body, responseInit } = await render('/leagues', () =>
      Promise.resolve(NO_ORGANIZATIONS),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section'))).toContain(
      'No organizations have published a league yet.',
    );
    expect(body.querySelector('nav[aria-label="Organizations pages"]')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the organizations fail', async () => {
    const { html, body, responseInit } = await render('/leagues?page=2&ott=SECRET', () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe('/leagues?page=2');
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the organizations time out', async () => {
    const { body, responseInit } = await render('/leagues', () => new Promise(() => undefined), 30);
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });

  it('renders the results of ?q, noindex, with the canonical /leagues and no other parameter in the HTML', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/leagues?q=coed&ott=SECRET&utm_source=CANARYabc',
    );
    expect(queries).toEqual([{ name: 'search:leagues', args: { q: 'coed' } }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main section [role="status"]'))).toBe('3 leagues match “coed”');
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Sunday Reverse Coed 4s',
      'Thursday Night Coed 2s',
      'Saturday Coed 6s',
    ]);
    expect(text(body.querySelector('main section ul > li'))).toContain('Registration open');
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex');
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/leagues`,
    );
    expect(meta(head, 'meta[property="og:url"]')).toBe(`${ORIGIN}/leagues`);
    expect(head.querySelector('title')?.textContent).toBe('coed | Find a league | Omni League');
    expect(body.querySelector('input[name="q"]')?.getAttribute('value')).toBe('coed');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('CANARYabc');
    expect(html).not.toContain('ott=');
  });

  it('renders the no-results state with 200', async () => {
    const { body, responseInit } = await render('/leagues?q=pickleball', () =>
      Promise.resolve(NO_RESULTS),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section [role="status"]'))).toBe(
      'No leagues match “pickleball”',
    );
    const clear = body.querySelector('main section a');
    expect(text(clear)).toBe('Clear the search');
    expect(new URL(clear?.getAttribute('href') ?? '', ORIGIN).pathname).toBe('/leagues');
  });

  it.each([
    ['?q=a&q=b', { q: 'a' }],
    [`?q=${'x'.repeat(300)}`, { q: 'x'.repeat(100) }],
    [
      `?q=${Array.from({ length: 20 }, (_, i) => `w${i + 1}`).join('+')}`,
      { q: Array.from({ length: 16 }, (_, i) => `w${i + 1}`).join(' ') },
    ],
  ])('%s asks %j with 200', async (query, args) => {
    const { responseInit, queries } = await render(`/leagues${query}`);
    expect(queries).toEqual([{ name: 'search:leagues', args }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
  });

  it('escapes the search in the HTML', async () => {
    const { html, body } = await render('/leagues?q=%3Cscript%3Ealert(1)%3C/script%3E');
    expect(html).not.toContain('<script>alert(1)');
    expect(body.querySelector('main script')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the search fails', async () => {
    const { html, body, head, responseInit } = await render('/leagues?q=coed&ott=SECRET', () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe('/leagues?q=coed');
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(
      head.querySelector('link[rel="canonical"], meta[property^="og:"], meta[name="robots"]'),
    ).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the search times out', async () => {
    const { body, responseInit } = await render(
      '/leagues?q=coed',
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });
});
