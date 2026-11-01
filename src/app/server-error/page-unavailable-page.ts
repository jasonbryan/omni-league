import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PublicLayout } from '../public-layout/public-layout';
import { Shell } from '../shell';
import { PageUnavailableView } from './page-unavailable-view';

/** One route for every path, so the initial bundle holds one route; a page under `/app` keeps the app shell. */
@Component({
  selector: 'app-page-unavailable-page',
  imports: [PageUnavailableView, PublicLayout, Shell],
  template: `
    @if (inApp) {
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
  protected readonly inApp = /^\/app(?:[/?#]|$)/.test(
    String(inject(Router).currentNavigation()?.extras.browserUrl ?? ''),
  );
}
