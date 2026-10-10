// No visitor gets another visitor's query string from a shared cache (PR #90). Netlify's CDN may
// store a server response whose Cache-Control allows it, and on PR #90's preview it keyed stored
// edge-function responses by the path alone. A query string can carry a one-time token (ADR 0008),
// so (Angular conventions, Rendering, "Query strings and the CDN"):
// - server HTML never contains the request's query string;
// - every edge-function response sends `Netlify-Vary: query` (src/server-cache.ts);
// - every response with a Location is `no-store` (it can copy the query string).
// Add a sample path here for every new server route, with a sample value for each parameter.
import { randomUUID } from 'node:crypto';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';

/** Paths the edge function answers (server and client routes), one per route kind. */
const EDGE_PATHS = [
  '/this-page-does-not-exist',
  '/app/x',
  '/app',
  '/organizations/cache-key-sample',
];
/** Prerendered pages: static files, the same bytes for every request. */
const STATIC_PATHS = ['/'];

/** True when a shared cache may store a response with this Cache-Control. */
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
        // Netlify passes `Netlify-Vary` on to the client (seen on PR #90's preview).
        if (EDGE_PATHS.includes(path)) {
          expect(response.headers['netlify-vary'], path).toBe('query');
        }
      }
    },
  );

  // On a preview this is the PR #90 reproduction: the first request stores the page, and the
  // next ones with another query string, or none, must not get the first one's value.
  test(
    'a request never gets the body or Location of a request with another query string',
    RAW_HTTP,
    async () => {
      const unique = `/cache-key-${randomUUID()}`;
      const [a, b] = [canary(), canary()];
      for (const path of [unique, `/app${unique}`, `/organizations${unique}`]) {
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

      // The router normalizes `/x//` to `/x/`, and the engine redirects there (PR #90, round 2).
      const normalized = `${unique}//`;
      for (const query of [`?token=${a}`, `?token=${a}`, `?token=${b}`, '']) {
        const response = await rawGet(`${normalized}${query}`);
        expect(response.status, query).toBe(302);
        expect(response.headers['cache-control'], query).toBe('no-store');
        expect(response.location, query).toBe(`${unique}/${query}`);
      }
    },
  );
});
