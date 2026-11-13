import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarDays,
  lucideClock,
  lucideMapPin,
  lucideShirt,
  lucideUsers,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { registerTournamentTeamPath } from '../../teams/team-paths';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { PRIMARY_BUTTON_LARGE } from '../../ui/button/button-classes';
import { HlmCard } from '../../ui/card';
import { seasonDateParts } from '../league/season-dates';
import { organizationPath } from '../organization-path';
import {
  CRUMB_LINK,
  CRUMB_LIST,
  LEAGUE_HEADING,
} from '../public-league/public-league-header-classes';
import { tournamentRegistrationCard } from './public-tournament-registration';
import type { PublicTournamentData } from './public-tournament-view';

const FACT = 'relative min-h-18 py-4 ps-14';
const FACT_ICON =
  'absolute start-0 top-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground';

/** The dates are written from the stored text (`seasonDateParts`), never through `Date`, so the server and a browser in any time zone render the same text. */
@Component({
  selector: 'app-public-tournament-content',
  imports: [HlmBreadcrumbImports, HlmCard, NgIcon, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({ lucideCalendarDays, lucideClock, lucideMapPin, lucideShirt, lucideUsers }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <nav hlmBreadcrumb aria-label="Breadcrumb">
        <ol hlmBreadcrumbList class="${CRUMB_LIST}">
          <li hlmBreadcrumbItem>
            <a hlmBreadcrumbLink [link]="organizationHref()" class="${CRUMB_LINK}">{{
              tournament().organization.name
            }}</a>
          </li>
          <li hlmBreadcrumbSeparator></li>
          <li hlmBreadcrumbItem>
            <a
              hlmBreadcrumbLink
              [link]="organizationHref()"
              fragment="tournaments"
              class="${CRUMB_LINK}"
              >Tournaments</a
            >
          </li>
        </ol>
      </nav>
      <h1 class="${LEAGUE_HEADING}">{{ tournament().name }}</h1>
      <p class="mt-2 font-medium md:mt-3 md:text-lg">{{ tournament().divisionLabel }}</p>
      <p class="mt-1 text-muted-foreground md:text-lg">{{ sportAndPlaces() }}</p>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full grid-cols-1 max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <section
          id="registration"
          aria-labelledby="registration-heading"
          class="scroll-mt-20 pt-2 lg:col-start-3 lg:row-start-1 lg:pt-10 lg:pb-10"
        >
          <div hlmCard size="bare" class="p-5 md:p-6 lg:sticky lg:top-24">
            <h2 id="registration-heading" class="sr-only">Registration</h2>
            @if (card(); as card) {
              @if (card.kind === 'open') {
                <p class="text-lg font-semibold tracking-tight">
                  Registration open &middot; closes {{ card.closes }}
                </p>
                <a [routerLink]="registerHref()" data-slot="button" [class]="registerButton"
                  ><ng-icon
                    name="lucideShirt"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Register a team</a
                >
                <p class="mt-4 text-sm text-muted-foreground">
                  Captains register a team and play as its first player.
                </p>
              } @else if (card.kind === 'full') {
                <p class="text-lg font-semibold tracking-tight">Full</p>
                <p class="mt-2 text-sm text-muted-foreground">
                  Join the waitlist and an organizer offers your team a place if one opens.
                  Registration closes {{ card.closes }}.
                </p>
                <a [routerLink]="registerHref()" data-slot="button" [class]="registerButton"
                  ><ng-icon name="lucideClock" data-icon="inline-start" aria-hidden="true" />Join
                  the waitlist</a
                >
              } @else {
                <p class="text-lg font-semibold tracking-tight">Registration closed</p>
                <p class="mt-2 text-sm text-muted-foreground">
                  The deadline was {{ card.deadline }}.
                </p>
              }
            }
          </div>
        </section>
        <section
          aria-labelledby="details-heading"
          class="py-8 md:py-10 lg:col-span-2 lg:row-start-1"
        >
          <h2 id="details-heading" class="sr-only">Tournament details</h2>
          <dl class="grid divide-y divide-border sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideCalendarDays" class="text-lg" aria-hidden="true" /></span
                >Dates
              </dt>
              <dd class="mt-0.5 font-medium">
                <time [attr.datetime]="tournament().startDate">{{ dates().start }}</time>
                @if (dates().end; as end) {
                  &ndash; <time [attr.datetime]="tournament().endDate">{{ end }}</time>
                }
              </dd>
            </div>
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" /></span
                >Teams
              </dt>
              <dd class="mt-0.5 font-medium">Up to {{ tournament().maximumTeams }} teams</dd>
              <dd class="mt-0.5 text-sm text-muted-foreground">
                Teams of at least {{ tournament().minimumRosterSize }} players
              </dd>
            </div>
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideClock" class="text-lg" aria-hidden="true" /></span
                >Registration closes
              </dt>
              <dd class="mt-0.5 font-medium">
                <time [attr.datetime]="tournament().registrationDeadline">{{ closes() }}</time>
              </dd>
            </div>
            @if (tournament().locations.length) {
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true" /></span
                  >{{ locationsLabel() }}
                </dt>
                @for (location of tournament().locations; track location.name) {
                  <dd class="mt-0.5">
                    <span class="font-medium">{{ location.name }}</span>
                    <span class="block text-sm text-muted-foreground">{{ location.address }}</span>
                  </dd>
                }
              </div>
            }
          </dl>
        </section>
      </div>
    </div>
  `,
})
export class PublicTournamentContent {
  readonly tournament = input.required<PublicTournamentData>();
  readonly savedAt = input<number | undefined>(undefined);
  /** The viewer's clock, so the card follows the deadline after hydration. */
  readonly now = input.required<number>();

  protected readonly registerButton = `${PRIMARY_BUTTON_LARGE} mt-5 w-full`;
  protected readonly fact = FACT;
  protected readonly factIcon = FACT_ICON;

  protected readonly card = computed(() =>
    tournamentRegistrationCard(this.tournament(), this.now()),
  );
  protected readonly dates = computed(() =>
    seasonDateParts(this.tournament().startDate, this.tournament().endDate),
  );
  protected readonly closes = computed(() =>
    formatCalendarDate(this.tournament().registrationDeadline),
  );
  protected readonly locationsLabel = computed(() =>
    this.tournament().locations.length === 1 ? 'Location' : 'Locations',
  );
  protected readonly sportAndPlaces = computed(() =>
    [this.tournament().sportName, ...this.tournament().locations.map(({ name }) => name)].join(
      ' · ',
    ),
  );
  protected readonly registerHref = computed(() =>
    registerTournamentTeamPath(this.tournament().organization.slug, this.tournament().slug),
  );
  protected readonly organizationHref = computed(() =>
    organizationPath(this.tournament().organization.slug),
  );
}
