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
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBan,
  lucideCalendarClock,
  lucideCalendarDays,
  lucideCalendarPlus,
  lucideCheck,
  lucideCircleDashed,
  lucideClock,
  lucideMapPin,
  lucideRepeat,
  lucideCircleCheck,
  lucideUndo2,
  lucideUserRound,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { trainingAgesLabel } from '../../../../convex/lib/trainingInput';
import {
  WEEKDAY_NAMES,
  trainingClassDate,
  trainingClassTimes,
} from '../../../../convex/lib/trainingPattern';
import {
  api,
  injectMutation,
  injectOnline,
  injectOfflineCause,
  offlineTitle,
  ConvexOfflineError,
} from '../../core/data/convex';
import { PageTitle } from '../../core/page-title';
import { isPlainClick } from '../../shell/follow-link';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { AdminAlert } from './admin-alert';
import { OUTLINE_BUTTON } from './button-classes';
import { injectSectionJump } from './section-jump';
import { TrainingBreadcrumb } from './training-breadcrumb';
import { TrainingContext, type TrainingClassRow } from './training-context';
import { TrainingNoAccess } from './training-no-access';
import { trainingPath } from './training-path';
import { SCHEDULE_FRAGMENT, TrainingScheduleLanding } from './training-schedule-landing';
import { TrainingScheduleForm } from './training-schedule-form';

const CANCEL_FAILED = 'Check your connection and try again.';
const RESTORE_FAILED = 'could not be restored. Try again.';

type Outcome =
  | { kind: 'scheduled'; count: number }
  | { kind: 'cancelled'; row: TrainingClassRow }
  | { kind: 'restored'; date: string };

@Component({
  selector: 'app-training-management',
  imports: [
    AdminAlert,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    NgIcon,
    NotFoundView,
    ServerErrorView,
    TrainingBreadcrumb,
    TrainingNoAccess,
    TrainingScheduleForm,
  ],
  providers: [
    provideIcons({
      lucideBan,
      lucideCalendarClock,
      lucideCalendarDays,
      lucideCalendarPlus,
      lucideCheck,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideClock,
      lucideMapPin,
      lucideRepeat,
      lucideUndo2,
      lucideUserRound,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (state()) {
      @case ('ready') {
        @if (training(); as training) {
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
            <app-training-breadcrumb
              [role]="training.role"
              [organizationName]="training.organization.name"
              [organizationSlug]="training.organization.slug"
              [name]="training.name"
              [slug]="training.slug"
            />
            <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div class="min-w-0">
                <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                  {{ training.name }}
                </h1>
                <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  @if (training.status === 'published') {
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
                  <span hlmBadge variant="secondary">{{ training.sportName }}</span>
                </div>
              </div>
            </div>
            @if (training.status === 'draft') {
              <app-admin-alert
                class="mt-6"
                kind="info"
                title="This training program is a draft"
                description="Only your staff can see it."
              />
            }
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
                    <ng-icon
                      name="lucideUserRound"
                      class="shrink-0 text-base"
                      aria-hidden="true"
                    />Coach
                  </dt>
                  <dd class="mt-1 font-medium">{{ training.coachName }}</dd>
                </div>
                <div class="px-4 py-3.5 md:px-5">
                  <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                    <ng-icon name="lucideUsers" class="shrink-0 text-base" aria-hidden="true" />Ages
                  </dt>
                  <dd class="mt-1 font-medium">{{ ages() }}</dd>
                </div>
                @if (training.locations.length) {
                  <div class="px-4 py-3.5 md:px-5">
                    <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideMapPin"
                        class="shrink-0 text-base"
                        aria-hidden="true"
                      />{{ training.locations.length === 1 ? 'Location' : 'Locations' }}
                    </dt>
                    @for (location of training.locations; track location.name) {
                      <dd class="mt-1">
                        <span class="font-medium">{{ location.name }}</span>
                        <span class="block text-sm text-muted-foreground">{{
                          location.address
                        }}</span>
                      </dd>
                    }
                  </div>
                }
                @if (pattern(); as pattern) {
                  <div class="px-4 py-3.5 md:px-5">
                    <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                      <ng-icon name="lucideRepeat" class="shrink-0 text-base" aria-hidden="true" />
                      Weekly classes
                    </dt>
                    <dd data-slot="pattern" class="mt-1 font-medium">{{ pattern.summary }}</dd>
                  </div>
                  <div class="px-4 py-3.5 md:px-5">
                    <dt class="flex items-center gap-2 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideCalendarClock"
                        class="shrink-0 text-base"
                        aria-hidden="true"
                      />Series registration closes
                    </dt>
                    <dd data-slot="pattern-deadline" class="mt-1 font-medium">
                      {{ pattern.deadline }}
                    </dd>
                    <dd data-slot="pattern-single" class="text-sm text-muted-foreground">
                      {{ pattern.single }}
                    </dd>
                  </div>
                }
              </dl>
            </section>
            <section
              id="classes"
              aria-labelledby="classes-heading"
              hlmCard
              size="bare"
              class="mt-4 max-w-2xl overflow-hidden md:mt-6"
            >
              <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                <h2 id="classes-heading" class="font-semibold">Classes</h2>
              </div>
              <div role="status" data-slot="class-status">
                @if (outcome(); as outcome) {
                  <div #statusBox tabindex="-1" [class]="statusClass">
                    <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />
                    @switch (outcome.kind) {
                      @case ('scheduled') {
                        <span class="font-medium"
                          >{{ outcome.count }}
                          {{ outcome.count === 1 ? 'class' : 'classes' }} scheduled.</span
                        >
                      }
                      @case ('cancelled') {
                        <span class="font-medium">{{ dateOf(outcome.row) }} cancelled.</span>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                          [class.opacity-50]="!online() && !working()"
                          [attr.aria-disabled]="working() !== null || !online() ? 'true' : null"
                          (click)="undo(outcome.row)"
                        >
                          <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />{{
                            working() === outcome.row.trainingClassId ? 'Undoing…' : 'Undo'
                          }}
                        </button>
                        @if (undoNote(); as note) {
                          <span class="basis-full">{{ note }}</span>
                        }
                      }
                      @default {
                        <span class="font-medium">{{ outcome.date }} restored.</span>
                      }
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
              @switch (classes().status) {
                @case ('error') {
                  <div class="px-4 py-4 md:px-5">
                    <app-admin-alert
                      kind="error"
                      title="The classes could not be loaded."
                      description="Check your connection and try again."
                    />
                  </div>
                }
                @case ('ready') {
                  @if (rows().length > 0) {
                    <ul id="classes-list" role="list" class="divide-y divide-border">
                      @for (row of rows(); track row.trainingClassId) {
                        <li
                          class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3.5 md:px-5"
                          [attr.data-status]="row.status"
                        >
                          <div class="min-w-0">
                            <h3 class="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                              <span
                                data-slot="class-date"
                                [class.line-through]="row.status === 'cancelled'"
                                >{{ dateOf(row) }}</span
                              >
                              @if (row.status === 'cancelled') {
                                <span hlmBadge variant="outline-muted"
                                  ><ng-icon
                                    name="lucideBan"
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />Cancelled</span
                                >
                              }
                            </h3>
                            <p
                              data-slot="class-times"
                              class="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground"
                            >
                              <ng-icon
                                name="lucideClock"
                                class="mt-0.5 shrink-0 text-base"
                                aria-hidden="true"
                              /><span>{{ timesOf(row) }}</span>
                            </p>
                            <p
                              data-slot="class-registered"
                              class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"
                            >
                              <ng-icon
                                name="lucideUsers"
                                class="mt-0.5 shrink-0 text-base"
                                aria-hidden="true"
                              /><span
                                >{{ row.registeredCount }} of {{ row.places }} registered</span
                              >
                            </p>
                          </div>
                          <div class="flex flex-wrap items-center gap-2">
                            @if (row.status === 'cancelled') {
                              <button
                                type="button"
                                data-slot="button"
                                [class]="outlineButton"
                                [class.opacity-50]="!online() && working() !== row.trainingClassId"
                                [attr.aria-disabled]="
                                  working() !== null || !online() ? 'true' : null
                                "
                                (click)="restore(row)"
                              >
                                @if (working() === row.trainingClassId) {
                                  Restoring…
                                } @else {
                                  <ng-icon
                                    name="lucideUndo2"
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />Restore<span class="sr-only"> {{ dateOf(row) }}</span>
                                }
                              </button>
                            } @else if (row.registeredCount > 0) {
                              <span data-slot="class-required" class="text-sm text-muted-foreground"
                                >Has registrations</span
                              >
                            } @else {
                              <button
                                type="button"
                                data-slot="button"
                                [class]="outlineButton"
                                [class.opacity-50]="!online() && working() !== row.trainingClassId"
                                [attr.aria-disabled]="
                                  working() !== null || !online() ? 'true' : null
                                "
                                (click)="cancel(row)"
                              >
                                @if (working() === row.trainingClassId) {
                                  Cancelling…
                                } @else {
                                  <ng-icon
                                    name="lucideBan"
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />Cancel<span class="sr-only"> {{ dateOf(row) }}</span>
                                }
                              </button>
                            }
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
                      <p class="mt-4 font-medium">No classes yet</p>
                      <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                        Enter a weekly pattern, and every class is created for you.
                      </p>
                      <div class="mt-5">
                        <!-- The fragment link is explicit: a bare #schedule would resolve against <base href="/"> to the home page. -->
                        <a
                          [href]="schedulePath()"
                          data-slot="button"
                          [class]="outlineButton"
                          (click)="jumpToForm($event)"
                        >
                          <ng-icon
                            name="lucideCalendarPlus"
                            data-icon="inline-start"
                            aria-hidden="true"
                          />Schedule classes
                        </a>
                      </div>
                    </div>
                  }
                }
                @default {
                  <p role="status" class="sr-only">Loading the classes.</p>
                  <div aria-hidden="true" class="divide-y divide-border">
                    @for (placeholder of placeholders; track placeholder) {
                      <div class="px-4 py-3.5 md:px-5">
                        <div hlmSkeleton class="rounded-md h-4 w-40 max-w-full"></div>
                        <div hlmSkeleton class="rounded-md mt-2 h-3.5 w-32 max-w-full"></div>
                      </div>
                    }
                  </div>
                }
              }
            </section>
            @if (scheduling() !== 'no') {
              <section
                #scheduleSection
                id="schedule"
                tabindex="-1"
                aria-labelledby="schedule-heading"
                hlmCard
                size="bare"
                class="mt-4 max-w-2xl overflow-clip focus:outline-none md:mt-6"
              >
                <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                  <h2 id="schedule-heading" class="font-semibold">Schedule classes</h2>
                </div>
                @if (scheduling() === 'form') {
                  <app-training-schedule-form
                    [trainingId]="training.trainingId"
                    (scheduled)="scheduled($event)"
                  />
                } @else {
                  <p role="status" class="sr-only">Loading the schedule.</p>
                  <div aria-hidden="true" class="flex flex-col gap-5 px-4 py-4 md:px-5 md:py-5">
                    @for (field of skeletonFields; track field) {
                      <div class="flex flex-col gap-2">
                        <div hlmSkeleton class="rounded-md h-3.5 w-24"></div>
                        <div
                          hlmSkeleton
                          data-slot="skeleton-input"
                          class="h-9 w-full rounded-lg pointer-coarse:h-11"
                        ></div>
                      </div>
                    }
                  </div>
                }
              </section>
            }
          </div>
        }
      }
      @case ('loading') {
        <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <p role="status" class="sr-only">Loading the training program.</p>
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
        <app-training-no-access />
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
export class TrainingManagement {
  private readonly context = inject(TrainingContext);
  private readonly injector = inject(Injector);
  private readonly landing = inject(TrainingScheduleLanding);
  private readonly pageTitle = inject(PageTitle);
  private readonly cancelCall = injectMutation(api.trainingClasses.cancel);
  private readonly restoreCall = injectMutation(api.trainingClasses.restore);
  private readonly cause = injectOfflineCause();

  protected readonly online = injectOnline();
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly statusClass =
    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground';
  protected readonly placeholders = [1, 2];
  protected readonly detailRows = [1, 2];
  protected readonly skeletonFields = [1, 2, 3];

  protected readonly state = this.context.state;
  protected readonly training = this.context.training;
  protected readonly classes = this.context.classes;
  protected readonly rows = computed(() => {
    const view = this.classes();
    return view.status === 'ready' ? view.classes : [];
  });
  protected readonly ages = computed(() => {
    const training = this.training();
    return training ? trainingAgesLabel(training.minimumAge, training.maximumAge) : '';
  });
  protected readonly pattern = computed(() => {
    const pattern = this.training()?.pattern;
    if (!pattern) return null;
    return {
      summary: `${WEEKDAY_NAMES[pattern.weekday]}s, ${trainingClassTimes(pattern.startTime, pattern.endTime)}, for ${pattern.weeks} ${pattern.weeks === 1 ? 'week' : 'weeks'}, ${pattern.placesPerClass} ${pattern.placesPerClass === 1 ? 'place' : 'places'} per class`,
      deadline: formatCalendarDate(pattern.registrationDeadline),
      single: pattern.allowSingleRegistration
        ? 'Single-class registration is allowed.'
        : 'Single-class registration is not allowed.',
    };
  });
  /** The schedule section is a skeleton while the classes load, the form while there are none, and gone once there are some. */
  protected readonly scheduling = computed<'form' | 'loading' | 'no'>(() => {
    const view = this.classes();
    if (view.status === 'error') return 'no';
    if (view.status === 'loading') return 'loading';
    return view.classes.length === 0 ? 'form' : 'no';
  });
  protected readonly schedulePath = computed(
    () =>
      `${trainingPath(this.context.orgSlug(), this.context.trainingSlug())}#${SCHEDULE_FRAGMENT}`,
  );
  protected readonly retryHref = computed(() =>
    trainingPath(this.context.orgSlug(), this.context.trainingSlug()),
  );

  protected readonly working = signal<string | null>(null);
  protected readonly undoNote = signal<string | null>(null);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly failure = signal<{ title: string; description: string } | null>(null);

  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly scheduleSection = viewChild<ElementRef<HTMLElement>>('scheduleSection');
  private readonly sectionJump = injectSectionJump((section) =>
    section.querySelector<HTMLElement>('#weekday brn-radio input'),
  );

  constructor() {
    effect(() => this.landOnceTheFormRenders());
    // The no-access and not-found views set their own title.
    effect(() => {
      const training = this.training();
      if (training) this.pageTitle.set([training.name, training.organization.name]);
    });
  }

  protected dateOf(row: { date: string }): string {
    return trainingClassDate(row.date);
  }

  protected timesOf(row: TrainingClassRow): string {
    return trainingClassTimes(row.startTime, row.endTime);
  }

  protected jumpToForm(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const section = this.scheduleSection()?.nativeElement;
    if (!section) return;
    event.preventDefault();
    this.sectionJump.jump(section);
  }

  protected scheduled(count: number): void {
    this.failure.set(null);
    this.undoNote.set(null);
    this.outcome.set({ kind: 'scheduled', count });
    // The Schedule classes button that had focus goes with the form.
    this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
  }

  private landOnceTheFormRenders(): void {
    if (!this.landing.pending()) return;
    const state = this.state();
    if (state === 'loading') return;
    // The form is a skeleton until the classes answer, and gone if there are some.
    if (state === 'ready' && this.scheduling() === 'loading') return;
    this.landing.settle();
    if (state !== 'ready') return;
    afterNextRender(
      () => {
        const section = this.scheduleSection()?.nativeElement;
        if (section) this.sectionJump.jump(section);
      },
      { injector: this.injector },
    );
  }

  protected async cancel(row: TrainingClassRow): Promise<void> {
    if (this.working() !== null) return;
    this.failure.set(null);
    this.outcome.set(null);
    this.undoNote.set(null);
    this.working.set(row.trainingClassId);
    try {
      await this.cancelCall.run({ trainingClassId: row.trainingClassId });
      this.outcome.set({ kind: 'cancelled', row });
      // The Cancel button that had focus is now a Restore button in the same row; the status is what to read next.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.failure.set(
        this.failureOf(`${this.dateOf(row)} could not be cancelled.`, failure, 'removed'),
      );
      this.focusAfterRender(() => this.failureAlert()?.focus());
    } finally {
      this.working.set(null);
    }
  }

  protected async restore(row: TrainingClassRow): Promise<void> {
    if (this.working() !== null) return;
    this.failure.set(null);
    this.outcome.set(null);
    this.undoNote.set(null);
    this.working.set(row.trainingClassId);
    try {
      await this.restoreCall.run({ trainingClassId: row.trainingClassId });
      this.outcome.set({ kind: 'restored', date: this.dateOf(row) });
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.failure.set(this.failureOf(`${this.dateOf(row)} ${RESTORE_FAILED}`, failure, 'undone'));
      this.focusAfterRender(() => this.failureAlert()?.focus());
    } finally {
      this.working.set(null);
    }
  }

  protected async undo(row: TrainingClassRow): Promise<void> {
    if (this.working() !== null) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.undoNote.set(this.offlineNote());
      return;
    }
    this.working.set(row.trainingClassId);
    try {
      await this.restoreCall.run({ trainingClassId: row.trainingClassId });
      this.outcome.set({ kind: 'restored', date: this.dateOf(row) });
      // The Undo button that had focus is gone.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.undoNote.set(
        failure instanceof ConvexOfflineError
          ? this.offlineNote()
          : `${this.dateOf(row)} ${RESTORE_FAILED}`,
      );
    } finally {
      this.working.set(null);
    }
  }

  private failureOf(title: string, failure: unknown, notDone: 'removed' | 'undone') {
    if (failure instanceof ConvexOfflineError) {
      return {
        title: offlineTitle(this.cause(), notDone),
        description: "Try again when you're connected.",
      };
    }
    const refusal = failure instanceof ConvexError ? (failure.data as { message?: unknown }) : null;
    const message = typeof refusal?.message === 'string' ? refusal.message : CANCEL_FAILED;
    return { title, description: message };
  }

  private offlineNote(): string {
    return `${offlineTitle(this.cause(), 'undone')} Try again when you're connected.`;
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
