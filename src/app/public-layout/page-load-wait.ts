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
import { PAGE_LOAD_WAIT_MS } from './page-load-wait-ms';

export function injectPageLoadWait(
  waiting: () => boolean,
  restartOn: () => unknown,
): Signal<boolean> {
  assertInInjectionContext(injectPageLoadWait);
  // The server render has its own query timeout, and a browser timer there would outlive the render.
  if (isPlatformServer(inject(PLATFORM_ID))) return signal(false).asReadonly();

  const spell = computed(() => ({ waiting: waiting(), restartOn: restartOn() }), {
    equal: (a, b) => a.waiting === b.waiting && a.restartOn === b.restartOn,
  });
  const stalled = linkedSignal({ source: spell, computation: () => false });

  effect((onCleanup) => {
    if (!spell().waiting) return;
    const timer = setTimeout(() => stalled.set(true), PAGE_LOAD_WAIT_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return stalled.asReadonly();
}
