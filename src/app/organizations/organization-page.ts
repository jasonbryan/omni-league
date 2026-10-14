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
import { PublicLayout } from '../public-layout/public-layout';
import { OrganizationOverview } from './organization-overview';
import { organizationPath, type PublicOrganizationPage } from './organization-path';

/**
 * The queries take only the route's slug and page 1, so the server and the browser use the same
 * `TransferState` keys and the server HTML holds no query string. A failed or timed-out query
 * renders the server-error view (503, `no-store`) so the CDN never stores it.
 */
@Component({
  selector: 'app-organization-page',
  imports: [NotFoundView, NotSavedView, OrganizationOverview, PublicLayout, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (page(); as page) {
        <app-organization-overview [page]="page" [savedAt]="savedAt()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
      }
    </app-public-layout>
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
