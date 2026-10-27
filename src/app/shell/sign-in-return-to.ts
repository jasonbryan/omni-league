import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, computed, inject, type Signal } from '@angular/core';
import { PRIMARY_OUTLET, Router } from '@angular/router';
import { returnToOrApp, safeReturnTo } from '../core/auth/return-to';
import { injectCurrentUrl } from './current-url';

/**
 * The `returnTo` of a "Sign in" link: the page the visitor is on, so signing in brings them back to it. It is `null` on `/sign-in`, which needs no such link.
 * On `/sign-up` it is that page's own `returnTo` (`/app` when it has none or it is not valid), because the page the visitor came from is not this one.
 * A server render leaves the query string and fragment out: Netlify's CDN may store the HTML, and the browser adds them after hydration.
 */
export function injectSignInReturnTo(): Signal<string | null> {
  const router = inject(Router);
  const url = injectCurrentUrl();
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  return computed(() => {
    const tree = router.parseUrl(url());
    const path = (tree.root.children[PRIMARY_OUTLET]?.segments ?? []).map((s) => s.path).join('/');
    if (path === 'sign-in') return null;
    if (path === 'sign-up') {
      const own: unknown = tree.queryParams['returnTo'];
      return returnToOrApp(typeof own === 'string' ? own : null);
    }
    if (onServer) {
      tree.queryParams = {};
      tree.fragment = null;
    }
    return safeReturnTo(router.serializeUrl(tree));
  });
}
