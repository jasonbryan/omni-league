import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  signal,
  type Signal,
} from '@angular/core';

/** `setTimeout` runs a delay above this at once. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** A deadline given to the millisecond needs a tick of its own, because `injectNow` ticks once a day. */
export function injectNowAtDeadlines(deadlines: () => readonly number[]): Signal<number> {
  const now = signal(Date.now());
  const document = inject(DOCUMENT);
  const destroyRef = inject(DestroyRef);
  // After render, so a server render leaves no timer pending.
  afterRenderEffect((onCleanup) => {
    const current = now();
    const ahead = deadlines().filter((deadline) => deadline > current);
    if (ahead.length === 0) return;
    const delay = Math.min(Math.min(...ahead) - Date.now(), MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => now.set(Date.now()), Math.max(delay, 0));
    onCleanup(() => clearTimeout(timer));
  });
  // A device that slept fires the timer late, and a suspended tab may not fire it at all.
  afterNextRender(() => {
    const renewWhenVisible = () => {
      if (document.visibilityState === 'visible') now.set(Date.now());
    };
    document.addEventListener('visibilitychange', renewWhenVisible);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', renewWhenVisible));
  });
  return now.asReadonly();
}
