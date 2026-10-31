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
import {
  GULF_COAST,
  PAGED,
  PORT_ARANSAS,
  pagedResults,
  queryResults,
  SAND,
  sandResults,
  sportQueryResults,
} from './testing/pages';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
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

const gulfCoast = (name: string) => Promise.resolve(queryResults(GULF_COAST)[name]);

async function render(
  path: string,
  query: (name: string, args: unknown) => Promise<unknown>,
  timeoutMs?: number,
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
          { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: () => client },
          ...(timeoutMs === undefined
            ? []
            : [{ provide: CONVEX_SERVER_QUERY_TIMEOUT_MS, useValue: timeoutMs }]),
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
const lines = (el: Element | null) => [...(el?.querySelectorAll('h3, p') ?? [])].map(text);
const meta = (head: HTMLHeadElement, property: string) =>
  head.querySelector(`meta[property="${property}"]`)?.getAttribute('content');

describe('OrganizationPage server render', () => {
  it('renders the page and meta from the query in the public layout, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/organizations/gulf-coast-sport-social?ott=SECRET&x=1',
      gulfCoast,
    );

    const slug = 'gulf-coast-sport-social';
    expect([...queries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'organizations:getPublicPage', args: { slug } },
      { name: 'organizations:listPublicLeagueFacets', args: { slug } },
      { name: 'organizations:listPublicLeagues', args: { slug, page: 1 } },
      { name: 'organizations:listPublicLocations', args: { slug, page: 1 } },
      { name: 'seasons:listOpenForOrganization', args: { orgSlug: slug } },
    ]);
    expect(responseInit.status).toBeUndefined();
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
    expect(text(body.querySelector('main h1')?.previousElementSibling)).toBe('GC');
    expect(body.querySelector('main h1')?.previousElementSibling?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(text(body.querySelector('main h1')?.parentElement?.nextElementSibling)).toBe(
      'Beach volleyball, soccer, and softball · 5 leagues at 3 locations',
    );
    expect(lines(body.querySelector('#league-2'))).toEqual([
      "Men's Over-30 11v11",
      "Men's · 11v11 · Rec · 30+",
      'Soccer · Bayside Athletic Complex',
      'No upcoming season',
    ]);
    expect(lines(body.querySelector('#location-1'))).toEqual([
      'Bayside Athletic Complex',
      '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
      'Soccer, softball',
    ]);
    expect([...body.querySelectorAll('main [role="status"]')].map(text)).toEqual(['5 leagues', '']);

    expect(publicFrame(body)).toEqual({ ...PUBLIC_FRAME, navs: ['Sports', 'Footer'] });
    const chips = [...body.querySelectorAll('nav[aria-label="Sports"] a')];
    expect(
      chips.map((a) => [
        text(a),
        new URL(a.getAttribute('href') ?? '', ORIGIN).pathname,
        a.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['All sports 5 leagues', '/organizations/gulf-coast-sport-social', 'page'],
      [
        'Beach volleyball 2 leagues',
        '/organizations/gulf-coast-sport-social/sports/beach-volleyball',
        null,
      ],
      ['Soccer 2 leagues', '/organizations/gulf-coast-sport-social/sports/soccer', null],
      ['Softball 1 league', '/organizations/gulf-coast-sport-social/sports/softball', null],
    ]);
    expect(body.querySelector('a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social#main',
    );
    expect([...body.querySelectorAll('header a')].map(text)).toEqual([
      'Omni League',
      'Find a league',
      'Sign in',
    ]);
    expect(body.querySelector('nav[aria-label="Gulf Coast Sport & Social"]')).toBeNull();

    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('ott=');
    expect(html).not.toContain('x=1');
  });

  it('writes one description tag that matches og:description, ending with the City, state when set', async () => {
    const { head } = await render('/organizations/gulf-coast-sport-social', (name) =>
      Promise.resolve(queryResults({ ...GULF_COAST, cityState: 'Corpus Christi, TX' })[name]),
    );
    const expected =
      'Leagues and locations of Gulf Coast Sport & Social on Omni League in Corpus Christi, TX.';
    expect(meta(head, 'og:description')).toBe(expected);
    expect(
      [...head.querySelectorAll('meta[name="description"]')].map((tag) =>
        tag.getAttribute('content'),
      ),
    ).toEqual([expected]);
  });

  it('writes no description tag on the not-found view', async () => {
    const { head } = await render('/organizations/does-not-exist', (name) =>
      Promise.resolve(
        name === 'organizations:getPublicPage'
          ? null
          : { rows: [], page: 1, pageCount: 0, total: 0 },
      ),
    );
    expect(head.querySelector('meta[name="description"]')).toBeNull();
  });

  it('renders the empty hero line and no Leagues or Locations section for an organization with no leagues', async () => {
    const { body, responseInit } = await render(
      '/organizations/port-aransas-beach-volleyball-club',
      (name) => Promise.resolve(queryResults(PORT_ARANSAS)[name]),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main h1')?.parentElement?.nextElementSibling)).toBe(
      'No leagues published yet',
    );
    expect(text(body.querySelector('main h2'))).toBe('No leagues yet');
    expect(body.querySelector('main section')).toBeNull();
  });

  it('renders the not-found view in the public layout with status 404 and the public Cache-Control', async () => {
    const { body, head, responseInit } = await render('/organizations/does-not-exist', (name) =>
      Promise.resolve(
        name === 'organizations:getPublicPage'
          ? null
          : { rows: [], page: 1, pageCount: 0, total: 0 },
      ),
    );
    expect(responseInit.status).toBe(404);
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main h1'))).toBe('Page not found');
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(body.querySelector('button')).toBeNull();
    expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it('shows the totals and the rows of page 1 when a list has more than 5', async () => {
    const { body } = await render('/organizations/gulf-coast-sport-social', (name) => {
      const results = queryResults({
        ...GULF_COAST,
        leagueCount: 13,
        locationCount: 13,
        sportCount: 3,
      });
      return Promise.resolve(results[name]);
    });
    expect(text(body.querySelector('main h1')?.parentElement?.nextElementSibling)).toBe(
      'Beach volleyball, soccer, and softball · 13 leagues at 13 locations',
    );
    expect(text(body.querySelector('form[aria-label="Filter leagues"] [role="status"]'))).toBe(
      '13 leagues',
    );
    expect(
      body.querySelectorAll('main section[aria-labelledby="leagues-heading"] li[id]'),
    ).toHaveLength(5);
  });

  it('renders the server-error view in the public layout with 503 and Cache-Control: no-store when the query fails', async () => {
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
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
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

  it('answers 503 at the app default server timeout of 5 seconds for a held query, with no timeout provided', async () => {
    const started = Date.now();
    const { body, responseInit } = await render(
      '/organizations/gulf-coast-sport-social',
      () => new Promise(() => undefined),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(responseInit.status).toBe(503);
    expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
    expect(body.querySelector('[data-page-loading]')).toBeNull();
  }, 15_000);

  for (const failing of [
    'organizations:listPublicLeagues',
    'organizations:listPublicLocations',
    'seasons:listOpenForOrganization',
    'organizations:listPublicLeagueFacets',
  ]) {
    it(`renders the server-error view with 503 and no-store when ${failing} fails`, async () => {
      const { html, body, head, responseInit } = await render(
        '/organizations/gulf-coast-sport-social?ott=SECRET',
        (name) =>
          name === failing
            ? Promise.reject(new Error('connect ECONNREFUSED internal-db.corp.example:443'))
            : gulfCoast(name),
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
      expect(body.querySelector('main a')?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social',
      );
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
      expect(body.querySelector('main section')).toBeNull();
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
      expect(html).not.toContain('internal-db');
      expect(html).not.toContain('SECRET');
    });

    it(`renders the server-error view with 503 and no-store when ${failing} times out`, async () => {
      const { body, responseInit } = await render(
        '/organizations/gulf-coast-sport-social',
        (name) => (name === failing ? new Promise(() => undefined) : gulfCoast(name)),
        30,
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
      expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    });
  }
});

describe('Registration open on the server', () => {
  const NOW = Date.UTC(2027, 3, 1, 18);
  const season = (name: string, deadline: string, roster: number) => ({
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    startDate: '2027-06-02',
    endDate: '2027-08-25',
    registrationDeadline: deadline,
    minimumRosterSize: roster,
    league: {
      name: 'Coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      sportName: 'Soccer',
      divisionLabel: 'Coed · 7v7 · Rec',
      locationNames: ['Bayside Athletic Complex'],
    },
  });
  const withOpen = (name: string) =>
    Promise.resolve(
      queryResults({
        ...GULF_COAST,
        openSeasons: [
          season('Late 2027', '2027-05-30', 7),
          season('Soon 2027', '2027-04-20', 7),
          season('Past 2027', '2027-03-01', 7),
        ],
      })[name],
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts the open cards, soonest first, and the hero link in the raw HTML, with no query string', async () => {
    const { html, body } = await render(
      '/organizations/gulf-coast-sport-social?ott=SECRET',
      withOpen,
    );
    const section = body.querySelector('#registration-open');
    expect([...(section?.querySelectorAll(':scope > ul > li h3') ?? [])].map(text)).toEqual([
      'Coed 7v7 Rec',
      'Coed 7v7 Rec',
    ]);
    expect([...(section?.querySelectorAll(':scope > ul > li h3 + p') ?? [])].map(text)).toEqual([
      'Soon 2027',
      'Late 2027',
    ]);
    expect(
      [...(section?.querySelectorAll(':scope > ul > li a[data-slot="button"]') ?? [])].map(
        (a) => new URL(a.getAttribute('href') ?? '', ORIGIN).pathname,
      ),
    ).toEqual([
      '/organizations/gulf-coast-sport-social/leagues/coed-7v7-rec/seasons/soon-2027',
      '/organizations/gulf-coast-sport-social/leagues/coed-7v7-rec/seasons/late-2027',
    ]);
    const hero = body.querySelector('main a[href$="#registration-open"]');
    expect(text(hero)).toBe('Register for a season');
    expect(hero?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social#registration-open',
    );
    expect(html).not.toContain('SECRET');
  });
});

describe('sport view server render', () => {
  const SOCCER = '/organizations/gulf-coast-sport-social/sports/soccer';
  const soccer = (name: string) => Promise.resolve(sportQueryResults(GULF_COAST, 'soccer')[name]);

  it('renders the sport view with the Soccer chip current, its leagues and locations, and its meta', async () => {
    const { html, body, head, responseInit, queries } = await render(SOCCER, soccer);

    const slug = 'gulf-coast-sport-social';
    expect([...queries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'organizations:getPublicPage', args: { slug } },
      { name: 'organizations:listPublicLeagueFacets', args: { slug, sport: 'soccer' } },
      { name: 'organizations:listPublicLeagues', args: { slug, page: 1, sport: 'soccer' } },
      { name: 'organizations:listPublicLocations', args: { slug, page: 1, sport: 'soccer' } },
      { name: 'seasons:listOpenForOrganization', args: { orgSlug: slug, sport: 'soccer' } },
    ]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(head.querySelector('title')?.textContent).toBe(
      'Soccer | Gulf Coast Sport & Social | Omni League',
    );
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${SOCCER}`,
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${SOCCER}`);
    expect(
      [...body.querySelectorAll('nav[aria-label="Sports"] a')].map((a) => [
        text(a),
        a.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['All sports 5 leagues', null],
      ['Beach volleyball 2 leagues', null],
      ['Soccer 2 leagues', 'page'],
      ['Softball 1 league', null],
    ]);
    expect(text(body.querySelector('#leagues-heading'))).toBe('Soccer leagues');
    expect([...body.querySelectorAll('#leagues li h3')].map(text)).toEqual([
      'Coed 7v7 Rec',
      "Men's Over-30 11v11",
    ]);
    expect([...body.querySelectorAll('#locations li h3')].map(text)).toEqual([
      'Bayside Athletic Complex',
    ]);
    expect(text(body.querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
    expect(publicFrame(body)).toEqual({ ...PUBLIC_FRAME, navs: ['Sports', 'Footer'] });
    expect(html).not.toContain('ott=');
  });

  it.each(['?page=0', '?page=abc', '?page=2&page=3', '?ott=SECRET&page=9999'])(
    'asks for page 1 and holds none of the query string for %s',
    async (query) => {
      const { html, queries, responseInit } = await render(`${SOCCER}${query}`, soccer);
      expect(responseInit.status).toBeUndefined();
      expect(queries.find((q) => q.name === 'organizations:listPublicLeagues')?.args).toEqual({
        slug: 'gulf-coast-sport-social',
        page: 1,
        sport: 'soccer',
      });
      expect(html).not.toContain('SECRET');
      expect(html).not.toContain('abc');
      expect(html).not.toContain('page=3');
      expect(html).not.toContain('9999');
    },
  );

  it('puts the page from the result, never the request, in the canonical', async () => {
    const { head } = await render(`${SOCCER}?page=2`, (name) =>
      Promise.resolve(
        name === 'organizations:listPublicLeagues'
          ? { rows: GULF_COAST.leagues.slice(0, 1), page: 2, pageCount: 2, total: 7 }
          : sportQueryResults(GULF_COAST, 'soccer')[name],
      ),
    );
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${SOCCER}?page=2`,
    );
  });

  it.each(['curling', 'beachVolleyball', 'Soccer', 'soccer%2F'])(
    'answers 404 without asking a query for the segment %s',
    async (segment) => {
      const { body, head, responseInit, queries } = await render(
        `/organizations/gulf-coast-sport-social/sports/${segment}`,
        gulfCoast,
      );
      expect(queries).toEqual([]);
      expect(responseInit.status).toBe(404);
      expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
      expect(text(body.querySelector('main h1'))).toBe('Page not found');
      expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    },
  );

  it('answers 404 for a sport the organization has no published league in', async () => {
    const header = queryResults(GULF_COAST)['organizations:getPublicPage'] as typeof GULF_COAST;
    const { body, responseInit } = await render(
      '/organizations/gulf-coast-sport-social/sports/softball',
      (name) =>
        Promise.resolve(
          name === 'organizations:getPublicPage'
            ? { ...header, sports: header.sports.filter((sport) => sport.key !== 'softball') }
            : { rows: [], page: 1, pageCount: 0, total: 0 },
        ),
    );
    expect(responseInit.status).toBe(404);
    expect(text(body.querySelector('main h1'))).toBe('Page not found');
  });

  it('answers 404 for an unknown organization', async () => {
    const { responseInit } = await render('/organizations/nobody/sports/soccer', (name) =>
      Promise.resolve(
        name === 'organizations:getPublicPage'
          ? null
          : { rows: [], page: 1, pageCount: 0, total: 0 },
      ),
    );
    expect(responseInit.status).toBe(404);
  });

  for (const failing of [
    'organizations:getPublicPage',
    'organizations:listPublicLeagues',
    'organizations:listPublicLocations',
    'seasons:listOpenForOrganization',
    'organizations:listPublicLeagueFacets',
  ]) {
    it(`answers 503 with no-store when ${failing} fails`, async () => {
      const { html, body, responseInit } = await render(`${SOCCER}?ott=SECRET`, (name) =>
        name === failing
          ? Promise.reject(new Error('connect ECONNREFUSED internal-db.corp.example:443'))
          : soccer(name),
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
      expect(
        new URL(body.querySelector('main a')?.getAttribute('href') ?? '', ORIGIN).pathname,
      ).toBe(SOCCER);
      expect(html).not.toContain('internal-db');
      expect(html).not.toContain('SECRET');
    });

    it(`answers 503 with no-store when ${failing} times out`, async () => {
      const { responseInit } = await render(
        SOCCER,
        (name) => (name === failing ? new Promise(() => undefined) : soccer(name)),
        30,
      );
      expect(responseInit.status).toBe(503);
      expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    });
  }
});

describe('numbered pages on the server', () => {
  const ORG = `/organizations/${PAGED.slug}`;
  const paged =
    (pages: { leagues?: number; locations?: number }, segment?: string) =>
    (name: string, args: unknown) => {
      const page = (args as { page?: number }).page ?? 1;
      const results = pagedResults(
        PAGED,
        name === 'organizations:listPublicLocations'
          ? { ...pages, locations: page }
          : { ...pages, leagues: page },
        segment,
      );
      return Promise.resolve(results[name]);
    };

  it('renders the pages the URL asks for, with ids across pages, page links, and the canonical', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${ORG}?leagues=3&locations=2&utm_source=x`,
      paged({}),
    );
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(queries.find((q) => q.name === 'organizations:listPublicLeagues')?.args).toEqual({
      slug: PAGED.slug,
      page: 3,
    });
    expect(queries.find((q) => q.name === 'organizations:listPublicLocations')?.args).toEqual({
      slug: PAGED.slug,
      page: 2,
    });
    expect([...body.querySelectorAll('#leagues li[id]')].map((row) => row.id)).toEqual([
      'league-11',
      'league-12',
      'league-13',
      'league-14',
      'league-15',
    ]);
    expect([...body.querySelectorAll('#locations li[id]')].map((row) => row.id)).toEqual([
      'location-6',
      'location-7',
      'location-8',
      'location-9',
      'location-10',
    ]);
    const leagues = body.querySelector('nav[aria-label="Leagues pages"]');
    expect(text(leagues?.querySelector('p'))).toBe('11–15 of 26 leagues');
    expect(text(leagues?.querySelector('[aria-current="page"]'))).toBe('Page 3');
    const target = (a: Element | null | undefined) => {
      const url = new URL(a?.getAttribute('href') ?? '', ORIGIN);
      return `${url.pathname}${url.search}${url.hash}`;
    };
    expect(target(leagues?.querySelector('a'))).toBe(`${ORG}?leagues=2&locations=2#leagues`);
    expect(target(body.querySelector('nav[aria-label="Locations pages"] a'))).toBe(
      `${ORG}?leagues=3#locations`,
    );
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${ORG}?leagues=3&locations=2`,
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${ORG}?leagues=3&locations=2`);
    expect(html).not.toContain('utm_source');
  });

  for (const failing of ['organizations:listPublicLeagues', 'organizations:listPublicLocations']) {
    const query = failing === 'organizations:listPublicLeagues' ? '?leagues=3' : '?locations=3';
    for (const [where, path] of [
      ['organization page', `${ORG}${query}`],
      ['sport view', `${ORG}/sports/softball${query.replace('leagues', 'page')}`],
    ]) {
      it(`answers 503 with no-store on the ${where} when page 3 of ${failing} fails`, async () => {
        const { body, responseInit } = await render(path, (name, args) =>
          name === failing
            ? Promise.reject(new Error('connect ECONNREFUSED internal-db.corp.example:443'))
            : paged({}, path.includes('/sports/') ? 'softball' : undefined)(name, args),
        );
        expect(responseInit.status).toBe(503);
        expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
        expect(text(body.querySelector('main h1'))).toBe('This page is temporarily unavailable');
        expect(body.querySelector('main a')?.getAttribute('href')).toBe(path);
      });

      it(`answers 503 with no-store on the ${where} when page 3 of ${failing} times out`, async () => {
        const { responseInit } = await render(
          path,
          (name, args) =>
            name === failing
              ? new Promise(() => undefined)
              : paged({}, path.includes('/sports/') ? 'softball' : undefined)(name, args),
          30,
        );
        expect(responseInit.status).toBe(503);
        expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
      });
    }
  }
});

describe('filtered views server render', () => {
  const SAND_PATH = `/organizations/${SAND.slug}`;
  const sand =
    (args: Parameters<typeof sandResults>[0] = {}) =>
    (name: string) =>
      Promise.resolve(sandResults(args)[name]);
  const pathOf = (a: Element | undefined) => {
    const url = new URL(a?.getAttribute('href') ?? '', ORIGIN);
    return `${url.pathname}${url.search}`;
  };
  const pills = (body: HTMLElement) =>
    [...body.querySelectorAll('ul[aria-label="Active filters"] a')].map((a) => [
      text(a),
      pathOf(a),
    ]);
  const legends = (body: HTMLElement) => [...body.querySelectorAll('main legend')].map(text);
  const checked = (body: HTMLElement) =>
    [...body.querySelectorAll<HTMLInputElement>('main input[type="checkbox"]')]
      .filter((input) => input.hasAttribute('checked'))
      .map((input) => `${input.name}=${input.value}`);
  const count = (body: HTMLElement) =>
    text(body.querySelector('form[aria-label="Filter leagues"] [role="status"]'));

  it('renders the matching rows, pills, count, Clear all, noindex, and the unfiltered canonical', async () => {
    const { body, head, queries } = await render(
      `${SAND_PATH}?gender=coed&format=4v4`,
      sand({ gender: ['coed'], playersPerSide: [4] }),
    );
    const filterArgs = { gender: ['coed'], playersPerSide: [4] };
    expect(queries).toContainEqual({
      name: 'organizations:listPublicLeagues',
      args: { slug: SAND.slug, page: 1, ...filterArgs },
    });
    expect(queries).toContainEqual({
      name: 'seasons:listOpenForOrganization',
      args: { orgSlug: SAND.slug, ...filterArgs },
    });
    expect([...body.querySelectorAll('#leagues li[id] h3')].map(text)).toEqual([
      'Monday Coed 4s',
      'Wednesday Reverse Coed 4s',
    ]);
    expect(pills(body)).toEqual([
      ['Gender: Coed: remove the gender filter', `${SAND_PATH}?format=4v4`],
      ['4v4: remove the format filter', `${SAND_PATH}?gender=coed`],
    ]);
    expect(count(body)).toBe('2 of 7 leagues');
    const clearAll = [...body.querySelectorAll('main a')].find((a) => text(a) === 'Clear all');
    expect(pathOf(clearAll)).toBe(SAND_PATH);
    expect(head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}${SAND_PATH}`,
    );
    const form = body.querySelector('form[aria-label="Filter leagues"]');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe(SAND_PATH);
    expect(legends(body)).toEqual(['Gender', 'Format', 'Level', 'Age group']);
    expect(checked(body)).toEqual(['gender=coed', 'format=4v4']);
    expect(text(body.querySelector('main details summary'))).toBe('Filters 2 active');
    expect(form?.querySelectorAll('button[type="button"]')).toHaveLength(0);
  });

  it('ignores unknown values, which appear nowhere in the HTML or the query args', async () => {
    const canary = 'zq7canary';
    const { html, queries, head } = await render(
      `${SAND_PATH}?gender=nope&format=4x4&format=${canary}&level=${canary}&age=${canary}`,
      sand(),
    );
    expect(html).not.toContain(canary);
    expect(html).not.toContain('nope');
    expect(html).not.toContain('4x4');
    expect(queries).toContainEqual({
      name: 'organizations:listPublicLeagues',
      args: { slug: SAND.slug, page: 1 },
    });
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("ignores a format outside the organization's one sport on All sports", async () => {
    const { body, head } = await render(`${SAND_PATH}?format=11v11`, sand());
    expect(pills(body)).toEqual([]);
    expect(count(body)).toBe('7 leagues');
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
    expect(body.innerHTML).not.toContain('11v11');
  });

  it('shows no matches without the Registration open section or the Register link', async () => {
    const { body } = await render(
      `${SAND_PATH}?gender=mens&format=6v6`,
      sand({ gender: ['mens'], playersPerSide: [6] }),
    );
    expect(text(body.querySelector('#leagues'))).toContain('No leagues match these filters');
    expect(text(body.querySelector('#leagues'))).toContain('Remove a filter to see more.');
    expect([...body.querySelectorAll('#leagues a')].map((a) => [text(a), pathOf(a)])).toEqual([
      ['Clear all', SAND_PATH],
    ]);
    expect(body.querySelector('#registration-open')).toBeNull();
    expect(body.textContent).not.toContain('Register for a season');
    expect(count(body)).toBe('0 of 7 leagues');
  });

  it('retries the error view to the filtered URL, filters and pages in canonical order', async () => {
    const { body } = await render(
      `${SAND_PATH}?leagues=2&format=6v6&format=4v4&format=4v4`,
      (name) =>
        name === 'organizations:listPublicLeagues'
          ? Promise.reject(new Error('down'))
          : sand()(name),
    );
    const retry = [...body.querySelectorAll('main a')].find((a) => text(a) === 'Try again');
    expect(retry?.getAttribute('href')).toBe(`${SAND_PATH}?format=4v4&format=6v6&leagues=2`);
  });

  it('offers no Format or Level and shows no pill for them on All sports with several sports', async () => {
    const { body, queries } = await render(
      '/organizations/gulf-coast-sport-social?format=4v4&level=bb&leagues=2',
      gulfCoast,
    );
    expect(legends(body)).not.toContain('Format');
    expect(legends(body)).not.toContain('Level');
    expect(pills(body)).toEqual([]);
    expect(body.innerHTML).not.toContain('format=');
    expect(body.innerHTML).not.toContain('level=');
    expect(queries).toContainEqual({
      name: 'organizations:listPublicLeagues',
      args: { slug: 'gulf-coast-sport-social', page: 2, playersPerSide: [4], level: ['bb'] },
    });
  });
});
