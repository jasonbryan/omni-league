import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PublicLayout } from '../public-layout/public-layout';
import { Shell } from '../shell';
import { PageUnavailableView } from './page-unavailable-view';

/** One route for every path, so the initial bundle holds one route; a page under `/app` keeps the app shell. */
@Component({
  selector: 'app-page-unavailable-page',
  imports: [PageUnavailableView, PublicLayout, Shell],
  template: `
    @if (inApp()) {
      <app-shell>
        <app-page-unavailable-view />
      </app-shell>
    } @else {
      <app-public-layout>
        <app-page-unavailable-view />
      </app-public-layout>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageUnavailablePage {
  private readonly router = inject(Router);
  /** The router reuses this page for the next failure, so the layout follows each navigation. */
  protected readonly inApp = computed(() => {
    const navigation = this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation();
    return /^\/app(?:[/?#]|$)/.test(String(navigation?.extras.browserUrl ?? ''));
  });
}
