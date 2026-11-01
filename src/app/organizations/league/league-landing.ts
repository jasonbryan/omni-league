import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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

/**
 * Provided by the league page, so it starts at each arrival and sees a later choice or scroll while the league is still loading,
 * before the management component exists.
 */
@Injectable()
export class LeagueLanding {
  private readonly listening = new AbortController();
  readonly target = signal<LandingTarget | null>(
    targetOfFragment(inject(ActivatedRoute).snapshot.fragment),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.listening.abort());
    if (this.target() === null) return;
    onLaterChoiceOrScroll(
      inject(DOCUMENT),
      { isOwnFocus: (element) => element.id === 'main', signal: this.listening.signal },
      () => this.settle(),
    );
  }

  settle(): void {
    this.target.set(null);
    this.listening.abort();
  }
}
