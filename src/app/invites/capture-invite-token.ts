import { inject, type Type } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import {
  InviteTokenStore,
  type SessionTokenStore,
  TeamInviteTokenStore,
} from './invite-token-store';

export const ACCEPT_INVITE_PATH = '/invites/accept';
export const JOIN_TEAM_PATH = '/teams/join';

/**
 * Moves the fragment into the store's `sessionStorage` key and redirects to the same path with no fragment, before the page or the shell exists,
 * so the router's URL, the address bar, the top bar's sign-in `returnTo`, and every later request carry no token.
 * A query string is dropped the same way and never read as a token: a token in a query string would reach a server log.
 */
function captureTokenInto(store: Type<SessionTokenStore>, path: string): CanActivateFn {
  return (route) => {
    const hasFragment = route.fragment !== null;
    const hasQuery = Object.keys(route.queryParams).length > 0;
    if (!hasFragment && !hasQuery) return true;
    if (hasFragment) inject(store).save(route.fragment ?? '');
    return inject(Router).createUrlTree([path]);
  };
}

export const captureInviteToken = captureTokenInto(InviteTokenStore, ACCEPT_INVITE_PATH);

export const captureTeamInviteToken = captureTokenInto(TeamInviteTokenStore, JOIN_TEAM_PATH);
