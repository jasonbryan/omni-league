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
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCheck,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideClock,
  lucideMapPin,
  lucidePlus,
  lucideTrash2,
  lucideUndo2,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { campAgesLabel } from '../../../../convex/lib/campInput';
import { campSessionTimes } from '../../../../convex/lib/campSessionInput';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import {
  api,
  injectMutation,
  injectOnline,
  injectOfflineCause,
  offlineTitle,
  ConvexOfflineError,
} from '../../core/data/convex';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { seasonDates } from '../league/season-dates';
import { AdminAlert } from './admin-alert';
import { OUTLINE_BUTTON } from './button-classes';
import { CampBreadcrumb } from './camp-breadcrumb';
import { CampContext, type CampSessionRow } from './camp-context';
import { CampNoAccess } from './camp-no-access';
import { campPath } from './camp-path';
import { CampSessionForm } from './camp-session-form';
import { FOOTER_STATUS } from './footer-status';

const DELETE_FAILED = 'Check your connection and try again.';
const RESTORE_FAILED = 'could not be restored. Try again.';

type Outcome = { kind: 'deleted'; session: CampSessionRow } | { kind: 'restored'; name: string };

@Component({
  selector: 'app-camp-management',
  imports: [
    AdminAlert,
    CampBreadcrumb,
    CampNoAccess,
    CampSessionForm,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    NgIcon,
    NotFoundView,
    ServerErrorView,
  ],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCheck,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideClock,
      lucideMapPin,
      lucidePlus,
      lucideTrash2,
      lucideUndo2,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (state()) {
      @case ('ready') {
        @if (camp(); as camp) {
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
            <app-camp-breadcrumb
              [role]="camp.role"
              [organizationName]="camp.organization.name"
              [organizationSlug]="camp.organization.slug"
              [name]="camp.name"
              [slug]="camp.slug"
            />
            <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
              {{ camp.name }}
            </h1>
            <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              @if (camp.status === 'published') {
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
              <span hlmBadge variant="secondary">{{ camp.sportName }}</span>
            </div>
            <section
              id="details"
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
                    <ng-icon name="lucideUsers" class="shrink-0 text-base" aria-hidden="true" />Age
                    range
                  </dt>
                  <dd class="mt-1 font-medium">{{ ages() }}</dd>
                </div>
                @if (camp.locations.length) {
                  <div class="px-4 py-3.5 md:px-5">
                    <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideMapPin"
                        class="shrink-0 text-base"
                        aria-hidden="true"
                      />{{ camp.locations.length === 1 ? 'Location' : 'Locations' }}
                    </dt>
                    @for (location of camp.locations; track location.name) {
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
              id="sessions"
              aria-labelledby="sessions-heading"
              hlmCard
              size="bare"
              class="mt-4 max-w-2xl overflow-hidden md:mt-6"
            >
              <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                <h2 id="sessions-heading" class="font-semibold">Sessions</h2>
              </div>
              <div role="status" data-slot="session-status">
                @if (outcome(); as outcome) {
                  <div #statusBox tabindex="-1" [class]="statusClass">
                    <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />
                    @if (outcome.kind === 'deleted') {
                      <span class="font-medium">{{ outcome.session.name }} deleted.</span>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                        [class.opacity-50]="!online() && !undoing()"
                        [attr.aria-disabled]="undoing() || !online() ? 'true' : null"
                        (click)="undo(outcome.session)"
                      >
                        <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />{{
                          undoing() ? 'Undoing…' : 'Undo'
                        }}
                      </button>
                      @if (undoNote(); as note) {
                        <span class="basis-full">{{ note }}</span>
                      }
                    } @else {
                      <span class="font-medium">{{ outcome.name }} restored.</span>
                    }
                  </div>
                }
              </div>
              @if (failure(); as failure) {
                <div class="px-4 pt-4 md:px-5">
                  <app-admin-alert
                    #failureAlert
                    kind="error"
                    [title]="failure.title"
                    [description]="failure.description"
                  />
                </div>
              }
              @switch (sessions().status) {
                @case ('error') {
                  <div class="px-4 py-4 md:px-5">
                    <app-admin-alert
                      kind="error"
                      title="The sessions could not be loaded."
                      description="Check your connection and try again."
                    />
                  </div>
                }
                @case ('ready') {
                  @if (rows().length > 0) {
                    <ul id="sessions-list" role="list" class="divide-y divide-border">
                      @for (row of rows(); track row.campSessionId) {
                        <li
                          class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3.5 md:px-5"
                        >
                          <div class="min-w-0">
                            <h3 class="font-medium">{{ row.name }}</h3>
                            <p
                              data-slot="session-dates"
                              class="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground"
                            >
                              <ng-icon
                                name="lucideCalendarDays"
                                class="mt-0.5 shrink-0 text-base"
                                aria-hidden="true"
                              /><span>{{ dates(row) }}</span>
                            </p>
                            @if (times(row); as times) {
                              <p
                                data-slot="session-times"
                                class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"
                              >
                                <ng-icon
                                  name="lucideClock"
                                  class="mt-0.5 shrink-0 text-base"
                                  aria-hidden="true"
                                /><span>{{ times }}</span>
                              </p>
                            }
                            <p
                              data-slot="session-places"
                              class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"
                            >
                              <ng-icon
                                name="lucideUsers"
                                class="mt-0.5 shrink-0 text-base"
                                aria-hidden="true"
                              /><span>{{ places(row.places) }}</span>
                            </p>
                            <p
                              data-slot="session-deadline"
                              class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"
                            >
                              <ng-icon
                                name="lucideCalendarClock"
                                class="mt-0.5 shrink-0 text-base"
                                aria-hidden="true"
                              /><span>Registration closes {{ closes(row) }}</span>
                            </p>
                          </div>
                          @if (row.registeredCount === 0) {
                            <button
                              type="button"
                              data-slot="button"
                              [class]="outlineButton"
                              [class.opacity-50]="!online() && deleting() !== row.campSessionId"
                              [attr.aria-disabled]="
                                deleting() === row.campSessionId || !online() ? 'true' : null
                              "
                              (click)="remove(row)"
                            >
                              @if (deleting() === row.campSessionId) {
                                Deleting {{ row.name }}…
                              } @else {
                                <ng-icon
                                  name="lucideTrash2"
                                  data-icon="inline-start"
                                  aria-hidden="true"
                                />Delete<span class="sr-only"> {{ row.name }}</span>
                              }
                            </button>
                          } @else {
                            <span
                              data-slot="session-registered"
                              class="text-sm text-muted-foreground"
                              >{{ row.registeredCount }} registered</span
                            >
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
                      <p class="mt-4 font-medium">No sessions yet</p>
                      <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                        Add a session with its dates, places, and registration deadline.
                      </p>
                      <div class="mt-5">
                        <button
                          type="button"
                          data-slot="button"
                          [class]="outlineButton"
                          (click)="addSession()"
                        >
                          <ng-icon
                            name="lucidePlus"
                            data-icon="inline-start"
                            aria-hidden="true"
                          />Add a session
                        </button>
                      </div>
                    </div>
                  }
                }
                @default {
                  <p role="status" class="sr-only">Loading the sessions.</p>
                  <div aria-hidden="true" class="divide-y divide-border">
                    @for (placeholder of placeholders; track placeholder) {
                      <div class="px-4 py-3.5 md:px-5">
                        <div hlmSkeleton class="rounded-md h-4 w-24"></div>
                        <div hlmSkeleton class="rounded-md mt-2 h-3.5 w-48 max-w-full"></div>
                      </div>
                    }
                  </div>
                }
              }
            </section>
            <section
              #addSection
              id="add-session"
              tabindex="-1"
              aria-labelledby="add-session-heading"
              hlmCard
              size="bare"
              class="mt-4 max-w-2xl overflow-clip focus:outline-none md:mt-6"
            >
              <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                <h2 id="add-session-heading" class="font-semibold">Add a session</h2>
              </div>
              <app-camp-session-form [campId]="camp.campId" />
            </section>
          </div>
        }
      }
      @case ('loading') {
        <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <p role="status" class="sr-only">Loading the camp.</p>
          <div hlmSkeleton aria-hidden="true" class="rounded-md h-4 w-56 max-w-full"></div>
          <div hlmSkeleton aria-hidden="true" class="rounded-md mt-3 h-8 w-64 max-w-full"></div>
          <div hlmSkeleton aria-hidden="true" class="rounded-md mt-3 h-5 w-40"></div>
          <div aria-hidden="true" hlmCard size="bare" class="mt-6 max-w-2xl overflow-hidden">
            <div class="border-b border-border px-4 py-3 md:px-5">
              <div hlmSkeleton aria-hidden="true" class="rounded-md h-5 w-24"></div>
            </div>
            <div class="divide-y divide-border">
              @for (row of detailRows; track row) {
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
        <app-camp-no-access />
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
export class CampManagement {
  private readonly context = inject(CampContext);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly removeCall = injectMutation(api.campSessions.remove);
  private readonly addCall = injectMutation(api.campSessions.add);
  private readonly cause = injectOfflineCause();

  protected readonly online = injectOnline();
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly statusClass = `${FOOTER_STATUS} mb-0 flex flex-wrap items-center gap-x-3 gap-y-1`;
  protected readonly placeholders = [1, 2];
  protected readonly detailRows = [1, 2];

  protected readonly state = this.context.state;
  protected readonly camp = this.context.camp;
  protected readonly sessions = this.context.sessions;
  protected readonly rows = computed(() => {
    const view = this.sessions();
    return view.status === 'ready' ? view.sessions : [];
  });
  protected readonly ages = computed(() => {
    const camp = this.camp();
    return camp ? campAgesLabel(camp.minimumAge, camp.maximumAge) : '';
  });
  protected readonly retryHref = computed(() =>
    campPath(this.context.orgSlug(), this.context.campSlug()),
  );

  protected readonly deleting = signal<string | null>(null);
  protected readonly undoing = signal(false);
  protected readonly undoNote = signal<string | null>(null);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly failure = signal<{ title: string; description: string } | null>(null);

  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly addSection = viewChild<ElementRef<HTMLElement>>('addSection');
  private readonly addForm = viewChild(CampSessionForm);

  constructor() {
    // The no-access and not-found views set their own title.
    effect(() => {
      const camp = this.camp();
      if (camp) this.title.setTitle(`${camp.name} | ${camp.organization.name} | Omni League`);
    });
  }

  protected dates(row: CampSessionRow): string {
    return seasonDates(row.startDate, row.endDate);
  }

  protected times(row: CampSessionRow): string | null {
    return campSessionTimes(row.dailyStartTime, row.dailyEndTime);
  }

  protected places(places: number): string {
    return `${places} ${places === 1 ? 'place' : 'places'}`;
  }

  protected closes(row: CampSessionRow): string {
    return formatCalendarDate(row.registrationDeadline);
  }

  protected addSession(): void {
    this.addSection()?.nativeElement.scrollIntoView();
    this.addForm()?.focusName();
  }

  protected async remove(row: CampSessionRow): Promise<void> {
    if (this.deleting() !== null) return;
    this.failure.set(null);
    this.outcome.set(null);
    this.undoNote.set(null);
    this.deleting.set(row.campSessionId);
    try {
      await this.removeCall.run({ campSessionId: row.campSessionId });
      this.outcome.set({ kind: 'deleted', session: row });
      // The Delete button that had focus goes with its row.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.failure.set(this.deleteFailure(row, failure));
      this.focusAfterRender(() => this.failureAlert()?.focus());
    } finally {
      this.deleting.set(null);
    }
  }

  protected async undo(session: CampSessionRow): Promise<void> {
    if (this.undoing()) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.undoNote.set(this.offlineNote());
      return;
    }
    const camp = this.camp();
    if (!camp) return;
    this.undoing.set(true);
    try {
      await this.addCall.run({
        campId: camp.campId,
        name: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
        ...(session.dailyStartTime !== undefined && { dailyStartTime: session.dailyStartTime }),
        ...(session.dailyEndTime !== undefined && { dailyEndTime: session.dailyEndTime }),
        places: session.places,
        registrationDeadline: session.registrationDeadline,
      });
      this.outcome.set({ kind: 'restored', name: session.name });
      // The Undo button that had focus is gone.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.undoNote.set(
        failure instanceof ConvexOfflineError
          ? this.offlineNote()
          : `${session.name} ${RESTORE_FAILED}`,
      );
    } finally {
      this.undoing.set(false);
    }
  }

  private deleteFailure(row: CampSessionRow, failure: unknown) {
    const title = `${row.name} could not be deleted.`;
    if (failure instanceof ConvexOfflineError) {
      return {
        title: offlineTitle(this.cause(), 'removed'),
        description: "Try again when you're connected.",
      };
    }
    const refusal = failure instanceof ConvexError ? (failure.data as { message?: unknown }) : null;
    const message = typeof refusal?.message === 'string' ? refusal.message : DELETE_FAILED;
    return { title, description: message };
  }

  private offlineNote(): string {
    return `${offlineTitle(this.cause(), 'undone')} Try again when you're connected.`;
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
