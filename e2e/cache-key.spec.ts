import { randomUUID } from 'node:crypto';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { numberedSeasons, seedSeasons, seedTenant } from './support/tenant';

/**
 * Paths the edge function answers (server and client routes), one per route kind. Add one for every
 * new server route, with a sample value for each parameter.
 */
const EDGE_PATHS = [
  '/this-page-does-not-exist',
  '/app/x',
  '/app',
  '/organizations/cache-key-sample',
  '/organizations/cache-key-sample/leagues/cache-key-sample',
  '/organizations/cache-key-sample/leagues/cache-key-sample/seasons/cache-key-sample',
  '/sign-up',
  '/sign-in',
];
const STATIC_PATHS = ['/'];

function sharedCacheable(cacheControl: string | undefined): boolean {
  return !!cacheControl && !/\b(?:no-store|private)\b/i.test(cacheControl);
}

const canary = (): string => `ott${randomUUID().replaceAll('-', '')}`;

test.describe('query strings and the CDN', () => {
  test(
    'no response holds the request query string; edge responses vary by query',
    RAW_HTTP,
    async () => {
      for (const path of [...EDGE_PATHS, ...STATIC_PATHS]) {
        const token = canary();
        const response = await rawGet(`${path}?ott=${token}&q=${token}x`);
        expect(response.status, path).toBeLessThan(500);
        expect(response.body, path).not.toContain(token);
        expect(response.headers.location ?? '', path).not.toContain(token);
        // Netlify passes `Netlify-Vary` on to the client.
        if (EDGE_PATHS.includes(path)) {
          expect(response.headers['netlify-vary'], path).toBe('query');
        }
      }
    },
  );

  // On a preview, the first request stores the page, and the next ones with another query string,
  // or none, must not get the first one's value.
  test(
    'a request never gets the body or Location of a request with another query string',
    RAW_HTTP,
    async () => {
      const unique = `/cache-key-${randomUUID()}`;
      const [a, b] = [canary(), canary()];
      for (const path of [
        unique,
        `/app${unique}`,
        `/organizations${unique}`,
        `/organizations${unique}/leagues/sample`,
        `/organizations${unique}/leagues/sample/seasons/sample`,
        `/sign-up`,
        `/sign-in`,
      ]) {
        const first = await rawGet(`${path}?token=${a}`);
        expect(sharedCacheable(first.headers['cache-control']), path).toBe(true);
        await rawGet(`${path}?token=${a}`);
        for (const query of [`?token=${b}`, '']) {
          const later = await rawGet(`${path}${query}`);
          expect(later.status, `${path}${query}`).toBe(first.status);
          expect(later.body, `${path}${query}`).not.toContain(a);
        }
      }

      const redirect = `/${unique}/x`;
      const first = await rawGet(`${redirect}?token=${a}`);
      expect(first.status).toBe(301);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.location).toBe(`${unique}/x?token=${a}`);
      for (const query of [`?token=${b}`, '']) {
        const later = await rawGet(`${redirect}${query}`);
        expect(later.status, query).toBe(301);
        expect(later.location, query).toBe(`${unique}/x${query}`);
      }

      // The router normalizes `/x//` to `/x/`, and the engine redirects there.
      const normalized = `${unique}//`;
      for (const query of [`?token=${a}`, `?token=${a}`, `?token=${b}`, '']) {
        const response = await rawGet(`${normalized}${query}`);
        expect(response.status, query).toBe(302);
        expect(response.headers['cache-control'], query).toBe('no-store');
        expect(response.location, query).toBe(`${unique}/${query}`);
      }
    },
  );

  // The public league page reads `?page=N`, the one query parameter whose value the HTML may hold
  // (as an integer from the query result). Nothing else of the query string may: not the canary in
  // `?page=<canary>` (which reads as page 1), nor one beside a valid `page`.
  test(
    'the league page: ?page=<canary> and ?page=2&page=<canary> read as page 1 and never reach the response',
    RAW_HTTP,
    async () => {
      // On a preview the demo league has the published seasons `seed:demo` gives it; locally the
      // test seeds a league with 7.
      let path = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';
      if (remoteBaseUrl === undefined) {
        const tenant = await seedTenant({
          name: 'E2E Cache Key League',
          locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
          leagues: [
            { name: 'Cache Key League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
          ],
        });
        await seedSeasons(tenant, 'cache-key-league', numberedSeasons(7));
        path = `${tenant.path}/leagues/cache-key-league`;
      }
      const first = await rawGet(path);
      expect(first.status).toBe(200);
      expect(first.headers['netlify-vary']).toBe('query');
      expect(sharedCacheable(first.headers['cache-control'])).toBe(true);

      for (const sample of [(c: string) => `?page=${c}`, (c: string) => `?page=2&page=${c}`]) {
        const token = canary();
        const response = await rawGet(`${path}${sample(token)}`);
        expect(response.status, sample(token)).toBe(200);
        expect(response.body, sample(token)).not.toContain(token);
        expect(JSON.stringify(response.headers), sample(token)).not.toContain(token);
        expect(response.headers.location, sample(token)).toBeUndefined();
        expect(response.headers['netlify-vary'], sample(token)).toBe('query');
        const names = (body: string) =>
          [...body.matchAll(/<h3\b[^>]*>\s*(?:<a\b[^>]*>)?([^<]*)/g)].map(([, name]) =>
            name.trim(),
          );
        expect(names(response.body), sample(token)).toEqual(names(first.body));
      }
    },
  );

  // Locally only: a preview needs a league with more than 5 published seasons.
  test(
    'a request for one page never gets the body of a request for another',
    RAW_HTTP,
    async () => {
      test.skip(
        remoteBaseUrl !== undefined,
        'E2E_BASE_URL is set: no local Convex backend to seed',
      );
      const tenant = await seedTenant({
        name: 'E2E Cache Key Pages',
        locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
        leagues: [{ name: 'Pages League', sport: 'beachVolleyball', locations: ['Alpha Field'] }],
      });
      await seedSeasons(tenant, 'pages-league', numberedSeasons(12));
      const path = `${tenant.path}/leagues/pages-league`;
      const names = (body: string) =>
        [...body.matchAll(/<h3\b[^>]*>\s*(?:<a\b[^>]*>)?([^<]*)/g)].map(([, name]) => name.trim());
      const expected: Record<string, string[]> = {
        '?page=2': ['Season 07', 'Season 06', 'Season 05', 'Season 04', 'Season 03'],
        '?page=3': ['Season 02', 'Season 01'],
        '?page=2&page=3': ['Season 12', 'Season 11', 'Season 10', 'Season 09', 'Season 08'],
        '': ['Season 12', 'Season 11', 'Season 10', 'Season 09', 'Season 08'],
      };
      // Store the page-2 response first, then ask for the others: none gets page 2's rows.
      for (const query of ['?page=2', '?page=2', '?page=3', '?page=2&page=3', '', '?page=2']) {
        const response = await rawGet(`${path}${query}`);
        expect(response.status, query).toBe(200);
        expect(names(response.body), query).toEqual(expected[query]);
      }
    },
  );

  test(
    'the season page: no query string value reaches the response, and every query string gets the same page',
    RAW_HTTP,
    async () => {
      // On a preview the demo league has the published season `summer-2027`; locally the test seeds
      // one.
      let path =
        '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/summer-2027';
      if (remoteBaseUrl === undefined) {
        const tenant = await seedTenant({
          name: 'E2E Cache Key Season',
          locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
          leagues: [
            { name: 'Cache Key League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
          ],
        });
        await seedSeasons(tenant, 'cache-key-league', numberedSeasons(1));
        path = `${tenant.path}/leagues/cache-key-league/seasons/season-01`;
      }
      const first = await rawGet(path);
      expect(first.status).toBe(200);
      expect(first.headers['netlify-vary']).toBe('query');
      expect(sharedCacheable(first.headers['cache-control'])).toBe(true);

      for (const sample of [
        (c: string) => `?ott=${c}`,
        (c: string) => `?page=2&q=${c}`,
        (c: string) => `?seasonSlug=${c}`,
      ]) {
        const token = canary();
        const response = await rawGet(`${path}${sample(token)}`);
        expect(response.status, sample(token)).toBe(200);
        expect(response.body, sample(token)).not.toContain(token);
        expect(JSON.stringify(response.headers), sample(token)).not.toContain(token);
        expect(response.headers.location, sample(token)).toBeUndefined();
        expect(response.headers['netlify-vary'], sample(token)).toBe('query');
        const h1 = (body: string) => /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body)?.[1]?.trim();
        expect(h1(response.body), sample(token)).toBe(h1(first.body));
      }
    },
  );
});
