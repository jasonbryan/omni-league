import { DefaultUrlSerializer, type UrlTree } from '@angular/router';

/**
 * The router's rule for a query string it cannot decode (`?q=%`, `?q=%E0%A4%A`), shared by the
 * server handler (`src/server.ts`) and the router in the server render and the browser
 * (`src/app/app.config.ts`), so all three read a URL the same way (#91, PR #105).
 *
 * Web-API-only: the Netlify edge function bundles it through `src/server-unroutable.ts`.
 */

const serializer = new DefaultUrlSerializer();

/**
 * True when the router cannot percent-decode the query string `search` (`?q=%`, `?%`). Checked on
 * its own, after the path `/`: the router stops parsing a path at `//` and never reads the query
 * string after it, so `/x//?q=%` parses, while the router in the browser reads it as `/x/?q=%`
 * (Angular's `Location` drops one trailing slash) and cannot decode it.
 */
export function hasUndecodableQuery(search: string): boolean {
  if (search === '' || search === '?') return false;
  try {
    serializer.parse(`/${search}`);
    return false;
  } catch (error) {
    return error instanceof URIError;
  }
}

/**
 * The default serializer, except that a URL whose query string the router cannot decode is read
 * without that query string (`/organizations/acme?ref=%` as `/organizations/acme`). The default
 * one throws `URIError`, and the router then warns NG04018 and navigates to `/`, so a visitor who
 * follows a truncated link would land on the home page after hydration. A path the router cannot
 * read (`/%`, `/a(b`) still throws.
 */
export class QueryTolerantUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    try {
      return super.parse(url);
    } catch (error) {
      const { bare, search } = splitQuery(url);
      if (error instanceof URIError && hasUndecodableQuery(search)) return super.parse(bare);
      throw error;
    }
  }
}

/** `url` without its query string (the fragment kept), and that query string with its `?`. */
function splitQuery(url: string): { bare: string; search: string } {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  if (query === -1 || (hash !== -1 && hash < query)) return { bare: url, search: '' };
  const end = hash === -1 ? url.length : hash;
  return { bare: url.slice(0, query) + url.slice(end), search: url.slice(query, end) };
}
