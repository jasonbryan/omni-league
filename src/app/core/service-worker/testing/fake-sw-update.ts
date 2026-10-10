import type { UnrecoverableStateEvent, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

/**
 * Stands in for `SwUpdate` in unit tests: the test emits worker events through the subjects and
 * spies on the two methods (`vi.spyOn(fake, 'activateUpdate')`). Test-only: never imported by app
 * code.
 */
export class FakeSwUpdate {
  isEnabled = true;
  readonly versionUpdates = new Subject<VersionEvent>();
  readonly unrecoverable = new Subject<UnrecoverableStateEvent>();

  checkForUpdate(): Promise<boolean> {
    return Promise.resolve(false);
  }

  activateUpdate(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Emits `VERSION_READY` from the running version `current` to `latest`. */
  versionReady(current: string, latest = `${current}-next`): void {
    this.versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: current },
      latestVersion: { hash: latest },
    });
  }

  /** Emits `NO_NEW_VERSION_DETECTED` for `hash`, the newest version the worker knows. */
  noNewVersion(hash: string): void {
    this.versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED', version: { hash } });
  }

  /** Emits `UNRECOVERABLE_STATE`. */
  broken(reason = 'missing file'): void {
    this.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason });
  }
}

/** Sets `document.visibilityState` and fires `visibilitychange`, as the browser does. */
export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Removes the override `setVisibility` put on the document. */
export function resetVisibility(): void {
  delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
}
