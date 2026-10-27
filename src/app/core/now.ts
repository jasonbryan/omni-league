import { DestroyRef, afterNextRender, inject, signal, type Signal } from '@angular/core';
import { msUntilNextCalendarDate } from '../../../convex/lib/registration';

/**
 * The time of the request on the server, and the browser's clock from the first render on, renewed whenever the date at UTC-12 changes.
 * The server HTML may be minutes old when it arrives, so the first render reads the clock again.
 */
export function injectNow(): Signal<number> {
  const now = signal(Date.now());
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const renew = () => {
      const current = Date.now();
      now.set(current);
      timer = setTimeout(renew, msUntilNextCalendarDate(current));
    };
    renew();
    destroyRef.onDestroy(() => clearTimeout(timer));
  });
  return now.asReadonly();
}
