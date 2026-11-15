import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideClock,
  lucideMapPin,
  lucideUsers,
} from '@ng-icons/lucide';
import { campAgesLabel } from '../../../../convex/lib/campInput';
import { campSessionTimes } from '../../../../convex/lib/campSessionInput';
import { minorMayRegister } from '../../../../convex/lib/individualRegistration';
import { registrationIsOpen } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { HlmBadge } from '../../ui/badge';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { OUTLINE_BUTTON } from '../../ui/button/button-classes';
import { HlmCard } from '../../ui/card';
import { seasonDateParts } from '../league/season-dates';
import { organizationPath } from '../organization-path';
import { registerCampPath } from '../register-camp/register-camp-path';
import {
  CRUMB_LINK,
  CRUMB_LIST,
  LEAGUE_HEADING,
} from '../public-league/public-league-header-classes';
import { campSessionStatus } from './camp-session-status';
import type { PublicCampData } from './public-camp-view';

const FACT = 'relative min-h-18 py-4 ps-14';
const FACT_ICON =
  'absolute start-0 top-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground';
const SESSION_LINE = 'mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground';
const SESSION_ICON = 'mt-0.5 shrink-0 text-base';

type PublicCampSession = PublicCampData['sessions'][number];

/** The dates are written from the stored text (`seasonDateParts`), never through `Date`, so the server and a browser in any time zone render the same text. */
@Component({
  selector: 'app-public-camp-content',
  imports: [HlmBadge, HlmBreadcrumbImports, HlmCard, NgIcon, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideClock,
      lucideMapPin,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <nav hlmBreadcrumb aria-label="Breadcrumb">
        <ol hlmBreadcrumbList class="${CRUMB_LIST}">
          <li hlmBreadcrumbItem>
            <a hlmBreadcrumbLink [link]="organizationHref()" class="${CRUMB_LINK}">{{
              camp().organization.name
            }}</a>
          </li>
        </ol>
      </nav>
      <h1 class="${LEAGUE_HEADING}">{{ camp().name }}</h1>
      <p class="mt-2 font-medium md:mt-3 md:text-lg">{{ ages() }}</p>
      <p class="mt-1 text-muted-foreground md:text-lg">{{ sportAndPlaces() }}</p>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <section
          id="sessions"
          aria-labelledby="sessions-heading"
          class="scroll-mt-20 py-8 md:py-10 lg:col-span-2 lg:row-start-1"
        >
          <div hlmCard size="bare" class="overflow-hidden">
            <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
              <h2 id="sessions-heading" class="font-semibold">Sessions</h2>
            </div>
            <ul role="list" class="divide-y divide-border">
              @for (session of sessions(); track session.startDate + session.name) {
                <li class="px-4 py-4 md:px-5">
                  <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <h3 class="font-semibold">{{ session.name }}</h3>
                    @if (session.status.badge; as badge) {
                      <span hlmBadge [variant]="session.status.badgeVariant ?? 'muted'">{{
                        badge
                      }}</span>
                    }
                  </div>
                  <p class="${SESSION_LINE}">
                    <ng-icon name="lucideCalendarDays" class="${SESSION_ICON}" aria-hidden="true" />
                    <span
                      ><time [attr.datetime]="session.startDate">{{ session.dates.start }}</time>
                      @if (session.dates.end; as end) {
                        &ndash; <time [attr.datetime]="session.endDate">{{ end }}</time>
                      }
                    </span>
                  </p>
                  @if (session.times; as times) {
                    <p class="${SESSION_LINE}">
                      <ng-icon
                        name="lucideClock"
                        class="${SESSION_ICON}"
                        aria-hidden="true"
                      /><span>{{ times }}</span>
                    </p>
                  }
                  <p data-slot="session-places" class="${SESSION_LINE}">
                    <ng-icon name="lucideUsers" class="${SESSION_ICON}" aria-hidden="true" /><span
                      [class]="session.status.full ? 'font-medium text-foreground' : ''"
                      >{{ session.status.places }}</span
                    >
                  </p>
                  <p class="${SESSION_LINE}">
                    <ng-icon
                      name="lucideCalendarClock"
                      class="${SESSION_ICON}"
                      aria-hidden="true"
                    />
                    <span
                      >Registration closes
                      <time [attr.datetime]="session.registrationDeadline">{{
                        session.closes
                      }}</time></span
                    >
                  </p>
                  @for (line of session.registeredLines; track line) {
                    <p
                      data-slot="session-registered"
                      class="mt-3 flex h-9 items-center gap-1.5 text-sm font-medium pointer-coarse:min-h-11"
                    >
                      <ng-icon
                        name="lucideCircleCheck"
                        class="shrink-0 text-base"
                        aria-hidden="true"
                      />{{ line }}
                    </p>
                  }
                  @if (session.canRegister; as sessionId) {
                    <a
                      [routerLink]="registerPath()"
                      [queryParams]="{ session: sessionId }"
                      data-slot="button"
                      [class]="registerButton + ' mt-3'"
                      >Register<span class="sr-only"> for {{ session.name }}</span></a
                    >
                  }
                </li>
              }
            </ul>
          </div>
        </section>
        <section
          aria-labelledby="details-heading"
          class="pb-6 md:pb-10 lg:col-start-3 lg:row-start-1 lg:pt-10"
        >
          <h2 id="details-heading" class="sr-only">Camp details</h2>
          <dl class="grid divide-y divide-border">
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" /></span
                >Age range
              </dt>
              <dd class="mt-0.5 font-medium">{{ ages() }}</dd>
            </div>
            @if (camp().locations.length) {
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true" /></span
                  >{{ locationsLabel() }}
                </dt>
                @for (location of camp().locations; track location.name) {
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
export class PublicCampContent {
  readonly camp = input.required<PublicCampData>();
  readonly savedAt = input<number | undefined>(undefined);
  /** The viewer's clock, so each session's status follows its deadline after hydration. */
  readonly now = input.required<number>();
  readonly registeredSessionIds = input<readonly string[]>([]);
  readonly registeredMinors = input<readonly { sessionId: string; minorName: string }[]>([]);

  protected readonly registerButton = OUTLINE_BUTTON;
  protected readonly fact = FACT;
  protected readonly factIcon = FACT_ICON;

  protected readonly ages = computed(() =>
    campAgesLabel(this.camp().minimumAge, this.camp().maximumAge),
  );
  protected readonly sessions = computed(() => {
    const childrenMayRegister = minorMayRegister(this.camp().minimumAge);
    return this.camp().sessions.map((session: PublicCampSession) => {
      const { sessionId } = session;
      const registered = sessionId !== undefined && this.registeredSessionIds().includes(sessionId);
      const children = this.registeredMinors().filter((minor) => minor.sessionId === sessionId);
      const open = session.placesLeft > 0 && registrationIsOpen(session, this.now());
      return {
        ...session,
        status: campSessionStatus(session, this.now()),
        dates: seasonDateParts(session.startDate, session.endDate),
        times: campSessionTimes(session.dailyStartTime, session.dailyEndTime),
        closes: formatCalendarDate(session.registrationDeadline),
        registeredLines: [
          ...(registered ? ["You're registered"] : []),
          ...children.map((minor) => `${minor.minorName} is registered`),
        ],
        // A held place takes away only the guardian's own registration, so the link stays where a child may still be added.
        canRegister:
          open && sessionId !== undefined && (!registered || childrenMayRegister)
            ? sessionId
            : null,
      };
    });
  });
  protected readonly registerPath = computed(() =>
    registerCampPath(this.camp().organization.slug, this.camp().slug),
  );
  protected readonly locationsLabel = computed(() =>
    this.camp().locations.length === 1 ? 'Location' : 'Locations',
  );
  protected readonly sportAndPlaces = computed(() =>
    [this.camp().sportName, ...this.camp().locations.map(({ name }) => name)].join(' · '),
  );
  protected readonly organizationHref = computed(() =>
    organizationPath(this.camp().organization.slug),
  );
}
