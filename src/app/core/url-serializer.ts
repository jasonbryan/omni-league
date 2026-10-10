import { DefaultUrlSerializer, type UrlTree } from '@angular/router';

/**
 * The router's rule for a query string it cannot decode (`?q=%`, `?q=%E0%A4%A`), shared by the
 * server handler (`src/server.ts`) and the router in the server render and the browser
 * (`src/app/app.config.ts`), so all three read a URL the same way (#91, PR #105). The router
 * reads an undecodable fragment (`#%`) the same way (#116).
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
 * The default serializer, except that a URL whose query string or fragment the router cannot
 * decode is read without it (`/organizations/acme?ref=%` as `/organizations/acme`, `/x#%` as `/x`;
 * a decodable one next to it is kept). The default one throws `URIError`, and the router then
 * warns NG04018 and navigates to `/`, so a visitor who follows a truncated link would land on the
 * home page after hydration. The server never sees a fragment. A path the router cannot read
 * (`/%`, `/a(b`) still throws.
 */
export class QueryTolerantUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    try {
      return super.parse(url);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      const { path, search, fragment } = splitUrl(url);
      const dropQuery = hasUndecodableQuery(search);
      const dropFragment = hasUndecodableFragment(fragment);
      if (!dropQuery && !dropFragment) throw error;
      return super.parse(path + (dropQuery ? '' : search) + (dropFragment ? '' : fragment));
    }
  }
}

/** True when the router cannot percent-decode `fragment` (`#%`, `''` for none). */
function hasUndecodableFragment(fragment: string): boolean {
  if (fragment === '') return false;
  try {
    decodeURIComponent(fragment.slice(1));
    return false;
  } catch (error) {
    return error instanceof URIError;
  }
}

/**
 * `url` split into its path, its query string with its `?`, and its fragment with its `#`; the
 * last two are `''` when absent. A `?` after the `#` belongs to the fragment.
 */
function splitUrl(url: string): { path: string; search: string; fragment: string } {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const fragment = hash === -1 ? '' : url.slice(hash);
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  if (query === -1 || (hash !== -1 && hash < query)) {
    return { path: beforeHash, search: '', fragment };
  }
  return { path: url.slice(0, query), search: url.slice(query, beforeHash.length), fragment };
}
