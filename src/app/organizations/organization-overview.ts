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
  lucideArrowDown,
  lucideCalendarDays,
  lucideChevronRight,
  lucideMapPin,
  lucidePencil,
  lucideSearch,
  lucideTrophy,
  lucideUsers,
} from '@ng-icons/lucide';
import { FollowLink } from '../shell/follow-link';
import { SavedCopyNote } from '../offline/saved-copy-note';
import { OrganizationMark } from './organization-mark';
import { seasonDates } from './league/season-dates';
import {
  organizationPath,
  sportViewPath,
  type PublicLeagueRows,
  type PublicOpenSeasonRows,
  type PublicLocationRows,
  type PublicOrganizationHeader,
  type PublicSport,
} from './organization-path';
import { OpenSeasonsSkeleton, OrganizationRowsSkeleton } from './organization-skeleton';
import { PageControl } from './page-control';
import {
  OUTLINE_BUTTON_LARGE,
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_LARGE,
} from '../ui/button/button-classes';
import { publicLeaguePath, publicSeasonPath } from './public-league/public-league-path';
import { closesText, leagueSeasonStatus, MUTED_BADGE, OPEN_BADGE } from './season-status';
import { hasSportChoice, SportChips } from './sport-chips';
import { sportsCommaList, sportsInSentence } from './sport-list';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

@Component({
  selector: 'app-organization-overview',
  imports: [
    NgIcon,
    OpenSeasonsSkeleton,
    OrganizationMark,
    OrganizationRowsSkeleton,
    PageControl,
    RouterLink,
    SavedCopyNote,
    SportChips,
  ],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideCalendarDays,
      lucideChevronRight,
      lucideMapPin,
      lucidePencil,
      lucideSearch,
      lucideTrophy,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-6 pb-6 md:px-8 md:pt-12 md:pb-10">
      <div class="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-3 md:items-center md:gap-4">
            <app-organization-mark [name]="page().name" [logoUrl]="page().logoUrl" />
            <h1 class="min-w-0 text-2xl font-semibold tracking-tight text-balance md:text-5xl">
              {{ page().name }}
            </h1>
          </div>
          <p class="mt-2 text-muted-foreground md:mt-3 md:text-lg">{{ summary() }}</p>
          @if (savedAt(); as savedAt) {
            <app-saved-copy-note [savedAt]="savedAt" />
          }
        </div>
        <div
          data-hero-actions
          class="flex min-h-11 flex-wrap items-center gap-2 md:shrink-0 md:gap-3"
        >
          @if (canManage()) {
            <a [routerLink]="manageHref()" data-slot="button" [class]="manageButton"
              ><ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Manage</a
            >
          }
          @if (!isEmpty()) {
            @if (openCards() === undefined) {
              <span
                aria-hidden="true"
                class="block h-11 w-48 rounded-md bg-muted motion-safe:animate-pulse"
              ></span>
            } @else if (openCards()?.length) {
              <a
                [href]="openHref()"
                data-slot="button"
                (click)="followLink.clicked($event)"
                [class]="registerButtonLarge"
                >Register for a season<ng-icon
                  name="lucideArrowDown"
                  data-icon="inline-end"
                  aria-hidden="true"
              /></a>
            }
          }
        </div>
      </div>
    </div>
    <app-sport-chips
      [slug]="page().slug"
      [sports]="page().sports"
      [allSportsLeagueCount]="page().leagueCount"
      [currentSegment]="sport()?.segment"
    />
    @if (isEmpty()) {
      <div class="border-t border-border">
        <div class="mx-auto w-full max-w-6xl px-4 py-12 md:px-8 md:py-20">
          <div class="mx-auto flex max-w-md flex-col items-center text-center">
            <span
              class="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              ><ng-icon name="lucideTrophy" class="text-2xl" aria-hidden="true"
            /></span>
            <h2 class="mt-5 text-xl font-semibold tracking-tight">No leagues yet</h2>
            <p class="mt-2 text-balance text-muted-foreground">
              Leagues this organization runs will be listed here, with their seasons and how to
              register.
            </p>
            <a routerLink="/leagues" data-slot="button" [class]="findButton" class="mt-6">
              <ng-icon name="lucideSearch" data-icon="inline-start" aria-hidden="true" />
              Find another league
            </a>
          </div>
        </div>
      </div>
    }
    @if (!isEmpty() || locationsLoading() || locationRows().length) {
      <div class="mx-auto w-full max-w-6xl px-4 md:px-8">
        @if (!isEmpty()) {
          <section
            id="registration-open"
            aria-labelledby="registration-open-heading"
            class="py-8 md:py-12"
          >
            <h2
              id="registration-open-heading"
              class="text-xl font-semibold tracking-tight md:text-2xl"
            >
              Registration open
            </h2>
            @if (openCards(); as cards) {
              @if (cards.length) {
                <p class="mt-1 text-sm text-muted-foreground">
                  Register a team, or register as a free agent and an organizer places you on one.
                </p>
                <ul role="list" class="mt-5 grid gap-4 md:mt-6 md:grid-cols-2 lg:grid-cols-3">
                  @for (card of cards; track card.href) {
                    <li
                      class="flex flex-col rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10"
                    >
                      <p>
                        <span data-slot="badge" [class]="openBadge">{{ card.sportName }}</span>
                      </p>
                      <h3 class="mt-3 text-lg font-semibold tracking-tight">
                        <a
                          [routerLink]="card.href"
                          class="rounded-md hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                          >{{ card.leagueName }}</a
                        >
                      </h3>
                      <p class="text-sm text-muted-foreground">{{ card.name }}</p>
                      <ul role="list" class="mt-4 space-y-2 text-sm">
                        <li class="flex items-start gap-2.5">
                          <ng-icon
                            name="lucideCalendarDays"
                            class="mt-0.5 shrink-0 text-base text-muted-foreground"
                            aria-hidden="true"
                          />{{ card.dates }}
                        </li>
                        <li class="flex items-start gap-2.5">
                          <ng-icon
                            name="lucideUsers"
                            class="mt-0.5 shrink-0 text-base text-muted-foreground"
                            aria-hidden="true"
                          />{{ card.teams }}
                        </li>
                        @if (card.where) {
                          <li class="flex items-start gap-2.5">
                            <ng-icon
                              name="lucideMapPin"
                              class="mt-0.5 shrink-0 text-base text-muted-foreground"
                              aria-hidden="true"
                            />{{ card.where }}
                          </li>
                        }
                      </ul>
                      <div class="mt-auto pt-5">
                        <div
                          class="flex items-center justify-between gap-3 border-t border-border pt-4"
                        >
                          <p class="text-sm text-muted-foreground">
                            Closes
                            <span class="font-medium text-foreground">{{ card.closes }}</span>
                          </p>
                          <a
                            [routerLink]="card.href"
                            fragment="registration"
                            data-slot="button"
                            [class]="registerButton"
                            >Register<span class="sr-only">
                              for {{ card.leagueName }}, {{ card.name }}</span
                            ></a
                          >
                        </div>
                      </div>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-1 text-sm text-muted-foreground">{{ noOpenText() }}</p>
              }
            } @else {
              <p role="status" class="sr-only">Loading the open seasons.</p>
              <app-open-seasons-skeleton />
            }
          </section>
        }
        <div [class]="gridClass()">
          @if (!isEmpty()) {
            <section
              id="leagues"
              aria-labelledby="leagues-heading"
              class="py-8 md:py-12 lg:col-span-2"
            >
              <div class="flex items-baseline justify-between gap-4">
                <h2
                  #heading
                  id="leagues-heading"
                  tabindex="-1"
                  class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
                >
                  {{ leaguesHeading() }}
                </h2>
                <p class="text-sm text-muted-foreground">{{ leagueTotal() }}</p>
              </div>
              @if (leaguesLoading()) {
                <p role="status" class="sr-only">Loading the leagues.</p>
                <app-organization-rows-skeleton kind="league" class="mt-2 block" />
              } @else {
                <ul
                  role="list"
                  class="mt-2 divide-y divide-border"
                  [attr.aria-busy]="busy() ? 'true' : null"
                >
                  @for (league of leagueRows(); track league.id) {
                    <li [id]="league.id" class="group relative">
                      <div class="flex min-h-18 items-center gap-4 py-4">
                        <div class="min-w-0 flex-1">
                          <h3 class="font-medium">
                            <a
                              [routerLink]="league.href"
                              class="rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
                              >{{ league.name }}</a
                            >
                          </h3>
                          @if (league.divisionLabel) {
                            <p class="mt-0.5 text-sm font-medium">{{ league.divisionLabel }}</p>
                          }
                          <p class="mt-0.5 text-sm text-muted-foreground">{{ league.where }}</p>
                          @if (league.status; as status) {
                            <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                              @if (status.badge) {
                                <span
                                  data-slot="badge"
                                  [class]="status.open ? openBadge : mutedBadge"
                                  >{{ status.badge }}</span
                                >
                              }
                              <span class="text-xs text-muted-foreground">{{ status.text }}</span>
                              @if (league.register; as register) {
                                <a
                                  [routerLink]="register.href"
                                  fragment="registration"
                                  class="relative z-10 rounded-md text-xs font-medium text-primary underline underline-offset-4 pointer-fine:-my-1 pointer-fine:py-1 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                                  >Register<span class="sr-only">
                                    for {{ league.name }}, {{ register.seasonName }}</span
                                  ></a
                                >
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
              }
              @if (leaguePaging(); as paging) {
                <div class="-mx-4 md:-mx-5">
                  <app-page-control
                    label="Leagues pages"
                    noun="leagues"
                    [page]="paging.page"
                    [pageCount]="paging.pageCount"
                    [total]="paging.total"
                    [path]="sportHref()"
                    fragment="leagues"
                    (pageActivated)="pageRequested = true"
                  />
                </div>
              }
            </section>
          }
          @if (locationsLoading() || locationRows().length) {
            <section id="locations" aria-labelledby="locations-heading" [class]="locationsClass()">
              <h2 id="locations-heading" class="text-xl font-semibold tracking-tight md:text-2xl">
                Locations
              </h2>
              @if (locationsLoading()) {
                <p role="status" class="sr-only">Loading the locations.</p>
                <app-organization-rows-skeleton kind="location" class="mt-4 block" />
              } @else {
                <ul role="list" class="mt-4 divide-y divide-border">
                  @for (location of locationRows(); track location.id) {
                    <li [id]="location.id" class="flex gap-3 py-4">
                      <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                        ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true"
                      /></span>
                      <div class="min-w-0">
                        <h3 class="font-medium">{{ location.name }}</h3>
                        <p class="mt-0.5 text-sm text-muted-foreground">{{ location.address }}</p>
                        @if (location.sports) {
                          <p class="mt-1 text-xs text-muted-foreground">{{ location.sports }}</p>
                        }
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class OrganizationOverview {
  readonly page = input.required<PublicOrganizationHeader>();
  readonly leagues = input.required<PublicLeagueRows | undefined>();
  readonly locations = input.required<PublicLocationRows | undefined>();
  readonly savedAt = input<number | undefined>(undefined);
  readonly sport = input<PublicSport | undefined>(undefined);
  readonly leaguePaging = input<{ page: number; pageCount: number; total: number } | undefined>(
    undefined,
  );
  readonly busy = input(false);
  readonly openSeasons = input<PublicOpenSeasonRows | undefined>(undefined);
  readonly now = input.required<number>();
  readonly canManage = input(false);

  protected readonly followLink = inject(FollowLink);
  protected readonly registerButtonLarge = PRIMARY_BUTTON_LARGE;
  protected readonly registerButton = PRIMARY_BUTTON;
  protected readonly manageButton = OUTLINE_BUTTON_LARGE;
  protected readonly findButton = OUTLINE_BUTTON_LARGE;
  protected readonly openBadge = OPEN_BADGE;
  protected readonly mutedBadge = MUTED_BADGE;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  protected pageRequested = false;

  protected readonly leaguesLoading = computed(() => this.leagues() === undefined);
  protected readonly locationsLoading = computed(() => this.locations() === undefined);

  protected readonly isEmpty = computed(
    () => this.page().leagueCount === 0 && (this.leagues() ?? []).length === 0,
  );

  // From `getPublicPage`, never the number of rows shown, which is at most 5 per list.
  protected readonly summary = computed(() => {
    const { leagueCount, locationCount, sports } = this.page();
    if (this.isEmpty()) return 'No leagues published yet';
    const counts = [
      plural(leagueCount, 'league'),
      ...(locationCount > 0 ? [`at ${plural(locationCount, 'location')}`] : []),
    ].join(' ');
    const names = sportsInSentence(sports.map((sport) => sport.name));
    return names ? `${names} · ${counts}` : counts;
  });

  protected readonly locationsClass = computed(() =>
    this.isEmpty()
      ? 'py-8 md:py-12 lg:col-span-3'
      : 'border-t border-border py-8 md:py-12 lg:border-t-0',
  );

  protected readonly leagueTotal = computed(() =>
    plural(this.sport()?.leagueCount ?? this.page().leagueCount, 'league'),
  );

  protected readonly leaguesHeading = computed(() => {
    const sport = this.sport();
    return sport ? `${sport.name} leagues` : 'Leagues';
  });

  protected readonly sportHref = computed(() => {
    const sport = this.sport();
    return sport ? sportViewPath(this.page().slug, sport.segment) : '';
  });

  // The chip row ends in a rule of its own, so the sections below it start without one, unless the Registration open section sits between.
  protected readonly gridClass = computed(() =>
    !this.isEmpty() || !hasSportChoice(this.page().sports)
      ? 'grid gap-x-12 border-t border-border lg:grid-cols-3'
      : 'grid gap-x-12 lg:grid-cols-3',
  );

  protected readonly pagePath = computed(() => {
    const { slug } = this.page();
    const sport = this.sport();
    return sport ? sportViewPath(slug, sport.segment) : organizationPath(slug);
  });
  protected readonly manageHref = computed(() => `/app/organizations/${this.page().slug}`);
  protected readonly openHref = computed(() => `${this.pagePath()}#registration-open`);

  protected readonly noOpenText = computed(() => {
    const sport = this.sport()?.name.toLowerCase();
    return `No ${sport ? `${sport} ` : ''}season is open for registration right now. Each league below shows its next season once it is published.`;
  });

  protected readonly openCards = computed(() =>
    this.openSeasons()?.map((season) => ({
      href: publicSeasonPath(this.page().slug, season.league.slug, season.slug),
      sportName: season.league.sportName,
      leagueName: season.league.name,
      name: season.name,
      dates: seasonDates(season.startDate, season.endDate),
      teams: season.league.divisionLabel
        ? `${season.league.divisionLabel}, teams of at least ${season.minimumRosterSize}`
        : `Teams of at least ${season.minimumRosterSize}`,
      where: season.league.locationNames.join(', '),
      closes: closesText(season.registrationDeadline),
    })),
  );

  protected readonly leagueRows = computed(() =>
    (this.leagues() ?? []).map((league, i) => {
      const status = leagueSeasonStatus(league.seasons, this.now());
      return {
        id: `league-${i + 1}`,
        name: league.name,
        href: publicLeaguePath(this.page().slug, league.slug),
        divisionLabel: league.divisionLabel,
        where: [league.sportName, league.locationNames.join(', ')].filter(Boolean).join(' · '),
        status,
        register:
          status?.open && status.season
            ? {
                href: publicSeasonPath(this.page().slug, league.slug, status.season.slug),
                seasonName: status.season.name,
              }
            : undefined,
      };
    }),
  );

  protected readonly locationRows = computed(() =>
    (this.locations() ?? []).map((location, i) => ({
      id: `location-${i + 1}`,
      name: location.name,
      address: location.address,
      sports: sportsCommaList(location.sportNames ?? []),
    })),
  );

  constructor() {
    // Focus moves only in the browser, and only for a click on a page link: a live update of the shown page leaves it alone.
    effect(() => {
      this.leagues();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
