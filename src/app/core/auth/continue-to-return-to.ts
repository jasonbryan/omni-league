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
  let underway = false;
  const go = async (): Promise<void> => {
    if (underway) return;
    underway = true;
    await router.navigateByUrl(returnToOrApp(returnTo), { replaceUrl: true });
  };
  inject(AuthService)
    .signedInByCheck.pipe(takeUntilDestroyed())
    .subscribe(() => void go());
  return { go, underway: () => underway };
}
