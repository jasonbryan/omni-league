import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

/** Loaded when `/leagues` is opened, so the redirect's parsing stays out of the initial bundle. */
export const redirectLeagues: CanActivateFn = async (route) => {
  const router = inject(Router);
  const { programsLocation } = await import('./programs-location');
  return router.parseUrl(programsLocation(route.queryParamMap));
};
