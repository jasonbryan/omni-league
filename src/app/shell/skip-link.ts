import type { Router } from '@angular/router';

/**
 * A bare `#main` would resolve to `/#main` because of `<base href="/">`. The router's URL is the source, not `location`, and leading slashes and backslashes collapse to one,
 * since a browser reads them as the start of another host and the serializer is not trusted to avoid them. With `withQuery` false the query string is dropped:
 * Netlify's CDN may store the HTML of a public page, and a query string can carry a one-time token.
 */
export function skipLinkHref(router: Router, url: string, withQuery = true): string {
  const tree = router.parseUrl(url);
  tree.fragment = 'main';
  if (!withQuery) tree.queryParams = {};
  return router.serializeUrl(tree).replace(/^[/\\]+/, '/');
}
