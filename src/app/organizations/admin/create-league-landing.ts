import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { onLaterChoiceOrScroll } from '../../core/later-choice';
import { pathOf } from '../league/league-landing';
import { AdminContext } from './admin-context';
import { adminPath } from './admin-path';

const LEAGUES_SECTION = 'leagues';
const CREATE_LEAGUE_FRAGMENT = 'create-league';

/**
 * Provided by the admin area, which renders its pages only once it is ready, so it starts at each arrival
 * and sees a later choice or scroll while the admin area is still loading, before the Leagues page exists.
 */
@Injectable()
export class CreateLeagueLanding {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly context = inject(AdminContext);
  private listening = new AbortController();
  private shownPath: string | null = null;
  readonly pending = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.listening.abort());
    const snapshot = inject(ActivatedRoute).snapshot;
    const section = snapshot.firstChild?.url.map((segment) => segment.path).join('/');
    this.arm(section === LEAGUES_SECTION && snapshot.fragment === CREATE_LEAGUE_FRAGMENT);
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = pathOf(event.urlAfterRedirects);
      const arrived = this.shownPath !== null && path !== this.shownPath;
      this.shownPath = path;
      if (!arrived) return;
      const fragment = this.router.parseUrl(event.urlAfterRedirects).fragment;
      this.arm(
        path === adminPath(this.context.slug(), LEAGUES_SECTION) &&
          fragment === CREATE_LEAGUE_FRAGMENT,
      );
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
