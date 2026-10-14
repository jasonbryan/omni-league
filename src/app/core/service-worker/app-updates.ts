import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  InjectionToken,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { firstRunOf } from './version-first-run';

export const FORCED_RELOAD_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const ACTIVATE_TIMEOUT_MS = 3_000;
export { FIRST_RUN_MAX_ENTRIES, FIRST_RUN_STORAGE_KEY } from './version-first-run';

/** A token so unit tests can observe it (jsdom cannot reload). */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return () => {
      document.location.reload();
    };
  },
});

export type UpdateCard = 'none' | 'ready' | 'unrecoverable';

/**
 * A running version first run more than 14 days ago arms a reload at the next router navigation or the next time the page becomes visible,
 * so a form being filled in is not lost. The visibility check runs at most every 30 minutes, for installed apps left open (ngsw itself checks whenever the app opens).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly swUpdate = inject(SwUpdate);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly reloadPage = inject(RELOAD_PAGE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly state = signal<UpdateCard>('none');
  readonly card: Signal<UpdateCard> = this.state.asReadonly();

  private started = false;
  private dismissed = false;
  private reloadArmed = false;
  private newerVersionSeen = false;
  private lastCheck: number | undefined;

  start(): boolean {
    if (!this.swUpdate.isEnabled) return false;
    if (this.started) return true;
    this.started = true;

    this.swUpdate.versionUpdates
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.onVersionEvent(event));
    this.swUpdate.unrecoverable
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.state.set('unrecoverable'));
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => void this.reloadIfArmed());
    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisibilityChange),
    );
    return true;
  }

  reload(): void {
    this.reloadPage();
  }

  later(): void {
    this.dismissed = true;
    if (this.state() === 'ready') this.state.set('none');
  }

  private onVersionEvent(event: VersionEvent): void {
    const now = Date.now();
    if (event.type === 'VERSION_DETECTED') {
      this.newerVersionSeen = true;
      return;
    }
    if (event.type === 'NO_NEW_VERSION_DETECTED') {
      // Only the running version gets a first-run time. The event names the newest version the worker has; a newly opened page runs that version,
      // so it is the running one until this page sees a newer version. After that, the running one is VERSION_READY's `currentVersion`, already recorded there.
      if (!this.newerVersionSeen) firstRunOf(event.version.hash, now);
      return;
    }
    if (event.type !== 'VERSION_READY') return;
    this.newerVersionSeen = true;
    const firstRun = firstRunOf(event.currentVersion.hash, now);
    if (now - firstRun > FORCED_RELOAD_AGE_MS) {
      this.reloadArmed = true;
      if (this.state() === 'ready') this.state.set('none');
      return;
    }
    if (!this.dismissed && this.state() === 'none') this.state.set('ready');
  }

  private onVisibilityChange(): void {
    if (this.document.visibilityState !== 'visible') return;
    if (this.reloadArmed) {
      void this.reloadIfArmed();
      return;
    }
    const now = Date.now();
    if (this.lastCheck !== undefined && now - this.lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    this.lastCheck = now;
    // Offline, or the worker is busy: the next visibility change after the interval tries again.
    this.swUpdate.checkForUpdate().catch(() => undefined);
  }

  private async reloadIfArmed(): Promise<void> {
    if (!this.reloadArmed) return;
    this.reloadArmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACTIVATE_TIMEOUT_MS);
    });
    await Promise.race([this.swUpdate.activateUpdate().catch(() => false), timeout]);
    clearTimeout(timer);
    this.reloadPage();
  }
}
