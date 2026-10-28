import { isPlatformServer } from '@angular/common';
import {
  PLATFORM_ID,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  type Signal,
} from '@angular/core';

/** Twice the server render's query timeout and the offline signal delay (both 5 s), so a slow first answer on a phone network arrives first. */
export const PAGE_LOAD_WAIT_MS = 10_000;

/**
 * True once `waiting` has held for `PAGE_LOAD_WAIT_MS` with the same `key`. A new key, or `waiting` going false and true again, starts the wait over.
 * The server render has its own query timeout and holds no browser timer.
 */
export function injectPageLoadWait(waiting: () => boolean, key: () => unknown): Signal<boolean> {
  assertInInjectionContext(injectPageLoadWait);
  if (isPlatformServer(inject(PLATFORM_ID))) return signal(false).asReadonly();

  const spell = computed(() => ({ waiting: waiting(), key: key() }), {
    equal: (a, b) => a.waiting === b.waiting && a.key === b.key,
  });
  const stalled = linkedSignal({ source: spell, computation: () => false });

  effect((onCleanup) => {
    if (!spell().waiting) return;
    const timer = setTimeout(() => stalled.set(true), PAGE_LOAD_WAIT_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return stalled.asReadonly();
}
