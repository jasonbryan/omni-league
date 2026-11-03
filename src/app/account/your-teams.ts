import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideCircleAlert, lucideCrown, lucideUsers } from '@ng-icons/lucide';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { BADGE_SECONDARY } from '../organizations/admin/field-classes';
import { OUTLINE_BUTTON } from '../ui/button/button-classes';

// Keyed by string: a role this build does not know (one a later backend adds) gets no badge.
const ROLE_BADGES: Readonly<Record<string, { label: string; crown: boolean } | undefined>> = {
  captain: { label: 'Captain', crown: true },
  player: { label: 'Player', crown: false },
  guardian: { label: 'Guardian', crown: false },
};

@Component({
  selector: 'app-your-teams',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowRight, lucideCircleAlert, lucideCrown, lucideUsers })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      aria-labelledby="teams-heading"
      class="mt-6 max-w-3xl md:mt-8 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="teams-heading" class="font-semibold">Your teams</h2>
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
              Your teams could not be loaded.
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
        <p role="status" class="sr-only">Loading your teams.</p>
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
            ><ng-icon name="lucideUsers" class="text-xl" aria-hidden="true"
          /></span>
          <p class="mt-4 font-medium">No teams yet</p>
          <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
            To play, register a team or register as a free agent from a season&rsquo;s page, or open
            the invite link your captain sent you.
          </p>
        </div>
      } @else {
        <ul role="list" class="divide-y divide-border">
          @for (row of rows(); track row.teamId) {
            <li class="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3.5 md:px-5">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                ><ng-icon name="lucideUsers" class="text-xl" aria-hidden="true"
              /></span>
              <div class="min-w-0 flex-1">
                <h3 class="font-medium">{{ row.teamName }}</h3>
                <p class="mt-0.5 text-sm text-muted-foreground">
                  {{ row.seasonName }} &middot; {{ row.leagueName }}
                </p>
                <p class="text-sm text-muted-foreground">{{ row.organizationName }}</p>
                @if (row.badge; as badge) {
                  <p class="mt-1.5">
                    <span data-slot="badge" data-variant="secondary" [class]="badgeClass">
                      @if (badge.crown) {
                        <ng-icon name="lucideCrown" data-icon="inline-start" aria-hidden="true" />
                      }
                      {{ badge.label }}</span
                    >
                  </p>
                }
              </div>
              <div class="flex w-full gap-2 sm:w-auto">
                <a [routerLink]="row.path" data-slot="button" [class]="teamPageButton"
                  ><ng-icon
                    name="lucideArrowRight"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Team page<span class="sr-only">: {{ row.teamName }}</span></a
                >
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class YourTeams {
  private readonly auth = inject(AuthService);

  private readonly mine = injectQuery(api.teams.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly badgeClass = BADGE_SECONDARY;
  protected readonly teamPageButton = `${OUTLINE_BUTTON} flex-1 sm:flex-none`;
  protected readonly placeholders = [1, 2];
  protected readonly failed = computed(() => this.mine.error() !== undefined);
  protected readonly loading = computed(() => this.mine.value() === undefined);
  protected readonly rows = computed(() =>
    (this.mine.value() ?? []).map((team) => ({
      ...team,
      badge: ROLE_BADGES[team.role],
      // Segments, not a string, so the router encodes the id and it cannot change the path.
      path: ['/app', 'teams', team.teamId],
    })),
  );
}
