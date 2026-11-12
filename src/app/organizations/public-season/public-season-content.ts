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
  lucideCheck,
  lucideClock,
  lucideMapPin,
  lucideShirt,
  lucideUserPlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { LIST_PAGE_SIZE } from '../../core/list-page';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { HlmBadge, type HlmBadgeVariant } from '../../ui/badge';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import {
  BUTTON_BASE,
  OUTLINE_BUTTON_LARGE,
  PRIMARY_BUTTON_LARGE,
} from '../../ui/button/button-classes';
import { registerFreeAgentPath, registerTeamPath, teamPath } from '../../teams/team-paths';
import { seasonDateParts } from '../league/season-dates';
import { organizationPath } from '../organization-path';
import { PageControl } from '../page-control';
import { publicLeaguePath, publicSeasonPath } from '../public-league/public-league-path';
import { publicPageNames } from '../public-league/public-page-names';
import {
  registrationCard,
  teamCard,
  type RegistrationCard,
  type ViewerTeam,
} from './public-season-registration';
import { BADGE_TEXT, FULL_BADGE_TEXT } from '../season-status';
import type { PublicSeasonView } from './public-season-view';

const SEE_SEASON_BUTTON = `${BUTTON_BASE} border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 mt-5 h-11 w-full gap-2 px-5 has-data-[icon=inline-end]:pe-4`;
const CRUMB_LINK =
  'inline-flex items-center rounded-md font-medium hover:underline pointer-coarse:min-h-11';
const FACT = 'relative min-h-18 py-4 ps-14';
const REGISTRATION_CARD =
  'rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10 md:p-6 lg:sticky lg:top-24 lg:min-h-0';
/**
 * Below 1024px the card sits above the details, and the team card replaces the server's signed-out card after hydration. The signed-out card
 * stays in the card behind the team card, so the card is never shorter than it; these floors cover the team card when it is the taller one.
 * A full season is still open for registration, so a captain below the minimum gets the open team card.
 */
const RESERVED_HEIGHT = {
  open: 'min-h-66 sm:min-h-58',
  full: 'min-h-66 sm:min-h-58',
  closed: 'min-h-47 md:min-h-49',
} as const;
const PHASE_BADGES: Record<RegistrationCard['kind'], HlmBadgeVariant> = {
  open: 'secondary',
  full: 'outline',
  closed: 'muted',
};
const FACT_ICON =
  'absolute start-0 top-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground';

/** The dates are written from the stored text (`seasonDateParts`), never through `Date`, so the server and a browser in any time zone render the same text. */
@Component({
  selector: 'app-public-season-content',
  imports: [HlmBadge, HlmBreadcrumbImports, NgIcon, PageControl, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideArrowRight,
      lucideCalendarDays,
      lucideCheck,
      lucideClock,
      lucideMapPin,
      lucideShirt,
      lucideUserPlus,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <nav hlmBreadcrumb aria-label="Breadcrumb">
        <ol hlmBreadcrumbList class="flex-wrap gap-x-1.5">
          <li hlmBreadcrumbItem>
            <a hlmBreadcrumbLink [link]="organizationHref()" [class]="crumbLink">{{
              season().organization.name
            }}</a>
          </li>
          <li hlmBreadcrumbSeparator></li>
          <li hlmBreadcrumbItem>
            <a
              hlmBreadcrumbLink
              [link]="leagueHref()"
              [state]="leagueNames()"
              [class]="crumbLink"
              >{{ season().league.name }}</a
            >
          </li>
          <li hlmBreadcrumbSeparator></li>
          <li hlmBreadcrumbItem>
            <a hlmBreadcrumbPage [link]="seasonHref()" [class]="crumbLink">{{ season().name }}</a>
          </li>
        </ol>
      </nav>
      <div class="mt-4 flex flex-wrap items-center gap-2 md:mt-6">
        <span hlmBadge variant="secondary" size="fit">{{ season().league.sportName }}</span>
        @if (card(); as card) {
          <span data-testid="season-phase" hlmBadge size="fit" [variant]="phaseBadge()">{{
            phaseLabel(card)
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
      <div class="mx-auto grid w-full grid-cols-1 max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        @if (card(); as card) {
          <section
            id="registration"
            aria-labelledby="registration-heading"
            class="scroll-mt-20 pt-2 lg:col-start-3 lg:row-start-1 lg:pt-10 lg:pb-10"
          >
            <div [class]="registrationCardClass()">
              <h2 id="registration-heading" class="sr-only">Registration</h2>
              <div class="grid grid-cols-1">
                <div
                  class="col-start-1 row-start-1"
                  [class.invisible]="!!team()"
                  [attr.inert]="team() ? '' : null"
                  [attr.aria-hidden]="team() ? 'true' : null"
                >
                  @if (card.kind === 'open') {
                    <p class="text-lg font-semibold tracking-tight">
                      Registration open &middot; closes {{ card.closes }}
                    </p>
                    <div class="mt-5 flex flex-col gap-2">
                      <a
                        [routerLink]="registerTeamHref()"
                        data-slot="button"
                        [class]="registerButton"
                        ><ng-icon
                          name="lucideShirt"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Register a team</a
                      ><a
                        [routerLink]="registerFreeAgentHref()"
                        data-slot="button"
                        [class]="freeAgentButton"
                        ><ng-icon
                          name="lucideUserPlus"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Register as a free agent</a
                      >
                    </div>
                    <p class="mt-4 text-sm text-muted-foreground">
                      Captains register a team, then invite their players. Without a team? Register
                      as a free agent, and an organizer places you on one.
                    </p>
                  } @else if (card.kind === 'full') {
                    <p class="text-lg font-semibold tracking-tight">This season is full</p>
                    <p class="mt-2 text-sm text-muted-foreground">{{ card.note }}</p>
                    <div class="mt-5 flex flex-col gap-2">
                      <a
                        [routerLink]="registerTeamHref()"
                        data-slot="button"
                        [class]="registerButton"
                        ><ng-icon
                          name="lucideClock"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Join the waitlist</a
                      ><a
                        [routerLink]="registerFreeAgentHref()"
                        data-slot="button"
                        [class]="freeAgentButton"
                        ><ng-icon
                          name="lucideUserPlus"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Register as a free agent</a
                      >
                    </div>
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
                      <a
                        [routerLink]="nextHref(next.slug)"
                        data-slot="button"
                        [class]="seeSeasonButton"
                        >See {{ next.name
                        }}<ng-icon
                          name="lucideArrowRight"
                          data-icon="inline-end"
                          aria-hidden="true"
                      /></a>
                    }
                  }
                </div>
                @if (team(); as team) {
                  <div class="col-start-1 row-start-1">
                    <p>
                      <span hlmBadge variant="secondary" size="fit"
                        ><ng-icon
                          name="lucideCheck"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />You&apos;re registered</span
                      >
                    </p>
                    <div class="mt-4 flex items-center gap-3">
                      <span
                        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                        ><ng-icon name="lucideShirt" class="text-xl" aria-hidden="true"
                      /></span>
                      <div class="min-w-0">
                        <p class="truncate font-semibold">{{ team.name }}</p>
                        <p class="text-sm text-muted-foreground">{{ team.role }}</p>
                      </div>
                    </div>
                    <a
                      [routerLink]="teamHref(team.teamId)"
                      data-slot="button"
                      [class]="openTeamButton"
                      >Open your team<ng-icon
                        name="lucideArrowRight"
                        data-icon="inline-end"
                        aria-hidden="true"
                    /></a>
                    @if (team.invite; as invite) {
                      <p class="mt-4 text-sm text-muted-foreground">{{ invite }}</p>
                    }
                  </div>
                }
              </div>
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
          @if (view().teams; as teams) {
            <div class="border-t border-border py-8 md:py-10">
              <section
                id="teams"
                aria-labelledby="teams-heading"
                class="scroll-mt-20 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
              >
                <div class="border-b border-border px-4 py-3 md:px-5">
                  <h2
                    #teamsHeading
                    id="teams-heading"
                    tabindex="-1"
                    class="font-semibold focus:outline-none"
                  >
                    Teams
                  </h2>
                </div>
                @if (teams.rows.length) {
                  <ul
                    role="list"
                    class="divide-y divide-border"
                    [attr.aria-busy]="busy() ? 'true' : null"
                  >
                    @for (team of teams.rows; track team.name) {
                      <li class="flex items-center gap-3 px-4 py-3.5 md:px-5">
                        <span class="font-medium">{{ team.name }}</span>
                      </li>
                    }
                  </ul>
                  @if (teams.total > pageSize) {
                    <app-page-control
                      label="Teams pages"
                      noun="teams"
                      [page]="teams.page"
                      [pageCount]="teams.pageCount"
                      [total]="teams.total"
                      [path]="seasonHref()"
                      fragment="teams"
                      (pageActivated)="pageRequested = true"
                    />
                  } @else {
                    <p
                      class="border-t border-border px-4 py-3 text-sm text-muted-foreground tabular-nums md:px-5"
                    >
                      {{ teamTotal() }}
                    </p>
                  }
                } @else {
                  <div class="flex flex-col items-center px-6 py-10 text-center">
                    <span
                      class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                      ><ng-icon name="lucideUsers" class="text-xl" aria-hidden="true"
                    /></span>
                    <p class="mt-4 font-medium">No teams yet</p>
                    <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                      Teams appear here once they register.
                    </p>
                  </div>
                }
              </section>
            </div>
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
  readonly busy = input(false);
  /** Set only after hydration, for a signed-in viewer on a team in this season. */
  readonly viewerTeam = input<ViewerTeam | undefined>(undefined);

  protected readonly phaseLabel = (card: RegistrationCard) =>
    card.kind === 'full' ? FULL_BADGE_TEXT : BADGE_TEXT[card.phase];
  protected readonly seeSeasonButton = SEE_SEASON_BUTTON;
  protected readonly registerButton = `${PRIMARY_BUTTON_LARGE} w-full`;
  protected readonly freeAgentButton = `${OUTLINE_BUTTON_LARGE} w-full`;
  protected readonly openTeamButton = `${PRIMARY_BUTTON_LARGE} mt-5 w-full`;
  protected readonly crumbLink = CRUMB_LINK;
  protected readonly fact = FACT;
  protected readonly factIcon = FACT_ICON;

  protected readonly pageSize = LIST_PAGE_SIZE;
  protected pageRequested = false;

  private readonly teamsHeading = viewChild<ElementRef<HTMLElement>>('teamsHeading');
  private readonly injector = inject(Injector);

  protected readonly season = computed(() => this.view().season);
  private readonly shownTeams = computed(() => this.view().teams);
  protected readonly teamTotal = computed(() => {
    const total = this.shownTeams()?.total ?? 0;
    return `${total} ${total === 1 ? 'team' : 'teams'}`;
  });
  protected readonly card = computed(() => registrationCard(this.season(), this.now()));
  protected readonly registrationCardClass = computed(() => {
    const kind = this.card()?.kind;
    return kind ? `${RESERVED_HEIGHT[kind]} ${REGISTRATION_CARD}` : REGISTRATION_CARD;
  });
  protected readonly team = computed(() => {
    const team = this.viewerTeam();
    return team && teamCard(team, this.season(), this.now());
  });
  protected readonly phaseBadge = computed(() => PHASE_BADGES[this.card()?.kind ?? 'closed']);
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
  protected readonly leagueNames = computed(() =>
    publicPageNames({ organization: this.season().organization, league: this.season().league }),
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

  protected readonly registerFreeAgentHref = computed(() =>
    registerFreeAgentPath(
      this.season().organization.slug,
      this.season().league.slug,
      this.season().slug,
    ),
  );

  constructor() {
    // Moves focus, which only the browser does: a side effect outside Angular. The teams shown change when the page asked for has arrived, or
    // when a live update replaces them; only the first, after a click on a page link, moves focus.
    effect(() => {
      this.shownTeams();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.teamsHeading()?.nativeElement.focus(), {
          injector: this.injector,
        });
      });
    });
  }

  protected teamHref(teamId: string): string {
    return teamPath(teamId);
  }

  protected nextHref(seasonSlug: string): string {
    return publicSeasonPath(this.season().organization.slug, this.season().league.slug, seasonSlug);
  }
}
