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
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideGlobe,
  lucideMapPin,
  lucideUsers,
} from '@ng-icons/lucide';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { api, injectQuery } from '../../core/data/convex';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { seasonDates } from '../league/season-dates';
import { publicTournamentNames } from '../public-tournament/public-tournament-names';
import { publicTournamentPath } from '../public-tournament/public-tournament-path';
import { AdminAlert } from './admin-alert';
import { AdminContext } from './admin-context';
import { AdminNoAccess } from './admin-no-access';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  PublishTournamentDialog,
  type PublishTournamentOutcome,
} from './publish-tournament-dialog';
import { TournamentBreadcrumb } from './tournament-breadcrumb';
import { tournamentPath } from './tournament-path';

type TournamentState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The area has already shown the no-access view to anyone who is not an org admin of the organization, so the
 * forbidden answer here is only a race with a membership change.
 */
@Component({
  selector: 'app-tournament-management',
  imports: [
    AdminAlert,
    AdminNoAccess,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    NgIcon,
    NotFoundView,
    PublishTournamentDialog,
    RouterLink,
    ServerErrorView,
    TournamentBreadcrumb,
  ],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCircleCheck,
      lucideCircleDashed,
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
                  <ng-icon name="lucideGlobe" data-icon="inline-start" aria-hidden="true" />Publish
                </button>
              }
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
                <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                  <ng-icon
                    name="lucideCalendarDays"
                    class="mt-0.5 shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt class="text-sm text-muted-foreground">Dates</dt>
                    <dd class="font-medium">{{ dates() }}</dd>
                  </div>
                </div>
                <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                  <ng-icon
                    name="lucideCalendarClock"
                    class="mt-0.5 shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt class="text-sm text-muted-foreground">Registration closes</dt>
                    <dd class="font-medium">{{ closes() }}</dd>
                  </div>
                </div>
                <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                  <ng-icon
                    name="lucideUsers"
                    class="mt-0.5 shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt class="text-sm text-muted-foreground">Teams</dt>
                    <dd class="font-medium">Up to {{ tournament.maximumTeams }} teams</dd>
                    <dd class="text-sm text-muted-foreground">
                      Teams of at least {{ tournament.minimumRosterSize }} players
                    </dd>
                  </div>
                </div>
                @if (tournament.locations.length) {
                  <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                    <ng-icon
                      name="lucideMapPin"
                      class="mt-0.5 shrink-0 text-base text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div>
                      <dt class="text-sm text-muted-foreground">
                        {{ tournament.locations.length === 1 ? 'Location' : 'Locations' }}
                      </dt>
                      @for (location of tournament.locations; track location.name) {
                        <dd>
                          <span class="font-medium">{{ location.name }}</span>
                          <span class="block text-sm text-muted-foreground">{{
                            location.address
                          }}</span>
                        </dd>
                      }
                    </div>
                  </div>
                }
              </dl>
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
        <app-admin-no-access />
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
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);

  private readonly tournamentSlug = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('tournamentSlug') ?? '')),
    { requireSync: true },
  );

  private readonly result = injectQuery(api.tournaments.getForManagement, () => ({
    orgSlug: this.context.slug(),
    tournamentSlug: this.tournamentSlug(),
  }));

  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly rows = [1, 2, 3, 4];

  protected readonly state = computed<TournamentState>(() => {
    const error = this.result.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.result.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  protected readonly tournament = computed(() =>
    this.state() === 'ready' ? (this.result.value() ?? null) : null,
  );
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
  protected readonly names = computed(() => {
    const tournament = this.tournament();
    return tournament
      ? publicTournamentNames({ organization: tournament.organization, tournament })
      : undefined;
  });
  protected readonly retryHref = computed(() =>
    tournamentPath(this.context.slug(), this.tournamentSlug()),
  );

  private readonly publishButton = viewChild<ElementRef<HTMLButtonElement>>('publishButton');
  private readonly publishDialog = viewChild(PublishTournamentDialog);
  private readonly publishedNotice = viewChild<AdminAlert>('publishedNotice');

  protected readonly published = signal(false);
  protected readonly publishOpen = computed(() => this.publishDialog()?.isOpen() ?? false);

  constructor() {
    // The no-access and not-found views set their own title.
    effect(() => {
      const tournament = this.tournament();
      if (tournament) {
        this.title.setTitle(`${tournament.name} | ${tournament.organization.name} | Omni League`);
      }
    });
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
