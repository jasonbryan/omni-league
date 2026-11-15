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
import { spacedText } from '../public-tournament/testing/spaced-text';
import { at, CAMP_ARGS, CAMP_PATH, JUNIOR_CAMP, campQueryResults } from './testing/camp-data';

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('2027-06-01'));
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
  (camp = JUNIOR_CAMP as typeof JUNIOR_CAMP | null) =>
  (name: string) =>
    Promise.resolve(campQueryResults(camp)[name]);

describe('PublicCampPage server render', () => {
  it('renders the page, meta, and details from the query, with no query string anywhere', async () => {
    const { html, body, head, responseInit, queries } = await render(
      `${CAMP_PATH}?ott=SECRET&x=1`,
      answer(),
    );

    expect(queries).toEqual([{ name: 'camps:getPublicPage', args: CAMP_ARGS }]);
    expect(responseInit.status).toBeUndefined();
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);

    const title = 'Junior Beach Volleyball Camp | Gulf Coast Sport & Social | Omni League';
    expect(head.querySelector('title')?.textContent).toBe(title);
    expect(meta(head, 'og:title')).toBe(title);
    expect(meta(head, 'og:type')).toBe('website');
    expect(meta(head, 'og:description')).toBe(
      'Beach volleyball · Ages 9 to 14. 3 sessions, Jul 5 – Jul 23, 2027.',
    );
    expect(meta(head, 'og:url')).toBe(`${ORIGIN}${CAMP_PATH}`);
    const canonicals = head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].getAttribute('href')).toBe(`${ORIGIN}${CAMP_PATH}`);

    expect(text(body.querySelector('main h1'))).toBe('Junior Beach Volleyball Camp');
    expect(
      [...body.querySelectorAll('main nav[aria-label="Breadcrumb"] a')].map((a) => href(a)),
    ).toEqual(['/organizations/gulf-coast-sport-social']);
    expect([...body.querySelectorAll('main dl > div')].map((row) => text(row))).toEqual([
      'Age range Ages 9 to 14',
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

  it('writes the h1, the ages, each session with its places left, and then the details into the raw HTML', async () => {
    const { html, body } = await render(CAMP_PATH, answer());
    const sessions = [...body.querySelectorAll('main #sessions li')].map((row) => spacedText(row));
    expect(sessions).toEqual([
      'Week 1 Registration open Jul 5 – Jul 9, 2027 9 AM to 12 PM 15 places left Registration closes Jul 1, 2027 Register for Week 1',
      'Week 2 Registration open Jul 12 – Jul 16, 2027 9 AM to 12 PM 1 place left Registration closes Jul 8, 2027 Register for Week 2',
      'Week 3 Jul 19 – Jul 23, 2027 Full Registration closes Jul 15, 2027',
    ]);
    const markup = html.slice(html.indexOf('<body'));
    const order = [
      '<h1',
      'Ages 9 to 14',
      'id="sessions"',
      'Week 1',
      '15 places left',
      'Week 3',
      'Full',
      'id="details-heading"',
      '3500 Sandcourt Ln',
    ].map((marker) => markup.indexOf(marker));
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text(body.querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('puts the sessions card’s slot, size, and classes in the raw HTML as static attributes', async () => {
    const { body } = await render(CAMP_PATH, answer());
    const cards = body.querySelectorAll('main #sessions [data-slot="card"]');
    expect(cards).toHaveLength(1);
    expectBareCard(cards[0], 'overflow-hidden');
  });

  it('renders a session whose deadline has passed as Registration closed', async () => {
    vi.setSystemTime(at('2027-07-02'));
    const { body } = await render(CAMP_PATH, answer());
    const first = body.querySelector('main #sessions li');
    expect(spacedText(first)).toContain('Registration closed');
    expect(spacedText(first)).not.toContain('Registration open');
  });

  it('writes one description tag that matches og:description', async () => {
    const { head } = await render(CAMP_PATH, answer());
    expect(
      [...head.querySelectorAll('meta[name="description"]')].map((tag) =>
        tag.getAttribute('content'),
      ),
    ).toEqual([meta(head, 'og:description')]);
  });

  it('writes the same dates whatever the server’s time zone: from the stored text, not an instant', async () => {
    const { body } = await render(
      CAMP_PATH,
      answer({
        ...JUNIOR_CAMP,
        sessions: [{ ...JUNIOR_CAMP.sessions[0], startDate: '2027-01-01', endDate: '2027-01-02' }],
      }),
    );
    expect(spacedText(body.querySelector('main #sessions li'))).toContain('Jan 1 – Jan 2, 2027');
  });

  it('renders the not-found view in the public layout with status 404 and the public Cache-Control for a null camp', async () => {
    const { body, head, responseInit } = await render(CAMP_PATH, answer(null));
    expect(responseInit.status).toBe(404);
    expect(responseInit.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(text(body.querySelector('main h1'))).toBe('Page not found');
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(head.querySelector('title')?.textContent).toBe('Page not found | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it('renders the server-error view with 503 and Cache-Control: no-store when the query fails', async () => {
    const { html, body, head, responseInit } = await render(`${CAMP_PATH}?ott=SECRET`, () =>
      Promise.reject(new Error(CONNECTION_REFUSED)),
    );
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(responseInit.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
    expect(body.querySelector('main a')?.getAttribute('href')).toBe(CAMP_PATH);
    expect(publicFrame(body)).toEqual(PUBLIC_FRAME);
    expect(head.querySelector('title')?.textContent).toBe('Temporarily unavailable | Omni League');
    expect(head.querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
    expect(html).not.toContain('internal-db');
    expect(html).not.toContain('SECRET');
  });

  it('renders the server-error view with 503 and no-store when the query times out', async () => {
    const { body, responseInit } = await render(CAMP_PATH, () => new Promise(() => undefined), 30);
    expect(responseInit.status).toBe(503);
    expect(responseInit.headers.get('Cache-Control')).toBe('no-store');
    expect(text(body.querySelector('main h1'))).toBe(SERVER_ERROR);
  });
});
