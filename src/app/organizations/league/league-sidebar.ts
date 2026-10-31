import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronsUpDown, lucideGlobe, lucideTrophy } from '@ng-icons/lucide';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import {
  SIDEBAR_GROUP_LABEL,
  SIDEBAR_HEAD_LINK,
  SIDEBAR_ICON,
  SIDEBAR_ICON_CURRENT,
  SIDEBAR_MARK,
  SIDEBAR_ROW,
  SIDEBAR_ROW_CURRENT,
} from '../../shell/sidebar-classes';
import { initials } from '../initials';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

const compareNames = (x: string, y: string) => {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};

/** The shell renders this twice while the phone sheet is open (the desktop column and the sheet), so it carries no `id`: the list takes its name from `aria-label`. */
@Component({
  selector: 'app-league-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronsUpDown, lucideGlobe, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="league().organization.name + ' leagues'" class="flex flex-col gap-4">
      <a routerLink="/app" [class]="head"
        ><span aria-hidden="true" [class]="mark">{{ initials() }}</span
        ><span class="min-w-0 flex-1"
          ><span class="block truncate text-sm font-semibold">{{ league().organization.name }}</span
          ><span class="block text-xs text-muted-foreground">League organizer</span></span
        ><ng-icon
          name="lucideChevronsUpDown"
          class="shrink-0 text-base text-muted-foreground"
          aria-hidden="true"
      /></a>
      <div>
        <p [class]="groupLabel">Your leagues</p>
        <ul role="list" aria-label="Your leagues" class="mt-1 flex flex-col gap-0.5">
          @for (item of leagues(); track item.slug) {
            <li>
              <a
                [routerLink]="item.path"
                [attr.aria-current]="item.isCurrent ? 'page' : null"
                [class]="item.isCurrent ? currentRow : row"
                ><ng-icon
                  name="lucideTrophy"
                  [class]="item.isCurrent ? currentIcon : icon"
                  aria-hidden="true"
                /><span class="min-w-0 flex-1">{{ item.name }}</span></a
              >
            </li>
          }
        </ul>
      </div>
      <ul role="list" class="flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
        <li>
          <a [routerLink]="publicPath()" [class]="row"
            ><ng-icon name="lucideGlobe" [class]="icon" aria-hidden="true" /><span
              class="min-w-0 flex-1 truncate"
              >Public page</span
            ></a
          >
        </li>
      </ul>
    </nav>
  `,
})
export class LeagueSidebar {
  readonly league = input.required<OrganizerLeague>();

  private readonly auth = inject(AuthService);

  protected readonly head = SIDEBAR_HEAD_LINK;
  protected readonly mark = SIDEBAR_MARK;
  protected readonly row = SIDEBAR_ROW;
  protected readonly currentRow = SIDEBAR_ROW_CURRENT;
  protected readonly icon = SIDEBAR_ICON;
  protected readonly currentIcon = SIDEBAR_ICON_CURRENT;
  protected readonly groupLabel = SIDEBAR_GROUP_LABEL;

  private readonly mine = injectQuery(api.organizations.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly initials = computed(() => initials(this.league().organization.name));
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
