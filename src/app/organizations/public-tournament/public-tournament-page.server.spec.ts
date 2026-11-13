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
import { CONVEX_URL, provideConvex } from '../../core/data/convex';
import {
  provideConvexServerQueries,
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  type ConvexHttpClientLike,
} from '../../core/data/convex/server-query-loader';
import { snapshotDomGlobals } from '../../core/data/convex/testing/dom-globals';
import { PUBLIC_FRAME, publicFrame } from '../../public-layout/testing/frame';
import { expectBareCard } from '../../ui/testing/card';
import {
  at,
  BEACH_OPEN,
  BEACH_OPEN_BRACKET,
  TOURNAMENT_ARGS,
  TOURNAMENT_PATH,
  tournamentQueryResults,
} from './testing/tournament-data';
import { spacedText } from './testing/spaced-text';

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
          { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
          provideConvexServerQueries(),
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

const SERVER_ERROR = 'This page is temporarily unavailable';
const CONNECTION_REFUSED = 'connect ECONNREFUSED internal-db.corp.example:443';

const answer =
  (tournament = BEACH_OPEN as typeof BEACH_OPEN | null) =>
  (name: string) =>
    Promise.resolve(tournamentQueryResults(tournament)[name]);

describe('PublicTournamentPage server render', () => {
  it('renders the page, meta, and details from the query, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${TOURNAMENT_PATH}?ott=SECRET&x=1`,
      answer(),
    );

    expect(queries).toEqual([{ name: 'tournaments:getPublicPage', args: TOURNAMENT_ARGS }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    const title = 'Gulf Coast Beach Open | Gulf Coast Sport & Social | Omni League';
    expect(head.querySelector('title')?.textContent).toBe(title);
    expect(meta(head, 'og:title')).toBe(title);
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:description')).toBe(
      'Jun 12 – Jun 13, 2027. Beach volleyball · Coed · 2v2 · Open. Up to 16 teams.',
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${TOURNAMENT_PATH}`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(`${ORIGIN}${TOURNAMENT_PATH}`);

    expect(text(body.querySelector('main h1'))).toBe('Gulf Coast Beach Open');
    expect(
      [...body.querySelectorAll('main nav[aria-label="Breadcrumb"] a')].map((a) => href(a)),
    ).toEqual([
      '/organizations/gulf-coast-sport-social',
      '/organizations/gulf-coast-sport-social#tournaments',
    ]);
    expect([...body.querySelectorAll('main dl > div')].map((row) => text(row))).toEqual([
      'Dates Jun 12 – Jun 13, 2027',
      'Teams Up to 16 teams Teams of at least 2 players',
      'Registration closes Jun 5, 2027',
      'Location North Beach Sand Courts3500 Sandcourt Ln, Corpus Christi, TX 78402',
    ]);
    const frame = publicFrame(body);
    expect({ ...frame, navs: [] }).toEqual({ ...PUBLIC_FRAME, navs: [] });
    expect(frame.navs.at(-1)).toBe('Footer');

    // Neither the token nor any other query parameter reaches the cacheable HTML.
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('writes the h1, the division, the dates, the address, and the registration card before the details', async () => {
    const { html, body } = await render(TOURNAMENT_PATH, answer());
    const registration = body.querySelector('main #registration');
    expect(text(registration)).toContain('Registration open · closes Jun 5, 2027');
    const markup = html.slice(html.indexOf('<body'));
    const order = [
      '<h1',
      'Coed · 2v2 · Open',
      'id="registration"',
      'id="details-heading"',
      'Jun 12',
      '3500 Sandcourt Ln',
    ].map((marker) => markup.indexOf(marker));
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text(body.querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('puts the registration card’s slot, size, and classes in the raw HTML as static attributes', async () => {
    const { body } = await render(TOURNAMENT_PATH, answer());
    const cards = body.querySelectorAll('main #registration [data-slot="card"]');
    expect(cards).toHaveLength(1);
    expectBareCard(cards[0], 'p-5 md:p-6 lg:sticky lg:top-24');
  });

  it('writes each round heading and every game with its seeds and teams into the raw HTML', async () => {
    const { html, body } = await render(
      TOURNAMENT_PATH,
      answer({ ...BEACH_OPEN, bracket: { ...BEACH_OPEN_BRACKET, winner: 'Sand Crabs' } }),
    );
    const section = body.querySelector('main section#bracket')!;
    expect([...section.querySelectorAll('h3')].map((heading) => text(heading))).toEqual([
      'Semifinals',
      'Final',
    ]);
    const games = [...section.querySelectorAll('li')].map((game) => spacedText(game));
    expect(games).toEqual([
      'Game 1: (1) Sand Crabs Won against (4) Dig Dogs',
      'Game 2: (2) Net Results against (3) Dune Dashers',
      'Game 1: (1) Sand Crabs against To be decided',
    ]);
    expect(text(section.querySelector('[data-testid="bracket-winner"]'))).toBe(
      'Winner: Sand Crabs',
    );
    const markup = html.slice(html.indexOf('<body'));
    expect(markup.indexOf('id="details-heading"')).toBeLessThan(markup.indexOf('id="bracket"'));
    expect(section.querySelector('[role="region"][aria-label="Bracket rounds"]')).not.toBeNull();
  });

  it('writes the empty line into the raw HTML when there is no bracket', async () => {
    const { body } = await render(TOURNAMENT_PATH, answer());
    expect(text(body.querySelector('main section#bracket p'))).toBe(
      'The bracket appears here once the organizer creates it.',
    );
  });

  it('renders the closed card when the clock is past the deadline', async () => {
    vi.setSystemTime(at('2027-06-20'));
    const { body } = await render(TOURNAMENT_PATH, answer());
    const registration = body.querySelector('main #registration');
    expect(text(registration)).toContain('Registration closed');
    expect(text(registration)).not.toContain('Registration open');
  });

  it('writes one description tag that matches og:description', async () => {
    const { head } = await render(TOURNAMENT_PATH, answer());
    expect(
      [...head.querySelectorAll('meta[name="description"]')].map((tag) =>
        tag.getAttribute('content'),
      ),
    ).toEqual([meta(head, 'og:description')]);
  });

  it('writes the same dates whatever the server’s time zone: from the stored text, not an instant', async () => {
    const { body } = await render(
      TOURNAMENT_PATH,
      answer({ ...BEACH_OPEN, startDate: '2027-01-01', endDate: '2027-01-02' }),
    );
    expect(text(body.querySelector('main dl > div'))).toBe('Dates Jan 1 – Jan 2, 2027');
  });

  it('renders the not-found view in the public layout with status 404 and the public Cache-Control for a null tournament', async () => {
    const { body, head, responseInit } = await render(TOURNAMENT_PATH, answer(null));
    expect(responseInit.status).toBe(404);
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main h1'))).toBe('Page not found');
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the query fails', async () => {
    const { html, body, head, responseInit } = await render(`${TOURNAMENT_PATH}?ott=SECRET`, () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(TOURNAMENT_PATH);
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the query times out', async () => {
    const { body, responseInit } = await render(
      TOURNAMENT_PATH,
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });
});
