import { afterRenderEffect, signal, type Signal } from '@angular/core';

/** `setTimeout` runs a delay above this at once. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** A deadline given to the millisecond needs a tick of its own, because `injectNow` ticks once a day. */
export function injectNowAtDeadlines(deadlines: () => readonly number[]): Signal<number> {
  const now = signal(Date.now());
  // After render, so a server render leaves no timer pending.
  afterRenderEffect((onCleanup) => {
    const current = now();
    const ahead = deadlines().filter((deadline) => deadline > current);
    if (ahead.length === 0) return;
    const delay = Math.min(Math.min(...ahead) - Date.now(), MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => now.set(Date.now()), Math.max(delay, 0));
    onCleanup(() => clearTimeout(timer));
  });
  return now.asReadonly();
}
