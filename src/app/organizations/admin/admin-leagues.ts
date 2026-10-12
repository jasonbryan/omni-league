import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleCheck,
  lucideCircleDashed,
  lucideGlobe,
  lucideMapPin,
  lucideMapPinOff,
  lucidePlus,
  lucideTrophy,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import { injectQuery, skipToken } from '../../core/data/convex';
import { isPlainClick } from '../../shell/follow-link';
import { leaguePath } from '../league/league-path';
import { AdminAlert } from './admin-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { OUTLINE_BUTTON } from './button-classes';
import { BADGE_DEFAULT, BADGE_OUTLINE, BADGE_SECONDARY } from './field-classes';
import { LeagueCreateForm } from './league-create-form';
import {
  PublishLeagueDialog,
  type PublishOutcome,
  type PublishTarget,
} from './publish-league-dialog';

/**
 * Leagues, `/app/organizations/:slug/leagues` (#66, #69; design/mockups/66-69-organization-
 * leagues.html): the organization's leagues from
 * `leagues.listForAdmin` (live, sorted by name, drafts included), each with its status, sport, and
 * locations, and the create form beside the list from 1024px and after it below. Below 1024px the
 * header's "Create a league" link jumps to the form and puts focus on its first field. An
 * organization with no locations sees "Add a location first" in place of the form, because a
 * league needs at least one. Each Draft row has a Publish button (#69) that opens
 * `PublishLeagueDialog`; once the league is published a status above the list says so, with a
 * link to the public page, and takes focus, because the button that had it is gone. The page
 * behind the dialog is inert while it is open. Each league's name links to its management page
 * (#125; design/mockups/125-126-seasons.html state 16).
 */
@Component({
  selector: 'app-admin-leagues',
  imports: [AdminAlert, LeagueCreateForm, NgIcon, PublishLeagueDialog, RouterLink],
  providers: [
    provideIcons({
      lucideCircleCheck,
      lucideCircleDashed,
      lucideGlobe,
      lucideMapPin,
      lucideMapPinOff,
      lucidePlus,
      lucideTrophy,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8',
    '[attr.inert]': 'publishOpen() ? "" : null',
  },
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
          @if (published(); as published) {
            <div class="border-b border-border px-4 py-3 md:px-5">
              <app-admin-alert
                #publishedNotice
                kind="success"
                [title]="published.name + ' is published.'"
                description="It’s on your public page now."
                ><a [routerLink]="publicPath()">View public page</a></app-admin-alert
              >
            </div>
          }
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
                        <h3 class="me-1 font-medium">
                          <a
                            [routerLink]="leaguePath(row.slug)"
                            class="underline underline-offset-4 hover:text-primary"
                            >{{ row.name }}</a
                          >
                        </h3>
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
                    @if (row.status !== 'published') {
                      <button
                        type="button"
                        data-slot="button"
                        aria-haspopup="dialog"
                        [attr.data-league-id]="row.leagueId"
                        [class]="outlineButton"
                        (click)="publish(row)"
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
      <app-publish-league-dialog (dismissed)="publishDismissed($event)" />
    }
  `,
})
export class AdminLeagues {
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  /** The league's management page (#125), from the route's organization slug and the row's. */
  protected leaguePath(leagueSlug: string): string {
    return leaguePath(this.context.slug(), leagueSlug);
  }

  private readonly createSection = viewChild<ElementRef<HTMLElement>>('createSection');
  private readonly publishDialog = viewChild(PublishLeagueDialog);
  private readonly publishedNotice = viewChild<AdminAlert>('publishedNotice');

  /** The league just published, for the status above the list; cleared by the next dialog. */
  protected readonly published = signal<PublishTarget | null>(null);
  protected readonly publishOpen = computed(() => this.publishDialog()?.isOpen() ?? false);
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.context.slug())}`,
  );

  constructor() {
    bindAdminTitle('Leagues');
  }

  /** The row's Publish button: asks to confirm, and clears the last result. */
  protected publish(row: PublishTarget): void {
    this.published.set(null);
    this.publishDialog()?.open({ leagueId: row.leagueId, name: row.name });
  }

  /**
   * The dialog has left the page and the page is no longer inert. A published league moves focus
   * to the status, because the button that had it is gone; a dialog that was cancelled puts focus
   * back on that row's Publish button.
   */
  protected publishDismissed(outcome: PublishOutcome): void {
    if (outcome.published) {
      this.published.set({ leagueId: outcome.leagueId, name: outcome.name });
      afterNextRender(() => this.publishedNotice()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`button[data-league-id="${outcome.leagueId}"]`)
          ?.focus(),
      { injector: this.injector },
    );
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
