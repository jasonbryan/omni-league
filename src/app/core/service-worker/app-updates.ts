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

/** A running version first run longer ago than this is replaced without a prompt (ADR 0013 §4). */
export const FORCED_RELOAD_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** The least time between two update checks started by the page becoming visible. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** How long the forced reload waits for `activateUpdate()` before it reloads anyway. */
export const ACTIVATE_TIMEOUT_MS = 3_000;
export { FIRST_RUN_MAX_ENTRIES, FIRST_RUN_STORAGE_KEY } from './version-first-run';

/** Reloads the page. A token so that unit tests can observe it (jsdom cannot reload). */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return () => {
      document.location.reload();
    };
  },
});

/** Which card the new-version prompt shows (`src/app/shell/update-prompt.ts`). */
export type UpdateCard = 'none' | 'ready' | 'unrecoverable';

/**
 * The app's side of service worker updates (#81, ADR 0013 section 4;
 * design/mockups/81-update-prompt.html):
 *
 * - `VERSION_READY` shows the new-version prompt, unless Later hid it in this page session.
 * - `SwUpdate.unrecoverable` shows the reload message, which nothing hides.
 * - When the running version was first run more than 14 days ago, `VERSION_READY` shows nothing and
 *   arms a reload: `activateUpdate()` and a reload run at the next router navigation or the next
 *   time the page becomes visible, whichever comes first, so a form being filled in is not lost.
 * - When the page becomes visible, it asks the worker to check for a new version, at most once
 *   every 30 minutes, for installed apps left open (ngsw itself checks whenever the app opens).
 *
 * The first-run time of each version is kept in `localStorage` (`version-first-run.ts`). Nothing
 * runs unless the worker is on (`SwUpdate.isEnabled`), so development builds, the server render,
 * and browsers without service workers never start it.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly swUpdate = inject(SwUpdate);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly reloadPage = inject(RELOAD_PAGE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly state = signal<UpdateCard>('none');
  /** The card to show. */
  readonly card: Signal<UpdateCard> = this.state.asReadonly();

  private started = false;
  /** Later was pressed: no new-version prompt until the app is next opened. */
  private dismissed = false;
  /** A forced reload waits for the next navigation or visibility change. */
  private reloadArmed = false;
  /**
   * This page has seen a version newer than the one it runs (VERSION_DETECTED or VERSION_READY), so
   * the newest version the worker has may not be the running one.
   */
  private newerVersionSeen = false;
  /** When the last update check started by the page becoming visible ran; unset before the first. */
  private lastCheck: number | undefined;

  /**
   * Starts listening when the worker is on; returns whether it is. Called once by the app
   * initializer (`provideUpdatePrompt`); later calls do nothing.
   */
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

  /** Reload on either card: the worker serves the newest version to the reloaded page. */
  reload(): void {
    this.reloadPage();
  }

  /** Later: hides the new-version prompt until the app is next opened. */
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
      // Only the running version gets a first-run time (ADR 0013 §4). The event names the newest
      // version the worker has. A newly opened page runs that version, so it is the running one
      // until this page sees a newer version; after that, the running one is VERSION_READY's
      // `currentVersion`, already recorded there.
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

  /** The forced reload, once: activate the waiting version, then reload into it. */
  private async reloadIfArmed(): Promise<void> {
    if (!this.reloadArmed) return;
    this.reloadArmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACTIVATE_TIMEOUT_MS);
    });
    // A reload alone also gets the newest version; activating first is what ADR 0013 asks for.
    await Promise.race([this.swUpdate.activateUpdate().catch(() => false), timeout]);
    clearTimeout(timer);
    this.reloadPage();
  }
}
