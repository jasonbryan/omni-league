import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../convex/_generated/api';
import { injectOnline, injectQuery } from '../core/data/convex';
import { bindPageMeta } from '../core/page-meta';
import { NotFoundView } from '../not-found/not-found-view';
import { NotSavedView } from '../offline/not-saved-view';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell, ShellSidebar } from '../shell';
import { OrganizationOverview } from './organization-overview';
import { organizationPath } from './organization-path';
import { OrganizationSidebar } from './organization-sidebar';

/**
 * The public organization page, `/organizations/:orgSlug` (#60), approved in #73
 * (design/mockups/60-organization-page.html). A Server route: the render reads
 * `organizations:getPublicPage` anonymously, and after hydration the live subscription keeps the
 * page current.
 *
 * - Found: the overview in the app shell, with the organization's sidebar, and the title, Open
 *   Graph tags, and canonical from the query result.
 * - `null`: #23's not-found view with status 404, top bar only (#73 decision 2).
 * - Failed or timed out: the server-error view with status 503 and `no-store`, top bar only. The
 *   live subscription replaces it once a result arrives.
 *
 * Offline (#82, design/mockups/82-offline-pages.html): `getPublicPage` is on the adapter's
 * `OFFLINE_SAVED_QUERIES`, so the browser keeps each live result as a saved copy and shows it when
 * there is no transferred value and no live result yet. While the app is offline (`injectOnline()`
 * false) the overview shows the saved-copy note under the `h1`; online, a saved copy shows with no
 * note until the live result replaces it. Offline with nothing to show, the page shows the
 * not-saved view. A live `null` removes the saved copy (the adapter) and shows the not-found view.
 *
 * The query's only argument is the route's slug, so the server and the browser use the same
 * `TransferState` key.
 */
@Component({
  selector: 'app-organization-page',
  imports: [
    NotFoundView,
    NotSavedView,
    OrganizationOverview,
    OrganizationSidebar,
    ServerErrorView,
    Shell,
    ShellSidebar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (page(); as page) {
        <ng-template appShellSidebar>
          <app-organization-sidebar [page]="page" />
        </ng-template>
        <app-organization-overview [page]="page" [savedAt]="savedAt()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
      }
    </app-shell>
  `,
})
export class OrganizationPage {
  private readonly slug = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly query = injectQuery(api.organizations.getPublicPage, () => ({
    slug: this.slug(),
  }));
  private readonly online = injectOnline();

  /** The page's path from the route, for "Try again" when there is no result to build it from. */
  protected readonly path = computed(() => organizationPath(this.slug()));

  /** The organization, once found: live, transferred, or a saved copy. */
  protected readonly page = computed(() => this.query.value() ?? undefined);

  /** When the saved copy shown was saved, only while offline (the note is hidden online). */
  protected readonly savedAt = computed(() => (this.online() ? undefined : this.query.savedAt()));

  protected readonly state = computed(() => {
    const page = this.query.value();
    if (page) return 'page';
    if (page === null) return 'not-found';
    // Any error, including a missing Convex URL; never its message (adapter README).
    if (this.query.error()) return 'error';
    // Offline with nothing to show (never on the server, where `online` is always true).
    if (!this.online()) return 'not-saved';
    return 'loading';
  });

  constructor() {
    bindPageMeta(() => {
      const page = this.page();
      if (!page) return null;
      return {
        title: `${page.name} | Omni League`,
        ogTitle: page.name,
        ogDescription: `Leagues and locations of ${page.name} on Omni League.`,
        ogType: 'website',
        path: organizationPath(page.slug),
      };
    });
  }
}
