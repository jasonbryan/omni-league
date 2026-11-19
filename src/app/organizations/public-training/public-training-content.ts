import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideClock,
  lucideListOrdered,
  lucideMapPin,
  lucideRepeat,
  lucideUserRound,
  lucideUsers,
} from '@ng-icons/lucide';
import {
  MAX_MINORS_PER_SESSION,
  participantsOffered,
  type Participant,
} from '../../../../convex/lib/individualRegistration';
import { trainingAgesLabel } from '../../../../convex/lib/trainingInput';
import {
  trainingClassDate,
  trainingHours,
  trainingPatternText,
} from '../../../../convex/lib/trainingPattern';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { HlmBadge } from '../../ui/badge';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { OUTLINE_BUTTON } from '../../ui/button/button-classes';
import { HlmCard } from '../../ui/card';
import { organizationPath } from '../organization-path';
import { CLASS_QUERY, registerTrainingPath } from '../register-training/register-training-path';
import { registeredLine } from '../registered-line';
import {
  CRUMB_LINK,
  CRUMB_LIST,
  LEAGUE_HEADING,
} from '../public-league/public-league-header-classes';
import { trainingSeriesStatus, upcomingClasses } from '../training-status';
import type { PublicTrainingData } from './public-training-view';

const ACTIONS_ROW = 'mt-3 flex min-h-9 items-center gap-3 pointer-coarse:min-h-11';
// `min-w-0`: a grid item may shrink below its content, or the registered line's width widens the column.
const FACT = 'relative min-h-18 min-w-0 py-4 ps-14';
const FACT_ICON =
  'absolute start-0 top-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground';
const CLASS_LINE = 'mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground';
const CLASS_ICON = 'mt-0.5 shrink-0 text-base';

export interface RegisteredClass {
  readonly classId: string;
  readonly self: boolean;
  readonly minorNames: readonly string[];
}

export interface ClassWaitingSpot extends WaitingSpot {
  readonly classId: string;
}

const ENDED_TEXT = 'This training has ended.';
const CANCELLED_TEXT = 'Every class of this training program is cancelled.';
const FULL_TEXT = 'A class is full, so no place is left for the whole series.';
const WAITING_TEXT = 'People are waiting for a place, so no place is left for the whole series.';

export interface WaitingSpot {
  readonly participant: Participant;
  readonly position: number;
}

function waitingLine({ participant, position }: WaitingSpot): string {
  const who = participant.kind === 'self' ? "You're" : `${participant.minorName} is`;
  return `${who} on the waitlist, position ${position}`;
}

/** The dates are written from the stored text, never through `Date`, so the server and a browser in any time zone render the same text. */
@Component({
  selector: 'app-public-training-content',
  imports: [HlmBadge, HlmBreadcrumbImports, HlmCard, NgIcon, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideClock,
      lucideListOrdered,
      lucideMapPin,
      lucideRepeat,
      lucideUserRound,
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
              training().organization.name
            }}</a>
          </li>
          <li hlmBreadcrumbSeparator></li>
          <li hlmBreadcrumbItem>
            <a
              hlmBreadcrumbLink
              [link]="organizationHref()"
              fragment="training"
              class="${CRUMB_LINK}"
              >Training</a
            >
          </li>
        </ol>
      </nav>
      <h1 class="${LEAGUE_HEADING} wrap-anywhere">{{ training().name }}</h1>
      <p class="mt-2 font-medium wrap-anywhere md:mt-3 md:text-lg">{{ pattern() }}</p>
      <p class="mt-1 text-muted-foreground wrap-anywhere md:text-lg">{{ sportAndPlaces() }}</p>
      @if (savedAt(); as savedAt) {
        <app-saved-copy-note [savedAt]="savedAt" />
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <section
          id="classes"
          aria-labelledby="classes-heading"
          class="scroll-mt-20 py-8 md:py-10 lg:col-span-2 lg:row-start-1"
        >
          <div hlmCard size="bare" class="overflow-hidden">
            <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
              <h2 id="classes-heading" class="font-semibold">Classes</h2>
            </div>
            @if (classes().length > 0) {
              <ul role="list" class="divide-y divide-border">
                @for (row of classes(); track row.date) {
                  <li class="px-4 py-4 md:px-5">
                    <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <h3 class="font-semibold">
                        <time [attr.datetime]="row.date">{{ row.day }}</time>
                      </h3>
                      @if (row.full) {
                        <span hlmBadge variant="outline">Full</span>
                      }
                    </div>
                    <p class="${CLASS_LINE}">
                      <ng-icon name="lucideClock" class="${CLASS_ICON}" aria-hidden="true" />
                      <span>{{ row.hours }}</span>
                    </p>
                    <p data-slot="class-places" class="${CLASS_LINE}">
                      <ng-icon name="lucideUsers" class="${CLASS_ICON}" aria-hidden="true" /><span
                        [class]="row.full ? 'font-medium text-foreground' : ''"
                        >{{ row.places }}</span
                      >
                    </p>
                    @if (row.single) {
                      <div
                        data-slot="class-actions"
                        [class]="actionsRow"
                        [class.flex-wrap]="row.waitingLines.length > 0"
                      >
                        @if (row.waitingLines.length > 0) {
                          <div class="flex min-w-0 basis-full flex-col gap-0.5">
                            @for (line of row.waitingLines; track line) {
                              <p
                                data-slot="class-waitlist"
                                class="flex min-w-0 items-start gap-1.5 text-sm font-medium"
                              >
                                <ng-icon
                                  name="lucideListOrdered"
                                  class="mt-0.5 shrink-0 text-base"
                                  aria-hidden="true"
                                /><span class="wrap-anywhere">{{ line }}</span>
                              </p>
                            }
                          </div>
                        }
                        @if (row.registeredLine; as line) {
                          <p
                            data-slot="class-registered"
                            class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium"
                          >
                            <ng-icon
                              name="lucideCircleCheck"
                              class="shrink-0 text-base"
                              aria-hidden="true"
                            /><span class="truncate">{{ line }}</span>
                          </p>
                        }
                        @if (row.canRegister) {
                          <a
                            [routerLink]="registerPath()"
                            [queryParams]="row.query"
                            data-slot="button"
                            [class]="registerButton + ' ms-auto shrink-0'"
                            >Register<span class="sr-only"> for {{ row.day }}</span></a
                          >
                        }
                        @if (row.canJoin) {
                          <a
                            [routerLink]="registerPath()"
                            [queryParams]="row.query"
                            data-slot="button"
                            [class]="registerButton + ' ms-auto shrink-0'"
                            >Join the waitlist<span class="sr-only"> for {{ row.day }}</span></a
                          >
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            } @else if (training().everyClassCancelled) {
              <p data-slot="training-cancelled" class="px-4 py-6 font-medium md:px-5">
                {{ cancelledText }}
              </p>
            } @else {
              <p data-slot="training-ended" class="px-4 py-6 font-medium md:px-5">
                {{ endedText }}
              </p>
            }
          </div>
        </section>
        <section
          aria-labelledby="details-heading"
          class="pb-6 md:pb-10 lg:col-start-3 lg:row-start-1 lg:pt-10"
        >
          <h2 id="details-heading" class="sr-only">Training details</h2>
          <dl class="grid divide-y divide-border">
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideUserRound" class="text-lg" aria-hidden="true" /></span
                >Coach
              </dt>
              <dd data-slot="coach" class="mt-0.5 font-medium wrap-anywhere">
                {{ training().coachName }}
              </dd>
            </div>
            @if (ages(); as ages) {
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" /></span
                  >Ages
                </dt>
                <dd class="mt-0.5 font-medium">{{ ages }}</dd>
              </div>
            }
            @if (training().locations.length) {
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true" /></span
                  >{{ locationsLabel() }}
                </dt>
                @for (location of training().locations; track location.name) {
                  <dd class="mt-0.5">
                    <span class="font-medium wrap-anywhere">{{ location.name }}</span>
                    <span class="block text-sm wrap-anywhere text-muted-foreground">{{
                      location.address
                    }}</span>
                  </dd>
                }
              </div>
            }
            <div [class]="fact">
              <dt class="text-sm text-muted-foreground">
                <span [class]="factIcon"
                  ><ng-icon name="lucideRepeat" class="text-lg" aria-hidden="true" /></span
                >Schedule
              </dt>
              <dd data-slot="pattern" class="mt-0.5 font-medium">{{ pattern() }}</dd>
              <dd class="text-sm text-muted-foreground">
                First class
                <time [attr.datetime]="training().pattern.firstDate">{{ firstClass() }}</time>
              </dd>
            </div>
            @if (status(); as status) {
              <div [class]="fact">
                <dt class="text-sm text-muted-foreground">
                  <span [class]="factIcon"
                    ><ng-icon name="lucideCalendarClock" class="text-lg" aria-hidden="true" /></span
                  >Registration
                </dt>
                <dd class="mt-0.5">
                  <span data-slot="series-status" hlmBadge [variant]="status.badgeVariant">{{
                    status.badge
                  }}</span>
                </dd>
                @if (status.registrationOpen) {
                  <dd class="mt-1 text-sm text-muted-foreground">
                    Closes
                    <time [attr.datetime]="training().pattern.registrationDeadline">{{
                      closes()
                    }}</time>
                  </dd>
                  @if (full()) {
                    <dd data-slot="series-full" class="mt-1 text-sm text-muted-foreground">
                      {{ seriesWaitlist() ? waitingText : fullText }}
                    </dd>
                  }
                }
                <dd
                  data-slot="series-actions"
                  [class]="actionsRow"
                  [class.flex-wrap]="waitingLines().length > 0"
                >
                  @if (registeredText() || waitingLines().length > 0) {
                    <div
                      class="flex min-w-0 flex-1 flex-col justify-center gap-0.5"
                      [class.basis-full]="waitingLines().length > 0"
                    >
                      @if (registeredText(); as line) {
                        <p
                          data-slot="series-registered"
                          class="flex min-w-0 items-center gap-1.5 text-sm font-medium"
                        >
                          <ng-icon
                            name="lucideCircleCheck"
                            class="shrink-0 text-base"
                            aria-hidden="true"
                          /><span class="truncate">{{ line }}</span>
                        </p>
                      }
                      @for (line of waitingLines(); track line) {
                        <p
                          data-slot="series-waitlist"
                          class="flex min-w-0 items-start gap-1.5 text-sm font-medium"
                        >
                          <ng-icon
                            name="lucideListOrdered"
                            class="mt-0.5 shrink-0 text-base"
                            aria-hidden="true"
                          /><span class="wrap-anywhere">{{ line }}</span>
                        </p>
                      }
                    </div>
                  }
                  @if (canRegister()) {
                    <a
                      [routerLink]="registerPath()"
                      data-slot="button"
                      [class]="registerButton + ' ms-auto shrink-0'"
                      >Register<span class="sr-only"> for the series</span></a
                    >
                  }
                  @if (canJoin()) {
                    <a
                      [routerLink]="registerPath()"
                      data-slot="button"
                      [class]="registerButton + ' ms-auto shrink-0'"
                      >Join the waitlist<span class="sr-only"> for the series</span></a
                    >
                  }
                </dd>
              </div>
            }
          </dl>
        </section>
      </div>
    </div>
  `,
})
export class PublicTrainingContent {
  readonly training = input.required<PublicTrainingData>();
  readonly savedAt = input<number | undefined>(undefined);
  /** The viewer's clock, so the classes listed and the registration status follow it after hydration. */
  readonly now = input.required<number>();
  readonly registeredSelf = input(false);
  readonly registeredMinors = input<readonly string[]>([]);
  /** What the viewer holds in single classes; the series is in `registeredSelf` and `registeredMinors`. */
  readonly registeredClasses = input<readonly RegisteredClass[]>([]);
  readonly waitlist = input<readonly WaitingSpot[]>([]);
  readonly classWaitlist = input<readonly ClassWaitingSpot[]>([]);

  protected readonly endedText = ENDED_TEXT;
  protected readonly cancelledText = CANCELLED_TEXT;
  protected readonly fullText = FULL_TEXT;
  protected readonly waitingText = WAITING_TEXT;
  protected readonly registerButton = OUTLINE_BUTTON;
  protected readonly actionsRow = ACTIONS_ROW;
  protected readonly fact = FACT;
  protected readonly factIcon = FACT_ICON;

  protected readonly pattern = computed(() => trainingPatternText(this.training().pattern));
  protected readonly firstClass = computed(() =>
    formatCalendarDate(this.training().pattern.firstDate),
  );
  protected readonly closes = computed(() =>
    formatCalendarDate(this.training().pattern.registrationDeadline),
  );
  /** Left out when neither bound is set, which "All ages" would only restate. */
  protected readonly ages = computed(() => {
    const { minimumAge, maximumAge } = this.training();
    return minimumAge === undefined && maximumAge === undefined
      ? null
      : trainingAgesLabel(minimumAge, maximumAge);
  });
  protected readonly classes = computed(() => {
    const { allowSingleRegistration } = this.training();
    return upcomingClasses(this.training().classes, this.now()).map((row) => {
      const { classId } = row;
      const full = row.placesLeft === 0;
      const held = this.registeredClasses().find((entry) => entry.classId === classId);
      const spots = this.classWaitlist().filter((spot) => spot.classId === classId);
      return {
        date: row.date,
        day: trainingClassDate(row.date),
        hours: trainingHours(row.startTime, row.endTime),
        full,
        // The series replaces a place of the viewer's own in the class, so it is not full to them.
        fullForSeries: full && held === undefined,
        places: full
          ? 'Full'
          : `${row.placesLeft} ${row.placesLeft === 1 ? 'place' : 'places'} left`,
        // A copy saved before classes were named has no id to link to.
        single: allowSingleRegistration === true && classId !== undefined,
        query: { [CLASS_QUERY]: classId },
        registeredLine: held ? registeredLine(held.self, held.minorNames) : null,
        waitingLines: spots.map(waitingLine),
        canRegister: !full && this.canAddToClass(held),
        canJoin: full && this.canAddToClass(held, spots),
      };
    });
  });
  /** With no class left there is nothing to register for, so no status is shown. */
  protected readonly status = computed(() =>
    this.classes().length === 0
      ? null
      : trainingSeriesStatus(
          {
            firstDate: this.training().pattern.firstDate,
            weeks: this.training().pattern.weeks,
            registrationDeadline: this.training().pattern.registrationDeadline,
          },
          this.now(),
        ),
  );
  /** A waiting entry holds the next place in every class, so the series is full to the viewer whatever they hold. */
  protected readonly seriesWaitlist = computed(() => this.training().seriesWaitlist === true);
  protected readonly full = computed(
    () => this.seriesWaitlist() || this.classes().some((row) => row.fullForSeries),
  );
  protected readonly registeredText = computed(() =>
    registeredLine(this.registeredSelf(), this.registeredMinors()),
  );
  protected readonly waitingLines = computed(() => this.waitlist().map(waitingLine));
  private readonly canAdd = computed(() => {
    const offered = participantsOffered(this.training());
    const waitingSelf = this.waitlist().some(({ participant }) => participant.kind === 'self');
    const waitingChildren = this.waitlist().filter(
      ({ participant }) => participant.kind === 'minor',
    );
    return (
      (offered.includes('self') && !this.registeredSelf() && !waitingSelf) ||
      (offered.includes('minor') &&
        this.registeredMinors().length + waitingChildren.length < MAX_MINORS_PER_SESSION)
    );
  });
  private canAddToClass(
    held: RegisteredClass | undefined,
    spots: readonly WaitingSpot[] = [],
  ): boolean {
    const offered = participantsOffered(this.training());
    // A waiting account holder is refused another wait, for the series or the class, so only a child can still be added.
    const selfFree =
      !this.registeredSelf() &&
      held?.self !== true &&
      !this.waitlist().some(({ participant }) => participant.kind === 'self') &&
      !spots.some(({ participant }) => participant.kind === 'self');
    // A child already held may take another class, so the link stays at the most children.
    return (offered.includes('self') && selfFree) || offered.includes('minor');
  }
  private readonly asks = computed(() => this.status()?.registrationOpen === true && this.canAdd());
  protected readonly canRegister = computed(() => this.asks() && !this.full());
  protected readonly canJoin = computed(() => this.asks() && this.full());
  protected readonly registerPath = computed(() =>
    registerTrainingPath(this.training().organization.slug, this.training().slug),
  );
  protected readonly locationsLabel = computed(() =>
    this.training().locations.length === 1 ? 'Location' : 'Locations',
  );
  protected readonly sportAndPlaces = computed(() =>
    [this.training().sportName, ...this.training().locations.map(({ name }) => name)].join(' · '),
  );
  protected readonly organizationHref = computed(() =>
    organizationPath(this.training().organization.slug),
  );
}
