import type { UnrecoverableStateEvent, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

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

  versionReady(current: string, latest = `${current}-next`): void {
    this.versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: current },
      latestVersion: { hash: latest },
    });
  }

  versionDetected(hash: string): void {
    this.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash } });
  }

  noNewVersion(hash: string): void {
    this.versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED', version: { hash } });
  }

  broken(reason = 'missing file'): void {
    this.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason });
  }
}

export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

export function resetVisibility(): void {
  delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
}
