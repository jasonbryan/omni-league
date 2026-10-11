import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { InviteTokenStore } from './invite-token-store';

/** The invite page's path (#70). It is also the `returnTo` that sign-up and sign-in carry. */
export const ACCEPT_INVITE_PATH = '/invites/accept';

/**
 * The guard of `/invites/accept` (#70): the link is `/invites/accept#<token>`, and this moves the
 * fragment into `sessionStorage` and redirects to the same path with no fragment, before the page
 * or the shell exists. So the router's URL, the address bar, the top bar's sign-in `returnTo`, and
 * every later request carry no token. The redirect replaces the history entry (the first
 * navigation of a page load does). A query string is dropped the same way and is never read as a
 * token: a token in a query string would reach a server log. The route is `RenderMode.Client`, so
 * this runs in the browser only.
 */
export const captureInviteToken: CanActivateFn = (route) => {
  const hasFragment = route.fragment !== null;
  const hasQuery = Object.keys(route.queryParams).length > 0;
  if (!hasFragment && !hasQuery) return true;
  const store = inject(InviteTokenStore);
  if (hasFragment) store.save(route.fragment ?? '');
  return inject(Router).createUrlTree([ACCEPT_INVITE_PATH]);
};
