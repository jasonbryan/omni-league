import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, computed, inject, type Signal } from '@angular/core';
import { PRIMARY_OUTLET, Router } from '@angular/router';
import { returnToOrApp, safeReturnTo } from '../core/auth/return-to';
import { injectCurrentUrl } from './current-url';

export interface SignInReturnTo {
  returnTo: string;
  /** The top bar shows no Sign in link there. */
  onSignInPage: boolean;
}

/**
 * On `/sign-up` and `/sign-in` the page the visitor came from is that page's own `returnTo`, not the page itself.
 * A server render leaves the query string and fragment out: Netlify's CDN may store the HTML, and the browser adds them after hydration.
 */
export function injectSignInReturnTo(): Signal<SignInReturnTo> {
  const router = inject(Router);
  const url = injectCurrentUrl();
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  return computed(() => {
    const tree = router.parseUrl(url());
    const path = (tree.root.children[PRIMARY_OUTLET]?.segments ?? []).map((s) => s.path).join('/');
    const onSignInPage = path === 'sign-in';
    if (onSignInPage || path === 'sign-up') {
      const own: unknown = tree.queryParams['returnTo'];
      return { onSignInPage, returnTo: returnToOrApp(typeof own === 'string' ? own : null) };
    }
    if (onServer) {
      tree.queryParams = {};
      tree.fragment = null;
    }
    return { onSignInPage, returnTo: safeReturnTo(router.serializeUrl(tree)) };
  });
}
