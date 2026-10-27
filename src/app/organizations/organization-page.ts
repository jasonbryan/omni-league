import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { api } from '../../../convex/_generated/api';
import { sportFromSegment } from '../../../convex/lib/sports';
import { injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { parseListPage } from '../core/list-page';
import { bindPageMeta } from '../core/page-meta';
import { NotFoundView } from '../not-found/not-found-view';
import { NotSavedView } from '../offline/not-saved-view';
import { ServerErrorView } from '../server-error/server-error-view';
import { PublicLayout } from '../public-layout/public-layout';
import { OrganizationOverview } from './organization-overview';
import { OrganizationSkeleton } from './organization-skeleton';
import {
  organizationPath,
  sportViewCanonicalPath,
  type PublicOrganizationPage,
} from './organization-path';

type PublicLeagues = FunctionReturnType<typeof api.organizations.listPublicLeagues>;

/**
 * Both `/organizations/:orgSlug` and the sport view `/organizations/:orgSlug/sports/:sport`, which filters the whole page to one sport.
 * The organization page asks for page 1 of each list and nothing from the URL, so the server and the browser use the same `TransferState` keys and the server HTML holds no query string.
 * The sport view also reads `?page=N` with `parseListPage`, from every value of the parameter, so the HTML holds only the page number the query result gives.
 * A segment that names no sport asks no query, because the queries validate their `sport` argument and would fail with a 503 instead of a 404.
 */
@Component({
  selector: 'app-organization-page',
  imports: [
    NotFoundView,
    NotSavedView,
    OrganizationOverview,
    OrganizationSkeleton,
    PublicLayout,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (page(); as page) {
        <app-organization-overview
          [page]="page"
          [sport]="sport()"
          [leaguePaging]="leaguePaging()"
          [busy]="busy()"
          [savedAt]="savedAt()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
      } @else {
        <app-organization-skeleton />
      }
    </app-public-layout>
  `,
})
export class OrganizationPage {
  private readonly route = inject(ActivatedRoute);
  private readonly slug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  /** The sport view's `:sport` segment; none on the organization page. */
  private readonly segment = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('sport'))),
    { requireSync: true },
  );
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );

  private readonly sportKey = computed(() => {
    const segment = this.segment();
    return segment === null ? undefined : sportFromSegment(segment);
  });
  private readonly unknownSport = computed(
    () => this.segment() !== null && this.sportKey() === undefined,
  );
  private readonly leaguesPage = computed(() =>
    this.segment() === null ? 1 : this.requestedPage(),
  );
  private readonly listArgs = computed(() => {
    const sport = this.sportKey();
    return sport ? { sport } : {};
  });

  private readonly header = injectQuery(api.organizations.getPublicPage, () =>
    this.unknownSport() ? skipToken : { slug: this.slug() },
  );
  private readonly leagues = injectQuery(api.organizations.listPublicLeagues, () =>
    this.unknownSport()
      ? skipToken
      : { slug: this.slug(), page: this.leaguesPage(), ...this.listArgs() },
  );
  private readonly locations = injectQuery(api.organizations.listPublicLocations, () =>
    this.unknownSport() ? skipToken : { slug: this.slug(), page: 1, ...this.listArgs() },
  );
  private readonly online = injectOnline();

  /**
   * The leagues to show: the query's result, or, only while online, the previous page's result of the same list while the next page loads.
   * Offline, a page with no saved copy shows nothing, so the not-saved view takes its place: the previous rows would sit under another page's URL, and the load would never end.
   * Another sport's leagues are never kept.
   */
  private readonly shownLeagues = linkedSignal<
    { key: string; value: PublicLeagues | undefined; online: boolean },
    { key: string; value: PublicLeagues } | undefined
  >({
    source: () => ({
      key: `${this.slug()}/${this.segment()}`,
      value: this.leagues.value(),
      online: this.online(),
    }),
    computation: ({ key, value, online }, previous) => {
      if (value) return { key, value };
      return online && previous?.value?.key === key ? previous.value : undefined;
    },
  });

  protected readonly path = computed(() => {
    const segment = this.segment();
    return segment === null
      ? organizationPath(this.slug())
      : sportViewCanonicalPath(this.slug(), segment, this.leaguesPage());
  });

  private readonly failed = computed(
    () =>
      this.header.error() !== undefined ||
      this.leagues.error() !== undefined ||
      this.locations.error() !== undefined,
  );

  /** The organization's entry for the sport; none on the organization page, or when it has no published league in the sport. */
  protected readonly sport = computed(() =>
    this.header.value()?.sports.find((entry) => entry.key === this.sportKey()),
  );

  protected readonly page = computed((): PublicOrganizationPage | undefined => {
    if (this.failed()) return undefined;
    const header = this.header.value();
    const leagues = this.shownLeagues();
    const locations = this.locations.value();
    if (!header || !leagues || !locations) return undefined;
    if (this.sportKey() && !this.sport()) return undefined;
    return { ...header, leagues: leagues.value.rows, locations: locations.rows };
  });

  /** The numbered control's data, only on the sport view; the organization page lists page 1 of each list. */
  protected readonly leaguePaging = computed(() => {
    const leagues = this.shownLeagues()?.value;
    if (!leagues || !this.sport()) return undefined;
    return { page: leagues.page, pageCount: leagues.pageCount, total: leagues.total };
  });

  /** The page of leagues shown is the previous one: the asked-for page has not arrived yet. */
  protected readonly busy = computed(
    () => this.shownLeagues() !== undefined && this.leagues.value() === undefined,
  );

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [this.header.savedAt(), this.leagues.savedAt(), this.locations.savedAt()].filter(
      (time) => time !== undefined,
    );
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.page()) return 'page';
    if (this.unknownSport()) return 'not-found';
    const header = this.header.value();
    if (header === null) return 'not-found';
    // The organization is found but has no published league in the sport.
    if (header && this.sportKey() && !this.sport()) return 'not-found';
    if (this.failed()) return 'error';
    const offlineWithoutSavedCopy = !this.online();
    if (offlineWithoutSavedCopy) return 'not-saved';
    return 'loading';
  });

  constructor() {
    bindPageMeta(() => {
      const page = this.page();
      if (!page) return null;
      const sport = this.sport();
      if (!sport) {
        return {
          title: `${page.name} | Omni League`,
          ogTitle: page.name,
          ogDescription: `Leagues and locations of ${page.name} on Omni League.`,
          ogType: 'website',
          path: organizationPath(page.slug),
        };
      }
      return {
        title: `${sport.name} | ${page.name} | Omni League`,
        ogTitle: `${sport.name} | ${page.name}`,
        ogDescription: `${sport.name} leagues and locations of ${page.name} on Omni League.`,
        ogType: 'website',
        // The page the query served, never the request's: a page past the last is page 1.
        path: sportViewCanonicalPath(page.slug, sport.segment, this.leaguePaging()?.page ?? 1),
      };
    });
  }
}
