import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { onLaterChoiceOrScroll } from './later-choice';

export interface FragmentLandingRule {
  readonly atLoad: (snapshot: ActivatedRouteSnapshot) => boolean;
  /** Angular keeps the page when only its path changes, so each later arrival is judged again. */
  readonly atArrival: (path: string, fragment: string | null) => boolean;
}

export function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * A page injects its subclass in its constructor, so it listens from the arrival and sees a later choice
 * or scroll while the page's data is still loading, before the section to land on exists.
 */
export abstract class FragmentLanding {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private listening = new AbortController();
  private shownPath: string | null = null;
  readonly pending = signal(false);

  protected constructor(rule: FragmentLandingRule) {
    inject(DestroyRef).onDestroy(() => this.listening.abort());
    this.arm(rule.atLoad(inject(ActivatedRoute).snapshot));
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = pathOf(event.urlAfterRedirects);
      const arrived = this.shownPath !== null && path !== this.shownPath;
      this.shownPath = path;
      if (!arrived) return;
      const fragment = this.router.parseUrl(event.urlAfterRedirects).fragment;
      this.arm(rule.atArrival(path, fragment));
    });
  }

  settle(): void {
    this.pending.set(false);
    this.listening.abort();
  }

  private arm(armed: boolean): void {
    this.listening.abort();
    this.listening = new AbortController();
    this.pending.set(armed);
    if (!armed) return;
    onLaterChoiceOrScroll(
      this.document,
      {
        isOwnFocus: (element) => element.id === 'main',
        isOwnArea: (element) => element.closest('#main') !== null,
        signal: this.listening.signal,
      },
      () => this.settle(),
    );
  }
}
