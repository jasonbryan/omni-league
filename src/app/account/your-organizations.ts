import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBuilding2,
  lucideChevronRight,
  lucideCircleAlert,
  lucideGlobe,
  lucideInfo,
  lucidePlus,
  lucideSettings,
  lucideTrophy,
} from '@ng-icons/lucide';
import { api } from '../../../convex/_generated/api';
import { AuthService } from '../core/auth/auth.service';
import { injectQuery, skipToken } from '../core/data/convex';
import { adminPath } from '../organizations/admin/admin-path';
import { OUTLINE_BUTTON } from '../ui/button/button-classes';

export function organizationInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

const ROLE_NAMES = { orgAdmin: 'Org admin', leagueOrganizer: 'League organizer' } as const;

// Class strings are the approved mockup's, written as static attributes; buttons carry unmerged `buttonVariants` output.

@Component({
  selector: 'app-your-organizations',
  imports: [NgIcon, RouterLink],
  providers: [
    provideIcons({
      lucideBuilding2,
      lucideChevronRight,
      lucideCircleAlert,
      lucideGlobe,
      lucideInfo,
      lucidePlus,
      lucideSettings,
      lucideTrophy,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      aria-labelledby="organizations-heading"
      class="mt-6 max-w-3xl md:mt-8 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="organizations-heading" class="font-semibold">Your organizations</h2>
        @if (rows().length > 0) {
          <a
            routerLink="/app/organizations/new"
            data-slot="button"
            class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3"
            ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create an
            organization</a
          >
        }
      </div>
      @if (failed()) {
        <div class="px-4 py-4 md:px-5">
          <div
            data-slot="alert"
            role="alert"
            class="group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90 mb-5"
          >
            <ng-icon name="lucideCircleAlert" aria-hidden="true" />
            <div
              data-slot="alert-title"
              class="font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
            >
              Your organizations could not be loaded.
            </div>
            <div
              data-slot="alert-description"
              class="text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
            >
              Check your connection and try again.
            </div>
          </div>
        </div>
      } @else if (loading()) {
        <p role="status" class="sr-only">Loading your organizations.</p>
        <div aria-hidden="true" class="divide-y divide-border">
          @for (placeholder of placeholders; track placeholder) {
            <div class="flex items-center gap-3 px-4 py-3.5 md:px-5">
              <div
                aria-hidden="true"
                class="rounded-md bg-muted motion-safe:animate-pulse size-10 shrink-0 rounded-lg"
              ></div>
              <div class="flex-1">
                <div
                  aria-hidden="true"
                  class="rounded-md bg-muted motion-safe:animate-pulse h-4 w-48 max-w-full"
                ></div>
                <div
                  aria-hidden="true"
                  class="rounded-md bg-muted motion-safe:animate-pulse mt-2 h-3.5 w-24"
                ></div>
              </div>
            </div>
          }
        </div>
      } @else if (rows().length === 0) {
        <div class="flex flex-col items-center px-6 py-10 text-center">
          <span
            class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            ><ng-icon name="lucideBuilding2" class="text-xl" aria-hidden="true"
          /></span>
          <p class="mt-4 font-medium">No organizations yet</p>
          <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
            Ask your league organizer for an invite or registration link to join a league, or create
            an organization to run your own.
          </p>
          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <a
              routerLink="/app/organizations/new"
              data-slot="button"
              class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3"
              ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create an
              organization</a
            >
            <a routerLink="/leagues" data-slot="button" [class]="outlineButton">Find a league</a>
          </div>
        </div>
      } @else {
        <ul role="list" class="divide-y divide-border">
          @for (row of rows(); track row.slug) {
            <li class="px-4 py-3.5 md:px-5">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
                <span
                  aria-hidden="true"
                  class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
                  >{{ row.initials }}</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">{{ row.name }}</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">{{ row.roleName }}</p>
                </div>
                <div class="flex w-full gap-2 sm:w-auto">
                  <a
                    [routerLink]="row.publicPath"
                    data-slot="button"
                    class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 flex-1 sm:flex-none"
                    ><ng-icon
                      name="lucideGlobe"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Public page<span class="sr-only">: {{ row.name }}</span></a
                  >
                  @if (row.managePath; as managePath) {
                    <a
                      [routerLink]="managePath"
                      data-slot="button"
                      class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 flex-1 sm:flex-none"
                      ><ng-icon
                        name="lucideSettings"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Manage<span class="sr-only"> {{ row.name }}</span></a
                    >
                  }
                </div>
              </div>
              @if (row.isLeagueOrganizer) {
                @if (row.leagues.length > 0) {
                  <div class="mt-3 sm:ps-13">
                    <p [id]="row.leaguesLabelId" class="text-xs font-medium text-muted-foreground">
                      Your leagues
                    </p>
                    <ul
                      role="list"
                      [attr.aria-labelledby]="row.leaguesLabelId"
                      class="mt-1 -mx-2 flex flex-col gap-0.5"
                    >
                      @for (league of row.leagues; track league.slug) {
                        <li>
                          <a
                            [routerLink]="league.path"
                            class="flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted"
                            ><ng-icon
                              name="lucideTrophy"
                              class="shrink-0 text-base text-muted-foreground"
                              aria-hidden="true" /><span class="min-w-0 flex-1">{{
                              league.name
                            }}</span
                            ><ng-icon
                              name="lucideChevronRight"
                              class="shrink-0 text-base text-muted-foreground"
                              aria-hidden="true"
                          /></a>
                        </li>
                      }
                    </ul>
                  </div>
                } @else {
                  <p class="mt-3 flex items-start gap-1.5 text-sm text-muted-foreground sm:ps-13">
                    <ng-icon
                      name="lucideInfo"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    /><span
                      >No leagues are assigned to you here. Ask an org admin of {{ row.name }} to
                      assign one.</span
                    >
                  </p>
                }
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class YourOrganizations {
  private readonly auth = inject(AuthService);

  private readonly mine = injectQuery(api.organizations.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly placeholders = [1, 2];
  protected readonly failed = computed(() => this.mine.error() !== undefined);
  protected readonly loading = computed(() => this.mine.value() === undefined);
  protected readonly rows = computed(() =>
    (this.mine.value() ?? []).map(({ name, slug, role, leagues }) => ({
      name,
      slug,
      initials: organizationInitials(name),
      roleName: ROLE_NAMES[role],
      publicPath: `/organizations/${slug}`,
      managePath: role === 'orgAdmin' ? adminPath(slug) : null,
      isLeagueOrganizer: role === 'leagueOrganizer',
      leaguesLabelId: `${slug}-leagues-label`,
      leagues: leagues.map((league) => ({
        name: league.name,
        slug: league.slug,
        // Segments, not a string, so the router encodes each slug and none can change the path.
        path: ['/app', 'organizations', slug, 'leagues', league.slug],
      })),
    })),
  );
}
