import { isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  NO_DIVISION_FILTERS,
  hasDivisionFilters,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { sportName, sportSegment, type Sport } from '../../../convex/lib/sports';
import { api, injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { parseListPage } from '../core/list-page';
import { injectNow } from '../core/now';
import { bindPageMeta } from '../core/page-meta';
import { NotSavedView } from '../offline/not-saved-view';
import { filterGroups, divisionFilterQueryArgs } from '../organizations/division-filters';
import { draftLeagueCount } from '../organizations/filter-draft';
import { LeagueFilters } from '../organizations/league-filters';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';
import { FindContent, type FindPaging, type FindStatus } from './find-content';
import { FindOrganizationsList, type OrganizationsState } from './find-organizations';
import {
  FIND_PATH,
  findPath,
  findQuery,
  organizationsPath,
  type FindOrganizations,
  type FindSportResults,
} from './find-path';
import { FindSportChips } from './find-sport-chips';
import { parseFindView } from './find-view';

const TITLE = 'Find a league | Omni League';

@Component({
  selector: 'app-find-page',
  imports: [
    FindContent,
    FindOrganizationsList,
    FindSportChips,
    LeagueFilters,
    NotSavedView,
    PublicLayout,
    ServerErrorView,
  ],
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
            [results]="shownResults()"
            [now]="now()"
            [savedAt]="savedAt()"
            [sport]="sport()"
            [filters]="filters()"
            [paging]="paging()"
            [busy]="sportBusy()"
            [retryHref]="retryHref()"
            (searched)="search($event)"
          >
            <app-find-sport-chips
              findChips
              [query]="query()"
              [sport]="sport()"
              [filters]="filters()"
            />
            @if (mode() !== 'organizations') {
              <app-league-filters
                findFilters
                rule="above"
                [path]="path"
                [sportView]="false"
                [filters]="filters()"
                [groups]="filterGroupsOffered()"
                [total]="leagueTotal()"
                [matching]="matchingCount()"
                [facets]="facets()"
                [sport]="sport()"
                [queryBuilder]="queryBuilder()"
                [carried]="carried()"
              />
            }
          </app-find-content>
          @if (mode() === 'organizations') {
            <app-find-organizations
              [state]="organizationsState()"
              [result]="shownOrganizations()"
              [busy]="organizationsBusy()"
              [retryHref]="retryHref()"
            />
          }
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

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly query = computed(() => parseSearchQuery(this.queryParams().getAll('q')));
  private readonly parsedView = computed(() => parseFindView(this.queryParams()));
  protected readonly sport = computed(() => this.parsedView().sport);
  // A view that lists organizations offers no filter, so one in the URL is ignored there, not kept out of sight in the links.
  protected readonly filters = computed(() =>
    this.mode() === 'organizations' ? NO_DIVISION_FILTERS : this.parsedView().filters,
  );
  private readonly filterArgs = computed(() => divisionFilterQueryArgs(this.filters()));

  /** With no search and no sport the page lists organizations, which no filter applies to. */
  protected readonly mode = computed(() => {
    if (this.query() !== '') return 'search';
    return this.sport() === undefined ? 'organizations' : 'sport';
  });

  protected readonly path = FIND_PATH;

  protected readonly results = injectQuery(api.search.leagues, () => {
    if (this.mode() !== 'search') return skipToken;
    const sport = this.sport();
    return {
      q: this.query(),
      ...(sport !== undefined && { sport }),
      ...this.filterArgs(),
    };
  });

  // Read from every value of `page`, so a repeated or malformed one is page 1; only a search ignores it.
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );

  private readonly sportResults = injectQuery(api.search.leaguesBySport, () => {
    const sport = this.sport();
    if (this.mode() !== 'sport' || sport === undefined) return skipToken;
    return { sport, ...this.filterArgs(), page: this.requestedPage() };
  });

  protected readonly organizations = injectQuery(api.search.organizations, () =>
    this.mode() === 'organizations' ? { page: this.requestedPage() } : skipToken,
  );

  // Online, the previous page stays while the next one loads, and a chip's sport shows the skeleton; offline, a page with no saved copy shows the not-saved view instead.
  private readonly shownSportResults = linkedSignal<
    { value: FindSportResults | undefined; online: boolean; sport: Sport | undefined },
    { sport: Sport | undefined; value: FindSportResults } | undefined
  >({
    source: () => ({
      value: this.sportResults.value(),
      online: this.online(),
      sport: this.sport(),
    }),
    computation: ({ value, online, sport }, previous) => {
      if (value !== undefined) return { sport, value };
      const held = previous?.value;
      return online && held?.sport === sport ? held : undefined;
    },
  });

  protected readonly sportBusy = computed(
    () => this.shownSportResults() !== undefined && this.sportResults.value() === undefined,
  );

  protected readonly shownResults = computed(() =>
    this.mode() === 'sport' ? this.shownSportResults()?.value : this.results.value(),
  );

  protected readonly paging = computed((): FindPaging | undefined => {
    const value = this.mode() === 'sport' ? this.shownSportResults()?.value : undefined;
    return value && { page: value.page, pageCount: value.pageCount, total: value.total };
  });

  // A copy saved before the facets existed has none, so it still shows, with nothing to offer.
  protected readonly facets = computed(() => {
    const value = this.shownResults();
    return value && (value.facets ?? []);
  });
  protected readonly leagueTotal = computed(() => this.shownResults()?.facets?.length);
  protected readonly filterGroupsOffered = computed(() => {
    const facets = this.facets();
    return facets && filterGroups(facets, this.filters(), this.sport());
  });

  // While a filter change loads, the held page is the previous filters' result, so its count is not shown.
  protected readonly matchingCount = computed(() => {
    const facets = this.facets();
    if (facets === undefined || this.sportBusy() || !hasDivisionFilters(this.filters())) {
      return undefined;
    }
    return draftLeagueCount(facets, this.filters(), undefined, this.sport(), facets.length);
  });

  protected readonly queryBuilder = computed(() => {
    const [q, sport] = [this.query(), this.sport()];
    return (filters: DivisionFilters) => findQuery(q, { sport, filters });
  });

  /** The search and the sport, which the filter form keeps when it submits before hydration. */
  protected readonly carried = computed(() => {
    const sport = this.sport();
    return [
      ...(this.query() === '' ? [] : [{ name: 'q', value: this.query() }]),
      ...(sport === undefined ? [] : [{ name: 'sport', value: sportSegment(sport) }]),
    ];
  });

  // Online, the previous page stays while the next one loads; offline, a page with no saved copy shows the not-saved view instead.
  protected readonly shownOrganizations = linkedSignal<
    { value: FindOrganizations | undefined; online: boolean },
    FindOrganizations | undefined
  >({
    source: () => ({ value: this.organizations.value(), online: this.online() }),
    computation: ({ value, online }, previous) => value ?? (online ? previous?.value : undefined),
  });

  protected readonly organizationsBusy = computed(
    () => this.shownOrganizations() !== undefined && this.organizations.value() === undefined,
  );

  protected readonly organizationsState = computed((): OrganizationsState => {
    if (this.organizations.error() !== undefined) return 'error';
    return this.shownOrganizations() === undefined ? 'loading' : 'ready';
  });

  protected readonly retryHref = computed(() => {
    const view = { sport: this.sport(), filters: this.filters() };
    if (this.mode() === 'organizations') return organizationsPath(this.requestedPage());
    return findPath(this.query(), {
      ...view,
      page: this.mode() === 'sport' ? this.requestedPage() : 1,
    });
  });

  protected readonly status = computed((): FindStatus => {
    if (this.mode() === 'organizations') return 'start';
    const failed = (this.mode() === 'sport' ? this.sportResults : this.results).error();
    if (failed !== undefined) return 'error';
    return this.shownResults() === undefined ? 'searching' : 'results';
  });

  // The server renders the whole page as the error view so its status is 503; the browser keeps the form and shows an alert in place of the results.
  protected readonly view = computed(() => {
    const failed = this.status() === 'error' || this.organizationsState() === 'error';
    if (failed && this.onServer) return 'server-error';
    const pending =
      this.status() === 'searching' ||
      (this.mode() === 'organizations' && this.organizationsState() === 'loading');
    if (pending && !this.online()) return 'not-saved';
    return 'page';
  });

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [
      this.results.savedAt(),
      this.sportResults.savedAt(),
      this.organizations.savedAt(),
    ].filter((time) => time !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  constructor() {
    bindPageMeta(() => {
      if (this.view() !== 'page') return null;
      const query = this.query();
      const sport = this.sport();
      const sportOnly = this.mode() === 'sport' && !hasDivisionFilters(this.filters());
      return {
        title: this.title(),
        ogTitle: 'Find a league',
        ogDescription:
          sport === undefined
            ? 'Find beach volleyball, soccer, and softball leagues on Omni League.'
            : `Find ${sportName(sport).toLowerCase()} leagues on Omni League.`,
        ogType: 'website',
        // The page of the query result, never the request's, so the canonical holds only an integer.
        path: this.canonicalPath(sportOnly),
        noindex: query !== '' || (sport !== undefined && hasDivisionFilters(this.filters())),
      };
    });
  }

  private title(): string {
    const sport = this.sport();
    if (this.query() !== '') return `${this.query()} | ${TITLE}`;
    return this.mode() === 'sport' && sport !== undefined
      ? `${sportName(sport)} | ${TITLE}`
      : TITLE;
  }

  private canonicalPath(sportOnly: boolean): string {
    if (this.mode() === 'organizations') {
      return organizationsPath(this.organizations.value()?.page ?? 1);
    }
    const sport = this.sport();
    if (!sportOnly || sport === undefined) return FIND_PATH;
    return findPath('', { sport, page: this.sportResults.value()?.page ?? 1 });
  }

  protected search(query: string): void {
    void this.router.navigate([FIND_PATH], {
      queryParams: findQuery(query, { sport: this.sport(), filters: this.filters() }),
    });
  }
}
