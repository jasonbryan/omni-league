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
import {
  DIVISIONLESS_PROGRAM_TYPES,
  SEARCHABLE_PROGRAM_TYPES,
  type ProgramType,
} from '../../../convex/lib/programs';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { sportName, sportSegment, type Sport } from '../../../convex/lib/sports';
import { api, injectOnline, injectQuery, skipToken } from '../core/data/convex';
import { parseListPage } from '../core/list-page';
import { injectNow } from '../core/now';
import { bindPageMeta } from '../core/page-meta';
import { NotSavedView } from '../offline/not-saved-view';
import {
  YOUTH_FIRST_AGE_ORDER,
  divisionFilterQueryArgs,
  filterGroups,
} from '../organizations/division-filters';
import { draftLeagueCount } from '../organizations/filter-draft';
import { LeagueFilters } from '../organizations/league-filters';
import { injectPageLoadWait } from '../public-layout/page-load-wait';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';
import { FindContent, type FindPaging, type FindStatus } from './find-content';
import { FindOrganizationsList, type OrganizationsState } from './find-organizations';
import { FIND_PATH, findPath, findQuery, organizationsPath } from './find-path';
import { FindSportChips } from './find-sport-chips';
import type { FindBrowseResults, FindOrganizations } from './find-types';
import { FindTypeChips } from './find-type-chips';
import { parseFindView } from './find-view';
import { PROGRAM_TYPE_WORDS } from './program-type';

const TITLE = 'Find a program | Omni League';

@Component({
  selector: 'app-find-page',
  imports: [
    FindContent,
    FindOrganizationsList,
    FindSportChips,
    FindTypeChips,
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
            [type]="type()"
            [sport]="sport()"
            [filters]="filters()"
            [paging]="paging()"
            [busy]="browseBusy()"
            [retryHref]="retryHref()"
            (searched)="search($event)"
          >
            <div findChips>
              <app-find-type-chips
                [query]="query()"
                [type]="type()"
                [sport]="sport()"
                [filters]="filters()"
                [offered]="offeredTypes()"
              />
              <app-find-sport-chips
                [query]="query()"
                [type]="type()"
                [sport]="sport()"
                [filters]="filters()"
              />
            </div>
            @if (mode() !== 'organizations') {
              <app-league-filters
                findFilters
                rule="above"
                [path]="path"
                [sportView]="false"
                [filters]="formFilters()"
                [groups]="filterGroupsOffered()"
                [total]="leagueTotal()"
                [matching]="matchingCount()"
                [filterExempt]="divisionlessCount()"
                [facets]="facets()"
                [sport]="sport()"
                [queryBuilder]="queryBuilder()"
                [noun]="noun()"
                [kind]="kind"
                [ageOrder]="ageOrder"
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
  protected readonly type = computed(() => this.parsedView().type);
  protected readonly sport = computed(() => this.parsedView().sport);
  // A view that lists organizations offers no filter, so one in the URL is ignored there, not kept out of sight in the links.
  protected readonly filters = computed(() =>
    this.mode() === 'organizations' ? NO_DIVISION_FILTERS : this.parsedView().filters,
  );
  // A camp or a training program has no division, so on their types a filter in the URL narrows nothing; the links keep it for the types it does narrow.
  protected readonly formFilters = computed(() => {
    const type = this.type();
    return type !== undefined && DIVISIONLESS_PROGRAM_TYPES.includes(type)
      ? NO_DIVISION_FILTERS
      : this.filters();
  });
  private readonly filterArgs = computed(() => divisionFilterQueryArgs(this.filters()));

  protected readonly mode = computed(() => {
    if (this.query() !== '') return 'search';
    return this.sport() === undefined && this.type() === undefined ? 'organizations' : 'browse';
  });

  protected readonly path = FIND_PATH;
  protected readonly kind = { singular: 'program', plural: 'programs' };
  protected readonly ageOrder = YOUTH_FIRST_AGE_ORDER;

  protected readonly noun = computed(() => {
    const [type, sport] = [this.type(), this.sport()];
    const typeNoun = type === undefined ? 'program' : PROGRAM_TYPE_WORDS[type].noun;
    return sport === undefined ? typeNoun : `${sportName(sport).toLowerCase()} ${typeNoun}`;
  });

  protected readonly results = injectQuery(api.search.programs, () => {
    if (this.mode() !== 'search') return skipToken;
    const [type, sport] = [this.type(), this.sport()];
    return {
      q: this.query(),
      ...(type !== undefined && { type }),
      ...(sport !== undefined && { sport }),
      withCamps: true,
      withTraining: true,
      ...this.filterArgs(),
    };
  });

  // Read from every value of `page`, so a repeated or malformed one is page 1; only a search ignores it.
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );

  private readonly browseResults = injectQuery(api.search.programsBrowse, () => {
    if (this.mode() !== 'browse') return skipToken;
    const [type, sport] = [this.type(), this.sport()];
    return {
      ...(type !== undefined && { type }),
      ...(sport !== undefined && { sport }),
      withCamps: true,
      withTraining: true,
      ...this.filterArgs(),
      page: this.requestedPage(),
    };
  });

  protected readonly organizations = injectQuery(api.search.organizations, () =>
    this.mode() === 'organizations' ? { page: this.requestedPage() } : skipToken,
  );

  // Online, the previous page stays while the next one loads, and a chip's type or sport shows the skeleton; offline, a page with no saved copy shows the not-saved view instead.
  private readonly shownBrowseResults = linkedSignal<
    {
      value: FindBrowseResults | undefined;
      online: boolean;
      type: ProgramType | undefined;
      sport: Sport | undefined;
    },
    | { type: ProgramType | undefined; sport: Sport | undefined; value: FindBrowseResults }
    | undefined
  >({
    source: () => ({
      value: this.browseResults.value(),
      online: this.online(),
      type: this.type(),
      sport: this.sport(),
    }),
    computation: ({ value, online, type, sport }, previous) => {
      if (value !== undefined) return { type, sport, value };
      const held = previous?.value;
      return online && held !== undefined && held.type === type && held.sport === sport
        ? held
        : undefined;
    },
  });

  protected readonly browseBusy = computed(
    () => this.shownBrowseResults() !== undefined && this.browseResults.value() === undefined,
  );

  protected readonly shownResults = computed(() =>
    this.mode() === 'browse' ? this.shownBrowseResults()?.value : this.results.value(),
  );

  protected readonly paging = computed((): FindPaging | undefined => {
    const value = this.mode() === 'browse' ? this.shownBrowseResults()?.value : undefined;
    return value && { page: value.page, pageCount: value.pageCount, total: value.total };
  });

  // The start view has no counts, so it offers each type a search lists; a search or a browse offers those with a match. The counts do not depend on the chosen type, so the last answer's types stay while the next loads and no chip moves.
  protected readonly offeredTypes = linkedSignal<
    readonly ProgramType[] | undefined,
    readonly ProgramType[] | undefined
  >({
    source: () =>
      this.mode() === 'organizations'
        ? SEARCHABLE_PROGRAM_TYPES
        : this.shownResults()?.typeCounts.map(({ type }) => type),
    computation: (types, previous) => types ?? previous?.value,
  });

  // A copy saved before the facets existed has none, so it still shows, with nothing to offer.
  protected readonly facets = computed(() => {
    const value = this.shownResults();
    return value && (value.facets ?? []);
  });
  // The division filters never narrow a camp or a training program, which add no facet, so they are added to each count the form shows.
  private readonly divisionlessCount = computed(() => {
    const type = this.type();
    return (this.shownResults()?.typeCounts ?? [])
      .filter(
        (entry) =>
          DIVISIONLESS_PROGRAM_TYPES.includes(entry.type) &&
          (type === undefined || type === entry.type),
      )
      .reduce((sum, entry) => sum + entry.count, 0);
  });
  protected readonly leagueTotal = computed(() => {
    const facets = this.shownResults()?.facets;
    return facets && facets.length + this.divisionlessCount();
  });
  protected readonly filterGroupsOffered = computed(() => {
    const facets = this.facets();
    return facets && filterGroups(facets, this.formFilters(), this.sport(), YOUTH_FIRST_AGE_ORDER);
  });

  // While a filter change loads, the held page is the previous filters' result, so its count is not shown.
  protected readonly matchingCount = computed(() => {
    const facets = this.facets();
    if (facets === undefined || this.browseBusy() || !hasDivisionFilters(this.formFilters())) {
      return undefined;
    }
    return draftLeagueCount(
      facets,
      this.formFilters(),
      undefined,
      this.sport(),
      facets.length + this.divisionlessCount(),
      this.divisionlessCount(),
    );
  });

  protected readonly queryBuilder = computed(() => {
    const [q, type, sport] = [this.query(), this.type(), this.sport()];
    return (filters: DivisionFilters) => findQuery(q, { type, sport, filters });
  });

  /** The type, the search, and the sport, which the filter form keeps when it submits before hydration. */
  protected readonly carried = computed(() => {
    const [type, sport] = [this.type(), this.sport()];
    return [
      ...(type === undefined ? [] : [{ name: 'type', value: type }]),
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
    const view = { type: this.type(), sport: this.sport(), filters: this.filters() };
    if (this.mode() === 'organizations') return organizationsPath(this.requestedPage());
    return findPath(this.query(), {
      ...view,
      page: this.mode() === 'browse' ? this.requestedPage() : 1,
    });
  });

  private readonly failed = computed(
    () => (this.mode() === 'browse' ? this.browseResults : this.results).error() !== undefined,
  );
  private readonly searching = computed(
    () => this.mode() !== 'organizations' && !this.failed() && this.shownResults() === undefined,
  );
  // Offline, the not-saved view replaces the skeleton, so no timer runs.
  private readonly waitedOut = injectPageLoadWait(
    () => this.searching() && this.online(),
    () => this.retryHref(),
  );

  protected readonly status = computed((): FindStatus => {
    if (this.mode() === 'organizations') return 'start';
    if (this.failed()) return 'error';
    if (!this.searching()) return 'results';
    return this.waitedOut() ? 'error' : 'searching';
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
      this.browseResults.savedAt(),
      this.organizations.savedAt(),
    ].filter((time) => time !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  constructor() {
    bindPageMeta(() => {
      if (this.view() !== 'page') return null;
      const query = this.query();
      const browseOnly = this.mode() === 'browse' && !hasDivisionFilters(this.filters());
      return {
        title: this.title(),
        ogTitle: 'Find a program',
        ogDescription:
          this.mode() === 'organizations'
            ? 'Find beach volleyball, soccer, and softball leagues, tournaments, camps, and training programs on Omni League.'
            : `Find ${this.noun()}s on Omni League.`,
        ogType: 'website',
        // The page of the query result, never the request's, so the canonical holds only an integer.
        path: this.canonicalPath(browseOnly),
        noindex: query !== '' || hasDivisionFilters(this.filters()),
      };
    });
  }

  private title(): string {
    const [type, sport] = [this.type(), this.sport()];
    if (this.query() !== '') return `${this.query()} | ${TITLE}`;
    if (this.mode() === 'organizations') return TITLE;
    const typeWords = type === undefined ? undefined : PROGRAM_TYPE_WORDS[type].chip;
    if (sport === undefined) return `${typeWords} | ${TITLE}`;
    return `${typeWords === undefined ? sportName(sport) : `${sportName(sport)} ${typeWords.toLowerCase()}`} | ${TITLE}`;
  }

  private canonicalPath(browseOnly: boolean): string {
    if (this.mode() === 'organizations') {
      return organizationsPath(this.organizations.value()?.page ?? 1);
    }
    if (!browseOnly) return FIND_PATH;
    return findPath('', {
      type: this.type(),
      sport: this.sport(),
      page: this.browseResults.value()?.page ?? 1,
    });
  }

  protected search(query: string): void {
    void this.router.navigate([FIND_PATH], {
      queryParams: findQuery(query, {
        type: this.type(),
        sport: this.sport(),
        filters: this.filters(),
      }),
    });
  }
}
