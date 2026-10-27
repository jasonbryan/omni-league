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
import { App } from '../../app';
import { routes } from '../../app.routes';
import {
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  CONVEX_URL,
  provideConvex,
  type ConvexHttpClientLike,
} from '../../core/data/convex';
import { snapshotDomGlobals } from '../../core/data/convex/testing/dom-globals';
import { PUBLIC_FRAME, publicFrame } from '../../public-layout/testing/frame';
import { provideSpartanHlm } from '../../ui/utils';
import { at, leagueQueryResults, NO_SEASONS, OPEN_DAY, seasonsPage } from './testing/league-data';

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
  queries: { name: string; args: unknown }[];
}

const sunday = (name: string) => Promise.resolve(leagueQueryResults()[name]);

async function render(
  path: string,
  query: (name: string, args: unknown) => Promise<unknown>,
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
const href = (link: Element | null | undefined) => {
  const url = new URL(link?.getAttribute('href') ?? '', ORIGIN);
  return `${url.pathname}${url.search}${url.hash}`;
};
const meta = (head: HTMLHeadElement, property: string) =>
  head.querySelector(`meta[property="${property}"]`)?.getAttribute('content');

const LEAGUE_PATH = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';
const slugs = { orgSlug: 'gulf-coast-sport-social', leagueSlug: 'sunday-reverse-coed-4s' };
const SERVER_ERROR = 'This page is temporarily unavailable';
const CONNECTION_REFUSED = 'connect ECONNREFUSED internal-db.corp.example:443';

const answer =
  (options: Parameters<typeof leagueQueryResults>[0] = {}) =>
  (name: string) =>
    Promise.resolve(leagueQueryResults(options)[name]);

describe('PublicLeaguePage server render', () => {
  it('renders the page, meta, and seasons from the queries, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${LEAGUE_PATH}?ott=SECRET&x=1`,
      sunday,
    );

    expect([...queries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'leagues:getPublicPage', args: slugs },
      { name: 'organizations:getPublicPage', args: { slug: 'gulf-coast-sport-social' } },
      { name: 'seasons:listPublic', args: { ...slugs, page: 1 } },
    ]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    expect(head.querySelector('title')?.textContent).toBe(
      'Sunday Reverse Coed 4s | Gulf Coast Sport & Social | Omni League',
    );
    expect(meta(head, 'og:title')).toBe('Sunday Reverse Coed 4s');
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${LEAGUE_PATH}`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(`${ORIGIN}${LEAGUE_PATH}`);

    expect(text(body.querySelector('main h1'))).toBe('Sunday Reverse Coed 4s');
    expect([...body.querySelectorAll('main section#seasons > ul > li h3')].map(text)).toEqual([
      'Summer 2027',
      'Spring 2027',
      'Fall 2026',
      'Summer 2026',
      'Spring 2026',
    ]);
    expect(text(body.querySelector('nav[aria-label="Seasons pages"] p'))).toBe('1–5 of 7 seasons');
    expect(text(body.querySelector('main section#registration-open h3'))).toBe('Summer 2027');
    expect(text(body.querySelector('main section#registration-open a[data-slot="button"]'))).toBe(
      'Register for Summer 2027',
    );
    expect(text(body.querySelector('main section#where'))).toContain(
      '3500 Surfside Blvd, Corpus Christi, TX 78402',
    );
    expect(text(body.querySelector('main section#where > p'))).toBe(
      'Run by Gulf Coast Sport & Social',
    );
    const frame = publicFrame(body);
    expect({ ...frame, navs: [] }).toEqual({ ...PUBLIC_FRAME, navs: [] });
    expect(frame.navs.at(-1)).toBe('Footer');
    expect(frame.navs).not.toContain('Gulf Coast Sport & Social');
    expect(body.querySelector('a')?.getAttribute('href')).toBe(`${LEAGUE_PATH}#main`);
    expect([...body.querySelectorAll('header a')].map(text)).toEqual(['Omni League', 'Sign in']);

    // Neither the token nor any other query parameter reaches the cacheable HTML.
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('writes one description tag that matches og:description', async () => {
    const { head } = await render(LEAGUE_PATH, sunday);
    const description = meta(head, 'og:description');
    expect(description).toBe(
      'Seasons of Sunday Reverse Coed 4s from Gulf Coast Sport & Social on Omni League.',
    );
    expect(
      [...head.querySelectorAll('meta[name="description"]')].map((tag) =>
        tag.getAttribute('content'),
      ),
    ).toEqual([description]);
  });

  it('renders page 2 from ?page=2, with ?page=2 in the canonical, og:url, and the control’s links', async () => {
    const { html, body, head, queries } = await render(
      `${LEAGUE_PATH}?page=2&utm_source=x`,
      answer({ page: 2 }),
    );
    expect(queries.find((q) => q.name === 'seasons:listPublic')?.args).toEqual({
      ...slugs,
      page: 2,
    });
    expect([...body.querySelectorAll('main section#seasons > ul > li h3')].map(text)).toEqual([
      'Fall 2025',
      'Summer 2025',
    ]);
    expect(text(body.querySelector('nav[aria-label="Seasons pages"] p'))).toBe('6–7 of 7 seasons');
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${LEAGUE_PATH}?page=2`);
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${LEAGUE_PATH}?page=2`,
    );
    expect(href(body.querySelector('nav[aria-label="Seasons pages"] a[aria-current="page"]'))).toBe(
      `${LEAGUE_PATH}?page=2#seasons`,
    );
    expect(html).not.toContain('utm_source');
  });

  it.each([
    ['?page=0', 1, 'page=0'],
    ['?page=9', 9, 'page=9'],
    ['?page=abc', 1, 'page=abc'],
    ['?page=2&page=3', 1, 'page=3'],
    ['?page=2&page=CANARYabc123', 1, 'CANARYabc123'],
    ['?page=CANARYabc123', 1, 'CANARYabc123'],
  ])(
    '%s renders page 1 with 200, the public Cache-Control, no Location, and none of the raw value',
    async (query, asked, raw) => {
      const { html, body, head, responseInit, queries } = await render(
        `${LEAGUE_PATH}${query}`,
        answer(),
      );
      expect(queries.find((q) => q.name === 'seasons:listPublic')?.args).toMatchObject({
        page: asked,
      });
      expect(responseInit.status).toBeUndefined();
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(responseInit.headers.get('Location')).toBeNull();
      expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${ORIGIN}${LEAGUE_PATH}`,
      );
      expect(
        body.querySelector('nav[aria-label="Seasons pages"] a[aria-current="page"]')?.textContent,
      ).toContain('1');
      expect(html).not.toContain(raw);
    },
  );

  it('shows the empty state for a published league with no published season', async () => {
    const { body, responseInit } = await render(LEAGUE_PATH, answer({ seasons: NO_SEASONS }));
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section#seasons'))).toContain('No seasons yet');
    expect(body.querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
  });

  it('shows no numbered control for 5 seasons and one for 6', async () => {
    const five = await render(LEAGUE_PATH, answer({ seasons: seasonsPage(1, 5) }));
    expect(five.body.querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
    const six = await render(LEAGUE_PATH, answer({ seasons: seasonsPage(1, 6) }));
    expect(six.body.querySelector('nav[aria-label="Seasons pages"]')).not.toBeNull();
  });

  it.each([
    ['a null league (a draft or an unknown league)', { league: null }],
    ['an unknown organization', { organization: null, league: null }],
  ])(
    'renders the not-found view in the public layout with status 404 and the public Cache-Control for %s',
    async (_label, options) => {
      const { body, head, responseInit } = await render(
        LEAGUE_PATH,
        answer({ ...options, seasons: NO_SEASONS }),
      );
      expect(responseInit.status).toBe(404);
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(text(body.querySelector('main h1'))).toBe('Page not found');
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
      expect(body.querySelector('button')).toBeNull();
      expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    },
  );

  it('renders the server-error view in the public layout with 503 and Cache-Control: no-store when the queries fail', async () => {
    const { html, body, head, responseInit } = await render(`${LEAGUE_PATH}?ott=SECRET`, () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(LEAGUE_PATH);
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the queries time out', async () => {
    const { body, responseInit } = await render(
      LEAGUE_PATH,
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });

  for (const failing of [
    'leagues:getPublicPage',
    'seasons:listPublic',
    'organizations:getPublicPage',
  ]) {
    it(`renders the server-error view with 503 and no-store when ${failing} fails`, async () => {
      const { html, body, head, responseInit } = await render(
        `${LEAGUE_PATH}?page=2&ott=SECRET`,
        (name) =>
          name === failing
            ? Promise.reject(new Error(CONNECTION_REFUSED))
            : answer({ page: 2 })(name),
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(body.querySelector('main a')?.getAttribute('href')).toBe(`${LEAGUE_PATH}?page=2`);
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
      expect(body.querySelector('main section')).toBeNull();
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
      expect(html).not.toContain('internal-db');
      expect(html).not.toContain('SECRET');
    });

    it(`renders the server-error view with 503 and no-store when ${failing} times out`, async () => {
      const { body, responseInit } = await render(
        LEAGUE_PATH,
        (name) => (name === failing ? new Promise(() => undefined) : answer()(name)),
        30,
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    });
  }
});
