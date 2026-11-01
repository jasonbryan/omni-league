import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCalendarDays,
  lucideChevronRight,
  lucideClock,
  lucideMapPin,
  lucideShirt,
  lucideUsers,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { BUTTON_BASE, PRIMARY_BUTTON_LARGE } from '../../ui/button/button-classes';
import { registerTeamPath } from '../../teams/team-paths';
import { seasonDateParts } from '../league/season-dates';
import { organizationPath } from '../organization-path';
import { publicLeaguePath, publicSeasonPath } from '../public-league/public-league-path';
import { registrationCard } from './public-season-registration';
import { BADGE_TEXT, MUTED_BADGE, OPEN_BADGE } from '../season-status';
import type { SeasonPhase } from '../../../../convex/lib/registration';
import type { PublicSeasonView } from './public-season-view';

const SEE_SEASON_BUTTON = `${BUTTON_BASE} border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 mt-5 h-11 w-full gap-2 px-5 has-data-[icon=inline-end]:pe-4`;
const CRUMB_LINK =
  'inline-flex items-center rounded-md font-medium hover:text-foreground hover:underline pointer-coarse:min-h-11';
const CURRENT_CRUMB_LINK = `${CRUMB_LINK} text-foreground`;
const FACT = 'relative min-h-18 py-4 ps-14';
const FACT_ICON =
  'absolute start-0 top-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground';

/** The dates are written from the stored text (`seasonDateParts`), never through `Date`, so the server and a browser in any time zone render the same text. */
@Component({
  selector: 'app-public-season-content',
  imports: [NgIcon, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideArrowRight,
      lucideCalendarDays,
      lucideChevronRight,
      lucideClock,
      lucideMapPin,
      lucideShirt,
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
            <a [routerLink]="organizationHref()" [class]="crumbLink">{{
              season().organization.name
            }}</a>
          </li>
          <li aria-hidden="true">
            <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
          </li>
          <li>
            <a [routerLink]="leagueHref()" [class]="crumbLink">{{ season().league.name }}</a>
          </li>
          <li aria-hidden="true">
            <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
          </li>
          <li>
            <a [routerLink]="seasonHref()" aria-current="page" [class]="currentCrumbLink">{{
              season().name
            }}</a>
          </li>
        </ol>
      </nav>
      <div class="mt-4 flex flex-wrap items-center gap-2 md:mt-6">
        <span data-slot="badge" [class]="openBadge">{{ season().league.sportName }}</span>
        @if (card(); as card) {
          <span data-testid="season-phase" [class]="phaseBadge()">{{
            phaseLabel(card.phase)
          }}</span>
        }
      </div>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-balance md:text-5xl">
        {{ season().league.name }}&nbsp;&middot; {{ season().name }}
      </h1>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        @if (card(); as card) {
          <section
            id="registration"
            aria-labelledby="registration-heading"
            class="scroll-mt-20 pt-2 lg:col-start-3 lg:row-start-1 lg:pt-10 lg:pb-10"
          >
            <div
              class="rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10 md:p-6 lg:sticky lg:top-24"
            >
              <h2 id="registration-heading" class="sr-only">Registration</h2>
              @if (card.kind === 'open') {
                <p class="text-lg font-semibold tracking-tight">
                  Registration open &middot; closes {{ card.closes }}
                </p>
                <div class="mt-5 flex flex-col gap-2">
                  <a [routerLink]="registerTeamHref()" data-slot="button" [class]="registerButton"
                    ><ng-icon
                      name="lucideShirt"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Register a team</a
                  >
                </div>
                <p class="mt-4 text-sm text-muted-foreground">
                  Captains register a team, then invite their players. Without a team? Register as a
                  free agent, and an organizer places you on one.
                </p>
              } @else {
                <p class="text-lg font-semibold tracking-tight">
                  Registration closed on {{ card.closedOn }}
                </p>
                <p class="mt-4 text-sm text-muted-foreground">
                  {{ card.note }}
                  @if (card.next; as next) {
                    Registration is open for {{ next.name }}.
                  }
                </p>
                @if (card.next; as next) {
                  <a [routerLink]="nextHref(next.slug)" data-slot="button" [class]="seeSeasonButton"
                    >See {{ next.name
                    }}<ng-icon name="lucideArrowRight" data-icon="inline-end" aria-hidden="true"
                  /></a>
                }
              }
            </div>
          </section>
        }
        <div class="lg:col-span-2 lg:row-start-1">
          <section aria-labelledby="details-heading" class="py-8 md:py-10">
            <h2 id="details-heading" class="sr-only">Season details</h2>
            <dl class="grid divide-y divide-border sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideCalendarDays" class="text-lg" aria-hidden="true" /></span
                  >Dates
                </dt>
                <dd class="mt-0.5 font-medium">
                  <time [attr.datetime]="season().startDate">{{ dates().start }}</time>
                  @if (dates().end; as end) {
                    &ndash; <time [attr.datetime]="season().endDate">{{ end }}</time>
                  }
                </dd>
              </div>
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" /></span
                  >Division
                </dt>
                <dd class="mt-0.5 font-medium">
                  {{ season().league.divisionLabel ?? season().formatName }}
                </dd>
                <dd class="mt-0.5 text-sm text-muted-foreground">{{ teamSize() }}</dd>
              </div>
              @if (closes(); as closes) {
                <div [class]="fact">
                  <dt class="text-sm text-muted-foreground">
                    <span [class]="factIcon"
                      ><ng-icon name="lucideClock" class="text-lg" aria-hidden="true" /></span
                    >Registration closes
                  </dt>
                  <dd class="mt-0.5 font-medium">
                    <time [attr.datetime]="season().registrationDeadline">{{ closes }}</time>
                  </dd>
                </div>
              }
              @if (locations().length) {
                <div [class]="fact">
                  <dt class="text-sm text-muted-foreground">
                    <span [class]="factIcon"
                      ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true" /></span
                    >{{ locationsLabel() }}
                  </dt>
                  @for (location of locations(); track location.name) {
                    <dd class="mt-0.5">
                      <span class="font-medium">{{ location.name }}</span>
                      @if (location.address) {
                        <span class="block text-sm text-muted-foreground">{{
                          location.address
                        }}</span>
                      }
                    </dd>
                  }
                </div>
              }
            </dl>
          </section>
          @if (card()?.kind === 'open') {
            <section aria-labelledby="how-heading" class="border-t border-border py-8 md:py-10">
              <h2 id="how-heading" class="text-xl font-semibold tracking-tight">
                How registration works
              </h2>
              <ol role="list" class="mt-5 space-y-5">
                @for (step of steps(); track step.title; let index = $index) {
                  <li class="flex gap-4">
                    <span
                      aria-hidden="true"
                      class="flex size-8 shrink-0 items-center justify-center rounded-full border border-input text-sm font-semibold tabular-nums"
                      >{{ index + 1 }}</span
                    >
                    <div>
                      <h3 class="font-medium">{{ step.title }}</h3>
                      <p class="mt-0.5 text-sm text-muted-foreground">{{ step.text }}</p>
                    </div>
                  </li>
                }
              </ol>
            </section>
          }
        </div>
      </div>
    </div>
  `,
})
export class PublicSeasonContent {
  readonly view = input.required<PublicSeasonView>();
  readonly savedAt = input<number | undefined>(undefined);
  /** The viewer's clock, so the card follows the deadline after hydration. */
  readonly now = input.required<number>();

  protected readonly openBadge = OPEN_BADGE;
  protected readonly phaseLabel = (phase: SeasonPhase) => BADGE_TEXT[phase];
  protected readonly seeSeasonButton = SEE_SEASON_BUTTON;
  protected readonly registerButton = `${PRIMARY_BUTTON_LARGE} w-full`;
  protected readonly crumbLink = CRUMB_LINK;
  protected readonly currentCrumbLink = CURRENT_CRUMB_LINK;
  protected readonly fact = FACT;
  protected readonly factIcon = FACT_ICON;

  protected readonly season = computed(() => this.view().season);
  protected readonly card = computed(() => registrationCard(this.season(), this.now()));
  protected readonly phaseBadge = computed(() =>
    this.card()?.phase === 'registrationOpen' ? OPEN_BADGE : MUTED_BADGE,
  );
  protected readonly dates = computed(() =>
    seasonDateParts(this.season().startDate, this.season().endDate),
  );
  protected readonly closes = computed(() => {
    const deadline = this.season().registrationDeadline;
    return deadline === undefined ? undefined : formatCalendarDate(deadline);
  });
  protected readonly teamSize = computed(() => {
    const { league, minimumRosterSize } = this.season();
    const need = `teams need at least ${minimumRosterSize} players`;
    return league.divisionLabel === undefined
      ? `Teams need at least ${minimumRosterSize} players`
      : `From the league · ${need}`;
  });
  /** A copy saved before addresses existed has the names only. */
  protected readonly locations = computed(
    () =>
      this.season().league.locations ??
      this.season().league.locationNames.map((name) => ({ name, address: '' })),
  );
  protected readonly locationsLabel = computed(() =>
    this.locations().length === 1 ? 'Location' : 'Locations',
  );
  protected readonly steps = computed(() => {
    const { minimumRosterSize, startDate } = this.season();
    const firstLocation = this.locations()[0];
    const games = `Games start ${formatCalendarDate(startDate)}`;
    return [
      {
        title: 'Register',
        text: 'Register a team as its captain, or register on your own as a free agent.',
      },
      {
        title: 'Build your roster',
        text: `Captains share an invite link. Teams need at least ${minimumRosterSize} players before registration closes.`,
      },
      {
        title: 'Play',
        text: firstLocation ? `${games} at ${firstLocation.name}.` : `${games}.`,
      },
    ];
  });
  protected readonly organizationHref = computed(() =>
    organizationPath(this.season().organization.slug),
  );
  protected readonly leagueHref = computed(() =>
    publicLeaguePath(this.season().organization.slug, this.season().league.slug),
  );
  protected readonly seasonHref = computed(() =>
    publicSeasonPath(
      this.season().organization.slug,
      this.season().league.slug,
      this.season().slug,
    ),
  );

  protected readonly registerTeamHref = computed(() =>
    registerTeamPath(
      this.season().organization.slug,
      this.season().league.slug,
      this.season().slug,
    ),
  );

  protected nextHref(seasonSlug: string): string {
    return publicSeasonPath(this.season().organization.slug, this.season().league.slug, seasonSlug);
  }
}
