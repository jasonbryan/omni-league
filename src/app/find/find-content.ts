import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideCircleAlert, lucideSearch } from '@ng-icons/lucide';
import {
  NO_DIVISION_FILTERS,
  hasDivisionFilters,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { sportName, sportSegment, type Sport } from '../../../convex/lib/sports';
import { isPlainClick } from '../shell/follow-link';
import { SavedCopyNote } from '../offline/saved-copy-note';
import type { LeagueFacet } from '../organizations/division-filters';
import { hiddenDraftInputs } from '../organizations/filter-draft';
import { noMatchSentence, removalSuggestions } from '../organizations/no-match-suggestions';
import { OrganizationMark } from '../organizations/organization-mark';
import { PageControl } from '../organizations/page-control';
import { publicLeaguePath } from '../organizations/public-league/public-league-path';
import { publicPageNames } from '../organizations/public-league/public-page-names';
import { leagueSeasonStatus } from '../organizations/season-status';
import { HlmBadge } from '../ui/badge';
import { OUTLINE_BUTTON, SEARCH_BUTTON } from '../ui/button/button-classes';
import { FIND_PATH, findPath, findQuery, type FindResultRow } from './find-path';
import { FindSkeleton } from './find-skeleton';

export type FindStatus = 'start' | 'searching' | 'results' | 'error';

/** What a search finds, named once so the page's copy follows the noun. */
const RESULT_NOUN = 'league';

/** The leagues of a search or of a sport, whichever the page asked for. */
export interface FindRows {
  readonly rows: readonly FindResultRow[];
  readonly more?: boolean;
  readonly suggestions?: readonly string[];
  readonly facets?: readonly LeagueFacet[];
}

export interface FindPaging {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

const LINK_CLASSES =
  'rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring';

const TEXT_LINK_CLASSES =
  'inline-flex items-center rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11';

const REMOVE_BUTTON = `${OUTLINE_BUTTON} h-auto! min-h-9 max-w-full whitespace-normal! py-1.5 text-start`;

const CLEAR_BUTTON = `${OUTLINE_BUTTON} mt-4 pointer-coarse:h-11`;

@Component({
  selector: 'app-find-content',
  imports: [
    FindSkeleton,
    HlmBadge,
    NgIcon,
    OrganizationMark,
    PageControl,
    RouterLink,
    SavedCopyNote,
  ],
  providers: [provideIcons({ lucideChevronRight, lucideCircleAlert, lucideSearch })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:px-8 md:pt-14 md:pb-8">
      <h1 class="text-3xl font-semibold tracking-tight md:text-5xl">Find a league</h1>
      <p class="mt-2 text-muted-foreground md:mt-3 md:text-lg">
        Beach volleyball, soccer, and softball leagues on Omni League.
      </p>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
      <!-- A plain GET form, so a search works before hydration; after it, the page keeps the URL and navigates through the router. -->
      <form
        role="search"
        [action]="action"
        method="get"
        class="mt-6 max-w-2xl"
        (submit)="submit($event)"
      >
        <label for="find-q" class="text-sm font-medium">League, organization, or location</label>
        <div class="mt-2 flex gap-2">
          <div class="relative min-w-0 flex-1">
            <ng-icon
              name="lucideSearch"
              class="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground"
              aria-hidden="true"
            />
            <input
              #field
              id="find-q"
              name="q"
              type="search"
              autocomplete="off"
              class="h-12 w-full rounded-full border border-input bg-card ps-11 pe-4 text-base"
              [value]="draft()"
              (input)="draft.set($any($event.target).value)"
            />
          </div>
          <button type="submit" data-slot="button" [class]="searchButton">Search</button>
        </div>
        @for (field of carried(); track $index) {
          <input type="hidden" [attr.name]="field.name" [attr.value]="field.value" />
        }
      </form>
      <ng-content select="[findChips]" />
    </div>
    <ng-content select="[findFilters]" />
    @if (status() !== 'start') {
      <div>
        <section
          aria-labelledby="results-heading"
          class="mx-auto w-full max-w-6xl px-4 md:px-8"
          [class]="sectionSpacing()"
        >
          <h2 #resultsHeading id="results-heading" tabindex="-1" class="sr-only focus:outline-none">
            Results
          </h2>
          @switch (status()) {
            @case ('searching') {
              <app-find-skeleton [withCount]="query() !== ''" />
            }
            @case ('error') {
              <div
                data-slot="alert"
                role="alert"
                class="group/alert relative grid w-full max-w-xl gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-start text-sm text-destructive has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]"
              >
                <ng-icon name="lucideCircleAlert" aria-hidden="true" />
                <div class="col-start-2 font-medium">The search could not be completed.</div>
                <div class="col-start-2 text-sm text-balance text-muted-foreground">
                  Check your connection, then try again. Your search is kept above.
                </div>
                <a
                  [href]="retryHref()"
                  class="col-start-2 mt-1 inline-flex w-fit items-center rounded-md font-medium text-foreground underline underline-offset-4 pointer-coarse:min-h-11"
                  >Try again</a
                >
              </div>
            }
            @default {
              @if (rows().length > 0) {
                @if (query() !== '') {
                  <p
                    #resultStatus
                    role="status"
                    tabindex="-1"
                    class="text-sm text-muted-foreground"
                  >
                    {{ countLine() }}
                  </p>
                }
                <ul
                  role="list"
                  class="mt-2 max-w-3xl divide-y divide-border"
                  [attr.aria-busy]="busy() ? 'true' : null"
                >
                  @for (row of rows(); track row.href) {
                    <li class="group relative">
                      <div class="flex min-h-18 items-center gap-4 py-4">
                        <app-organization-mark
                          size="row"
                          [name]="row.organizationName"
                          [logoUrl]="row.logoUrl"
                        />
                        <div class="min-w-0 flex-1">
                          <h3 class="font-medium">
                            <a [routerLink]="row.href" [state]="row.names" [class]="linkClasses">{{
                              row.name
                            }}</a>
                          </h3>
                          @if (row.divisionLabel) {
                            <p class="mt-0.5 text-sm font-medium">{{ row.divisionLabel }}</p>
                          }
                          <p class="mt-0.5 text-sm text-muted-foreground">{{ row.where }}</p>
                          @if (row.status; as status) {
                            <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                              @if (status.badge && status.badgeVariant; as variant) {
                                <span hlmBadge size="fit" [variant]="variant">{{
                                  status.badge
                                }}</span>
                              }
                              <span class="text-xs text-muted-foreground">{{ status.text }}</span>
                            </p>
                          }
                        </div>
                        <ng-icon
                          name="lucideChevronRight"
                          class="shrink-0 text-lg text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>
                    </li>
                  }
                </ul>
                @if (paging(); as paging) {
                  <div class="-mx-4 mt-2 md:-mx-5">
                    <app-page-control
                      label="Leagues pages"
                      noun="leagues"
                      [page]="paging.page"
                      [pageCount]="paging.pageCount"
                      [total]="paging.total"
                      [path]="action"
                      [fragment]="undefined"
                      [queryFor]="pageQuery()"
                      (pageActivated)="pageRequested = true"
                    />
                  </div>
                }
              } @else if (emptyKind() === 'filters') {
                <div class="flex max-w-md flex-col items-start">
                  <p #resultStatus role="status" tabindex="-1" class="font-medium">
                    {{ filtersHeading() }}
                  </p>
                  @if (query() === '') {
                    <p class="mt-1 text-sm text-muted-foreground">
                      {{ noMatchSentence() }} Remove a filter to see more.
                    </p>
                  } @else {
                    <p class="mt-1 text-sm text-muted-foreground">Remove a filter to see more.</p>
                  }
                  @if (removals().length > 0) {
                    <ul role="list" class="mt-4 flex flex-wrap gap-2">
                      @for (removal of removals(); track removal.label) {
                        <li class="max-w-full">
                          <a
                            [routerLink]="action"
                            [queryParams]="removal.query"
                            data-slot="button"
                            [class]="removeButton"
                            (click)="followed('status', $event)"
                            >Remove {{ removal.label }}
                            <span class="whitespace-nowrap text-muted-foreground">{{
                              removal.text
                            }}</span></a
                          >
                        </li>
                      }
                    </ul>
                  }
                  <a
                    [routerLink]="action"
                    [queryParams]="clearFiltersQuery()"
                    data-slot="button"
                    [class]="clearButton"
                    (click)="followed('status', $event)"
                    >Clear all</a
                  >
                </div>
              } @else if (emptyKind() === 'sport') {
                <div class="flex max-w-md flex-col items-start">
                  <p #resultStatus role="status" tabindex="-1" class="font-medium">
                    No {{ noun() }}s are published yet
                  </p>
                  <p class="mt-1 text-sm text-muted-foreground">
                    A league appears here once its organization publishes it.
                  </p>
                  <a
                    [routerLink]="action"
                    [class]="clearClasses"
                    (click)="followed('status', $event)"
                    >All sports</a
                  >
                </div>
              } @else {
                <div class="flex max-w-md flex-col items-start">
                  <p #resultStatus role="status" tabindex="-1" class="font-medium">
                    No {{ noun() }}s match “{{ query() }}”
                  </p>
                  <p class="mt-1 text-sm text-muted-foreground">
                    Omni League has beach volleyball, soccer, and softball leagues. Try a league
                    name, an organization, or a location such as “North Beach”.
                  </p>
                  @if (suggestions().length > 0) {
                    <p id="suggestions-heading" class="mt-4 text-sm font-medium">
                      Try fewer words:
                    </p>
                    <ul role="list" aria-labelledby="suggestions-heading" class="mt-1">
                      @for (suggestion of suggestions(); track suggestion) {
                        <li>
                          <a
                            [routerLink]="action"
                            [queryParams]="suggestionQuery(suggestion)"
                            [class]="suggestionClasses"
                            (click)="followed('status', $event)"
                            >{{ suggestion }}</a
                          >
                        </li>
                      }
                    </ul>
                  }
                  <a
                    [routerLink]="action"
                    [queryParams]="clearSearchQuery()"
                    [class]="clearClasses"
                    (click)="followed('field', $event)"
                    >Clear the search</a
                  >
                </div>
              }
            }
          }
        </section>
      </div>
    }
  `,
})
export class FindContent {
  /** The parsed search; empty before one. */
  readonly query = input.required<string>();
  readonly status = input.required<FindStatus>();
  readonly results = input<FindRows | undefined>(undefined);
  readonly now = input.required<number>();
  readonly savedAt = input<number | undefined>(undefined);
  readonly sport = input<Sport | undefined>(undefined);
  readonly filters = input<DivisionFilters>(NO_DIVISION_FILTERS);
  readonly paging = input<FindPaging | undefined>(undefined);
  /** The shown rows are the previous view's, held while the next loads. */
  readonly busy = input(false);
  readonly retryHref = input.required<string>();
  readonly searched = output<string>();

  protected readonly action = FIND_PATH;
  protected readonly searchButton = SEARCH_BUTTON;
  protected readonly linkClasses = LINK_CLASSES;
  protected readonly suggestionClasses = TEXT_LINK_CLASSES;
  protected readonly clearClasses = `mt-4 ${TEXT_LINK_CLASSES}`;
  protected readonly removeButton = REMOVE_BUTTON;
  protected readonly clearButton = CLEAR_BUTTON;

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly resultStatus = viewChild<ElementRef<HTMLElement>>('resultStatus');
  private readonly resultsHeading = viewChild<ElementRef<HTMLElement>>('resultsHeading');
  private readonly injector = inject(Injector);
  private readonly pendingFocus = signal<{ target: 'status' | 'field'; from: string } | null>(null);

  protected pageRequested = false;

  protected readonly draft = linkedSignal(() => this.query());

  /** What the search form submits besides the words, so a new search stays in its sport and filters. */
  protected readonly carried = computed(() => {
    const sport = this.sport();
    return [
      ...(sport === undefined ? [] : [{ name: 'sport', value: sportSegment(sport) }]),
      ...hiddenDraftInputs(this.filters(), []),
    ];
  });

  protected readonly noun = computed(() => {
    const sport = this.sport();
    return sport === undefined ? RESULT_NOUN : `${sportName(sport).toLowerCase()} ${RESULT_NOUN}`;
  });

  /** What the followed links change, so focus waits for the view that replaces this one. */
  private readonly viewKey = computed(() =>
    findPath(this.query(), { sport: this.sport(), filters: this.filters() }),
  );

  private readonly facets = computed(() => this.results()?.facets ?? []);

  // The facets are the matches before the division filters, so any of them with no row left means the filters, not the words, excluded them.
  protected readonly emptyKind = computed((): 'rows' | 'filters' | 'sport' | 'words' => {
    if (this.rows().length > 0) return 'rows';
    if (hasDivisionFilters(this.filters()) && this.facets().length > 0) return 'filters';
    return this.query() === '' ? 'sport' : 'words';
  });

  protected readonly filtersHeading = computed(() =>
    this.query() === ''
      ? `No ${this.noun()}s match these filters`
      : `No ${this.noun()}s match “${this.query()}” with these filters`,
  );

  protected readonly noMatchSentence = computed(() => {
    const sport = this.sport();
    return noMatchSentence(
      'Omni League',
      this.filters(),
      sport === undefined ? undefined : sportName(sport),
    );
  });

  protected readonly removals = computed(() =>
    removalSuggestions({
      facets: this.facets(),
      filters: this.filters(),
      sportLeagueCounts: undefined,
      sport: this.sport(),
      total: this.facets().length,
      queryFor: (without) => findQuery(this.query(), { sport: this.sport(), filters: without }),
    }),
  );

  protected readonly clearFiltersQuery = computed(() =>
    findQuery(this.query(), { sport: this.sport() }),
  );
  protected readonly clearSearchQuery = computed(() =>
    findQuery('', { sport: this.sport(), filters: this.filters() }),
  );

  protected readonly pageQuery = computed(() => {
    const [q, sport, filters] = [this.query(), this.sport(), this.filters()];
    return (page: number) => findQuery(q, { sport, filters, page });
  });

  protected suggestionQuery(suggestion: string) {
    return findQuery(suggestion, { sport: this.sport(), filters: this.filters() });
  }

  protected readonly rows = computed(() =>
    (this.results()?.rows ?? []).map((league) => ({
      href: publicLeaguePath(league.organization.slug, league.slug),
      names: publicPageNames({ organization: league.organization, league }),
      name: league.name,
      organizationName: league.organization.name,
      logoUrl: league.organization.logoUrl,
      divisionLabel: league.divisionLabel,
      where: [league.organization.name, league.locationNames.join(', ')]
        .filter(Boolean)
        .join(' · '),
      status: leagueSeasonStatus(league.seasons, this.now()),
    })),
  );

  protected readonly suggestions = computed(() => this.results()?.suggestions ?? []);

  protected readonly countLine = computed(() => {
    const count = this.rows().length;
    if (this.results()?.more) {
      return `Showing the first ${count}. Add a word to narrow the search.`;
    }
    return count === 1
      ? `1 ${this.noun()} matches “${this.query()}”`
      : `${count} ${this.noun()}s match “${this.query()}”`;
  });

  // The filter bar above has no bottom padding, so a count line or an alert needs a top one; a list has its own top margin.
  protected readonly sectionSpacing = computed(() => {
    if (this.status() === 'results' && this.rows().length === 0) return 'py-10 md:py-16';
    const needsTop = this.query() !== '' || this.status() === 'error';
    return `${needsTop ? 'pt-3 ' : ''}pb-6 md:pb-10`;
  });

  constructor() {
    // Focus moves only for a click on a page link: a live update of the shown page leaves it alone.
    effect(() => {
      this.results();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.resultsHeading()?.nativeElement.focus(), {
          injector: this.injector,
        });
      });
    });
    // The followed link leaves the page with the old results, so focus waits for the new ones.
    afterRenderEffect(() => {
      const pending = this.pendingFocus();
      if (!pending || pending.from === this.viewKey()) return;
      if (pending.target === 'field') {
        this.field().nativeElement.focus();
      } else {
        if (this.status() !== 'results') return;
        this.resultStatus()?.nativeElement.focus();
      }
      this.pendingFocus.set(null);
    });
  }

  protected followed(target: 'status' | 'field', event: MouseEvent): void {
    if (isPlainClick(event)) this.pendingFocus.set({ target, from: this.viewKey() });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.pendingFocus.set(null);
    this.searched.emit(parseSearchQuery([this.draft()]));
  }
}
