import { DOCUMENT } from '@angular/common';
import { DestroyRef, afterNextRender, inject, signal, type Signal } from '@angular/core';
import { msUntilUtcMinus12DateChange } from '../../../convex/lib/registration';

export function injectNow(): Signal<number> {
  const now = signal(Date.now());
  const destroyRef = inject(DestroyRef);
  const document = inject(DOCUMENT);
  // Started after render, so a server render leaves no timer pending.
  afterNextRender(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const renew = () => {
      clearTimeout(timer);
      const current = Date.now();
      now.set(current);
      timer = setTimeout(renew, msUntilUtcMinus12DateChange(current));
    };
    // A device that slept through the date change fires the timer late, and a background tab may be throttled.
    const renewWhenVisible = () => {
      if (document.visibilityState === 'visible') renew();
    };
    renew();
    document.addEventListener('visibilitychange', renewWhenVisible);
    destroyRef.onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', renewWhenVisible);
    });
  });
  return now.asReadonly();
}
