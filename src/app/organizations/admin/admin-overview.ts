import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideGlobe,
  lucideMapPin,
  lucideTrophy,
  lucideUsers,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import { injectQuery, skipToken } from '../../core/data/convex';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { OUTLINE_BUTTON } from './button-classes';

/**
 * Overview, `/app/organizations/:slug` (#65, #66;
 * design/mockups/65-organization-admin-locations.html states 1 and 2): the organization, a "View
 * public page" link, a count tile for each section, and the "Get set up" list. The tiles count
 * what each section's own list query returns, so this page asks for no data of its own: the
 * Locations tile is `locations.listForAdmin` and the Leagues tile is `leagues.listForAdmin`. The
 * list hides once any league is published, and is not drawn while the leagues load, so an
 * established organization never sees it flash. The Staff tile (#67) counts
 * `memberships.listForOrganization` and `invites.listPending`, the staff screen's own queries.
 */
@Component({
  selector: 'app-admin-overview',
  imports: [NgIcon, RouterLink],
  providers: [
    provideIcons({ lucideArrowRight, lucideGlobe, lucideMapPin, lucideTrophy, lucideUsers }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (organization(); as organization) {
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">{{ organization.name }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Overview
          </h1>
        </div>
        <a [routerLink]="publicPath()" data-slot="button" [class]="outlineButton"
          ><ng-icon name="lucideGlobe" data-icon="inline-start" aria-hidden="true" />View public
          page</a
        >
      </div>
      <dl class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
        <div
          class="rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 px-3 py-3 md:px-4 md:py-4"
        >
          <dt class="flex items-center gap-2 text-xs font-medium text-muted-foreground md:text-sm">
            <span
              class="hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground md:flex"
              ><ng-icon name="lucideMapPin" class="text-base" aria-hidden="true" /></span
            >Locations
          </dt>
          @if (locationTile(); as tile) {
            <dd class="mt-1 text-2xl font-semibold tabular-nums md:mt-2">{{ tile.count }}</dd>
            <dd class="mt-0.5 text-sm text-muted-foreground">{{ tile.note }}</dd>
          } @else {
            <dd class="mt-1 md:mt-2">
              <span
                aria-hidden="true"
                class="block h-8 w-8 rounded-md bg-muted motion-safe:animate-pulse"
              ></span>
            </dd>
          }
        </div>
        <div
          class="rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 px-3 py-3 md:px-4 md:py-4"
        >
          <dt class="flex items-center gap-2 text-xs font-medium text-muted-foreground md:text-sm">
            <span
              class="hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground md:flex"
              ><ng-icon name="lucideTrophy" class="text-base" aria-hidden="true" /></span
            >Leagues
          </dt>
          @if (leagueTile(); as tile) {
            <dd class="mt-1 text-2xl font-semibold tabular-nums md:mt-2">{{ tile.count }}</dd>
            <dd class="mt-0.5 text-sm text-muted-foreground">{{ tile.note }}</dd>
          } @else {
            <dd class="mt-1 md:mt-2">
              <span
                aria-hidden="true"
                class="block h-8 w-8 rounded-md bg-muted motion-safe:animate-pulse"
              ></span>
            </dd>
          }
        </div>
        <div
          class="rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 px-3 py-3 md:px-4 md:py-4"
        >
          <dt class="flex items-center gap-2 text-xs font-medium text-muted-foreground md:text-sm">
            <span
              class="hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground md:flex"
              ><ng-icon name="lucideUsers" class="text-base" aria-hidden="true" /></span
            >Staff
          </dt>
          @if (staffTile(); as tile) {
            <dd class="mt-1 text-2xl font-semibold tabular-nums md:mt-2">{{ tile.count }}</dd>
            <dd class="mt-0.5 text-sm text-muted-foreground">{{ tile.note }}</dd>
          } @else {
            <dd class="mt-1 md:mt-2">
              <span
                aria-hidden="true"
                class="block h-8 w-8 rounded-md bg-muted motion-safe:animate-pulse"
              ></span>
            </dd>
          }
        </div>
      </dl>
      @if (showSetup()) {
        <div class="mt-4 max-w-3xl md:mt-6">
          <section
            aria-labelledby="setup-heading"
            class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
          >
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
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4"
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
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4"
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
                    class="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline underline-offset-4"
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
    }
  `,
})
export class AdminOverview {
  private readonly context = inject(AdminContext);

  protected readonly organization = this.context.organization;
  protected readonly outlineButton = OUTLINE_BUTTON;

  private readonly locations = injectQuery(api.locations.listForAdmin, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.context.slug())}`,
  );
  protected readonly locationsPath = computed(() => adminPath(this.context.slug(), 'locations'));
  protected readonly leaguesPath = computed(() => adminPath(this.context.slug(), 'leagues'));
  protected readonly staffPath = computed(() => adminPath(this.context.slug(), 'staff'));

  private readonly leagues = injectQuery(api.leagues.listForAdmin, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  /**
   * The Leagues tile, or `null` while the list loads: every league counted, split into published
   * and drafts (a part that is 0 is left out).
   */
  protected readonly leagueTile = computed(() => {
    if (this.leagues.error()) return { count: '–', note: 'Could not be loaded' };
    const rows = this.leagues.value();
    if (rows === undefined) return null;
    const published = rows.filter((row) => row.status === 'published').length;
    const drafts = rows.length - published;
    const parts = [
      published > 0 ? `${published} published` : null,
      drafts > 0 ? `${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : null,
    ].filter((part) => part !== null);
    return { count: String(rows.length), note: parts.length > 0 ? parts.join(', ') : 'None yet' };
  });

  private readonly members = injectQuery(api.memberships.listForOrganization, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  private readonly invites = injectQuery(api.invites.listPending, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  /**
   * The Staff tile, or `null` while either list loads: the members and "N pending invites". A
   * failed member list reads "–"; a failed pending list keeps the member count and says so.
   */
  protected readonly staffTile = computed(() => {
    if (this.members.error()) return { count: '–', note: 'Could not be loaded' };
    const members = this.members.value();
    if (members === undefined) return null;
    const count = String(members.length);
    if (this.invites.error()) return { count, note: 'Pending invites could not be loaded' };
    const invites = this.invites.value();
    if (invites === undefined) return null;
    const note =
      invites.length === 0
        ? 'No pending invites'
        : `${invites.length} pending ${invites.length === 1 ? 'invite' : 'invites'}`;
    return { count, note };
  });

  /**
   * Whether the "Get set up" list shows: not while the leagues load, and not once any league is
   * published (decision 2). A failed list shows it, because it cannot say a league is published.
   */
  protected readonly showSetup = computed(() => {
    if (this.leagues.error()) return true;
    const rows = this.leagues.value();
    return rows !== undefined && !rows.some((row) => row.status === 'published');
  });

  /** The Locations tile, or `null` while the list loads. */
  protected readonly locationTile = computed(() => {
    if (this.locations.error()) return { count: '–', note: 'Could not be loaded' };
    const rows = this.locations.value();
    if (rows === undefined) return null;
    return {
      count: String(rows.length),
      note: rows.length > 0 ? 'All on your public page' : 'None yet',
    };
  });

  constructor() {
    bindAdminTitle('Overview');
  }
}
