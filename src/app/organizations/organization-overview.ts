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
import { LIST_PAGE_SIZE } from '../core/list-page';
import {
  listPagesQuery,
  organizationPath,
  pageQueryFor,
  sportViewPath,
  type PagedList,
  type PublicLeagueRows,
  type PublicOpenSeasonRows,
  type PublicOpenTournamentRows,
  type PublicTournamentRows,
  type PublicLocationRows,
  type PublicOrganizationHeader,
  type PublicSport,
} from './organization-path';
import { UNSEEN_OPEN_SEASON_COUNT, type OpenCardKind } from './open-seasons-seen';
import { OpenSeasonsSkeleton, OrganizationRowsSkeleton } from './organization-skeleton';
import { PageControl } from './page-control';
import { LeagueFilters } from './league-filters';
import { filterPills, type FilterGroup, type LeagueFacet } from './division-filters';
import { noMatchSentence, removalSuggestions } from './no-match-suggestions';
import type { SportCounts } from '../../../convex/lib/sports';
import {
  NO_DIVISION_FILTERS,
  hasDivisionFilters,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import { HlmBadge } from '../ui/badge';
import { HlmCard } from '../ui/card';
import {
  BUTTON_BASE,
  BUTTON_SIZE_LARGE,
  OUTLINE_BUTTON,
  OUTLINE_BUTTON_LARGE,
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_LARGE,
} from '../ui/button/button-classes';
import { HlmSkeleton } from '../ui/skeleton';
import { publicLeaguePath, publicSeasonPath } from './public-league/public-league-path';
import { publicPageNames } from './public-league/public-page-names';
import {
  closesText,
  compare,
  FULL_BADGE_TEXT,
  OPEN_SEASONS_INTRO,
  leagueSeasonStatus,
} from './season-status';
import { hasSportChoice, SportChips } from './sport-chips';
import { sportsCommaList, sportsInSentence } from './sport-list';
import { publicTournamentNames } from './public-tournament/public-tournament-names';
import { publicTournamentPath } from './public-tournament/public-tournament-path';
import {
  OPEN_MIXED_INTRO,
  OPEN_TOURNAMENTS_INTRO,
  REGISTER_FOR_SEASON,
  REGISTER_FOR_TOURNAMENT,
  tournamentStatus,
  upcomingTournaments,
} from './tournament-status';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface ListPaging {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

function rowId(
  list: 'league' | 'location' | 'tournament',
  paging: ListPaging | undefined,
  i: number,
): string {
  const rowsBefore = ((paging?.page ?? 1) - 1) * LIST_PAGE_SIZE;
  return `${list}-${rowsBefore + i + 1}`;
}

@Component({
  selector: 'app-organization-overview',
  imports: [
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    LeagueFilters,
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
          @if (registrationOpenShown()) {
            @if (openCards() === undefined) {
              @if (expectedOpenSeasons() > 0) {
                <span hlmSkeleton aria-hidden="true" [class]="registerPlaceholder"
                  ><span class="invisible">{{ placeholderText() }}</span
                  ><ng-icon
                    name="lucideArrowDown"
                    data-icon="inline-end"
                    class="invisible"
                    aria-hidden="true"
                /></span>
              }
            } @else if (openCards()?.length) {
              <a
                [href]="openHref()"
                data-slot="button"
                (click)="followLink.clicked($event)"
                [class]="registerButtonLarge"
                >{{ heroRegisterText()
                }}<ng-icon name="lucideArrowDown" data-icon="inline-end" aria-hidden="true"
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
    @if (!isEmpty()) {
      <app-league-filters
        [path]="pagePath()"
        [sportView]="sport() !== undefined"
        [filters]="filters()"
        [groups]="filterGroups()"
        [locationsPage]="locationPaging()?.page ?? 1"
        [total]="leagueTotal()"
        [matching]="matchingCount()"
        [facets]="facets()"
        [sportLeagueCounts]="sportLeagueCounts()"
        [sport]="sport()?.key"
      />
    }
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
    @if (!isEmpty() || locationsLoading() || locationRows().length || tournamentsShown()) {
      <div class="mx-auto w-full max-w-6xl px-4 md:px-8">
        @if (registrationOpenShown()) {
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
                <p class="mt-1 text-sm text-muted-foreground">{{ openIntro() }}</p>
                <ul role="list" class="mt-5 grid gap-4 md:mt-6 md:grid-cols-2 lg:grid-cols-3">
                  @for (card of cards; track card.href) {
                    <li hlmCard size="bare" class="flex flex-col p-5">
                      <p class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <span hlmBadge variant="secondary" size="fit">{{ card.sportName }}</span>
                        @if (card.full) {
                          <span hlmBadge variant="outline" size="fit">{{ fullBadgeText }}</span>
                        }
                      </p>
                      <h3 class="mt-3 text-lg font-semibold tracking-tight">
                        <a
                          [routerLink]="card.href"
                          [state]="card.names"
                          class="rounded-md hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                          >{{ card.title }}</a
                        >
                      </h3>
                      <p class="text-sm text-muted-foreground">{{ card.subtitle }}</p>
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
                            {{ card.closesLabel }}
                            <span class="font-medium text-foreground">{{ card.closes }}</span>
                          </p>
                          <a
                            [routerLink]="card.href"
                            [state]="card.names"
                            fragment="registration"
                            data-slot="button"
                            [class]="registerButton"
                            >Register<span class="sr-only"> {{ card.registerFor }}</span></a
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
              <app-open-seasons-skeleton
                [count]="expectedOpenSeasons()"
                [noOpenText]="noOpenText()"
              />
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
              <h2
                #heading
                id="leagues-heading"
                tabindex="-1"
                class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
              >
                {{ leaguesHeading() }}
              </h2>
              @if (leaguesLoading()) {
                <p role="status" class="sr-only">Loading the leagues.</p>
                <app-organization-rows-skeleton kind="league" class="mt-2 block" />
              } @else if (noMatches()) {
                <div
                  class="mt-4 flex max-w-md flex-col items-start rounded-xl border border-dashed border-border p-6"
                >
                  <p class="font-medium">No leagues match these filters</p>
                  <p class="mt-1 text-sm text-muted-foreground">
                    {{ noMatchSentence() }} Remove a filter to see more.
                  </p>
                  @if (removals(); as removals) {
                    @if (removals.length) {
                      <ul role="list" class="mt-4 flex flex-wrap gap-2">
                        @for (removal of removals; track removal.label) {
                          <li class="max-w-full">
                            <a
                              [routerLink]="pagePath()"
                              [queryParams]="removal.query"
                              data-slot="button"
                              [class]="removeButton"
                              (click)="filterBar()?.focusCountNext($event)"
                              >Remove {{ removal.label }}
                              <span class="whitespace-nowrap text-muted-foreground">{{
                                removal.text
                              }}</span></a
                            >
                          </li>
                        }
                      </ul>
                    }
                  } @else {
                    <div data-suggestions-skeleton class="mt-4 flex flex-wrap gap-2">
                      <p role="status" class="sr-only">Loading the suggestions.</p>
                      @for (pill of activeValues(); track pill) {
                        <span
                          hlmSkeleton
                          aria-hidden="true"
                          class="block h-9 w-44 rounded-lg pointer-coarse:h-11"
                        ></span>
                      }
                    </div>
                  }
                  <a
                    [routerLink]="pagePath()"
                    [queryParams]="filterBar()?.clearQuery()"
                    data-slot="button"
                    [class]="clearButton"
                    class="mt-4"
                    (click)="filterBar()?.focusCountNext($event)"
                    >Clear all</a
                  >
                </div>
              } @else {
                <ul
                  role="list"
                  class="mt-2 divide-y divide-border"
                  [attr.aria-busy]="leaguesBusy() ? 'true' : null"
                >
                  @for (league of leagueRows(); track league.id) {
                    <li [id]="league.id" class="group relative">
                      <div class="flex min-h-18 items-center gap-4 py-4">
                        <div class="min-w-0 flex-1">
                          <h3 class="font-medium">
                            <a
                              [routerLink]="league.href"
                              [state]="league.names"
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
                              @if (status.badge && status.badgeVariant; as variant) {
                                <span hlmBadge size="fit" [variant]="variant">{{
                                  status.badge
                                }}</span>
                              }
                              <span class="text-xs text-muted-foreground">{{ status.text }}</span>
                              @if (league.register; as register) {
                                <a
                                  [routerLink]="register.href"
                                  [state]="register.names"
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
                    [path]="pagePath()"
                    fragment="leagues"
                    [queryFor]="leagueQueryFor()"
                    (pageActivated)="pageRequested.leagues = true"
                  />
                </div>
              }
            </section>
          }
          @if (tournamentsShown()) {
            <section
              id="tournaments"
              aria-labelledby="tournaments-heading"
              [class]="tournamentsClass()"
            >
              <h2
                #tournamentsHeading
                id="tournaments-heading"
                tabindex="-1"
                class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
              >
                {{ tournamentsHeadingText() }}
              </h2>
              <ul
                role="list"
                class="mt-2 divide-y divide-border"
                [attr.aria-busy]="tournamentsBusy() ? 'true' : null"
              >
                @for (tournament of tournamentRows(); track tournament.id) {
                  <li [id]="tournament.id" class="group relative">
                    <div class="flex min-h-18 items-center gap-4 py-4">
                      <div class="min-w-0 flex-1">
                        <h3 class="font-medium">
                          <a
                            [routerLink]="tournament.href"
                            [state]="tournament.names"
                            class="rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
                            >{{ tournament.name }}</a
                          >
                        </h3>
                        <p class="mt-0.5 text-sm font-medium">{{ tournament.divisionLabel }}</p>
                        <p class="mt-0.5 text-sm text-muted-foreground">{{ tournament.where }}</p>
                        <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span hlmBadge size="fit" [variant]="tournament.status.badgeVariant">{{
                            tournament.status.badge
                          }}</span>
                          <span class="text-xs text-muted-foreground">{{
                            tournament.status.text
                          }}</span>
                          @if (tournament.status.registrationOpen) {
                            <a
                              [routerLink]="tournament.href"
                              [state]="tournament.names"
                              fragment="registration"
                              class="relative z-10 rounded-md text-xs font-medium text-primary underline underline-offset-4 pointer-fine:-my-1 pointer-fine:py-1 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                              >Register<span class="sr-only"> for {{ tournament.name }}</span></a
                            >
                          }
                        </p>
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
              @if (shownTournamentPaging(); as paging) {
                <div class="-mx-4 md:-mx-5">
                  <app-page-control
                    label="Tournaments pages"
                    noun="tournaments"
                    [page]="paging.page"
                    [pageCount]="paging.pageCount"
                    [total]="paging.total"
                    [shown]="tournamentRows().length"
                    [path]="pagePath()"
                    fragment="tournaments"
                    [queryFor]="tournamentQueryFor()"
                    (pageActivated)="pageRequested.tournaments = true"
                  />
                </div>
              }
            </section>
          }
          @if (locationsLoading() || locationRows().length) {
            <section id="locations" aria-labelledby="locations-heading" [class]="locationsClass()">
              <h2
                #locationsHeading
                id="locations-heading"
                tabindex="-1"
                class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
              >
                Locations
              </h2>
              @if (locationsLoading()) {
                <p role="status" class="sr-only">Loading the locations.</p>
                <app-organization-rows-skeleton kind="location" class="mt-4 block" />
              } @else {
                <ul
                  role="list"
                  class="mt-4 divide-y divide-border"
                  [attr.aria-busy]="locationsBusy() ? 'true' : null"
                >
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
              @if (locationPaging(); as paging) {
                <div class="-mx-4 md:-mx-5">
                  <app-page-control
                    label="Locations pages"
                    noun="locations"
                    [page]="paging.page"
                    [pageCount]="paging.pageCount"
                    [total]="paging.total"
                    [path]="pagePath()"
                    fragment="locations"
                    [queryFor]="locationQueryFor()"
                    (pageActivated)="pageRequested.locations = true"
                  />
                </div>
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
  readonly leaguePaging = input<ListPaging | undefined>(undefined);
  readonly locationPaging = input<ListPaging | undefined>(undefined);
  readonly leaguesBusy = input(false);
  readonly locationsBusy = input(false);
  readonly tournaments = input<PublicTournamentRows | undefined>(undefined);
  readonly tournamentPaging = input<ListPaging | undefined>(undefined);
  readonly tournamentsBusy = input(false);
  readonly openSeasons = input<PublicOpenSeasonRows | undefined>(undefined);
  readonly openTournaments = input<PublicOpenTournamentRows | undefined>(undefined);
  readonly expectedOpenSeasons = input(UNSEEN_OPEN_SEASON_COUNT);
  readonly expectedOpenKind = input<OpenCardKind>('season');
  readonly openCardsShownBefore = input(false);
  readonly now = input.required<number>();
  readonly canManage = input(false);
  readonly filters = input<DivisionFilters>(NO_DIVISION_FILTERS);
  readonly filterGroups = input<readonly FilterGroup[] | undefined>(undefined);
  readonly facets = input<readonly LeagueFacet[] | undefined>(undefined);

  protected readonly followLink = inject(FollowLink);
  protected readonly registerButtonLarge = PRIMARY_BUTTON_LARGE;
  protected readonly registerButton = PRIMARY_BUTTON;
  protected readonly registerPlaceholder = `${BUTTON_BASE} ${BUTTON_SIZE_LARGE}`;
  protected readonly manageButton = OUTLINE_BUTTON_LARGE;
  protected readonly findButton = OUTLINE_BUTTON_LARGE;
  protected readonly clearButton = `${OUTLINE_BUTTON} pointer-coarse:h-11`;
  protected readonly removeButton = `${OUTLINE_BUTTON} h-auto! min-h-9 max-w-full whitespace-normal! py-1.5 text-start`;
  protected readonly filterBar = viewChild(LeagueFilters);
  protected readonly fullBadgeText = FULL_BADGE_TEXT;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly locationsHeading = viewChild<ElementRef<HTMLElement>>('locationsHeading');
  private readonly tournamentsHeading = viewChild<ElementRef<HTMLElement>>('tournamentsHeading');
  private readonly injector = inject(Injector);

  protected readonly pageRequested: Record<PagedList, boolean> = {
    leagues: false,
    locations: false,
    tournaments: false,
  };

  protected readonly leaguesLoading = computed(() => this.leagues() === undefined);
  private readonly locationCount = computed(
    () => this.sport()?.locationCount ?? this.page().locationCount,
  );

  // A header with no locations reserves no section, so the footer does not jump when the empty list answers.
  protected readonly locationsLoading = computed(
    () => this.locations() === undefined && this.locationCount() > 0,
  );

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

  // Beside Leagues and Tournaments, which stack in the first two columns.
  protected readonly locationsClass = computed(() =>
    this.isEmpty()
      ? 'py-8 md:py-12 lg:col-span-3'
      : 'border-t border-border py-8 md:py-12 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:border-t-0',
  );

  protected readonly tournamentsClass = computed(() =>
    this.isEmpty()
      ? 'py-8 md:py-12 lg:col-span-3'
      : 'border-t border-border py-8 md:py-12 lg:col-span-2',
  );

  protected readonly sportLeagueCounts = computed((): SportCounts =>
    Object.fromEntries(this.page().sports.map((sport) => [sport.key, sport.leagueCount])),
  );

  protected readonly leagueTotal = computed(
    () => this.sport()?.leagueCount ?? this.page().leagueCount,
  );

  // While a filter change loads, the held page is the previous filters' result, so its total is not shown.
  protected readonly matchingCount = computed(() =>
    hasDivisionFilters(this.filters()) && !this.leaguesBusy()
      ? this.leaguePaging()?.total
      : undefined,
  );

  // The Registration open section and the hero's Register link would speak of the whole organization, so a view with no match leaves them out.
  protected readonly noMatches = computed(() => this.matchingCount() === 0);

  protected readonly noMatchSentence = computed(() =>
    noMatchSentence(this.page().name, this.filters(), this.sport()?.name),
  );

  protected readonly activeValues = computed(() => filterPills(this.filters()).map((_, i) => i));

  protected readonly removals = computed(() => {
    const facets = this.facets();
    if (facets === undefined) return undefined;
    const locations = this.locationPaging()?.page ?? 1;
    return removalSuggestions({
      facets,
      filters: this.filters(),
      sportLeagueCounts: this.sportLeagueCounts(),
      sport: this.sport()?.key,
      total: this.leagueTotal(),
      queryFor: (without) =>
        listPagesQuery({ leagues: 1, locations }, this.sport() !== undefined, without),
    });
  });

  protected readonly leaguesHeading = computed(() => {
    const sport = this.sport();
    return sport ? `${sport.name} leagues` : 'Leagues';
  });

  protected readonly tournamentsHeadingText = computed(() => {
    const sport = this.sport();
    return sport ? `${sport.name} tournaments` : 'Tournaments';
  });

  // The chip row and the filter bar end in a rule of their own, so the sections below start without one, unless the Registration open section sits between.
  protected readonly gridClass = computed(() =>
    (this.registrationOpenShown() || !this.noMatches()) &&
    (!this.isEmpty() || !hasSportChoice(this.page().sports))
      ? 'grid gap-x-12 border-t border-border lg:grid-cols-3'
      : 'grid gap-x-12 lg:grid-cols-3',
  );

  protected readonly pagePath = computed(() => {
    const { slug } = this.page();
    const sport = this.sport();
    return sport ? sportViewPath(slug, sport.segment) : organizationPath(slug);
  });
  private readonly shownPages = computed(() => ({
    leagues: this.leaguePaging()?.page ?? 1,
    locations: this.locationPaging()?.page ?? 1,
    tournaments: this.tournamentPaging()?.page ?? 1,
  }));
  protected readonly leagueQueryFor = computed(() =>
    pageQueryFor('leagues', this.shownPages(), this.sport() !== undefined, this.filters()),
  );
  protected readonly locationQueryFor = computed(() =>
    pageQueryFor('locations', this.shownPages(), this.sport() !== undefined, this.filters()),
  );
  protected readonly tournamentQueryFor = computed(() =>
    pageQueryFor('tournaments', this.shownPages(), this.sport() !== undefined, this.filters()),
  );

  protected readonly manageHref = computed(() => `/app/organizations/${this.page().slug}`);
  protected readonly openHref = computed(() => `${this.pagePath()}#registration-open`);

  protected readonly noOpenText = computed(() => {
    const sport = this.sport()?.name.toLowerCase();
    return `No ${sport ? `${sport} ` : ''}season is open for registration right now. Each league below shows its next season once it is published.`;
  });

  // The seasons are left out where the page speaks of no league, as for filters that match none.
  protected readonly seasonsListed = computed(() => !this.isEmpty() && !this.noMatches());

  private readonly openSeasonCards = computed(() =>
    (this.seasonsListed() ? this.openSeasons() : [])?.map((season) => ({
      kind: 'season' as const,
      href: publicSeasonPath(this.page().slug, season.league.slug, season.slug),
      names: publicPageNames({ organization: this.page(), league: season.league, season }),
      sportName: season.league.sportName,
      title: season.league.name,
      subtitle: season.name,
      registerFor: `for ${season.league.name}, ${season.name}`,
      deadline: season.registrationDeadline,
      dates: seasonDates(season.startDate, season.endDate),
      teams: season.league.divisionLabel
        ? `${season.league.divisionLabel}, teams of at least ${season.minimumRosterSize}`
        : `Teams of at least ${season.minimumRosterSize}`,
      where: season.league.locationNames.join(', '),
      closes: closesText(season.registrationDeadline),
      full: season.isFull === true,
      closesLabel: season.isFull === true ? 'Waitlist open · closes' : 'Closes',
    })),
  );

  private readonly openTournamentCards = computed(() =>
    this.openTournaments()?.map((tournament) => ({
      kind: 'tournament' as const,
      href: publicTournamentPath(this.page().slug, tournament.slug),
      names: publicTournamentNames({ organization: this.page(), tournament }),
      sportName: tournament.sportName,
      title: tournament.name,
      subtitle: 'Tournament',
      registerFor: `for ${tournament.name}`,
      deadline: tournament.registrationDeadline,
      dates: seasonDates(tournament.startDate, tournament.endDate),
      teams: `${tournament.divisionLabel}, teams of at least ${tournament.minimumRosterSize}`,
      where: tournament.locationNames.join(', '),
      closes: closesText(tournament.registrationDeadline),
      full: false,
      closesLabel: 'Closes',
    })),
  );

  // Undefined until both have answered, so a card does not arrive after the others and move what is below.
  protected readonly openCards = computed(() => {
    const seasons = this.openSeasonCards();
    const tournaments = this.openTournamentCards();
    if (!seasons || !tournaments) return undefined;
    return [...seasons, ...tournaments].sort(
      (a, b) =>
        compare(a.deadline, b.deadline) ||
        compare(a.title, b.title) ||
        compare(a.subtitle, b.subtitle),
    );
  });

  // With no season listed, the section holds its place while it loads only for an organization that has shown a card, so a card that arrives late does not push down what is below.
  protected readonly registrationOpenShown = computed(() => {
    if (this.seasonsListed()) return true;
    const cards = this.openCards();
    return cards === undefined
      ? this.openCardsShownBefore() && this.expectedOpenSeasons() > 0
      : cards.length > 0;
  });

  protected readonly heroRegisterText = computed(() =>
    this.openCards()?.some((card) => card.kind === 'season')
      ? REGISTER_FOR_SEASON
      : REGISTER_FOR_TOURNAMENT,
  );

  protected readonly placeholderText = computed(() =>
    this.expectedOpenKind() === 'tournament' ? REGISTER_FOR_TOURNAMENT : REGISTER_FOR_SEASON,
  );

  protected readonly openIntro = computed(() => {
    const cards = this.openCards() ?? [];
    const season = cards.some((card) => card.kind === 'season');
    const tournament = cards.some((card) => card.kind === 'tournament');
    if (season && tournament) return OPEN_MIXED_INTRO;
    return tournament ? OPEN_TOURNAMENTS_INTRO : OPEN_SEASONS_INTRO;
  });

  private readonly upcoming = computed(() =>
    upcomingTournaments(this.tournaments() ?? [], this.now()),
  );

  // The query counts the rows that have ended since it ran, so the total drops them, and a page left with none keeps its control for the way back.
  protected readonly shownTournamentPaging = computed((): ListPaging | undefined => {
    const paging = this.tournamentPaging();
    const dropped = (this.tournaments()?.length ?? 0) - this.upcoming().length;
    if (!paging || dropped === 0) return paging;
    const total = Math.max(
      paging.total - dropped,
      paging.page > 1 ? (paging.page - 1) * LIST_PAGE_SIZE + 1 : 0,
    );
    const pageCount = Math.min(paging.pageCount, Math.ceil(total / LIST_PAGE_SIZE));
    return { page: paging.page, total, pageCount: Math.max(paging.page, pageCount) };
  });

  protected readonly tournamentsShown = computed(
    () =>
      this.tournamentRows().length > 0 ||
      ((this.shownTournamentPaging()?.page ?? 1) > 1 &&
        (this.shownTournamentPaging()?.total ?? 0) > LIST_PAGE_SIZE),
  );

  protected readonly tournamentRows = computed(() =>
    this.upcoming().map((tournament, i) => ({
      id: rowId('tournament', this.tournamentPaging(), i),
      name: tournament.name,
      href: publicTournamentPath(this.page().slug, tournament.slug),
      names: publicTournamentNames({ organization: this.page(), tournament }),
      divisionLabel: tournament.divisionLabel,
      where: [tournament.sportName, tournament.locationNames.join(', ')]
        .filter(Boolean)
        .join(' · '),
      status: tournamentStatus(tournament, this.now()),
    })),
  );

  protected readonly leagueRows = computed(() =>
    (this.leagues() ?? []).map((league, i) => {
      const status = leagueSeasonStatus(league.seasons, this.now());
      return {
        id: rowId('league', this.leaguePaging(), i),
        name: league.name,
        href: publicLeaguePath(this.page().slug, league.slug),
        names: publicPageNames({ organization: this.page(), league }),
        divisionLabel: league.divisionLabel,
        where: [league.sportName, league.locationNames.join(', ')].filter(Boolean).join(' · '),
        status,
        register:
          status?.registrationOpen && status.season
            ? {
                href: publicSeasonPath(this.page().slug, league.slug, status.season.slug),
                names: publicPageNames({
                  organization: this.page(),
                  league,
                  season: status.season,
                }),
                seasonName: status.season.name,
              }
            : undefined,
      };
    }),
  );

  protected readonly locationRows = computed(() =>
    (this.locations() ?? []).map((location, i) => ({
      id: rowId('location', this.locationPaging(), i),
      name: location.name,
      address: location.address,
      sports: sportsCommaList(location.sportNames ?? []),
    })),
  );

  constructor() {
    this.focusHeadingAfterPageChange('leagues', this.leagues, this.heading);
    this.focusHeadingAfterPageChange('locations', this.locations, this.locationsHeading);
    this.focusHeadingAfterPageChange('tournaments', this.tournaments, this.tournamentsHeading);
  }

  // Focus moves only in the browser, and only for a click on a page link: a live update of the shown page leaves it alone.
  private focusHeadingAfterPageChange(
    list: PagedList,
    rows: () => unknown,
    heading: () => ElementRef<HTMLElement> | undefined,
  ): void {
    effect(() => {
      rows();
      untracked(() => {
        if (!this.pageRequested[list]) return;
        this.pageRequested[list] = false;
        afterNextRender(() => heading()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
