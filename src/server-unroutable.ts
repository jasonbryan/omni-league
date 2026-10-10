import { DefaultUrlSerializer, PRIMARY_OUTLET, type UrlSegmentGroup } from '@angular/router';

/**
 * Paths the router can never render (#23, PR #90). Their pathname has one leading slash, so
 * `src/server-redirect.ts` lets them through, but the router reads them as one of:
 * - a URL whose own form starts with `//`: `/(//evil.com)` is an empty first segment, which the
 *   router writes as `//evil.com`. Angular then throws NG05702 (a protocol-relative URL);
 * - a route for a named outlet (`/(a:b)`, `/x/(a:b//c:d)`). The app has no named
 *   `<router-outlet>` (`src/server.spec.ts` fails when a route names one), so none can match;
 * - a URL it cannot parse (`/a(b`, `/a(?q=1`). The router warns NG04018 and renders `/` with
 *   status 200;
 * - an empty URL for a path that is not `/` (`/(`, `/()x`, `/()`, #91). The router parses each of
 *   these to `/` without a warning, and the engine renders the home page with status 200 and the
 *   public `Cache-Control`.
 *
 * Angular logs most such requests, the first with a stack, so a crawler could fill the
 * edge-function log, and the CDN would store the home page under each of the others. The handler
 * answers them with the plain 404 before the engine runs.
 *
 * A query string the router cannot decode (`?q=%`) is not a reason for the 404: the engine renders
 * the same path without it (`hasUndecodableQuery`, #91).
 *
 * Web-API-only: bundled into the Netlify edge function (ESLint enforces it for `src/server*.ts`).
 */

const serializer = new DefaultUrlSerializer();

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
  } catch (error) {
    // Malformed percent-encoding in the query string (`?q=%`): the path alone decides here, and
    // the engine renders a routable path without the query string (`hasUndecodableQuery`, #91).
    return search && error instanceof URIError ? isUnroutable(path, '') : true;
  }
  const serialized = serializer.serialize(tree);
  return /^[/\\]{2}/.test(serialized) || hasNamedOutlet(tree.root) || readsAsRoot(path, serialized);
}

/** True when the router reads a path other than `/` as `/` (`/(`, `/()x`, `/()`, `/(/`). */
function readsAsRoot(path: string, serialized: string): boolean {
  return path !== '' && path !== '/' && serialized.split(/[?#]/, 1)[0] === '/';
}

/**
 * True when the router cannot decode the query string of a URL whose path it can parse (`/x?q=%`,
 * `/?%`, `/o/acme?q=%E0%A4%A`). The router would warn NG04018 and render `/` whatever the path
 * was. Call it after `isMalformedPath` and `isUnroutablePath`, so the only `URIError` left is the
 * query string's (#91).
 */
export function hasUndecodableQuery(pathname: string, search: string): boolean {
  if (search === '') return false;
  try {
    serializer.parse(pathname + search);
    return false;
  } catch (error) {
    return error instanceof URIError;
  }
}
