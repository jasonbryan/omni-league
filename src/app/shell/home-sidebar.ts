import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBuilding2,
  lucideHouse,
  lucideSearch,
  lucideShirt,
  lucideTrophy,
} from '@ng-icons/lucide';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { adminPath } from '../organizations/admin/admin-path';
import { teamPath } from '../teams/team-paths';
import { SKELETON_CLASSES } from '../ui/skeleton';
import { injectCurrentUrl } from './current-url';
import {
  SIDEBAR_GROUP_LABEL,
  SIDEBAR_ICON,
  SIDEBAR_ICON_CURRENT,
  SIDEBAR_ROW,
  SIDEBAR_ROW_CURRENT,
} from './sidebar-classes';
import { pathWithoutQueryOrTrailingSlash } from './url-path';

const HOME_PATH = '/app';

/**
 * The shell renders it twice while the phone sheet is open (the desktop column and the sheet), so it carries no `id`.
 */
@Component({
  selector: 'app-home-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [
    provideIcons({ lucideBuilding2, lucideHouse, lucideSearch, lucideShirt, lucideTrophy }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      routerLink="/"
      class="flex min-h-11 items-center gap-2 rounded-lg px-2 text-base font-semibold hover:bg-muted"
    >
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
        ><ng-icon name="lucideTrophy" class="text-lg" aria-hidden="true" /></span
      >Omni League</a
    >
    <nav aria-label="Your account" class="mt-5 flex flex-col gap-5">
      <ul role="list" class="flex flex-col gap-0.5">
        <li>
          <a
            [routerLink]="homePath"
            [attr.aria-current]="onHome() ? 'page' : null"
            [class]="onHome() ? currentRow : row"
            ><ng-icon
              name="lucideHouse"
              [class]="onHome() ? currentIcon : icon"
              aria-hidden="true"
            /><span class="min-w-0 flex-1 truncate">Home</span></a
          >
        </li>
        <li>
          <a [routerLink]="findPath" [class]="row"
            ><ng-icon name="lucideSearch" [class]="icon" aria-hidden="true" /><span
              class="min-w-0 flex-1 truncate"
              >Find a league</span
            ></a
          >
        </li>
      </ul>
      @if (teams().length > 0) {
        <div>
          <p [class]="groupLabel">Your teams</p>
          <ul role="list" aria-label="Your teams" class="mt-1 flex flex-col gap-0.5">
            @for (team of teams(); track team.teamId) {
              <li>
                <a
                  [routerLink]="team.segments"
                  [attr.aria-current]="team.current ? 'page' : null"
                  [class]="team.current ? currentRow : row"
                  ><ng-icon
                    name="lucideShirt"
                    [class]="team.current ? currentIcon : icon"
                    aria-hidden="true"
                  /><span class="min-w-0 flex-1 truncate">{{ team.teamName }}</span></a
                >
              </li>
            }
          </ul>
        </div>
      }
      @if (organizations().length > 0) {
        <div>
          <p [class]="groupLabel">Your organizations</p>
          <ul role="list" aria-label="Your organizations" class="mt-1 flex flex-col gap-0.5">
            @for (organization of organizations(); track organization.slug) {
              <li>
                <a [routerLink]="organization.path" [class]="row"
                  ><ng-icon name="lucideBuilding2" [class]="icon" aria-hidden="true" /><span
                    class="min-w-0 flex-1 truncate"
                    >{{ organization.name }}</span
                  ></a
                >
              </li>
            }
          </ul>
        </div>
      }
      @if (loading()) {
        <div>
          <p role="status" class="sr-only">Loading your teams and organizations.</p>
          <div
            aria-hidden="true"
            data-slot="skeleton"
            class="${SKELETON_CLASSES} mx-3 h-9 rounded-lg"
          ></div>
        </div>
      }
    </nav>
  `,
})
export class HomeSidebar {
  private readonly auth = inject(AuthService);
  private readonly url = injectCurrentUrl();

  private readonly mine = injectQuery(api.organizations.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly myTeams = injectQuery(api.teams.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly homePath = HOME_PATH;
  protected readonly findPath = '/leagues';
  protected readonly row = SIDEBAR_ROW;
  protected readonly currentRow = SIDEBAR_ROW_CURRENT;
  protected readonly icon = SIDEBAR_ICON;
  protected readonly currentIcon = SIDEBAR_ICON_CURRENT;
  protected readonly groupLabel = SIDEBAR_GROUP_LABEL;

  protected readonly onHome = computed(
    () => pathWithoutQueryOrTrailingSlash(this.url()) === HOME_PATH,
  );
  protected readonly loading = computed(
    () =>
      (this.mine.value() === undefined && this.mine.error() === undefined) ||
      (this.myTeams.value() === undefined && this.myTeams.error() === undefined),
  );
  protected readonly teams = computed(() => {
    const path = pathWithoutQueryOrTrailingSlash(this.url());
    return (this.myTeams.value() ?? []).map(({ teamId, teamName }) => ({
      teamId,
      teamName,
      // Segments, not a string, so the router encodes the id and it cannot change the path.
      segments: ['/app', 'teams', teamId],
      current: path === teamPath(teamId),
    }));
  });
  protected readonly organizations = computed(() =>
    (this.mine.value() ?? []).map(({ name, slug, role, leagues }) => {
      const first = leagues[0];
      const path =
        role === 'orgAdmin'
          ? adminPath(slug)
          : first
            ? `/app/organizations/${encodeURIComponent(slug)}/leagues/${encodeURIComponent(first.slug)}`
            : `/organizations/${encodeURIComponent(slug)}`;
      return { name, slug, path };
    }),
  );
}
