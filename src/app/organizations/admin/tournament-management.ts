import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideCopy,
  lucideGlobe,
  lucideMapPin,
  lucideUsers,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { seasonDates } from '../league/season-dates';
import { publicTournamentNames } from '../public-tournament/public-tournament-names';
import { publicTournamentPath } from '../public-tournament/public-tournament-path';
import { AdminAlert } from './admin-alert';
import { adminPath } from './admin-path';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  PublishTournamentDialog,
  type PublishTournamentOutcome,
} from './publish-tournament-dialog';
import { TournamentBreadcrumb } from './tournament-breadcrumb';
import { TournamentDetailsForm } from './tournament-details-form';
import { TournamentEditLanding } from './tournament-edit-landing';
import { TournamentContext } from './tournament-context';
import { TournamentNoAccess } from './tournament-no-access';
import { tournamentPath } from './tournament-path';

@Component({
  selector: 'app-tournament-management',
  imports: [
    AdminAlert,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    NgIcon,
    NotFoundView,
    PublishTournamentDialog,
    RouterLink,
    ServerErrorView,
    TournamentBreadcrumb,
    TournamentDetailsForm,
    TournamentNoAccess,
  ],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideCopy,
      lucideGlobe,
      lucideMapPin,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '[attr.inert]': 'publishOpen() ? "" : null' },
  template: `
    @switch (state()) {
      @case ('ready') {
        @if (tournament(); as tournament) {
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
            <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div class="min-w-0">
                <app-tournament-breadcrumb
                  [role]="tournament.role"
                  [organizationName]="tournament.organization.name"
                  [organizationSlug]="tournament.organization.slug"
                  [name]="tournament.name"
                  [slug]="tournament.slug"
                />
                <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                  {{ tournament.name }}
                </h1>
                <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  @if (tournament.status === 'published') {
                    <span hlmBadge variant="default"
                      ><ng-icon
                        name="lucideCircleCheck"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Published</span
                    >
                  } @else {
                    <span hlmBadge variant="outline"
                      ><ng-icon
                        name="lucideCircleDashed"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Draft</span
                    >
                  }
                  <span hlmBadge variant="secondary">{{ tournament.sportName }}</span>
                </div>
                <p class="mt-2 font-medium" data-slot="tournament-division">
                  {{ tournament.divisionLabel }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                @if (tournament.role === 'orgAdmin') {
                  <a
                    [routerLink]="copyPath()"
                    [queryParams]="{ copyOf: tournament.slug }"
                    fragment="create-tournament"
                    data-slot="button"
                    [class]="outlineButton"
                    ><ng-icon name="lucideCopy" data-icon="inline-start" aria-hidden="true" />Copy
                    to a new tournament</a
                  >
                }
                @if (tournament.status === 'published') {
                  <a
                    [routerLink]="publicPath()"
                    [state]="names()"
                    data-slot="button"
                    [class]="outlineButton"
                    ><ng-icon name="lucideGlobe" data-icon="inline-start" aria-hidden="true" />View
                    public page</a
                  >
                } @else {
                  <button
                    #publishButton
                    type="button"
                    data-slot="button"
                    aria-haspopup="dialog"
                    [class]="primaryButton"
                    (click)="publish()"
                  >
                    <ng-icon
                      name="lucideGlobe"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Publish
                  </button>
                }
              </div>
            </div>
            @if (published()) {
              <app-admin-alert
                #publishedNotice
                class="mt-6"
                kind="success"
                [title]="tournament.name + ' is published.'"
                description="Its page is public now."
                ><a [routerLink]="publicPath()" [state]="names()"
                  >View public page</a
                ></app-admin-alert
              >
            } @else if (tournament.status === 'draft') {
              <app-admin-alert
                class="mt-6"
                kind="info"
                title="This tournament is a draft"
                description="Only your staff can see it. Publish it to put its page online."
              />
            }
            <section
              aria-labelledby="details-heading"
              hlmCard
              size="bare"
              class="mt-6 max-w-2xl overflow-hidden"
            >
              <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                <h2 id="details-heading" class="font-semibold">Details</h2>
              </div>
              <dl class="divide-y divide-border">
                <div class="px-4 py-3.5 md:px-5">
                  <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                    <ng-icon
                      name="lucideCalendarDays"
                      class="shrink-0 text-base"
                      aria-hidden="true"
                    />Dates
                  </dt>
                  <dd class="mt-1 font-medium">{{ dates() }}</dd>
                </div>
                <div class="px-4 py-3.5 md:px-5">
                  <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                    <ng-icon
                      name="lucideCalendarClock"
                      class="shrink-0 text-base"
                      aria-hidden="true"
                    />Registration closes
                  </dt>
                  <dd class="mt-1 font-medium">{{ closes() }}</dd>
                </div>
                <div class="px-4 py-3.5 md:px-5">
                  <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                    <ng-icon
                      name="lucideUsers"
                      class="shrink-0 text-base"
                      aria-hidden="true"
                    />Teams
                  </dt>
                  <dd class="mt-1 font-medium">Up to {{ tournament.maximumTeams }} teams</dd>
                  <dd class="text-sm text-muted-foreground">
                    Teams of at least {{ tournament.minimumRosterSize }} players
                  </dd>
                </div>
                @if (tournament.locations.length) {
                  <div class="px-4 py-3.5 md:px-5">
                    <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideMapPin"
                        class="shrink-0 text-base"
                        aria-hidden="true"
                      />{{ tournament.locations.length === 1 ? 'Location' : 'Locations' }}
                    </dt>
                    @for (location of tournament.locations; track location.name) {
                      <dd class="mt-1">
                        <span class="font-medium">{{ location.name }}</span>
                        <span class="block text-sm text-muted-foreground">{{
                          location.address
                        }}</span>
                      </dd>
                    }
                  </div>
                }
              </dl>
            </section>
            <section
              #editSection
              id="edit-details"
              aria-labelledby="edit-details-heading"
              hlmCard
              size="bare"
              class="mt-4 max-w-2xl overflow-clip md:mt-6"
            >
              <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-6">
                <h2 id="edit-details-heading" class="font-semibold">Edit details</h2>
              </div>
              <app-tournament-details-form [tournament]="tournament" />
            </section>
          </div>
          <app-publish-tournament-dialog (dismissed)="publishDismissed($event)" />
        }
      }
      @case ('loading') {
        <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <p role="status" class="sr-only">Loading the tournament.</p>
          <div hlmSkeleton aria-hidden="true" class="rounded-md h-4 w-56 max-w-full"></div>
          <div hlmSkeleton aria-hidden="true" class="rounded-md mt-3 h-8 w-64 max-w-full"></div>
          <div hlmSkeleton aria-hidden="true" class="rounded-md mt-3 h-5 w-40"></div>
          <div aria-hidden="true" hlmCard size="bare" class="mt-6 max-w-2xl overflow-hidden">
            <div class="border-b border-border px-4 py-3 md:px-5">
              <div hlmSkeleton aria-hidden="true" class="rounded-md h-5 w-24"></div>
            </div>
            <div class="divide-y divide-border">
              @for (row of rows; track row) {
                <div class="px-4 py-3.5 md:px-5">
                  <div hlmSkeleton aria-hidden="true" class="rounded-md h-3.5 w-24"></div>
                  <div
                    hlmSkeleton
                    aria-hidden="true"
                    class="rounded-md mt-2 h-4 w-48 max-w-full"
                  ></div>
                </div>
              }
            </div>
          </div>
        </div>
      }
      @case ('forbidden') {
        <app-tournament-no-access />
      }
      @case ('not-found') {
        <app-not-found-view />
      }
      @default {
        <app-server-error-view [retryHref]="retryHref()" />
      }
    }
  `,
})
export class TournamentManagement {
  private readonly context = inject(TournamentContext);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly landing = inject(TournamentEditLanding);

  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly rows = [1, 2, 3, 4];

  protected readonly state = this.context.state;
  protected readonly tournament = this.context.tournament;
  protected readonly dates = computed(() => {
    const tournament = this.tournament();
    return tournament ? seasonDates(tournament.startDate, tournament.endDate) : '';
  });
  protected readonly closes = computed(() => {
    const tournament = this.tournament();
    return tournament ? formatCalendarDate(tournament.registrationDeadline) : '';
  });
  protected readonly publicPath = computed(() => {
    const tournament = this.tournament();
    return tournament ? publicTournamentPath(tournament.organization.slug, tournament.slug) : '';
  });
  protected readonly copyPath = computed(() => {
    const tournament = this.tournament();
    return tournament ? adminPath(tournament.organization.slug, 'tournaments') : '';
  });
  protected readonly names = computed(() => {
    const tournament = this.tournament();
    return tournament
      ? publicTournamentNames({ organization: tournament.organization, tournament })
      : undefined;
  });
  protected readonly retryHref = computed(() =>
    tournamentPath(this.context.orgSlug(), this.context.tournamentSlug()),
  );

  private readonly editSection = viewChild<ElementRef<HTMLElement>>('editSection');
  private readonly publishButton = viewChild<ElementRef<HTMLButtonElement>>('publishButton');
  private readonly publishDialog = viewChild(PublishTournamentDialog);
  private readonly publishedNotice = viewChild<AdminAlert>('publishedNotice');

  protected readonly published = signal(false);
  protected readonly publishOpen = computed(() => this.publishDialog()?.isOpen() ?? false);

  constructor() {
    effect(() => this.landOnceTheFormRenders());
    // The no-access and not-found views set their own title.
    effect(() => {
      const tournament = this.tournament();
      if (tournament) {
        this.title.setTitle(`${tournament.name} | ${tournament.organization.name} | Omni League`);
      }
    });
  }

  private landOnceTheFormRenders(): void {
    if (!this.landing.pending()) return;
    const state = this.state();
    if (state === 'loading') return;
    this.landing.settle();
    if (state !== 'ready') return;
    afterNextRender(
      () => {
        const section = this.editSection()?.nativeElement;
        section?.scrollIntoView();
        section?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  protected publish(): void {
    const tournament = this.tournament();
    if (!tournament) return;
    this.published.set(false);
    this.publishDialog()?.open({ tournamentId: tournament.tournamentId, name: tournament.name });
  }

  /** A published tournament moves focus to the status, because the button that had it is gone; a dialog that was cancelled puts focus back on Publish. */
  protected publishDismissed(outcome: PublishTournamentOutcome): void {
    if (outcome.published) {
      this.published.set(true);
      afterNextRender(() => this.publishedNotice()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(() => this.publishButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
