import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  type Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { api } from '../../../convex/_generated/api';
import { filterSport, filtersInScope, hasDivisionFilters } from '../../../convex/lib/leagueFilters';
import { sportFromSegment } from '../../../convex/lib/sports';
import { AuthService } from '../core/auth/auth.service';
import { injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { parseListPage } from '../core/list-page';
import { injectNow } from '../core/now';
import { bindPageMeta } from '../core/page-meta';
import { NotFoundView } from '../not-found/not-found-view';
import { NotSavedView } from '../offline/not-saved-view';
import { ServerErrorView } from '../server-error/server-error-view';
import { PageLoadStatus } from '../public-layout/page-load-status';
import { injectPageLoadWait } from '../public-layout/page-load-wait';
import { PublicLayout } from '../public-layout/public-layout';
import { OrganizationOverview, type ListPaging } from './organization-overview';
import { OrganizationSkeleton } from './organization-skeleton';
import { listPagesPath } from './organization-path';
import { divisionFilterQueryArgs, filterGroups, parseDivisionFilters } from './division-filters';
import { openSeasonsBySoonestDeadline } from './season-status';

type PublicLeagues = FunctionReturnType<typeof api.organizations.listPublicLeagues>;
type PublicLocations = FunctionReturnType<typeof api.organizations.listPublicLocations>;

/** Offline, a page with no saved copy shows nothing, so the not-saved view takes its place: the previous rows would sit under another page's URL, and the load would never end. */
function holdPreviousPage<T>(
  key: () => string,
  value: () => T | undefined,
  online: () => boolean,
): Signal<{ key: string; value: T } | undefined> {
  return linkedSignal<
    { key: string; value: T | undefined; online: boolean },
    { key: string; value: T } | undefined
  >({
    source: () => ({ key: key(), value: value(), online: online() }),
    computation: (current, previous) => {
      if (current.value !== undefined) return { key: current.key, value: current.value };
      return current.online && previous?.value?.key === current.key ? previous.value : undefined;
    },
  });
}

function pagingOf(list: { page: number; pageCount: number; total: number }): ListPaging {
  return { page: list.page, pageCount: list.pageCount, total: list.total };
}

/**
 * Each page is read with `parseListPage` from every value of its parameter, so the HTML holds only the page numbers the query results give.
 * A segment that names no sport asks no query, because the queries validate their `sport` argument and would fail with a 503 instead of a 404.
 */
@Component({
  selector: 'app-organization-page',
  imports: [
    NotFoundView,
    NotSavedView,
    OrganizationOverview,
    OrganizationSkeleton,
    PageLoadStatus,
    PublicLayout,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (shownOrganization(); as organization) {
        <app-organization-overview
          [page]="organization"
          [leagues]="leagueRows()"
          [locations]="locationRows()"
          [sport]="sport()"
          [leaguePaging]="leaguePaging()"
          [locationPaging]="locationPaging()"
          [leaguesBusy]="leaguesBusy()"
          [locationsBusy]="locationsBusy()"
          [savedAt]="savedAt()"
          [openSeasons]="openSeasons()"
          [now]="now()"
          [canManage]="viewerIsOrgAdmin.value() === true"
          [filters]="filters()"
          [filterGroups]="filterGroups()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [publicSite]="true" />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="requestedPagesPath()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="requestedPagesPath()" />
      } @else {
        <app-organization-skeleton />
      }
      <app-page-load-status [stalled]="stalled()" />
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
    this.route.paramMap.pipe(map((params) => params.get('sport') ?? undefined)),
    { requireSync: true },
  );
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly requestedPages = computed(() => {
    const params = this.queryParams();
    return {
      leagues: parseListPage(params.getAll('leagues')),
      page: parseListPage(params.getAll('page')),
      locations: parseListPage(params.getAll('locations')),
    };
  });

  private readonly sportKey = computed(() => {
    const segment = this.segment();
    return segment === undefined ? undefined : sportFromSegment(segment);
  });
  private readonly unknownSport = computed(
    () => this.segment() !== undefined && this.sportKey() === undefined,
  );
  private readonly leaguesPage = computed(() => {
    const pages = this.requestedPages();
    return this.segment() === undefined ? pages.leagues : pages.page;
  });
  private readonly locationsPage = computed(() => this.requestedPages().locations);
  private readonly listArgs = computed(() => {
    const sport = this.sportKey();
    return sport ? { sport } : {};
  });
  // On All sports the organization's sports are not known until its header arrives, so the URL may name any sport's format or level, and the query drops what does not apply, as the page does below.
  private readonly requestedFilters = computed(() =>
    parseDivisionFilters(this.queryParams(), this.sportKey()),
  );
  private readonly filterArgs = computed(() => divisionFilterQueryArgs(this.requestedFilters()));

  private readonly header = injectQuery(api.organizations.getPublicPage, () =>
    this.unknownSport() ? skipToken : { slug: this.slug() },
  );
  private readonly leagues = injectQuery(api.organizations.listPublicLeagues, () =>
    this.unknownSport()
      ? skipToken
      : {
          slug: this.slug(),
          page: this.leaguesPage(),
          ...this.listArgs(),
          ...this.filterArgs(),
        },
  );
  private readonly locations = injectQuery(api.organizations.listPublicLocations, () =>
    this.unknownSport()
      ? skipToken
      : { slug: this.slug(), page: this.locationsPage(), ...this.listArgs() },
  );
  private readonly openSeasonRows = injectQuery(api.seasons.listOpenForOrganization, () =>
    this.unknownSport()
      ? skipToken
      : { orgSlug: this.slug(), ...this.listArgs(), ...this.filterArgs() },
  );
  private readonly facets = injectQuery(api.organizations.listPublicLeagueFacets, () =>
    this.unknownSport() ? skipToken : { slug: this.slug(), ...this.listArgs() },
  );
  // Signed-out views and the server render skip it, so signed-out visitors cost no extra function call.
  protected readonly viewerIsOrgAdmin = injectQuery(api.organizations.viewerIsOrgAdmin, () =>
    this.auth.convexAuthenticated() ? { slug: this.slug() } : skipToken,
  );
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  private readonly listKey = computed(() => `${this.slug()}/${this.segment()}`);
  private readonly shownLeagues = holdPreviousPage<PublicLeagues>(
    this.listKey,
    this.leagues.value,
    this.online,
  );
  private readonly shownLocations = holdPreviousPage<PublicLocations>(
    this.listKey,
    this.locations.value,
    this.online,
  );

  /** The sport whose formats and levels apply, read from the same `sportLeagueCounts` as the queries. */
  private readonly filterSport = computed(() => {
    const header = this.header.value();
    return header
      ? filterSport(
          this.sportKey(),
          header.sports.map((sport) => sport.key),
        )
      : undefined;
  });

  protected readonly filters = computed(() =>
    this.header.value()
      ? filtersInScope(this.requestedFilters(), this.filterSport())
      : this.requestedFilters(),
  );

  // A copy saved before the filters existed has no facets, so offline without one the page still shows, with nothing to offer.
  protected readonly filterGroups = computed(() => {
    const facets = this.facets.value() ?? (this.online() ? undefined : []);
    return facets && filterGroups(facets, this.filters(), this.filterSport());
  });

  protected readonly requestedPagesPath = computed(() =>
    listPagesPath(
      this.slug(),
      this.segment(),
      { leagues: this.leaguesPage(), locations: this.locationsPage() },
      this.filters(),
    ),
  );

  private readonly failed = computed(
    () =>
      this.header.error() !== undefined ||
      this.leagues.error() !== undefined ||
      this.locations.error() !== undefined ||
      this.openSeasonRows.error() !== undefined ||
      this.facets.error() !== undefined,
  );

  protected readonly sport = computed(() =>
    this.header.value()?.sports.find((entry) => entry.key === this.sportKey()),
  );

  private readonly noLeagueInSport = computed(
    () => this.sportKey() !== undefined && !!this.header.value() && !this.sport(),
  );

  protected readonly leagueRows = computed(() => this.shownLeagues()?.value.rows);
  protected readonly locationRows = computed(() => this.shownLocations()?.value.rows);

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
    return leagues && pagingOf(leagues);
  });
  protected readonly locationPaging = computed(() => {
    const locations = this.shownLocations()?.value;
    return locations && pagingOf(locations);
  });

  protected readonly leaguesBusy = computed(
    () => this.shownLeagues() !== undefined && this.leagues.value() === undefined,
  );
  protected readonly locationsBusy = computed(
    () => this.shownLocations() !== undefined && this.locations.value() === undefined,
  );

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [
      this.header.savedAt(),
      this.leagues.savedAt(),
      this.locations.savedAt(),
      this.openSeasonRows.savedAt(),
      this.facets.savedAt(),
    ].filter((time) => time !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  private readonly phase = computed(() => {
    if (this.organization()) return 'page';
    if (this.unknownSport() || this.header.value() === null || this.noLeagueInSport()) {
      return 'not-found';
    }
    if (this.failed()) return 'error';
    const offlineWithoutSavedCopy = !this.online();
    if (offlineWithoutSavedCopy) return 'not-saved';
    return 'loading';
  });

  private readonly waiting = computed(
    () =>
      this.phase() === 'loading' ||
      (this.phase() === 'page' && (this.leaguesBusy() || this.locationsBusy())),
  );
  private readonly waitedOut = injectPageLoadWait(this.waiting, this.requestedPagesPath);
  protected readonly stalled = computed(() => this.waiting() && this.waitedOut());

  protected readonly state = computed(() => (this.stalled() ? 'error' : this.phase()));

  protected readonly shownOrganization = computed(() =>
    this.state() === 'page' ? this.organization() : undefined,
  );

  constructor() {
    bindPageMeta(() => {
      const page = this.shownOrganization();
      const leagues = this.leaguePaging();
      const locations = this.locationPaging();
      if (!page || !leagues || !locations) return null;
      const sport = this.sport();
      const inCity = page.cityState === undefined ? '' : ` in ${page.cityState}`;
      // A filtered view is not indexed, and names the unfiltered first page as its canonical.
      const filtered = hasDivisionFilters(this.filters());
      const pages = filtered
        ? { leagues: 1, locations: 1 }
        : { leagues: leagues.page, locations: locations.page };
      const path = listPagesPath(page.slug, sport?.segment, pages);
      const noindex = filtered ? { noindex: true } : {};
      if (!sport) {
        return {
          title: `${page.name} | Omni League`,
          ogTitle: page.name,
          ogDescription: `Leagues and locations of ${page.name} on Omni League${inCity}.`,
          ogType: 'website',
          path,
          ...noindex,
        };
      }
      return {
        title: `${sport.name} | ${page.name} | Omni League`,
        ogTitle: `${sport.name} | ${page.name}`,
        ogDescription: `${sport.name} leagues and locations of ${page.name} on Omni League${inCity}.`,
        ogType: 'website',
        path,
        ...noindex,
      };
    });
  }
}
