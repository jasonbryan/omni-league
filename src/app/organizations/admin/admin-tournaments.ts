import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarDays,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideMapPin,
  lucideMapPinOff,
  lucidePlus,
  lucideSwords,
} from '@ng-icons/lucide';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { keepFocusWhenAlertGoes } from '../../core/replaced-focus';
import { isPlainClick } from '../../shell/follow-link';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { seasonDates } from '../league/season-dates';
import { AdminAlert } from './admin-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { ROW_TITLE_LINK } from './link-classes';
import { tournamentPath } from './tournament-path';
import { OUTLINE_BUTTON } from './button-classes';
import { CreateFormLanding } from './create-form-landing';
import { injectSectionJump } from './section-jump';
import { TournamentCreateForm } from './tournament-create-form';

const NAME_THEN_GO_TO_LOCATIONS_THEN_ALERT = ['#name', 'a[href]', '[data-slot="alert"]'];

@Component({
  selector: 'app-admin-tournaments',
  imports: [AdminAlert, HlmBadge, HlmCard, HlmSkeleton, NgIcon, RouterLink, TournamentCreateForm],
  providers: [
    provideIcons({
      lucideCalendarDays,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideMapPin,
      lucideMapPinOff,
      lucidePlus,
      lucideSwords,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (organization(); as organization) {
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">{{ organization.name }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Tournaments
          </h1>
          <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
            A tournament is a one-time event with a bracket. Drafts are visible only to your staff.
          </p>
        </div>
        <!-- The fragment link is explicit: a bare #create-tournament would resolve against <base href="/"> to the home page. -->
        <a [href]="createPath()" data-slot="button" [class]="jumpClass" (click)="jumpToForm($event)"
          ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create a
          tournament</a
        >
      </div>
      <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="tournaments-heading"
          hlmCard
          size="bare"
          class="overflow-hidden lg:col-span-2"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="tournaments-heading" class="font-semibold">Tournaments</h2>
          </div>
          @if (failed()) {
            <div class="px-4 py-4 md:px-5">
              <app-admin-alert
                kind="error"
                title="The tournaments could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          } @else if (rows(); as rows) {
            @if (rows.length > 0) {
              <ul id="tournaments-list" role="list" class="divide-y divide-border">
                @for (row of rows; track row.tournamentId) {
                  <li class="px-4 py-3.5 md:px-5">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <h3 class="me-1 font-medium">
                        <a [routerLink]="tournamentHref(row.slug)" [class]="rowLink">{{
                          row.name
                        }}</a>
                      </h3>
                      @if (row.status === 'published') {
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
                    </div>
                    <p class="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideCalendarDays"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span
                        ><span class="sr-only">Dates: </span
                        >{{ dates(row.startDate, row.endDate) }}</span
                      >
                    </p>
                  </li>
                }
              </ul>
            } @else {
              <div class="flex flex-col items-center px-6 py-10 text-center">
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideSwords" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No tournaments yet</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  Create a tournament to run a one-time event with a bracket.
                </p>
              </div>
            }
          } @else {
            <p role="status" class="sr-only">Loading the tournaments.</p>
            <div aria-hidden="true" class="divide-y divide-border">
              @for (placeholder of placeholders; track placeholder) {
                <div class="flex gap-3 px-4 py-3.5 md:px-5">
                  <div class="flex-1">
                    <div hlmSkeleton class="rounded-md h-4 w-48 max-w-full"></div>
                    <div hlmSkeleton class="rounded-md mt-2 h-3.5 w-64 max-w-full"></div>
                  </div>
                </div>
              }
            </div>
          }
        </section>
        <section
          #createSection
          id="create-tournament"
          tabindex="-1"
          aria-labelledby="create-tournament-heading"
          hlmCard
          size="bare"
          class="overflow-clip focus:outline-none"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="create-tournament-heading" class="font-semibold">Create a tournament</h2>
          </div>
          @if (locations(); as locations) {
            @if (locations.length > 0) {
              <app-tournament-create-form
                [organizationId]="organization.organizationId"
                [organizationName]="organization.name"
                [organizationSlug]="organization.slug"
                [locations]="locations"
              />
            } @else {
              <div class="flex flex-col items-center px-6 py-10 text-center">
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideMapPinOff" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">Add a location first</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  Every tournament is held at one or more of your locations.
                </p>
                <div class="mt-5">
                  <a [routerLink]="locationsPath()" data-slot="button" [class]="outlineButton"
                    ><ng-icon name="lucideMapPin" data-icon="inline-start" aria-hidden="true" />Go
                    to Locations</a
                  >
                </div>
              </div>
            }
          } @else if (locationsFailed()) {
            <div class="px-4 py-4 md:px-5">
              <app-admin-alert
                #locationsAlert
                kind="error"
                title="The locations could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          }
          @if (skeletonShown()) {
            <p role="status" class="sr-only">Loading the locations.</p>
            <div aria-hidden="true" class="px-4 py-4 md:px-5 md:py-5">
              <div class="flex flex-col gap-5">
                @for (field of skeletonFields; track field) {
                  <div class="flex flex-col gap-2">
                    <div class="flex h-5 items-center">
                      <div hlmSkeleton class="rounded-md h-3.5 w-16"></div>
                    </div>
                    <div
                      hlmSkeleton
                      data-slot="skeleton-input"
                      class="h-9 w-full rounded-lg pointer-coarse:h-11"
                    ></div>
                  </div>
                }
              </div>
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class AdminTournaments {
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly landing = inject(CreateFormLanding);

  protected readonly organization = this.context.organization;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly placeholders = [1, 2, 3];
  protected readonly skeletonFields = [1, 2, 3];
  protected readonly dates = seasonDates;
  protected readonly rowLink = ROW_TITLE_LINK;

  private readonly list = injectQuery(api.tournaments.listForOrganization, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  private readonly locationList = injectQuery(api.locations.listForAdmin, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  protected readonly rows = computed(() => this.list.value());
  protected readonly failed = computed(() => this.list.error() !== undefined);
  protected readonly locations = computed(() => this.locationList.value());
  protected readonly locationsFailed = computed(() => this.locationList.error() !== undefined);
  protected readonly locationsLoading = computed(
    () => this.locations() === undefined && !this.locationsFailed(),
  );
  protected readonly createPath = computed(
    () => `${adminPath(this.context.slug(), 'tournaments')}#create-tournament`,
  );
  protected tournamentHref(slug: string): string {
    return tournamentPath(this.context.slug(), slug);
  }
  protected readonly locationsPath = computed(() => adminPath(this.context.slug(), 'locations'));

  private readonly createSection = viewChild<ElementRef<HTMLElement>>('createSection');
  private readonly locationsAlertHost = viewChild<unknown, ElementRef<HTMLElement>>(
    'locationsAlert',
    { read: ElementRef },
  );
  private readonly sectionJump = injectSectionJump((section) => {
    for (const selector of NAME_THEN_GO_TO_LOCATIONS_THEN_ALERT) {
      const target = section.querySelector<HTMLElement>(selector);
      if (target) return target;
    }
    return null;
  });

  protected readonly skeletonShown = signal(true);

  constructor() {
    bindAdminTitle('Tournaments');
    effect(() => this.landOnceItsTargetRenders());
    keepFocusWhenAlertGoes(
      () => this.locationsAlertHost()?.nativeElement,
      () => this.createSection()?.nativeElement,
    );
    // WebKit moves the scroll when the content's arrival and the skeleton's removal reach the same
    // layout, so the skeleton goes one render later, after a layout with both in the page.
    afterRenderEffect({
      earlyRead: () => {
        if (!this.locationsLoading()) this.createSection()?.nativeElement.getBoundingClientRect();
      },
      write: () => this.skeletonShown.set(this.locationsLoading()),
    });
  }

  private landOnceItsTargetRenders(): void {
    if (!this.landing.pending() || this.locationsLoading()) return;
    const section = this.createSection()?.nativeElement;
    if (!section) return;
    this.landing.settle();
    afterNextRender(() => this.sectionJump.jump(section), { injector: this.injector });
  }

  protected jumpToForm(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const section = this.createSection()?.nativeElement;
    if (!section) return;
    event.preventDefault();
    this.sectionJump.jump(section);
  }
}
