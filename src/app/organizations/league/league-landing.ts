import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { onLaterChoiceOrScroll } from '../../core/later-choice';

export type LandingTarget =
  | { readonly kind: 'season'; readonly slug: string }
  | { readonly kind: 'create-season' }
  | { readonly kind: 'details' };

const SEASON_FRAGMENT = 'season-';

function targetOfFragment(fragment: string | null): LandingTarget | null {
  if (fragment === 'create-season' || fragment === 'details') return { kind: fragment };
  if (!fragment?.startsWith(SEASON_FRAGMENT)) return null;
  const slug = fragment.slice(SEASON_FRAGMENT.length);
  try {
    return { kind: 'season', slug: decodeURIComponent(slug) };
  } catch {
    return { kind: 'season', slug };
  }
}

function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Provided by the league page, so it starts at each arrival and sees a later choice or scroll while the league is still loading,
 * before the management component exists. Angular keeps the page when only the league changes, so a navigation to another path arms it again.
 */
@Injectable()
export class LeagueLanding {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private listening = new AbortController();
  private shownPath: string | null = null;
  readonly target = signal<LandingTarget | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.listening.abort());
    this.arm(inject(ActivatedRoute).snapshot.fragment);
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = pathOf(event.urlAfterRedirects);
      const arrived = this.shownPath !== null && path !== this.shownPath;
      this.shownPath = path;
      if (arrived) this.arm(this.router.parseUrl(event.urlAfterRedirects).fragment);
    });
  }

  settle(): void {
    this.target.set(null);
    this.listening.abort();
  }

  private arm(fragment: string | null): void {
    this.listening.abort();
    this.listening = new AbortController();
    const target = targetOfFragment(fragment);
    this.target.set(target);
    if (target === null) return;
    onLaterChoiceOrScroll(
      this.document,
      { isOwnFocus: (element) => element.id === 'main', signal: this.listening.signal },
      () => this.settle(),
    );
  }
}
