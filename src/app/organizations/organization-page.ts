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
import { organizationPath, type PublicOrganizationPage } from './organization-path';
import { OrganizationSidebar } from './organization-sidebar';

/**
 * The public organization page, `/organizations/:orgSlug` (#60), approved in #73
 * (design/mockups/60-organization-page.html). A Server route: the render reads three queries
 * anonymously, `organizations:getPublicPage` (the header and totals) and page 1 of
 * `organizations:listPublicLeagues` and `organizations:listPublicLocations` (#100), and after
 * hydration the live subscriptions keep the page current.
 *
 * - Found: the overview in the app shell, with the organization's sidebar, and the title, Open
 *   Graph tags, and canonical from the query results, once all three have arrived.
 * - Header `null`: #23's not-found view with status 404, top bar only (#73 decision 2).
 * - Any of the three failed or timed out: the server-error view with status 503 and `no-store`,
 *   top bar only, so an error never enters the CDN cache. The live subscriptions replace it once
 *   every result has arrived.
 *
 * Offline (#82, design/mockups/82-offline-pages.html): all three queries are on the adapter's
 * `OFFLINE_SAVED_QUERIES`, so the browser keeps each live result as a saved copy and shows it when
 * there is no transferred value and no live result yet. While the app is offline (`injectOnline()`
 * false) the overview shows the saved-copy note under the `h1`, dated by the oldest saved copy on
 * screen; online, a saved copy shows with no note until the live result replaces it. Offline with
 * any of the three missing, the page shows the not-saved view. A live `null` header removes its
 * saved copy (the adapter) and shows the not-found view.
 *
 * The queries' only arguments are the route's slug and page 1, so the server and the browser use
 * the same `TransferState` keys and the server HTML holds no query string. Page numbers in the URL
 * are #103.
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
  private readonly header = injectQuery(api.organizations.getPublicPage, () => ({
    slug: this.slug(),
  }));
  private readonly leagues = injectQuery(api.organizations.listPublicLeagues, () => ({
    slug: this.slug(),
    page: 1,
  }));
  private readonly locations = injectQuery(api.organizations.listPublicLocations, () => ({
    slug: this.slug(),
    page: 1,
  }));
  private readonly online = injectOnline();

  /** The page's path from the route, for "Try again" when there is no result to build it from. */
  protected readonly path = computed(() => organizationPath(this.slug()));

  /** The organization with the rows of page 1 of each list, once found and all three arrived. */
  protected readonly page = computed((): PublicOrganizationPage | undefined => {
    const header = this.header.value();
    const leagues = this.leagues.value();
    const locations = this.locations.value();
    if (!header || !leagues || !locations) return undefined;
    return { ...header, leagues: leagues.rows, locations: locations.rows };
  });

  /**
   * When the oldest saved copy on screen was saved, only while offline (the note is hidden online)
   * and only while some of the three results is still a saved copy.
   */
  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [this.header.savedAt(), this.leagues.savedAt(), this.locations.savedAt()].filter(
      (time) => time !== undefined,
    );
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.page()) return 'page';
    if (this.header.value() === null) return 'not-found';
    // Any error of any of the three, including a missing Convex URL; never its message (adapter
    // README).
    if (this.header.error() || this.leagues.error() || this.locations.error()) return 'error';
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
