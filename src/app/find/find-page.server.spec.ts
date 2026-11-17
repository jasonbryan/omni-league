import { DOCUMENT } from '@angular/common';
import { Component, REQUEST, RESPONSE_INIT, inject } from '@angular/core';
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
import { CONVEX_URL, provideConvex } from '../core/data/convex';
import {
  provideConvexServerQueries,
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  type ConvexHttpClientLike,
} from '../core/data/convex/server-query-loader';
import { snapshotDomGlobals } from '../core/data/convex/testing/dom-globals';
import { PUBLIC_FRAME, publicFrame } from '../public-layout/testing/frame';
import { expectFindAlert } from '../ui/testing/alert';
import { slotsOf } from '../ui/testing/helm-slots';
import {
  at,
  COED_RESULTS,
  GIRLS_ROOKIES_ROW,
  GIRLS_SELECT_ROW,
  GULF_OPEN_ROW,
  JUNIOR_CAMP_ROW,
  NO_RESULTS,
  OPEN_DAY,
  SATURDAY_6S_ROW,
  SUNDAY_4S_ROW,
  THURSDAY_2S_ROW,
  browseResults,
} from './testing/find-data';
import { FindContent } from './find-content';
import { FindOrganizationsList } from './find-organizations';
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
const meta = (head: HTMLHeadElement, selector: string) =>
  head.querySelector(selector)?.getAttribute('content') ?? null;

describe('FindPage server render', () => {
  it('renders /programs with the form and the organizations, asks no search, and answers 200 with the public Cache-Control', async () => {
    const { body, head, responseInit, queries } = await render('/programs');
    expect(queries).toEqual([{ name: ORGANIZATIONS_QUERY, args: { page: 1 } }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(head.querySelector('title')?.textContent).toBe('Find a program | Omni League');
    expect(text(body.querySelector('main h1'))).toBe('Find a program');
    expect(
      body.querySelector('main form[role="search"][action="/programs"] input[name="q"]'),
    ).not.toBeNull();
    expect(body.querySelector('main section[aria-labelledby="results-heading"]')).toBeNull();
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Front Range Rec Sports',
      'Gulf Coast Sport & Social',
      'Saguaro Valley Softball',
    ]);
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs`,
    );
    expect(publicFrame(body)).toEqual({
      ...PUBLIC_FRAME,
      navs: ['Program type', 'Sport', 'Footer'],
    });
  });

  it('renders page 2 of the organizations with the canonical /programs?page=2, and no other parameter in the HTML', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/programs?page=2&ott=SECRET&utm_source=CANARYabc',
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
      `${ORIGIN}/programs?page=2`,
    );
    expect(meta(head, 'meta[property="og:url"]')).toBe(`${ORIGIN}/programs?page=2`);
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('CANARYabc');
    expect(html).not.toContain('ott=');
    expect(
      slotsOf(body.querySelector('nav[aria-label="Organizations pages"]')).slice(0, 4),
    ).toEqual(['pagination', 'pagination-content', 'pagination-item', 'pagination-link']);
  });

  it.each(['?page=0', '?page=abc', '?page=2&page=3'])(
    '%s asks page 1 of the organizations with 200 and the canonical /programs',
    async (query) => {
      const { head, responseInit, queries } = await render(`/programs${query}`);
      expect(queries).toEqual([{ name: ORGANIZATIONS_QUERY, args: { page: 1 } }]);
      expect(responseInit.status).toBeUndefined();
      expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${ORIGIN}/programs`,
      );
    },
  );

  it('renders the empty text with no page control when no organization has a published league', async () => {
    const { body, responseInit } = await render('/programs', () =>
      Promise.resolve(NO_ORGANIZATIONS),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section'))).toContain(
      'No organizations have published a league yet.',
    );
    expect(body.querySelector('nav[aria-label="Organizations pages"]')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the organizations fail', async () => {
    const { html, body, responseInit } = await render('/programs?page=2&ott=SECRET', () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe('/programs?page=2');
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the organizations time out', async () => {
    const { body, responseInit } = await render(
      '/programs',
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });

  it('renders the results of ?q, noindex, with the canonical /programs and no other parameter in the HTML', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/programs?q=coed&ott=SECRET&utm_source=CANARYabc',
    );
    expect(queries).toEqual([{ name: 'search:programs', args: { q: 'coed', withCamps: true } }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main section [role="status"]'))).toBe(
      '3 programs match “coed”',
    );
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Sunday Reverse Coed 4s',
      'Thursday Night Coed 2s',
      'Saturday Coed 6s',
    ]);
    expect(text(body.querySelector('main section ul > li'))).toContain('Registration open');
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex');
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs`,
    );
    expect(meta(head, 'meta[property="og:url"]')).toBe(`${ORIGIN}/programs`);
    expect(head.querySelector('title')?.textContent).toBe('coed | Find a program | Omni League');
    expect(body.querySelector('input[name="q"]')?.getAttribute('value')).toBe('coed');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('CANARYabc');
    expect(html).not.toContain('ott=');
  });

  it('puts Full and the open waitlist in the raw HTML of a league row whose open season is full', async () => {
    const [sunday, ...rest] = [SUNDAY_4S_ROW, THURSDAY_2S_ROW, SATURDAY_6S_ROW];
    const full = {
      ...COED_RESULTS,
      rows: [
        { ...sunday, seasons: sunday.seasons.map((season) => ({ ...season, isFull: true })) },
        ...rest,
      ],
    };
    const { body } = await render('/programs?q=coed', (name) =>
      Promise.resolve(name === ORGANIZATIONS_QUERY ? ORGANIZATIONS : full),
    );
    const row = body.querySelector('main section ul > li');
    expect(text(row?.querySelector('p:last-of-type [data-slot="badge"]'))).toBe('Full');
    expect(text(row)).toContain('Summer 2027 · waitlist open');
  });

  it('renders the no-results state with 200', async () => {
    const { body, responseInit } = await render('/programs?q=pickleball', () =>
      Promise.resolve(NO_RESULTS),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section [role="status"]'))).toBe(
      'No programs match “pickleball”',
    );
    const clear = body.querySelector('main section a');
    expect(text(clear)).toBe('Clear the search');
    expect(new URL(clear?.getAttribute('href') ?? '', ORIGIN).pathname).toBe('/programs');
  });

  it.each([
    ['?q=a&q=b', { q: 'a', withCamps: true }],
    [`?q=${'x'.repeat(300)}`, { q: 'x'.repeat(100), withCamps: true }],
    [
      `?q=${Array.from({ length: 20 }, (_, i) => `w${i + 1}`).join('+')}`,
      { q: Array.from({ length: 16 }, (_, i) => `w${i + 1}`).join(' '), withCamps: true },
    ],
  ])('%s asks %j with 200', async (query, args) => {
    const { responseInit, queries } = await render(`/programs${query}`);
    expect(queries).toEqual([{ name: 'search:programs', args }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
  });

  it('escapes the search in the HTML', async () => {
    const { html, body } = await render('/programs?q=%3Cscript%3Ealert(1)%3C/script%3E');
    expect(html).not.toContain('<script>alert(1)');
    expect(body.querySelector('main script')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the search fails', async () => {
    const { html, body, head, responseInit } = await render('/programs?q=coed&ott=SECRET', () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe('/programs?q=coed');
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
      '/programs?q=coed',
      () => new Promise(() => undefined),
      30,
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });
});

describe('FindPage server render by sport', () => {
  const BY_SPORT = 'search:programsBrowse';
  const answer = (value: unknown) => (name: string) =>
    Promise.resolve(name === ORGANIZATIONS_QUERY ? ORGANIZATIONS : value);
  const youth = browseResults([GIRLS_ROOKIES_ROW, GIRLS_SELECT_ROW]);
  const legends = (body: HTMLElement) => [...body.querySelectorAll('main legend')].map(text);
  const options = (body: HTMLElement, legend: string) => {
    const set = [...body.querySelectorAll('main fieldset')].find(
      (fieldset) => text(fieldset.querySelector('legend')) === legend,
    );
    return [...(set?.querySelectorAll('label') ?? [])].map(text);
  };

  it('renders the leagues of a sport with its filters in the raw HTML, noindex, with the canonical /programs', async () => {
    const { html, body, head, responseInit, queries } = await render(
      '/programs?sport=soccer&age=u10&gender=girls&ott=SECRET&utm_source=CANARYabc',
      answer(youth),
    );
    expect(queries).toEqual([
      {
        name: BY_SPORT,
        args: { sport: 'soccer', withCamps: true, gender: ['womens'], ageGroup: ['u10'], page: 1 },
      },
    ]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'U10 Girls Fall Rec',
      'U10 Girls Select',
    ]);
    expect(body.querySelector('nav[aria-label="Sport"] a[aria-current="page"]')?.textContent).toBe(
      'Soccer',
    );
    expect(
      [...body.querySelectorAll('ul[aria-label="Active filters"] a')].map((a) =>
        text(a).replace(/: remove the .* filter$/, ''),
      ),
    ).toEqual(['Gender: Girls', 'U10']);
    expect(
      text(body.querySelector('main form[aria-label="Filter programs"] [role="status"]')),
    ).toBe('2 of 5 soccer programs');
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex');
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs`,
    );
    expect(text(body.querySelector('main h1'))).toBe('Find a program');
    expect(html).not.toContain('CANARYabc');
    expect(html.replace(/returnTo=[^"]*/g, '')).not.toContain('SECRET');
  });

  it('offers every filter the sport has, before any script, with the U-ages first and Girls under a youth age group', async () => {
    const { body } = await render('/programs?sport=soccer&age=u10', answer(youth));
    expect(legends(body)).toEqual(['Gender', 'Format', 'Level', 'Age group']);
    expect(options(body, 'Format')).toEqual(['6v6', '7v7', '11v11']);
    expect(options(body, 'Age group')).toEqual(['U10', 'Adult', '40+']);
    expect(options(body, 'Gender')).toEqual(['Coed', 'Boys', 'Girls']);
  });

  it('offers Gender and Age group only, with no format or level, for a search with no sport', async () => {
    const { body } = await render(
      '/programs?q=coed',
      answer({ ...COED_RESULTS, facets: youth.facets }),
    );
    expect(legends(body)).toEqual(['Gender', 'Age group']);
  });

  it('submits the search and the sport with the filters, when script is off', async () => {
    const { body } = await render(
      '/programs?q=select&sport=soccer',
      answer({ ...NO_RESULTS, facets: youth.facets }),
    );
    const fields = [
      ...body.querySelectorAll('main form[aria-label="Filter programs"] input[type="hidden"]'),
    ].map((input) => [input.getAttribute('name'), input.getAttribute('value')]);
    expect(fields).toEqual([
      ['q', 'select'],
      ['sport', 'soccer'],
    ]);
  });

  it('is indexable with its own canonical for a sport alone, and for page 2 of it', async () => {
    const { head } = await render('/programs?sport=soccer', answer(youth));
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs?sport=soccer`,
    );
    expect(head.querySelector('title')?.textContent).toBe('Soccer | Find a program | Omni League');
    const second = await render(
      '/programs?sport=soccer&page=2',
      answer(browseResults([GIRLS_ROOKIES_ROW], { page: 2, pageCount: 2, total: 6 })),
    );
    expect(second.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs?sport=soccer&page=2`,
    );
  });

  it('writes no level of another sport into the HTML or the query', async () => {
    const { body, queries } = await render(
      '/programs?sport=softball&level=bb',
      answer(browseResults([], {}, [{ gender: 'coed', playersPerSide: 10, level: 'rec' }])),
    );
    expect(queries).toEqual([
      { name: BY_SPORT, args: { sport: 'softball', withCamps: true, page: 1 } },
    ]);
    expect(body.querySelector('main')!.innerHTML).not.toContain('bb');
  });

  it('renders the server-error view with 503 and no-store when the sport query fails', async () => {
    const { html, body, responseInit } = await render('/programs?sport=soccer&ott=SECRET', () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe('/programs?sport=soccer');
    expect(html).not.toContain('internal-db');
  });
});

@Component({
  selector: 'app-error-states',
  imports: [FindContent, FindOrganizationsList],
  template: `
    <app-find-content query="coed" status="error" [now]="0" retryHref="/programs?q=coed" />
    <app-find-organizations state="error" retryHref="/programs" />
  `,
})
class ErrorStates {}

// The page renders the server-error view when a query fails on the server, so the alerts are rendered here on their own.
describe('FindPage server render by type', () => {
  const SEARCH = 'search:programs';
  const BROWSE = 'search:programsBrowse';
  const answer = (value: unknown) => (name: string) =>
    Promise.resolve(name === ORGANIZATIONS_QUERY ? ORGANIZATIONS : value);
  const mixed = {
    more: false,
    rows: [SUNDAY_4S_ROW, GULF_OPEN_ROW],
    facets: [],
    typeCounts: [
      { type: 'league', count: 1 },
      { type: 'tournament', count: 1 },
    ],
  };
  // The server renders each link against the request's origin.
  const path = (a: Element) => a.getAttribute('href')?.replace(ORIGIN, '');
  const typeChips = (body: HTMLElement) =>
    [...body.querySelectorAll('nav[aria-label="Program type"] a')].map((a) => [
      text(a),
      path(a),
      a.getAttribute('aria-current'),
    ]);

  it('renders a league and a tournament with their badges and the tournament’s dates and status in the raw HTML', async () => {
    const { body, queries } = await render('/programs?q=beach', answer(mixed));
    expect(queries).toEqual([{ name: SEARCH, args: { q: 'beach', withCamps: true } }]);
    const [league, tournament] = [...body.querySelectorAll('main section ul > li')];
    expect(text(league.querySelector('[data-slot="badge"]'))).toBe('League');
    expect(text(tournament.querySelector('[data-slot="badge"]'))).toBe('Tournament');
    expect(text(tournament.querySelector('p:last-of-type [data-slot="badge"]'))).toBe(
      'Registration open',
    );
    expect(text(tournament)).toContain('Jul 10 – Jul 11, 2027 · closes Jul 1');
    expect(path(tournament.querySelector('h3 a')!)).toBe(
      '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open',
    );
    expect(typeChips(body)).toEqual([
      ['All', '/programs?q=beach', 'page'],
      ['Leagues', '/programs?type=league&q=beach', null],
      ['Tournaments', '/programs?type=tournament&q=beach', null],
    ]);
  });

  it('lists the tournaments of a sport by name without a search, indexable with its own canonical', async () => {
    const { body, head, queries, responseInit } = await render(
      '/programs?type=tournament&sport=beach-volleyball&utm_source=CANARYabc',
      answer({
        ...browseResults([GULF_OPEN_ROW]),
        typeCounts: [{ type: 'tournament', count: 1 }],
      }),
    );
    expect(queries).toEqual([
      {
        name: BROWSE,
        args: { type: 'tournament', sport: 'beachVolleyball', withCamps: true, page: 1 },
      },
    ]);
    expect(responseInit.status).toBeUndefined();
    expect([...body.querySelectorAll('main section ul > li h3')].map(text)).toEqual([
      'Gulf Coast Beach Open',
    ]);
    const form = body.querySelector('main form[role="search"]')!;
    expect(
      [...form.querySelectorAll('input[type="hidden"]')].map((input) => [
        input.getAttribute('name'),
        input.getAttribute('value'),
      ]),
    ).toEqual([
      ['type', 'tournament'],
      ['sport', 'beach-volleyball'],
    ]);
    expect(meta(head, 'meta[name="robots"]')).toBeNull();
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs?type=tournament&sport=beach-volleyball`,
    );
    expect(head.querySelector('title')?.textContent).toBe(
      'Beach volleyball tournaments | Find a program | Omni League',
    );
  });

  it('is noindex with the canonical /programs for a search with a type', async () => {
    const { head } = await render('/programs?type=league&q=beach', answer(mixed));
    expect(meta(head, 'meta[name="robots"]')).toBe('noindex');
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs`,
    );
  });

  it('keeps page 2 of a sport in the canonical, from the result', async () => {
    const { head } = await render(
      '/programs?sport=soccer&page=2',
      answer(browseResults([GULF_OPEN_ROW], { page: 2, pageCount: 2, total: 6 })),
    );
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${ORIGIN}/programs?sport=soccer&page=2`,
    );
  });

  it('ignores an unknown type: no argument, no chip, and the value nowhere in the HTML', async () => {
    const { html, body, queries } = await render('/programs?type=zzz&q=beach', answer(mixed));
    expect(queries).toEqual([{ name: SEARCH, args: { q: 'beach', withCamps: true } }]);
    expect(typeChips(body).map(([name]) => name)).toEqual(['All', 'Leagues', 'Tournaments']);
    expect(html).not.toContain('zzz');
  });

  it('renders a camp with its badge, ages, and the next session’s dates and status in the raw HTML', async () => {
    const { body, queries } = await render(
      '/programs?q=junior',
      answer({
        more: false,
        rows: [JUNIOR_CAMP_ROW],
        facets: [],
        typeCounts: [{ type: 'camp', count: 1 }],
      }),
    );
    expect(queries).toEqual([{ name: SEARCH, args: { q: 'junior', withCamps: true } }]);
    const [camp] = [...body.querySelectorAll('main section ul > li')];
    expect(text(camp.querySelector('[data-slot="badge"]'))).toBe('Camp');
    expect(text(camp)).toContain('Ages 9 to 14');
    expect(text(camp.querySelector('p:last-of-type'))).toBe(
      'Registration openJul 5 – Jul 9, 2027 · closes Jul 1',
    );
    expect(path(camp.querySelector('h3 a')!)).toBe(
      '/organizations/gulf-coast-sport-social/camps/junior-beach-volleyball-camp',
    );
    expect(typeChips(body)).toEqual([
      ['All', '/programs?q=junior', 'page'],
      ['Camps', '/programs?type=camp&q=junior', null],
    ]);
  });

  it('shows a type with no program as the current chip with the no-programs state, and answers 200', async () => {
    const { body, responseInit } = await render(
      '/programs?type=camp',
      answer({ ...browseResults([], {}, []), typeCounts: [{ type: 'league', count: 2 }] }),
    );
    expect(responseInit.status).toBeUndefined();
    expect(typeChips(body)).toEqual([
      ['All', '/programs', null],
      ['Leagues', '/programs?type=league', null],
      ['Camps', '/programs?type=camp', 'page'],
    ]);
    expect(text(body.querySelector('main section [role="status"]'))).toBe(
      'No camps are published yet',
    );
  });

  it('says training programs are not listed and names the types that are, and answers 200', async () => {
    const { body, responseInit } = await render(
      '/programs?type=training',
      answer({ ...browseResults([], {}, []), typeCounts: [] }),
    );
    expect(responseInit.status).toBeUndefined();
    expect(text(body.querySelector('main section [role="status"]'))).toBe(
      'Find a program does not list training programs yet',
    );
    expect(text(body.querySelector('main section [role="status"] + p'))).toBe(
      'Search the leagues, tournaments, and camps instead.',
    );
  });
});

describe('the Find error alerts server render', () => {
  async function renderAlerts(): Promise<HTMLElement> {
    const html = await renderApplication(
      (context: BootstrapContext) =>
        bootstrapApplication(
          ErrorStates,
          { providers: [provideServerRendering(), provideRouter([]), provideClientHydration()] },
          context,
        ),
      {
        document:
          '<!doctype html><html><head><base href="/"></head><body><app-error-states></app-error-states></body></html>',
      },
    );
    return new DOMParser().parseFromString(html, 'text/html').body;
  }

  it('writes the slot, role, and classes of each alert as static attributes', async () => {
    const body = await renderAlerts();
    const alerts = [...body.querySelectorAll('[data-slot="alert"]')];
    expect(alerts).toHaveLength(2);
    expectFindAlert(alerts[0]);
    expectFindAlert(alerts[1], 'mt-4');
    expect(slotsOf(alerts[0])).toEqual(['alert', 'alert-title', 'alert-description']);
  });
});
