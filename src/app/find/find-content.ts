import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideCircleAlert, lucideSearch } from '@ng-icons/lucide';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { SavedCopyNote } from '../offline/saved-copy-note';
import { initials } from '../organizations/initials';
import { publicLeaguePath } from '../organizations/public-league/public-league-path';
import { leagueSeasonStatus, MUTED_BADGE, OPEN_BADGE } from '../organizations/season-status';
import { SEARCH_BUTTON } from '../ui/button/button-classes';
import { FIND_PATH, findPath, type FindResults } from './find-path';
import { FindSkeleton } from './find-skeleton';

export type FindStatus = 'start' | 'searching' | 'results' | 'error';

/** What a search finds, named once so the page's copy follows the noun. */
const RESULT_NOUN = { one: 'league', many: 'leagues' } as const;

const LINK_CLASSES =
  'rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring';

const TEXT_LINK_CLASSES =
  'inline-flex items-center rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11';

@Component({
  selector: 'app-find-content',
  imports: [FindSkeleton, NgIcon, RouterLink, SavedCopyNote],
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
      </form>
    </div>
    @if (status() !== 'start') {
      <div class="border-t border-border">
        <section
          aria-labelledby="results-heading"
          class="mx-auto w-full max-w-6xl px-4 md:px-8"
          [class]="sectionSpacing()"
        >
          <h2 id="results-heading" class="sr-only">Results</h2>
          @switch (status()) {
            @case ('searching') {
              <app-find-skeleton />
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
                <p role="status" class="text-sm text-muted-foreground">{{ countLine() }}</p>
                <ul role="list" class="mt-2 max-w-3xl divide-y divide-border">
                  @for (row of rows(); track row.href) {
                    <li class="group relative">
                      <div class="flex min-h-18 items-center gap-4 py-4">
                        <span
                          aria-hidden="true"
                          class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground"
                          >{{ row.mark }}</span
                        >
                        <div class="min-w-0 flex-1">
                          <h3 class="font-medium">
                            <a [routerLink]="row.href" [class]="linkClasses">{{ row.name }}</a>
                          </h3>
                          @if (row.divisionLabel) {
                            <p class="mt-0.5 text-sm font-medium">{{ row.divisionLabel }}</p>
                          }
                          <p class="mt-0.5 text-sm text-muted-foreground">{{ row.where }}</p>
                          @if (row.status; as status) {
                            <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                              @if (status.badge) {
                                <span
                                  data-slot="badge"
                                  [class]="status.open ? openBadge : mutedBadge"
                                  >{{ status.badge }}</span
                                >
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
              } @else {
                <div class="flex max-w-md flex-col items-start">
                  <p role="status" class="font-medium">No {{ noun.many }} match “{{ query() }}”</p>
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
                            [queryParams]="{ q: suggestion }"
                            [class]="suggestionClasses"
                            >{{ suggestion }}</a
                          >
                        </li>
                      }
                    </ul>
                  }
                  <a [routerLink]="action" [class]="clearClasses">Clear the search</a>
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
  readonly results = input<FindResults | undefined>(undefined);
  readonly now = input.required<number>();
  readonly savedAt = input<number | undefined>(undefined);
  readonly searched = output<string>();

  protected readonly action = FIND_PATH;
  protected readonly noun = RESULT_NOUN;
  protected readonly searchButton = SEARCH_BUTTON;
  protected readonly linkClasses = LINK_CLASSES;
  protected readonly suggestionClasses = TEXT_LINK_CLASSES;
  protected readonly clearClasses = `mt-4 ${TEXT_LINK_CLASSES}`;
  protected readonly openBadge = OPEN_BADGE;
  protected readonly mutedBadge = MUTED_BADGE;

  protected readonly draft = linkedSignal(() => this.query());
  protected readonly retryHref = computed(() => findPath(this.query()));

  protected readonly rows = computed(() =>
    (this.results()?.rows ?? []).map((league) => ({
      href: publicLeaguePath(league.organization.slug, league.slug),
      name: league.name,
      mark: initials(league.organization.name),
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
      ? `1 ${this.noun.one} matches “${this.query()}”`
      : `${count} ${this.noun.many} match “${this.query()}”`;
  });

  protected readonly sectionSpacing = computed(() =>
    this.status() === 'results' && this.rows().length === 0 ? 'py-10 md:py-16' : 'py-6 md:py-10',
  );

  protected submit(event: Event): void {
    event.preventDefault();
    this.searched.emit(parseSearchQuery([this.draft()]));
  }
}
