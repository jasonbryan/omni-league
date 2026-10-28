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
import { ChangesInFlight } from '../changes-in-flight';
import { PageSafety } from './page-safety';
import {
  mayReloadForUnrecoverable,
  mayReloadForVersion,
  recordReloadForUnrecoverable,
  recordReloadForVersion,
} from './reload-guard';

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const ACTIVATE_TIMEOUT_MS = 3_000;
/** How long after the page loaded, or after a long-open page came back to the front, a ready version loads without waiting for a navigation. */
export const AUTO_APPLY_WINDOW_MS = 10_000;
/** Half of the 14 days public functions keep accepting the previous release, so a tab that stays on one path still updates inside that window. */
export const STALE_PAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const LEGACY_FIRST_RUN_KEY = 'omni-league:sw-version-first-run';

/** A token so unit tests can observe it (jsdom cannot reload). */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return () => {
      document.location.reload();
    };
  },
});

/** Milliseconds since the epoch at which this page began to load. */
export const PAGE_LOADED_AT = new InjectionToken<number>('PAGE_LOADED_AT', {
  factory: () => performance.timeOrigin,
});

export type UpdateCard = 'none' | 'ready' | 'unrecoverable';

type Trigger = 'load' | 'navigation' | 'visible';

function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/**
 * A downloaded version loads by itself when a reload cannot lose anything, at one of three moments:
 * early in the page load, on a navigation that changes the path, and when a page open for more than 7 days comes back to the front.
 * Unsaved input or a change in flight holds it, and the new-version prompt then offers Reload. The page is never reloaded because it became hidden, which would drop an Undo offer or a success status.
 * The visibility check runs at most every 30 minutes, for installed apps left open (ngsw itself checks whenever the app opens).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly swUpdate = inject(SwUpdate);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly reloadPage = inject(RELOAD_PAGE);
  private readonly destroyRef = inject(DestroyRef);
  private readonly safety = inject(PageSafety);
  private readonly changes = inject(ChangesInFlight);
  private readonly loadedAt = inject(PAGE_LOADED_AT);

  private readonly state = signal<UpdateCard>('none');
  readonly card: Signal<UpdateCard> = this.state.asReadonly();

  private started = false;
  private dismissed = false;
  /** The hash of the newest version that is downloaded and not yet running. */
  private readyHash: string | undefined;
  /** False once this tab reloaded for the hash before, or cannot keep that record. */
  private mayApply = true;
  private applying = false;
  private deferredTrigger: Trigger | undefined;
  private lastPath: string | undefined;
  private lastVisibleAt: number | undefined;
  private lastCheck: number | undefined;

  start(): boolean {
    if (!this.swUpdate.isEnabled) return false;
    if (this.started) return true;
    this.started = true;

    removeLegacyRecord();
    this.safety.watch();

    this.swUpdate.versionUpdates
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.onVersionEvent(event));
    this.swUpdate.unrecoverable
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onUnrecoverable());
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.onNavigationEnd(event));
    this.safety.fieldMarked.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.readyHash !== undefined) this.showPrompt();
    });
    this.changes.settled.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const trigger = this.deferredTrigger;
      this.deferredTrigger = undefined;
      if (trigger && this.holds(trigger)) this.tryApply(trigger);
    });
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

  /** Hides the prompt for the rest of the page session. The version still loads at the next safe trigger. */
  later(): void {
    this.dismissed = true;
    if (this.state() === 'ready') this.state.set('none');
  }

  private onVersionEvent(event: VersionEvent): void {
    if (event.type !== 'VERSION_READY') return;
    const hash = event.latestVersion.hash;
    this.readyHash = hash;
    this.mayApply = mayReloadForVersion(hash);
    if (!this.mayApply) {
      this.showPrompt();
      return;
    }
    const trigger = this.triggerAtReady();
    if (trigger) this.tryApply(trigger);
    else if (this.safety.hasUnsavedField()) this.showPrompt();
  }

  private onUnrecoverable(): void {
    const mayReload = this.safety.isSafe() && navigator.onLine && mayReloadForUnrecoverable();
    if (mayReload && recordReloadForUnrecoverable()) {
      this.reloadPage();
      return;
    }
    this.state.set('unrecoverable');
  }

  private onNavigationEnd(event: NavigationEnd): void {
    const path = pathOf(event.urlAfterRedirects);
    const previous = this.lastPath;
    this.lastPath = path;
    if (previous !== undefined && previous !== path) this.tryApply('navigation');
  }

  private onVisibilityChange(): void {
    if (this.document.visibilityState !== 'visible') return;
    const now = Date.now();
    this.lastVisibleAt = now;
    if (this.holds('visible')) this.tryApply('visible');
    if (this.lastCheck !== undefined && now - this.lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    this.lastCheck = now;
    // Offline, or the worker is busy: the next visibility change after the interval tries again.
    this.swUpdate.checkForUpdate().catch(() => undefined);
  }

  private get pageAge(): number {
    return Date.now() - this.loadedAt;
  }

  private holds(trigger: Trigger): boolean {
    switch (trigger) {
      case 'load':
        return this.pageAge <= AUTO_APPLY_WINDOW_MS && !this.safety.interacted();
      case 'navigation':
        return true;
      case 'visible':
        return this.pageAge > STALE_PAGE_AGE_MS;
    }
  }

  /** A version usually becomes ready a few seconds after the page became visible, so one that does on a long-open page counts as part of its return. */
  private triggerAtReady(): Trigger | undefined {
    if (this.holds('load')) return 'load';
    const sinceVisible =
      this.lastVisibleAt === undefined ? undefined : Date.now() - this.lastVisibleAt;
    if (
      this.holds('visible') &&
      sinceVisible !== undefined &&
      sinceVisible <= AUTO_APPLY_WINDOW_MS
    ) {
      return 'visible';
    }
    return undefined;
  }

  /** Safety is checked here, when the reload would happen, and never only when the version became ready. */
  private tryApply(trigger: Trigger): void {
    if (this.readyHash === undefined || !this.mayApply || this.applying) return;
    if (this.safety.hasUnsavedField()) {
      this.showPrompt();
      return;
    }
    if (this.changes.active()) {
      this.deferredTrigger = trigger;
      return;
    }
    void this.apply(this.readyHash);
  }

  private async apply(hash: string): Promise<void> {
    if (!recordReloadForVersion(hash)) {
      this.mayApply = false;
      this.showPrompt();
      return;
    }
    this.applying = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACTIVATE_TIMEOUT_MS);
    });
    await Promise.race([this.swUpdate.activateUpdate().catch(() => false), timeout]);
    clearTimeout(timer);
    this.reloadPage();
  }

  private showPrompt(): void {
    if (!this.dismissed && this.state() === 'none') this.state.set('ready');
  }
}

function removeLegacyRecord(): void {
  try {
    localStorage.removeItem(LEGACY_FIRST_RUN_KEY);
  } catch {
    // Blocked storage: the stale record stays, and nothing reads it.
  }
}
