import { assertInInjectionContext, computed, inject, type Signal } from '@angular/core';
import { ConvexConnection, type OfflineCause } from './connection';

export type NotDone = 'sent' | 'removed' | 'undone';

export function offlineLead(cause: OfflineCause): string {
  return cause === 'unreachable' ? "Can't reach Omni League right now." : "You're offline.";
}

/** The one place the words for a refused change come from, so a screen never gives two causes. */
export function offlineTitle(cause: OfflineCause, notDone: NotDone = 'sent'): string {
  return `${offlineLead(cause)} Nothing was ${notDone}.`;
}

export function injectOfflineTitle(notDone: NotDone = 'sent'): Signal<string> {
  assertInInjectionContext(injectOfflineTitle);
  const cause = inject(ConvexConnection).cause;
  return computed(() => offlineTitle(cause(), notDone));
}
