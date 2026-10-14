import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { InviteTokenStore } from './invite-token-store';

export const ACCEPT_INVITE_PATH = '/invites/accept';

/**
 * Moves the fragment into `sessionStorage` and redirects to the same path with no fragment, before the page or the shell exists,
 * so the router's URL, the address bar, the top bar's sign-in `returnTo`, and every later request carry no token.
 * A query string is dropped the same way and never read as a token: a token in a query string would reach a server log.
 */
export const captureInviteToken: CanActivateFn = (route) => {
  const hasFragment = route.fragment !== null;
  const hasQuery = Object.keys(route.queryParams).length > 0;
  if (!hasFragment && !hasQuery) return true;
  const store = inject(InviteTokenStore);
  if (hasFragment) store.save(route.fragment ?? '');
  return inject(Router).createUrlTree([ACCEPT_INVITE_PATH]);
};
