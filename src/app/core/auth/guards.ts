import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { afterAuthUrl } from './return-to';

/** Where a signed-out visitor goes to get an account (#63 changes it to `/sign-in`). */
export const SIGN_IN_PATH = '/sign-up';

/**
 * Signed-in routes (`/app`): a signed-out visitor goes to sign-up with `returnTo` set to the page
 * they asked for. These routes are `RenderMode.Client`, so this never runs on the server.
 */
export const requireSignedIn: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  if (await inject(AuthService).isSignedIn()) return true;
  return router.createUrlTree([SIGN_IN_PATH], { queryParams: { returnTo: state.url } });
};

/**
 * `/sign-up` (and `/sign-in`, #63): a visitor who is already signed in goes straight to the
 * validated `returnTo`, else `/app` (#96 approval).
 */
export const redirectSignedIn: CanActivateFn = async (route) => {
  const router = inject(Router);
  if (!(await inject(AuthService).isSignedIn())) return true;
  return router.parseUrl(afterAuthUrl(route.queryParamMap.get('returnTo')));
};
