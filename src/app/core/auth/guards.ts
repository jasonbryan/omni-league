import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { returnToOrApp } from './return-to';

export const SIGN_IN_PATH = '/sign-in';

export const requireSignedIn: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  if (await inject(AuthService).isSignedIn()) return true;
  return router.createUrlTree([SIGN_IN_PATH], { queryParams: { returnTo: state.url } });
};

export const redirectSignedIn: CanActivateFn = async (route) => {
  const router = inject(Router);
  if (!(await inject(AuthService).isSignedIn())) return true;
  return router.parseUrl(returnToOrApp(route.queryParamMap.get('returnTo')));
};
