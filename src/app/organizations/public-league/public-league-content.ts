import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCalendarDays,
  lucideChevronRight,
  lucideClock,
  lucideMapPin,
  lucideUsers,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { PRIMARY_BUTTON_LARGE } from '../../ui/button/button-classes';
import { seasonDates } from '../league/season-dates';
import { organizationPath, sportViewPath } from '../organization-path';
import { PageControl } from '../page-control';
import { MUTED_BADGE, OPEN_BADGE } from '../season-status';
import { soonestClosingOpenSeason, seasonStatus } from './league-seasons';
import { publicLeaguePath, publicSeasonPath, type PublicLeagueView } from './public-league-path';

const CRUMB_LINK =
  'inline-flex min-h-11 items-center rounded-md font-medium hover:text-foreground hover:underline md:min-h-0';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

@Component({
  selector: 'app-public-league-content',
  imports: [NgIcon, PageControl, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideArrowRight,
      lucideCalendarDays,
      lucideChevronRight,
      lucideClock,
      lucideMapPin,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <nav aria-label="Breadcrumb">
        <ol role="list" class="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <li>
            <a [routerLink]="organizationHref()" class="${CRUMB_LINK}">{{
              view().league.organization.name
            }}</a>
          </li>
          <li aria-hidden="true">
            <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
          </li>
          <li>
            <!-- A sport the organization no longer lists has no view to link to. -->
            @if (sportHref(); as sportHref) {
              <a [routerLink]="sportHref" class="${CRUMB_LINK}">{{ view().league.sportName }}</a>
            } @else {
              <span class="inline-flex min-h-11 items-center font-medium md:min-h-0">{{
                view().league.sportName
              }}</span>
            }
          </li>
        </ol>
      </nav>
      <h1 class="mt-4 text-3xl font-semibold tracking-tight text-balance md:mt-6 md:text-5xl">
        {{ view().league.name }}
      </h1>
      @if (view().league.divisionLabel; as divisionLabel) {
        <p class="mt-2 font-medium md:mt-3 md:text-lg">{{ divisionLabel }}</p>
      }
      <p class="mt-1 text-muted-foreground md:text-lg">{{ sportAndPlaces() }}</p>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <div class="lg:col-span-2">
          @if (card(); as card) {
            <section id="registration-open" aria-labelledby="open-heading" class="py-8 md:py-12">
              <h2 id="open-heading" class="text-xl font-semibold tracking-tight md:text-2xl">
                Registration open
              </h2>
              <div
                class="mt-5 flex flex-col gap-5 rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10 md:flex-row md:items-center md:p-6"
              >
                <div class="min-w-0 flex-1">
                  <h3 class="text-lg font-semibold tracking-tight">
                    <a
                      [routerLink]="card.href"
                      class="rounded-md hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                      >{{ card.name }}</a
                    >
                  </h3>
                  <ul
                    role="list"
                    class="mt-3 flex flex-col gap-2 text-sm md:flex-row md:flex-wrap md:gap-x-6"
                  >
                    <li class="flex items-center gap-2">
                      <ng-icon
                        name="lucideCalendarDays"
                        class="shrink-0 text-base text-muted-foreground"
                        aria-hidden="true"
                      />{{ card.dates }}
                    </li>
                    <li class="flex items-center gap-2">
                      <ng-icon
                        name="lucideUsers"
                        class="shrink-0 text-base text-muted-foreground"
                        aria-hidden="true"
                      />{{ card.teams }}
                    </li>
                    <li class="flex items-center gap-2">
                      <ng-icon
                        name="lucideClock"
                        class="shrink-0 text-base text-muted-foreground"
                        aria-hidden="true"
                      />Closes {{ card.closes }}
                    </li>
                  </ul>
                </div>
                <a
                  [routerLink]="card.href"
                  fragment="registration"
                  data-slot="button"
                  [class]="registerButton + ' w-full md:w-auto'"
                  ><span class="min-w-0 truncate">Register for {{ card.name }}</span
                  ><ng-icon name="lucideArrowRight" data-icon="inline-end" aria-hidden="true"
                /></a>
              </div>
            </section>
          }
          <section
            id="seasons"
            aria-labelledby="seasons-heading"
            [class]="card() ? 'border-t border-border py-8 md:py-12' : 'py-8 md:py-12'"
          >
            <div class="flex items-baseline justify-between gap-4">
              <h2
                #heading
                id="seasons-heading"
                tabindex="-1"
                class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
              >
                Seasons
              </h2>
              @if (rows().length) {
                <p class="text-sm text-muted-foreground">{{ total() }}</p>
              }
            </div>
            <p class="mt-1 text-sm text-muted-foreground">
              Each season is one run of {{ view().league.name }}, with its own dates, registration,
              teams, and schedule.
            </p>
            @if (rows().length) {
              <ul
                role="list"
                class="mt-2 divide-y divide-border"
                [attr.aria-busy]="busy() ? 'true' : null"
              >
                @for (season of rows(); track season.slug) {
                  <li class="group relative">
                    <div class="flex min-h-18 items-center gap-4 py-4">
                      <div class="min-w-0 flex-1">
                        <h3 class="font-medium">
                          <a
                            [routerLink]="season.href"
                            class="rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
                            >{{ season.name }}</a
                          >
                        </h3>
                        <p class="mt-0.5 text-sm text-muted-foreground">
                          <span class="sr-only">Dates: </span>{{ season.dates }}
                        </p>
                        @if (season.status; as status) {
                          <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              data-slot="badge"
                              [class]="status.open ? openBadge : mutedBadge"
                              >{{ status.badge }}</span
                            >
                            @if (status.note) {
                              <span class="text-xs text-muted-foreground">{{ status.note }}</span>
                            }
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
              <div class="-mx-4 md:-mx-5">
                <app-page-control
                  label="Seasons pages"
                  noun="seasons"
                  [page]="view().seasons.page"
                  [pageCount]="view().seasons.pageCount"
                  [total]="view().seasons.total"
                  [path]="leagueHref()"
                  fragment="seasons"
                  (pageActivated)="pageRequested = true"
                />
              </div>
            } @else {
              <div
                class="mt-5 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center"
              >
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideCalendarDays" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No seasons yet</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  When {{ view().league.organization.name }} publishes a season, its dates and
                  registration appear here.
                </p>
                <a
                  [routerLink]="organizationHref()"
                  class="mt-5 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4 md:min-h-0"
                  >See their other leagues<ng-icon
                    name="lucideChevronRight"
                    class="text-base"
                    aria-hidden="true"
                /></a>
              </div>
            }
          </section>
        </div>
        <section
          id="where"
          [attr.aria-labelledby]="places().length ? 'where-heading' : null"
          class="border-t border-border py-8 md:py-12 lg:border-t-0"
        >
          @if (places().length) {
            <h2 id="where-heading" class="text-xl font-semibold tracking-tight md:text-2xl">
              Where it’s played
            </h2>
            <ul role="list" class="mt-4 space-y-4">
              @for (place of places(); track $index) {
                <li class="flex gap-3">
                  <span
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                    ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true"
                  /></span>
                  <div class="min-w-0">
                    <h3 class="font-medium">{{ place.name }}</h3>
                    @if (place.address) {
                      <p class="mt-0.5 text-sm text-muted-foreground">{{ place.address }}</p>
                    }
                  </div>
                </li>
              }
            </ul>
          }
          <p class="text-sm text-muted-foreground" [class.mt-6]="places().length">
            Run by
            <a
              [routerLink]="organizationHref()"
              class="font-medium text-foreground underline underline-offset-4 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              >{{ view().league.organization.name }}</a
            >
          </p>
        </section>
      </div>
    </div>
  `,
})
export class PublicLeagueContent {
  readonly view = input.required<PublicLeagueView>();
  readonly now = input.required<number>();
  readonly busy = input(false);
  readonly savedAt = input<number | undefined>(undefined);

  protected readonly registerButton = PRIMARY_BUTTON_LARGE;
  protected readonly openBadge = OPEN_BADGE;
  protected readonly mutedBadge = MUTED_BADGE;

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  protected pageRequested = false;

  protected readonly organizationHref = computed(() =>
    organizationPath(this.view().league.organization.slug),
  );
  protected readonly leagueHref = computed(() =>
    publicLeaguePath(this.view().league.organization.slug, this.view().league.slug),
  );
  protected readonly sportHref = computed(() => {
    const { league, organization } = this.view();
    const sport = organization.sports.find((entry) => entry.name === league.sportName);
    return sport ? sportViewPath(league.organization.slug, sport.segment) : undefined;
  });

  protected readonly sportAndPlaces = computed(() => {
    const { sportName, locationNames } = this.view().league;
    return [sportName, locationNames.join(', ')].filter(Boolean).join(' · ');
  });

  // A copy saved before the page held addresses has the names only.
  protected readonly places = computed(() => {
    const { locations, locationNames } = this.view().league;
    return locations ?? locationNames.map((name) => ({ name, address: undefined }));
  });

  protected readonly total = computed(() => plural(this.view().seasons.total, 'season'));

  protected readonly card = computed(() => {
    const { league } = this.view();
    const season = soonestClosingOpenSeason(league.seasons, this.now());
    if (!season) return undefined;
    const minimum = `teams of at least ${season.minimumRosterSize}`;
    return {
      name: season.name,
      href: publicSeasonPath(league.organization.slug, league.slug, season.slug),
      dates: seasonDates(season.startDate, season.endDate),
      teams: league.divisionLabel
        ? `${league.divisionLabel}, ${minimum}`
        : `${minimum.charAt(0).toUpperCase()}${minimum.slice(1)}`,
      closes: formatCalendarDate(season.registrationDeadline),
    };
  });

  protected readonly rows = computed(() => {
    const { league, seasons } = this.view();
    return seasons.rows.map((season) => ({
      name: season.name,
      slug: season.slug,
      href: publicSeasonPath(league.organization.slug, league.slug, season.slug),
      dates: seasonDates(season.startDate, season.endDate),
      status: seasonStatus(season, this.now()),
    }));
  });

  private readonly shownSeasons = computed(() => this.view().seasons);

  constructor() {
    // Moves focus, which only the browser does: a side effect outside Angular. The seasons shown
    // change when the page asked for has arrived, or when a live update replaces them; only the
    // first, after a click on a page link, moves focus.
    effect(() => {
      this.shownSeasons();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
