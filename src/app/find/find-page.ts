import { isPlatformServer } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../convex/_generated/api';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { injectNow } from '../core/now';
import { bindPageMeta } from '../core/page-meta';
import { NotSavedView } from '../offline/not-saved-view';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';
import { FindContent, type FindStatus } from './find-content';
import { FIND_PATH, findPath } from './find-path';

const TITLE = 'Find a league | Omni League';

@Component({
  selector: 'app-find-page',
  imports: [FindContent, NotSavedView, PublicLayout, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @switch (view()) {
        @case ('server-error') {
          <app-server-error-view [retryHref]="retryHref()" />
        }
        @case ('not-saved') {
          <app-not-saved-view [retryHref]="retryHref()" />
        }
        @default {
          <app-find-content
            [query]="query()"
            [status]="status()"
            [results]="results.value()"
            [now]="now()"
            [savedAt]="savedAt()"
            (searched)="search($event)"
          />
        }
      }
    </app-public-layout>
  `,
})
export class FindPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  protected readonly query = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseSearchQuery(params.getAll('q')))),
    { requireSync: true },
  );

  protected readonly results = injectQuery(api.search.leagues, () =>
    this.query() === '' ? skipToken : { q: this.query() },
  );

  protected readonly retryHref = computed(() => findPath(this.query()));

  protected readonly status = computed((): FindStatus => {
    if (this.query() === '') return 'start';
    if (this.results.error() !== undefined) return 'error';
    return this.results.value() === undefined ? 'searching' : 'results';
  });

  // The server renders the whole page as the error view so its status is 503; the browser keeps the form and shows an alert in place of the results.
  protected readonly view = computed(() => {
    if (this.status() === 'error' && this.onServer) return 'server-error';
    if (this.status() === 'searching' && !this.online()) return 'not-saved';
    return 'page';
  });

  protected readonly savedAt = computed(() => (this.online() ? undefined : this.results.savedAt()));

  constructor() {
    bindPageMeta(() => {
      if (this.view() !== 'page') return null;
      const query = this.query();
      return {
        title: query === '' ? TITLE : `${query} | ${TITLE}`,
        ogTitle: 'Find a league',
        ogDescription: 'Find beach volleyball, soccer, and softball leagues on Omni League.',
        ogType: 'website',
        path: FIND_PATH,
        noindex: query !== '',
      };
    });
  }

  protected search(query: string): void {
    void this.router.navigate([FIND_PATH], { queryParams: query === '' ? {} : { q: query } });
  }
}
