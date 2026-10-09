import { DefaultUrlSerializer, PRIMARY_OUTLET, type UrlSegmentGroup } from '@angular/router';

/**
 * Paths the router can never render (#23, PR #90). Their pathname has one leading slash, so
 * `src/server-redirect.ts` lets them through, but the router reads them as one of:
 * - a URL whose own form starts with `//`: `/(//evil.com)` is an empty first segment, which the
 *   router writes as `//evil.com`. Angular then throws NG05702 (a protocol-relative URL);
 * - a route for a named outlet (`/(a:b)`, `/x/(a:b//c:d)`). The app has no named
 *   `<router-outlet>` (`src/server.spec.ts` fails when a route names one), so none can match;
 * - a URL it cannot parse (`/a(b`, `/a(?q=1`). The router warns NG04018 and renders `/` with
 *   status 200.
 *
 * Angular logs each such request, the first with a stack, so a crawler could fill the
 * edge-function log. The handler answers them with the plain 404 before the engine runs.
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
 * starting with `//` or as a route for a named outlet.
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
    // Malformed percent-encoding in the query string (`?q=%`) stays the engine's to answer, as
    // before PR #90's round 3 (`src/server.spec.ts`, "an engine URIError").
    return search && error instanceof URIError ? isUnroutable(path, '') : true;
  }
  return /^[/\\]{2}/.test(serializer.serialize(tree)) || hasNamedOutlet(tree.root);
}
