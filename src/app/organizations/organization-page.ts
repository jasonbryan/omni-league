import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { api } from '../../../convex/_generated/api';
import { sportFromSegment } from '../../../convex/lib/sports';
import { AuthService } from '../core/auth/auth.service';
import { injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { parseListPage } from '../core/list-page';
import { injectNow } from '../core/now';
import { bindPageMeta } from '../core/page-meta';
import { NotFoundView } from '../not-found/not-found-view';
import { NotSavedView } from '../offline/not-saved-view';
import { ServerErrorView } from '../server-error/server-error-view';
import { PublicLayout } from '../public-layout/public-layout';
import { OrganizationOverview } from './organization-overview';
import { OrganizationSkeleton } from './organization-skeleton';
import { organizationPath, sportViewCanonicalPath } from './organization-path';
import { openSeasonsBySoonestDeadline } from './season-status';

type PublicLeagues = FunctionReturnType<typeof api.organizations.listPublicLeagues>;

/**
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
      @if (organization(); as organization) {
        <app-organization-overview
          [page]="organization"
          [leagues]="leagueRows()"
          [locations]="locationRows()"
          [sport]="sport()"
          [leaguePaging]="leaguePaging()"
          [busy]="busy()"
          [savedAt]="savedAt()"
          [openSeasons]="openSeasons()"
          [now]="now()"
          [canManage]="viewerIsOrgAdmin.value() === true"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [findLeague]="true" />
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
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly slug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
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
  private readonly openSeasonRows = injectQuery(api.seasons.listOpenForOrganization, () =>
    this.unknownSport() ? skipToken : { orgSlug: this.slug(), ...this.listArgs() },
  );
  // Signed-out views and the server render skip it, so signed-out visitors cost no extra function call.
  protected readonly viewerIsOrgAdmin = injectQuery(api.organizations.viewerIsOrgAdmin, () =>
    this.auth.convexAuthenticated() ? { slug: this.slug() } : skipToken,
  );
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  /**
   * Online, the previous page of the same list stays while the next one loads.
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
      this.locations.error() !== undefined ||
      this.openSeasonRows.error() !== undefined,
  );

  protected readonly sport = computed(() =>
    this.header.value()?.sports.find((entry) => entry.key === this.sportKey()),
  );

  private readonly noLeagueInSport = computed(
    () => this.sportKey() !== undefined && !!this.header.value() && !this.sport(),
  );

  protected readonly leagueRows = computed(() => this.shownLeagues()?.value.rows);
  protected readonly locationRows = computed(() => this.locations.value()?.rows);

  // The query reads no clock, so which seasons are open is decided here, at the server's request time or the browser's clock.
  protected readonly openSeasons = computed(() => {
    const rows = this.openSeasonRows.value();
    return rows && openSeasonsBySoonestDeadline(rows, this.now());
  });

  // Online, the hero and chips stay on screen while the lists of another sport load. Offline, a list with no saved copy means the whole page has none.
  protected readonly organization = computed(() => {
    if (this.failed() || this.noLeagueInSport()) return undefined;
    const header = this.header.value();
    if (!header) return undefined;
    const listsMissing = !this.leagueRows() || !this.locationRows() || !this.openSeasonRows.value();
    return !this.online() && listsMissing ? undefined : header;
  });

  protected readonly leaguePaging = computed(() => {
    const leagues = this.shownLeagues()?.value;
    if (!leagues || !this.sport()) return undefined;
    return { page: leagues.page, pageCount: leagues.pageCount, total: leagues.total };
  });

  protected readonly busy = computed(
    () => this.shownLeagues() !== undefined && this.leagues.value() === undefined,
  );

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [
      this.header.savedAt(),
      this.leagues.savedAt(),
      this.locations.savedAt(),
      this.openSeasonRows.savedAt(),
    ].filter((time) => time !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.organization()) return 'page';
    if (this.unknownSport() || this.header.value() === null || this.noLeagueInSport()) {
      return 'not-found';
    }
    if (this.failed()) return 'error';
    const offlineWithoutSavedCopy = !this.online();
    if (offlineWithoutSavedCopy) return 'not-saved';
    return 'loading';
  });

  constructor() {
    bindPageMeta(() => {
      const page = this.organization();
      if (!page || !this.leagueRows() || !this.locationRows()) return null;
      const sport = this.sport();
      const inCity = page.cityState === undefined ? '' : ` in ${page.cityState}`;
      if (!sport) {
        return {
          title: `${page.name} | Omni League`,
          ogTitle: page.name,
          ogDescription: `Leagues and locations of ${page.name} on Omni League${inCity}.`,
          ogType: 'website',
          path: organizationPath(page.slug),
        };
      }
      return {
        title: `${sport.name} | ${page.name} | Omni League`,
        ogTitle: `${sport.name} | ${page.name}`,
        ogDescription: `${sport.name} leagues and locations of ${page.name} on Omni League${inCity}.`,
        ogType: 'website',
        path: sportViewCanonicalPath(page.slug, sport.segment, this.leaguePaging()?.page ?? 1),
      };
    });
  }
}
