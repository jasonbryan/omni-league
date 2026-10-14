import { PRIMARY_OUTLET, type UrlSegmentGroup } from '@angular/router';
import { QueryTolerantUrlSerializer } from './app/core/url-serializer';

/**
 * Their pathname has one leading slash, so `src/server-redirect.ts` lets them through, but the router reads them as `//evil.com` (`/(//evil.com)`, which Angular rejects with NG05702),
 * as a named outlet (`/(a:b)`; the app has none), as unparseable (`/a(b`; the router warns NG04018 and renders `/` with status 200), or as `/` for a path that is not `/` (`/(`, `/()x`).
 * Angular logs most such requests, so a crawler could fill the edge-function log, and the CDN would store the home page under each. The handler answers them with the plain 404 before the engine runs.
 * A query string the router cannot decode is not a reason: the engine renders the path without it, and the path is checked with the app router's serializer (`QueryTolerantUrlSerializer` in `src/app/core/url-serializer.ts`).
 * Web-API-only: bundled into the Netlify edge function (ESLint enforces it for `src/server*.ts`).
 */

const serializer = new QueryTolerantUrlSerializer();

function hasNamedOutlet(group: UrlSegmentGroup): boolean {
  return Object.entries(group.children).some(
    ([outlet, child]) => outlet !== PRIMARY_OUTLET || hasNamedOutlet(child),
  );
}

/**
 * True when the router cannot parse the URL's `pathname` followed by its `search` (the router
 * parses both together, so `/a(?q=1` fails where `/a(` does not), or would read it as a URL
 * starting with `//`, as a route for a named outlet, or as `/` for a path that is not `/`.
 */
export function isUnroutablePath(pathname: string, search = ''): boolean {
  // Angular's `Location` drops one trailing slash before the router parses the path, so `/(x/`
  // reaches the router as `/(x` (NG04018) and `/(///` as `/(//` (NG05701). Both forms are checked.
  return [pathname, pathname.replace(/\/$/, '')].some((path) => isUnroutable(path, search));
}

function isUnroutable(path: string, search: string): boolean {
  let tree;
  try {
    tree = serializer.parse(path + search);
  } catch {
    return true;
  }
  const serialized = serializer.serialize(tree);
  return /^[/\\]{2}/.test(serialized) || hasNamedOutlet(tree.root) || readsAsRoot(path, serialized);
}

function readsAsRoot(path: string, serialized: string): boolean {
  return path !== '' && path !== '/' && serialized.split(/[?#]/, 1)[0] === '/';
}
