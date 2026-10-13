import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideGlobe, lucideTrophy } from '@ng-icons/lucide';
import { initials } from '../organization-sidebar';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

const CURRENT =
  'flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';
const OTHER =
  'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';

/**
 * The sidebar of a league organizer on the league management page (#125;
 * design/mockups/125-126-seasons.html states 12 and 13), rendered in the app shell's sidebar slot:
 * the organization and "League organizer", "Your leagues" with the league being managed, then
 * Public page and Your organizations. A league organizer has no admin area (#65), so this
 * replaces the admin sidebar. Until #141 gives `organizations.listMine` the caller's assigned
 * leagues, "Your leagues" holds only the current league.
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
          <li>
            <a [routerLink]="path()" aria-current="page" [class]="current"
              ><ng-icon name="lucideTrophy" class="shrink-0 text-base" aria-hidden="true" /><span
                class="min-w-0"
                >{{ league().name }}</span
              ></a
            >
          </li>
        </ul>
      </div>
      <ul role="list" class="flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
        <li>
          <a [routerLink]="publicPath()" [class]="other"
            ><ng-icon
              name="lucideGlobe"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            />Public page</a
          >
        </li>
        <li>
          <a routerLink="/app" [class]="other"
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

  protected readonly current = CURRENT;
  protected readonly other = OTHER;

  protected readonly initials = computed(() => initials(this.league().organization.name));
  protected readonly path = computed(() =>
    leaguePath(this.league().organization.slug, this.league().slug),
  );
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.league().organization.slug)}`,
  );
}
