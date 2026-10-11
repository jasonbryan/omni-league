import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleCheck,
  lucideCircleDashed,
  lucideMapPin,
  lucideMapPinOff,
  lucidePlus,
  lucideTrophy,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import { injectQuery, skipToken } from '../../core/data/convex';
import { isPlainClick } from '../../shell/follow-link';
import { AdminAlert } from './admin-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { OUTLINE_BUTTON } from './button-classes';
import { BADGE_DEFAULT, BADGE_OUTLINE, BADGE_SECONDARY } from './field-classes';
import { LeagueCreateForm } from './league-create-form';

/**
 * Leagues, `/app/organizations/:slug/leagues` (#66; design/mockups/66-69-organization-
 * leagues.html states 1 to 8, without #69's Publish buttons): the organization's leagues from
 * `leagues.listForAdmin` (live, sorted by name, drafts included), each with its status, sport, and
 * locations, and the create form beside the list from 1024px and after it below. Below 1024px the
 * header's "Create a league" link jumps to the form and puts focus on its first field. An
 * organization with no locations sees "Add a location first" in place of the form, because a
 * league needs at least one.
 */
@Component({
  selector: 'app-admin-leagues',
  imports: [AdminAlert, LeagueCreateForm, NgIcon, RouterLink],
  providers: [
    provideIcons({
      lucideCircleCheck,
      lucideCircleDashed,
      lucideMapPin,
      lucideMapPinOff,
      lucidePlus,
      lucideTrophy,
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
            Leagues
          </h1>
          <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
            Drafts are visible only to your staff. Publish a league to put it on your public page.
          </p>
        </div>
        <!-- The fragment link is explicit: a bare #create-league would resolve against <base
             href="/"> to the home page. A plain click scrolls to the form and focuses its first
             field. -->
        <a [href]="createPath()" data-slot="button" [class]="jumpClass" (click)="jumpToForm($event)"
          ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create a
          league</a
        >
      </div>
      <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="leagues-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="leagues-heading" class="font-semibold">Leagues</h2>
          </div>
          @if (failed()) {
            <div class="px-4 py-4 md:px-5">
              <app-admin-alert
                kind="error"
                title="The leagues could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          } @else if (rows(); as rows) {
            @if (rows.length > 0) {
              <ul id="leagues-list" role="list" class="divide-y divide-border">
                @for (row of rows; track row.leagueId) {
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
                        <span data-slot="badge" data-variant="secondary" [class]="secondaryBadge">{{
                          row.sportName
                        }}</span>
                      </div>
                      <p class="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                        <ng-icon
                          name="lucideMapPin"
                          class="mt-0.5 shrink-0 text-base"
                          aria-hidden="true"
                        /><span
                          ><span class="sr-only">{{
                            row.locationNames.length === 1 ? 'Location: ' : 'Locations: '
                          }}</span
                          >{{ row.locationNames.join(', ') }}</span
                        >
                      </p>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <div class="flex flex-col items-center px-6 py-10 text-center">
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideTrophy" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No leagues yet</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  Leagues you create appear here as drafts until you publish them.
                </p>
              </div>
            }
          } @else {
            <p role="status" class="sr-only">Loading the leagues.</p>
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
          id="create-league"
          aria-labelledby="create-league-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="create-league-heading" class="font-semibold">Create a league</h2>
          </div>
          @if (locations(); as locations) {
            @if (locations.length > 0) {
              <app-league-create-form
                [organizationId]="organization.organizationId"
                [organizationName]="organization.name"
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
                  Every league is held at one or more of your locations.
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
                kind="error"
                title="The locations could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          } @else {
            <p role="status" class="sr-only">Loading the locations.</p>
          }
        </section>
      </div>
    }
  `,
})
export class AdminLeagues {
  private readonly context = inject(AdminContext);

  protected readonly organization = this.context.organization;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly defaultBadge = BADGE_DEFAULT;
  protected readonly secondaryBadge = BADGE_SECONDARY;
  protected readonly outlineBadge = BADGE_OUTLINE;
  protected readonly placeholders = [1, 2, 3];

  private readonly list = injectQuery(api.leagues.listForAdmin, () => {
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
  protected readonly createPath = computed(
    () => `${adminPath(this.context.slug(), 'leagues')}#create-league`,
  );
  protected readonly locationsPath = computed(() => adminPath(this.context.slug(), 'locations'));

  private readonly createSection = viewChild<ElementRef<HTMLElement>>('createSection');

  constructor() {
    bindAdminTitle('Leagues');
  }

  /** A plain click on "Create a league" (phones): scroll to the form and focus its first field. */
  protected jumpToForm(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const section = this.createSection()?.nativeElement;
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView();
    section.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }
}
