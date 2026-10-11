import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { returnToOrApp } from './return-to';

/** Where a signed-out visitor goes to sign in (#63; before it, to `/sign-up`). */
export const SIGN_IN_PATH = '/sign-in';

/**
 * Signed-in routes (`/app`): a signed-out visitor goes to sign-in with `returnTo` set to the page
 * they asked for. These routes are `RenderMode.Client`, so this never runs on the server.
 */
export const requireSignedIn: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  if (await inject(AuthService).isSignedIn()) return true;
  return router.createUrlTree([SIGN_IN_PATH], { queryParams: { returnTo: state.url } });
};

/**
 * `/sign-up` and `/sign-in`: a visitor who is already signed in goes straight to the valid
 * `returnTo`, else `/app` (#96 approval; an unsafe `returnTo` also goes to `/app`).
 */
export const redirectSignedIn: CanActivateFn = async (route) => {
  const router = inject(Router);
  if (!(await inject(AuthService).isSignedIn())) return true;
  return router.parseUrl(returnToOrApp(route.queryParamMap.get('returnTo')));
};
