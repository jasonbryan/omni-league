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
import { provideSpartanHlm } from '../../ui/utils';
import {
  BEACH_LEAGUES,
  CONFLUENCE_NO_SOFTBALL,
  leaguesPage,
  NO_LEAGUES,
  sportQueryResults,
} from './testing/sport-data';

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
  queries: { name: string; args: unknown }[];
}

/**
 * Renders `path` through the app's real routes the way `@angular/ssr` does for a Server route:
 * REQUEST is the request, and RESPONSE_INIT starts with the route's headers. `query` answers each
 * Convex query by function name (`organizations:listPublicLeagues`).
 */
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
/** A link's path, query string, and fragment: a router link's `href` is absolute in this render. */
const href = (link: Element | null | undefined) => {
  const url = new URL(link?.getAttribute('href') ?? '', ORIGIN);
  return `${url.pathname}${url.search}${url.hash}`;
};
const meta = (head: HTMLHeadElement, property: string) =>
  head.querySelector(`meta[property="${property}"]`)?.getAttribute('content');

const ORG_PATH = '/organizations/confluence-sport-social';
const SPORT_PATH = `${ORG_PATH}/sports/beach-volleyball`;
const SERVER_ERROR = 'This page is temporarily unavailable';
const CONNECTION_REFUSED = 'connect ECONNREFUSED internal-db.corp.example:443';

/** Answers each query with its result for `options`. */
const answer =
  (options: Parameters<typeof sportQueryResults>[0] = {}) =>
  (name: string) =>
    Promise.resolve(sportQueryResults(options)[name]);

const leagueNames = (body: HTMLElement) =>
  [...body.querySelectorAll('main section#leagues > ul > li h3')].map(text);

describe('SportViewPage server render', () => {
  it('renders the page, meta, sidebar, and leagues from the queries, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${SPORT_PATH}?ott=SECRET&x=1`,
      answer(),
    );

    // One fetch per query, with the route's slug, the sport key, and page 1 only.
    expect([...queries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'organizations:getPublicPage', args: { slug: 'confluence-sport-social' } },
      {
        name: 'organizations:listPublicLeagues',
        args: { slug: 'confluence-sport-social', page: 1, sport: 'beachVolleyball' },
      },
    ]);
    expect(responseInit.status).toBeUndefined(); // 200
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    expect(head.querySelector('title')?.textContent).toBe(
      'Beach volleyball | Confluence Sport & Social | Omni League',
    );
    expect(meta(head, 'og:title')).toBe('Beach volleyball');
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${SPORT_PATH}`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(`${ORIGIN}${SPORT_PATH}`);

    expect(text(body.querySelector('main h1'))).toBe('Beach volleyball');
    expect(text(body.querySelector('main h1 + p'))).toBe('12 leagues at 3 locations');
    expect(leagueNames(body)).toEqual(BEACH_LEAGUES.slice(0, 5).map((league) => league.name));
    expect(body.querySelector('main [data-slot="badge"]')).toBeNull();
    expect(text(body.querySelector('nav[aria-label="Leagues pages"] p'))).toBe('1–5 of 12 leagues');
    const sidebar = body.querySelector('nav[aria-label="Confluence Sport & Social"]');
    expect(text(sidebar?.querySelector('[aria-current="page"]'))).toBe(
      'Beach volleyball 12 leagues',
    );
    expect(href(sidebar?.querySelector('[aria-current="page"]'))).toBe(SPORT_PATH);
    expect(body.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();

    // Neither the token nor any other query parameter reaches the cacheable HTML (PR #90).
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('renders page 2 from ?page=2, with ?page=2 in the canonical, og:url, and the control’s links', async () => {
    const { html, body, head, queries } = await render(
      `${SPORT_PATH}?page=2&utm_source=x`,
      answer({ page: 2 }),
    );
    expect(queries.find((q) => q.name === 'organizations:listPublicLeagues')?.args).toEqual({
      slug: 'confluence-sport-social',
      page: 2,
      sport: 'beachVolleyball',
    });
    expect(leagueNames(body)).toEqual(BEACH_LEAGUES.slice(5, 10).map((league) => league.name));
    expect(text(body.querySelector('nav[aria-label="Leagues pages"] p'))).toBe(
      '6–10 of 12 leagues',
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${SPORT_PATH}?page=2`);
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${SPORT_PATH}?page=2`,
    );
    expect(href(body.querySelector('nav[aria-label="Leagues pages"] a[aria-current="page"]'))).toBe(
      `${SPORT_PATH}?page=2#leagues`,
    );
    expect(html).not.toContain('utm_source');
  });

  // The query is asked for the page the URL names (`parseListPage`), and answers the effective
  // page: page 1 for one past the last page, as `listPublicLeagues` does.
  it.each([
    ['?page=0', 1, 'page=0'],
    ['?page=4', 4, 'page=4'],
    ['?page=abc', 1, 'page=abc'],
    // The control links page 3 of 3 on purpose: only the raw repeated parameter must be absent.
    ['?page=2&page=3', 1, 'page=2&page=3'],
    ['?page=2&page=CANARYabc123', 1, 'CANARYabc123'],
    ['?page=CANARYabc123', 1, 'CANARYabc123'],
  ])(
    '%s renders page 1 with 200, the public Cache-Control, no Location, and none of the raw value',
    async (query, asked, raw) => {
      const { html, body, head, responseInit, queries } = await render(
        `${SPORT_PATH}${query}`,
        answer(),
      );
      expect(queries.find((q) => q.name === 'organizations:listPublicLeagues')?.args).toMatchObject(
        { page: asked },
      );
      expect(responseInit.status).toBeUndefined();
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(responseInit.headers.get('Location')).toBeNull();
      expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${ORIGIN}${SPORT_PATH}`,
      );
      expect(
        body.querySelector('nav[aria-label="Leagues pages"] a[aria-current="page"]')?.textContent,
      ).toContain('1');
      expect(html).not.toContain(raw);
      expect(html).not.toContain(raw.replaceAll('&', '&amp;'));
    },
  );

  it('shows no numbered control for 5 leagues and one for 6', async () => {
    const five = await render(SPORT_PATH, answer({ leagues: leaguesPage(1, 5) }));
    expect(five.body.querySelector('nav[aria-label="Leagues pages"]')).toBeNull();
    const six = await render(SPORT_PATH, answer({ leagues: leaguesPage(1, 6) }));
    expect(six.body.querySelector('nav[aria-label="Leagues pages"]')).not.toBeNull();
  });

  it.each([
    ['an unknown organization', SPORT_PATH, { organization: null, leagues: NO_LEAGUES }],
    [
      'a sport the organization has no league in',
      `${ORG_PATH}/sports/softball`,
      { organization: CONFLUENCE_NO_SOFTBALL, leagues: NO_LEAGUES },
    ],
  ])(
    'renders the not-found view with status 404, the public Cache-Control, and no sidebar for %s',
    async (_label, path, options) => {
      const { body, head, responseInit } = await render(path, answer(options));
      expect(responseInit.status).toBe(404);
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(text(body.querySelector('main h1'))).toBe('Page not found');
      expect(body.querySelector('nav')).toBeNull();
      expect(body.querySelector('button')).toBeNull();
      expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    },
  );

  // `listPublicLeagues` would throw on a `sport` it does not know, which would be a 503.
  it.each(['curling', 'beachVolleyball', 'Soccer', 'beach-volleyball-'])(
    'the segment %s renders the not-found view with 404 and asks no query',
    async (segment) => {
      const { body, responseInit, queries } = await render(
        `${ORG_PATH}/sports/${segment}?page=2`,
        () => Promise.reject(new Error('must not be asked')),
      );
      expect(queries).toEqual([]);
      expect(responseInit.status).toBe(404);
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(text(body.querySelector('main h1'))).toBe('Page not found');
    },
  );

  it('renders the server-error view with 503 and Cache-Control: no-store when the queries fail', async () => {
    const { html, body, head, responseInit } = await render(`${SPORT_PATH}?ott=SECRET`, () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(SPORT_PATH);
    expect(body.querySelector('nav')).toBeNull();
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the queries time out', async () => {
    const { body, responseInit } = await render(SPORT_PATH, () => new Promise(() => undefined), 30);
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });

  for (const failing of ['organizations:getPublicPage', 'organizations:listPublicLeagues']) {
    it(`renders the server-error view with 503 and no-store when ${failing} fails`, async () => {
      const { html, body, head, responseInit } = await render(
        `${SPORT_PATH}?page=2&ott=SECRET`,
        (name) =>
          name === failing
            ? Promise.reject(new Error(CONNECTION_REFUSED))
            : answer({ page: 2 })(name),
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(body.querySelector('main a')?.getAttribute('href')).toBe(`${SPORT_PATH}?page=2`);
      expect(body.querySelector('nav')).toBeNull();
      expect(body.querySelector('main section')).toBeNull();
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
      expect(html).not.toContain('internal-db');
      expect(html).not.toContain('SECRET');
    });

    it(`renders the server-error view with 503 and no-store when ${failing} times out`, async () => {
      const { body, responseInit } = await render(
        SPORT_PATH,
        (name) => (name === failing ? new Promise(() => undefined) : answer()(name)),
        30,
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(body.querySelector('nav')).toBeNull();
    });
  }
});
