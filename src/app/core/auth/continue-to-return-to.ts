import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { returnToOrApp } from './return-to';

export interface ContinueToReturnTo {
  go(): Promise<void>;
  underway(): boolean;
}

/** The form's success and a session check that confirms the stored session can both arrive, and only the first may navigate. */
export function injectContinueToReturnTo(): ContinueToReturnTo {
  const router = inject(Router);
  const returnTo = inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo');
  const auth = inject(AuthService);
  let underway = false;
  const go = async (): Promise<void> => {
    if (underway) return;
    underway = true;
    // The router's navigation error handler reports a failure; the page only lets the form try again.
    const navigated = await router
      .navigateByUrl(returnToOrApp(returnTo), { replaceUrl: true })
      .catch(() => false);
    if (!navigated) underway = false;
  };
  auth.signedInByCheck.pipe(takeUntilDestroyed()).subscribe(() => void go());
  // A check can confirm after the guard let the page through but before the page file loaded.
  if (auth.signedIn()) void go();
  return { go, underway: () => underway };
}
