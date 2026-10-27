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
import { seasonQueryResults, SUMMER_2027 } from './testing/season-data';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('2027-04-01'));
});
afterEach(() => {
  restoreDomGlobals();
  vi.useRealTimers();
});

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

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

const SEASON_PATH =
  '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/summer-2027';
const slugs = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'sunday-reverse-coed-4s',
  seasonSlug: 'summer-2027',
};
const SERVER_ERROR = 'This page is temporarily unavailable';
const CONNECTION_REFUSED = 'connect ECONNREFUSED internal-db.corp.example:443';

const answer =
  (options: Parameters<typeof seasonQueryResults>[0] = {}) =>
  (name: string) =>
    Promise.resolve(seasonQueryResults(options)[name]);

describe('PublicSeasonPage server render', () => {
  it('renders the page, meta, and details from the queries, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${SEASON_PATH}?ott=SECRET&x=1`,
      answer(),
    );

    expect([...queries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'seasons:getPublicPage', args: slugs },
    ]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    expect(head.querySelector('title')?.textContent).toBe(
      'Summer 2027 | Sunday Reverse Coed 4s | Omni League',
    );
    expect(meta(head, 'og:title')).toBe('Summer 2027');
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:description')).toBe(
      'Jun 6 – Aug 29, 2027. 4v4, teams need at least 4 players.',
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${SEASON_PATH}`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(`${ORIGIN}${SEASON_PATH}`);

    expect(text(body.querySelector('main h1'))).toBe('Sunday Reverse Coed 4s · Summer 2027');
    expect(
      [...body.querySelectorAll('main nav[aria-label="Breadcrumb"] a')].map((a) => href(a)),
    ).toEqual([
      '/organizations/gulf-coast-sport-social',
      '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s',
      SEASON_PATH,
    ]);
    expect([...body.querySelectorAll('main dl > div')].map((row) => text(row))).toEqual([
      'Dates Jun 6 – Aug 29, 2027',
      'Division Coed · 4v4 · Rec From the league · teams need at least 4 players',
      'Registration closes May 23, 2027',
      'Location North Beach Sand Courts3500 Surfside Blvd, Corpus Christi, TX 78402',
    ]);
    expect(
      [...body.querySelectorAll('main dl time')].map((time) => time.getAttribute('datetime')),
    ).toEqual(['2027-06-06', '2027-08-29', '2027-05-23']);
    const frame = publicFrame(body);
    expect({ ...frame, navs: [] }).toEqual({ ...PUBLIC_FRAME, navs: [] });
    expect(frame.navs.at(-1)).toBe('Footer');
    expect(frame.navs).not.toContain('Gulf Coast Sport & Social');
    expect(body.querySelector('a')?.getAttribute('href')).toBe(`${SEASON_PATH}#main`);
    expect([...body.querySelectorAll('header a')].map(text)).toEqual(['Omni League', 'Sign in']);

    // Neither the token nor any other query parameter reaches the cacheable HTML.
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('writes one description tag that matches og:description', async () => {
    const { head } = await render(SEASON_PATH, answer());
    const description = meta(head, 'og:description');
    expect(description).toBe('Jun 6 – Aug 29, 2027. 4v4, teams need at least 4 players.');
    expect(
      [...head.querySelectorAll('meta[name="description"]')].map((tag) =>
        tag.getAttribute('content'),
      ),
    ).toEqual([description]);
  });

  it('renders the open registration card after the h1 and before the details, with no price', async () => {
    const { html, body } = await render(SEASON_PATH, answer());
    const registration = body.querySelector('main #registration');
    expect(text(registration)).toContain('Registration open');
    expect(text(registration)).toContain('Registration closes');
    expect(text(registration)).toContain('May 23, 2027');
    const order = ['<h1', 'id="registration"', 'id="details-heading"', 'id="how-heading"'].map(
      (marker) => html.indexOf(marker),
    );
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text(body.querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('renders the closed card with the link to the league’s open season when the clock is past the deadline', async () => {
    vi.setSystemTime(at('2027-07-01'));
    const season = {
      ...SUMMER_2027,
      league: {
        ...SUMMER_2027.league,
        upcomingSeasons: [
          ...(SUMMER_2027.league.upcomingSeasons ?? []),
          {
            name: 'Fall 2027',
            slug: 'fall-2027',
            startDate: '2027-09-12',
            registrationDeadline: '2027-09-05',
          },
        ],
      },
    };
    const { body } = await render(SEASON_PATH, answer({ season }));
    const registration = body.querySelector('main #registration');
    expect(text(registration)).toContain('Registration closed');
    expect(text(registration)).not.toContain('Registration open');
    expect(href(registration?.querySelector('a'))).toBe(
      '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/fall-2027',
    );
    expect(body.querySelector('main #how-heading')).toBeNull();
  });

  it.each([
    ['a null season (a draft, or an unknown organization, league, or season)', { season: null }],
  ])(
    'renders the not-found view in the public layout with status 404 and the public Cache-Control for %s',
    async (_label, options) => {
      const { body, head, responseInit } = await render(SEASON_PATH, answer(options));
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
    const { html, body, head, responseInit } = await render(`${SEASON_PATH}?ott=SECRET`, () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(SEASON_PATH);
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the queries time out', async () => {
    const { body, responseInit } = await render(
      SEASON_PATH,
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });

  for (const failing of ['seasons:getPublicPage']) {
    it(`renders the server-error view with 503 and no-store when ${failing} fails`, async () => {
      const { html, body, head, responseInit } = await render(
        `${SEASON_PATH}?ott=SECRET`,
        (name) =>
          name === failing ? Promise.reject(new Error(CONNECTION_REFUSED)) : answer()(name),
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
      expect(body.querySelector('main dl')).toBeNull();
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
      expect(html).not.toContain('internal-db');
      expect(html).not.toContain('SECRET');
    });

    it(`renders the server-error view with 503 and no-store when ${failing} times out`, async () => {
      const { body, responseInit } = await render(
        SEASON_PATH,
        (name) => (name === failing ? new Promise(() => undefined) : answer()(name)),
        30,
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    });
  }

  it('writes the same dates whatever the server’s time zone: from the stored text, not an instant', async () => {
    // 2027-01-01 parsed as UTC midnight reads as 31 Dec 2026 west of UTC.
    const { body } = await render(
      SEASON_PATH,
      answer({ season: { ...SUMMER_2027, startDate: '2027-01-01', endDate: '2027-03-01' } }),
    );
    expect(text(body.querySelector('main dl > div'))).toBe('Dates Jan 1 – Mar 1, 2027');
  });
});
