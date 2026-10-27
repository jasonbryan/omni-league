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
import { lucideChevronRight, lucideMapPin, lucideTrophy } from '@ng-icons/lucide';
import { SavedCopyNote } from '../offline/saved-copy-note';
import { OrganizationMark } from './organization-mark';
import { sportViewPath, type PublicOrganizationPage, type PublicSport } from './organization-path';
import { PageControl } from './page-control';
import { publicLeaguePath } from './public-league/public-league-path';
import { SportChips } from './sport-chips';
import { sportsCommaList, sportsInSentence } from './sport-list';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

@Component({
  selector: 'app-organization-overview',
  imports: [NgIcon, OrganizationMark, PageControl, RouterLink, SavedCopyNote, SportChips],
  providers: [provideIcons({ lucideChevronRight, lucideMapPin, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-6 pb-6 md:px-8 md:pt-12 md:pb-10">
      <div class="min-w-0">
        <div class="flex items-start gap-3 md:items-center md:gap-4">
          <app-organization-mark [name]="page().name" />
          <h1 class="min-w-0 text-2xl font-semibold tracking-tight text-balance md:text-5xl">
            {{ page().name }}
          </h1>
        </div>
        <p class="mt-2 text-muted-foreground md:mt-3 md:text-lg">{{ summary() }}</p>
        @if (savedAt(); as savedAt) {
          <app-saved-copy-note [savedAt]="savedAt" />
        }
      </div>
    </div>
    <app-sport-chips
      [slug]="page().slug"
      [sports]="page().sports"
      [leagueCount]="page().leagueCount"
      [current]="sport()?.segment"
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
          </div>
        </div>
      </div>
    }
    @if (!isEmpty() || locations().length) {
      <div class="mx-auto w-full max-w-6xl px-4 md:px-8">
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
              <ul
                role="list"
                class="mt-2 divide-y divide-border"
                [attr.aria-busy]="busy() ? 'true' : null"
              >
                @for (league of leagues(); track league.id) {
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
          @if (locations().length) {
            <section id="locations" aria-labelledby="locations-heading" [class]="locationsClass()">
              <h2 id="locations-heading" class="text-xl font-semibold tracking-tight md:text-2xl">
                Locations
              </h2>
              <ul role="list" class="mt-4 divide-y divide-border">
                @for (location of locations(); track location.id) {
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
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class OrganizationOverview {
  readonly page = input.required<PublicOrganizationPage>();
  readonly savedAt = input<number | undefined>(undefined);
  /** The sport the page is filtered to (the sport view); none for the whole organization. */
  readonly sport = input<PublicSport | undefined>(undefined);
  /** The numbered control's page of `sport`'s leagues; none on the organization page, which lists page 1 only. */
  readonly leaguePaging = input<{ page: number; pageCount: number; total: number } | undefined>(
    undefined,
  );
  /** The next page of leagues is loading: the rows shown are the previous page's. */
  readonly busy = input(false);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  /** A visitor activated a link to another page, so focus follows when its leagues arrive. */
  protected pageRequested = false;

  protected readonly isEmpty = computed(
    () => this.page().leagueCount === 0 && this.page().leagues.length === 0,
  );

  /** From `getPublicPage`, never the number of rows shown, which is at most 5 per list. */
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

  protected readonly sportHref = computed(() =>
    sportViewPath(this.page().slug, this.sport()?.segment ?? ''),
  );

  /** The chip row ends in a rule of its own, so the sections below it start without one. */
  protected readonly gridClass = computed(() =>
    this.page().sports.length > 1
      ? 'grid gap-x-12 lg:grid-cols-3'
      : 'grid gap-x-12 border-t border-border lg:grid-cols-3',
  );

  protected readonly leagues = computed(() =>
    this.page().leagues.map((league, i) => ({
      id: `league-${i + 1}`,
      name: league.name,
      href: publicLeaguePath(this.page().slug, league.slug),
      divisionLabel: league.divisionLabel,
      where: [league.sportName, league.locationNames.join(', ')].filter(Boolean).join(' · '),
    })),
  );

  protected readonly locations = computed(() =>
    this.page().locations.map((location, i) => ({
      id: `location-${i + 1}`,
      name: location.name,
      address: location.address,
      sports: sportsCommaList(location.sportNames ?? []),
    })),
  );

  private readonly shownLeagues = computed(() => this.page().leagues);

  constructor() {
    // Moves focus, which only the browser does: a side effect outside Angular. The leagues shown
    // change when the page asked for has arrived, or when a live update replaces them; only the
    // first, after a click on a page link, moves focus.
    effect(() => {
      this.shownLeagues();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
