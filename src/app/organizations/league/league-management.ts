import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideMapPin,
  lucidePlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { sportName } from '../../../../convex/lib/sports';
import { injectQuery, skipToken } from '../../core/data/convex';
import { isPlainClick } from '../../shell/follow-link';
import { AdminAlert } from '../admin/admin-alert';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { BADGE_DEFAULT, BADGE_OUTLINE, BADGE_SECONDARY } from '../admin/field-classes';
import { LeagueContext } from './league-context';
import { leaguePath } from './league-path';
import { seasonDates } from './season-dates';
import { SeasonCreateForm } from './season-create-form';

/**
 * The content of the league management page, `/app/organizations/:orgSlug/leagues/:leagueSlug`
 * (#125; design/mockups/125-126-seasons.html states 2 to 11 and 22): the league's header, its
 * seasons from `seasons.listForOrganizer` (live, newest start date first, drafts included), each
 * with its status, dates, registration deadline, and format, and the create form beside the list
 * from 1024px and after it below. Below 1024px the header's "Create a season" link jumps to the
 * form and puts focus on its first field. It exists only once `LeagueContext` says `ready`, so
 * nothing here is requested before the caller is known to organize this league. Publishing is
 * #126's and the season page's link is #134's: a season's name is plain text until then.
 */
@Component({
  selector: 'app-league-management',
  imports: [AdminAlert, NgIcon, SeasonCreateForm],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideMapPin,
      lucidePlus,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (league(); as league) {
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">{{ league.organization.name }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            {{ league.name }}
          </h1>
          <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            @if (league.status === 'published') {
              <span data-slot="badge" data-variant="default" [class]="defaultBadge"
                ><ng-icon
                  name="lucideCircleCheck"
                  data-icon="inline-start"
                  aria-hidden="true"
                />Published</span
              >
            } @else {
              <span data-slot="badge" data-variant="outline" [class]="outlineBadge"
                ><ng-icon
                  name="lucideCircleDashed"
                  data-icon="inline-start"
                  aria-hidden="true"
                />Draft</span
              >
            }
            <span data-slot="badge" data-variant="secondary" [class]="secondaryBadge">{{
              sport()
            }}</span>
          </div>
          @if (league.locationNames.length > 0) {
            <p class="flex items-start gap-1.5 text-sm text-muted-foreground mt-2">
              <ng-icon
                name="lucideMapPin"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              /><span
                ><span class="sr-only">{{
                  league.locationNames.length === 1 ? 'Location: ' : 'Locations: '
                }}</span
                >{{ league.locationNames.join(', ') }}</span
              >
            </p>
          }
        </div>
        <!-- The fragment link is explicit: a bare #create-season would resolve against <base
             href="/"> to the home page. A plain click scrolls to the form and focuses its first
             field. -->
        <a [href]="createPath()" data-slot="button" [class]="jumpClass" (click)="jumpToForm($event)"
          ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create a
          season</a
        >
      </div>
      <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="seasons-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="seasons-heading" class="font-semibold">Seasons</h2>
          </div>
          @if (failed()) {
            <div class="px-4 py-4 md:px-5">
              <app-admin-alert
                kind="error"
                title="The seasons could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          } @else if (rows(); as rows) {
            @if (rows.length > 0) {
              <ul id="seasons-list" role="list" class="divide-y divide-border">
                @for (row of rows; track row.seasonId) {
                  <li class="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-3.5 md:px-5">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h3 class="me-1 font-medium">{{ row.name }}</h3>
                        @if (row.status === 'published') {
                          <span data-slot="badge" data-variant="default" [class]="defaultBadge"
                            ><ng-icon
                              name="lucideCircleCheck"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />Published</span
                          >
                        } @else {
                          <span data-slot="badge" data-variant="outline" [class]="outlineBadge"
                            ><ng-icon
                              name="lucideCircleDashed"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />Draft</span
                          >
                        }
                      </div>
                      <div class="mt-1.5 flex flex-col gap-1">
                        <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <ng-icon
                            name="lucideCalendarDays"
                            class="mt-0.5 shrink-0 text-base"
                            aria-hidden="true"
                          /><span
                            ><span class="sr-only">Dates: </span
                            >{{ dates(row.startDate, row.endDate) }}</span
                          >
                        </p>
                        <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <ng-icon
                            name="lucideCalendarClock"
                            class="mt-0.5 shrink-0 text-base"
                            aria-hidden="true"
                          /><span>Registration deadline {{ day(row.registrationDeadline) }}</span>
                        </p>
                        <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <ng-icon
                            name="lucideUsers"
                            class="mt-0.5 shrink-0 text-base"
                            aria-hidden="true"
                          /><span
                            >{{ row.formatName }} · at least
                            {{ row.minimumRosterSize }} players</span
                          >
                        </p>
                      </div>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <div class="flex flex-col items-center px-6 py-10 text-center">
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideCalendarDays" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No seasons yet</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  Seasons you create appear here as drafts until you publish them.
                </p>
              </div>
            }
          } @else {
            <p role="status" class="sr-only">Loading the seasons.</p>
            <div aria-hidden="true" class="divide-y divide-border">
              @for (placeholder of placeholders; track placeholder) {
                <div class="flex gap-3 px-4 py-3.5 md:px-5">
                  <div class="flex-1">
                    <div
                      aria-hidden="true"
                      class="rounded-md bg-muted motion-safe:animate-pulse h-4 w-48 max-w-full"
                    ></div>
                    <div
                      aria-hidden="true"
                      class="rounded-md bg-muted motion-safe:animate-pulse mt-2 h-3.5 w-64 max-w-full"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </section>
        <section
          #createSection
          id="create-season"
          aria-labelledby="create-season-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="create-season-heading" class="font-semibold">Create a season</h2>
          </div>
          <app-season-create-form
            [leagueId]="league.leagueId"
            [leagueName]="league.name"
            [sport]="league.sport"
          />
        </section>
      </div>
    }
  `,
})
export class LeagueManagement {
  private readonly context = inject(LeagueContext);

  protected readonly league = this.context.league;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly defaultBadge = BADGE_DEFAULT;
  protected readonly secondaryBadge = BADGE_SECONDARY;
  protected readonly outlineBadge = BADGE_OUTLINE;
  protected readonly placeholders = [1, 2, 3];
  protected readonly dates = seasonDates;
  protected readonly day = formatCalendarDate;

  private readonly list = injectQuery(api.seasons.listForOrganizer, () => {
    const league = this.context.league();
    return league ? { leagueId: league.leagueId } : skipToken;
  });

  protected readonly rows = computed(() => this.list.value());
  protected readonly failed = computed(() => this.list.error() !== undefined);
  protected readonly sport = computed(() => {
    const league = this.context.league();
    return league ? sportName(league.sport) : '';
  });
  protected readonly createPath = computed(
    () => `${leaguePath(this.context.orgSlug(), this.context.leagueSlug())}#create-season`,
  );

  private readonly createSection = viewChild<ElementRef<HTMLElement>>('createSection');

  /** A plain click on "Create a season" (phones): scroll to the form and focus its first field. */
  protected jumpToForm(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const section = this.createSection()?.nativeElement;
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView();
    section.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }
}
