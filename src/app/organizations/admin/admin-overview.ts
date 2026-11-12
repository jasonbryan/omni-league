import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucidePlus } from '@ng-icons/lucide';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { AdminAttention } from './admin-attention';
import { AdminContext, bindAdminTitle } from './admin-context';
import { AdminOpenSeasons } from './admin-open-seasons';
import { adminPath } from './admin-path';
import { PRIMARY_BUTTON } from './button-classes';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';

const COUNT_LINK =
  'rounded-sm hover:text-foreground hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center';

/**
 * The header counts read the organization's published and draft league counters and its staff counter, which hold past the 200 rows the lists stop at.
 * The setup list hides once any league is published (by the counter), and is not drawn while the counter loads, so an established organization never sees it flash.
 */
@Component({
  selector: 'app-admin-overview',
  imports: [AdminAttention, AdminOpenSeasons, HlmCard, HlmSkeleton, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowRight, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (organization(); as organization) {
      <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight text-balance md:text-3xl">Overview</h1>
          <p
            data-slot="overview-counts"
            class="mt-1 flex min-h-6 flex-wrap items-center gap-x-2 text-muted-foreground pointer-coarse:min-h-11"
          >
            @if (counts(); as counts) {
              @for (count of counts; track count.path; let last = $last) {
                <a [routerLink]="count.path" class="${COUNT_LINK}">{{ count.label }}</a>
                @if (!last) {
                  <span aria-hidden="true">·</span>
                }
              }
            } @else {
              <span
                hlmSkeleton
                aria-hidden="true"
                class="block h-5 w-64 max-w-full rounded-md"
              ></span>
            }
          </p>
        </div>
        <a
          [routerLink]="leaguesPath()"
          fragment="create-league"
          data-slot="button"
          [class]="createButton"
          ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create a
          league</a
        >
      </div>
      @if (showSetup()) {
        <div class="mt-6 max-w-3xl md:mt-8">
          <section aria-labelledby="setup-heading" hlmCard size="bare" class="overflow-hidden">
            <div
              class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
            >
              <h2 id="setup-heading" class="font-semibold">Get set up</h2>
            </div>
            <ol role="list" class="divide-y divide-border">
              <li class="flex gap-3 px-4 py-3.5 md:px-5">
                <span
                  aria-hidden="true"
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-input text-sm font-semibold tabular-nums"
                  >1</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">Add a location</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Where your leagues play. Visitors see it on your public page.
                  </p>
                  <a
                    [routerLink]="locationsPath()"
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11"
                    >Add a location<ng-icon
                      name="lucideArrowRight"
                      class="text-base"
                      aria-hidden="true"
                  /></a>
                </div>
              </li>
              <li class="flex gap-3 px-4 py-3.5 md:px-5">
                <span
                  aria-hidden="true"
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-input text-sm font-semibold tabular-nums"
                  >2</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">Create a league</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Choose its sport and locations. It starts as a draft, so only your staff see it.
                  </p>
                  <a
                    [routerLink]="leaguesPath()"
                    fragment="create-league"
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11"
                    >Create a league<ng-icon
                      name="lucideArrowRight"
                      class="text-base"
                      aria-hidden="true"
                  /></a>
                </div>
              </li>
              <li class="flex gap-3 px-4 py-3.5 md:px-5">
                <span
                  aria-hidden="true"
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-input text-sm font-semibold tabular-nums"
                  >3</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">Publish the league</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Publishing puts it on your public page.
                  </p>
                </div>
              </li>
              <li class="flex gap-3 px-4 py-3.5 md:px-5">
                <span
                  aria-hidden="true"
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-input text-sm font-semibold tabular-nums"
                  >4</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">Invite staff (optional)</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Add another org admin, or a league organizer for the leagues you choose.
                  </p>
                  <a
                    [routerLink]="staffPath()"
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11"
                    >Invite staff<ng-icon
                      name="lucideArrowRight"
                      class="text-base"
                      aria-hidden="true"
                  /></a>
                </div>
              </li>
            </ol>
          </section>
        </div>
      }
      <div class="mt-6 grid gap-4 md:mt-8 md:gap-6 xl:grid-cols-5">
        <app-admin-attention />
        <app-admin-open-seasons />
      </div>
    }
  `,
})
export class AdminOverview {
  private readonly context = inject(AdminContext);

  protected readonly organization = this.context.organization;
  protected readonly createButton = `${PRIMARY_BUTTON} w-full sm:w-auto`;

  private readonly locations = injectQuery(api.locations.listForAdmin, () =>
    this.organizationArgs(),
  );
  private readonly published = injectQuery(api.leagues.publishedCount, () =>
    this.organizationArgs(),
  );
  private readonly drafts = injectQuery(api.leagues.draftCount, () => this.organizationArgs());
  private readonly staff = injectQuery(api.memberships.staffCount, () => this.organizationArgs());

  protected readonly locationsPath = computed(() => adminPath(this.context.slug(), 'locations'));
  protected readonly leaguesPath = computed(() => adminPath(this.context.slug(), 'leagues'));
  protected readonly staffPath = computed(() => adminPath(this.context.slug(), 'staff'));

  /** A failed count is left out, because a 0 in its place would be false. */
  protected readonly counts = computed(() => {
    const leagueCounts = [this.published, this.drafts];
    const pending = [...leagueCounts, this.locations, this.staff].some(
      (query) => query.value() === undefined && query.error() === undefined,
    );
    if (pending) return null;
    const leagues = leagueCounts.every((query) => query.value() !== undefined)
      ? (this.published.value() ?? 0) + (this.drafts.value() ?? 0)
      : undefined;
    const locations = this.locations.value()?.length;
    const staff = this.staff.value();
    return [
      leagues !== undefined && {
        label: `${leagues} ${leagues === 1 ? 'league' : 'leagues'}`,
        path: this.leaguesPath(),
      },
      locations !== undefined && {
        label: `${locations} ${locations === 1 ? 'location' : 'locations'}`,
        path: this.locationsPath(),
      },
      staff !== undefined && { label: `${staff} staff`, path: this.staffPath() },
    ].filter((count) => count !== false);
  });

  /** A failed counter shows it, because it cannot say a league is published. */
  protected readonly showSetup = computed(() => {
    if (this.published.error()) return true;
    const count = this.published.value();
    return count !== undefined && count < 1;
  });

  private organizationArgs() {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  }

  constructor() {
    bindAdminTitle('Overview');
  }
}
