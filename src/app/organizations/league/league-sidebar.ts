import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideGlobe, lucideTrophy } from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import { AuthService } from '../../core/auth/auth.service';
import { injectQuery, skipToken } from '../../core/data/convex';
import { initials } from '../organization-sidebar';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

const compareNames = (x: string, y: string) => {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * The sidebar of a league organizer on the league management page (#125;
 * design/mockups/125-126-seasons.html states 12 and 13), rendered in the app shell's sidebar slot:
 * the organization and "League organizer", "Your leagues" with every league assigned to the caller
 * in this organization (#196, from `organizations.listMine`, in the order it gives) and the one
 * being managed marked, then Public page and Your organizations. A league organizer has no admin
 * area (#65), so this replaces the admin sidebar. While the list loads, and if it fails, "Your
 * leagues" holds only the current league, which is always listed.
 *
 * Every class string below is the approved mockup's, written as a static attribute
 * (design/mockups/125-126-seasons.html state 12); league-sidebar.spec.ts checks them.
 *
 * The shell renders this twice while the phone sheet is open (the desktop column and the sheet),
 * so it carries no `id`: the list takes its name from `aria-label`.
 */
@Component({
  selector: 'app-league-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft, lucideGlobe, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="league().organization.name + ' leagues'" class="flex flex-col gap-6">
      <div class="flex items-center gap-3 px-2">
        <span
          aria-hidden="true"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
          >{{ initials() }}</span
        >
        <div class="min-w-0">
          <p class="text-sm/tight font-semibold">{{ league().organization.name }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">League organizer</p>
        </div>
      </div>
      <div>
        <p class="px-2 text-xs font-medium text-muted-foreground">Your leagues</p>
        <ul role="list" aria-label="Your leagues" class="mt-1 flex flex-col gap-0.5">
          @for (item of leagues(); track item.slug) {
            <li>
              @if (item.isCurrent) {
                <a
                  [routerLink]="item.path"
                  aria-current="page"
                  class="flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground"
                  ><ng-icon
                    name="lucideTrophy"
                    class="shrink-0 text-base"
                    aria-hidden="true"
                  /><span class="min-w-0">{{ item.name }}</span></a
                >
              } @else {
                <a
                  [routerLink]="item.path"
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
                  ><ng-icon
                    name="lucideTrophy"
                    class="shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  /><span class="min-w-0">{{ item.name }}</span></a
                >
              }
            </li>
          }
        </ul>
      </div>
      <ul role="list" class="flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
        <li>
          <a
            [routerLink]="publicPath()"
            class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
            ><ng-icon
              name="lucideGlobe"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            />Public page</a
          >
        </li>
        <li>
          <a
            routerLink="/app"
            class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
            ><ng-icon
              name="lucideArrowLeft"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            />Your organizations</a
          >
        </li>
      </ul>
    </nav>
  `,
})
export class LeagueSidebar {
  readonly league = input.required<OrganizerLeague>();

  private readonly auth = inject(AuthService);

  private readonly mine = injectQuery(api.organizations.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly initials = computed(() => initials(this.league().organization.name));
  /**
   * The caller's assigned leagues in this organization, as `listMine` gives them (sorted by name),
   * with the league being managed marked. Until the answer comes, and if it fails or does not hold
   * the current league, the current league is listed on its own or added in name order.
   */
  protected readonly leagues = computed(() => {
    const { name, slug, organization } = this.league();
    const assigned =
      this.mine.value()?.find((row) => row.slug === organization.slug)?.leagues ?? [];
    const all = assigned.some((item) => item.slug === slug)
      ? assigned
      : [...assigned, { name, slug }].sort((x, y) => compareNames(x.name, y.name));
    return all.map((item) => ({
      name: item.name,
      slug: item.slug,
      path: leaguePath(organization.slug, item.slug),
      isCurrent: item.slug === slug,
    }));
  });
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.league().organization.slug)}`,
  );
}
