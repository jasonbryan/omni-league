import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideGlobe,
  lucideMapPin,
  lucidePencil,
  lucidePlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { sportName } from '../../../../convex/lib/sports';
import { injectQuery, skipToken } from '../../core/data/convex';
import { isPlainClick } from '../../shell/follow-link';
import { AdminAlert } from '../admin/admin-alert';
import { adminPath } from '../admin/admin-path';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { BADGE_DEFAULT, BADGE_OUTLINE, BADGE_SECONDARY } from '../admin/field-classes';
import { publicLeaguePath } from '../public-league/public-league-path';
import { LeagueContext } from './league-context';
import { LeagueDetailsForm } from './league-details-form';
import { leaguePath } from './league-path';
import { seasonDates } from './season-dates';
import { PublishSeasonDialog, type PublishSeasonOutcome } from './publish-season-dialog';
import { SeasonCreateForm } from './season-create-form';

/**
 * A draft league has no Publish buttons and no dialog: a note says why, and what to do depends on the role. An org admin gets a link to the Leagues page;
 * a league organizer is told to ask an org admin, with no link, because the admin area shows them the no-access view.
 */
@Component({
  selector: 'app-league-management',
  imports: [
    AdminAlert,
    LeagueDetailsForm,
    NgIcon,
    PublishSeasonDialog,
    RouterLink,
    SeasonCreateForm,
  ],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideGlobe,
      lucideMapPin,
      lucidePencil,
      lucidePlus,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8',
    '[attr.inert]': 'publishOpen() ? "" : null',
  },
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
          @if (league.division; as division) {
            <p class="mt-2 font-medium" data-slot="league-division">{{ division.label }}</p>
          }
        </div>
        <div class="flex flex-wrap gap-2">
          <!-- The fragment links are explicit: a bare #create-season would resolve against <base href="/"> to the home page. -->
          <a
            [href]="createPath()"
            data-slot="button"
            [class]="jumpClass"
            (click)="jumpTo($event, createSection)"
            ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create a
            season</a
          >
          <a
            [href]="detailsPath()"
            data-slot="button"
            [class]="outlineButton"
            (click)="jumpTo($event, detailsSection)"
            ><ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Edit
            details</a
          >
        </div>
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
          @if (league.status !== 'published') {
            <div class="border-b border-border px-4 py-3 md:px-5">
              @if (league.role === 'orgAdmin') {
                <app-admin-alert
                  kind="info"
                  title="Publish the league first"
                  description="Seasons of a draft league can’t be published."
                  ><a [href]="leaguesPath()">Publish {{ league.name }} in Leagues</a>, then come
                  back to publish its seasons.</app-admin-alert
                >
              } @else {
                <app-admin-alert
                  kind="info"
                  title="Ask an org admin to publish the league"
                  description="Seasons of a draft league can’t be published. You can create and prepare seasons until the league is published."
                />
              }
            </div>
          }
          @if (published(); as published) {
            <div class="border-b border-border px-4 py-3 md:px-5">
              <app-admin-alert
                #publishedNotice
                kind="success"
                [title]="published.name + ' is published.'"
                description="It’s on the league’s public page now."
                ><a [routerLink]="publicPath()">View public page</a></app-admin-alert
              >
            </div>
          }
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
                    @if (league.status === 'published' && row.status !== 'published') {
                      <button
                        type="button"
                        data-slot="button"
                        aria-haspopup="dialog"
                        [attr.data-season-id]="row.seasonId"
                        [class]="outlineButton"
                        (click)="publish(row, league.name)"
                      >
                        <ng-icon
                          name="lucideGlobe"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Publish<span class="sr-only"> {{ row.name }}</span>
                      </button>
                    }
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
          class="overflow-clip rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="create-season-heading" class="font-semibold">Create a season</h2>
          </div>
          <app-season-create-form
            [leagueId]="league.leagueId"
            [leagueName]="league.name"
            [division]="league.division"
            [detailsHref]="detailsPath()"
            (detailsOpened)="jumpTo($event, detailsSection)"
          />
        </section>
      </div>
      <section
        #detailsSection
        id="details"
        aria-labelledby="details-heading"
        class="mt-4 max-w-2xl overflow-clip rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 md:mt-6"
      >
        <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-6">
          <h2 id="details-heading" class="font-semibold">League details</h2>
        </div>
        <app-league-details-form [league]="league" [seasons]="rows() ?? []" />
      </section>
      @if (league.status === 'published') {
        <app-publish-season-dialog (dismissed)="publishDismissed($event)" />
      }
    }
  `,
})
export class LeagueManagement {
  private readonly context = inject(LeagueContext);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly league = this.context.league;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly outlineButton = OUTLINE_BUTTON;
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

  protected readonly publicPath = computed(() =>
    publicLeaguePath(this.context.orgSlug(), this.context.leagueSlug()),
  );

  protected readonly leaguesPath = computed(() => adminPath(this.context.orgSlug(), 'leagues'));
  protected readonly detailsPath = computed(
    () => `${leaguePath(this.context.orgSlug(), this.context.leagueSlug())}#details`,
  );
  private readonly publishDialog = viewChild(PublishSeasonDialog);
  private readonly publishedNotice = viewChild<AdminAlert>('publishedNotice');

  protected readonly published = signal<{ seasonId: Id<'seasons'>; name: string } | null>(null);
  protected readonly publishOpen = computed(() => this.publishDialog()?.isOpen() ?? false);

  protected publish(
    row: { seasonId: Id<'seasons'>; name: string; registrationDeadline: string },
    leagueName: string,
  ): void {
    this.published.set(null);
    this.publishDialog()?.open({
      seasonId: row.seasonId,
      name: row.name,
      registrationDeadline: row.registrationDeadline,
      leagueName,
    });
  }

  /** A published season moves focus to the status, because the button that had it is gone; a dialog that was cancelled puts focus back on that row's Publish button. */
  protected publishDismissed(outcome: PublishSeasonOutcome): void {
    if (outcome.published) {
      this.published.set({ seasonId: outcome.seasonId, name: outcome.name });
      afterNextRender(() => this.publishedNotice()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`button[data-season-id="${outcome.seasonId}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected jumpTo(event: MouseEvent, section: HTMLElement): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    section.scrollIntoView();
    section.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }
}
