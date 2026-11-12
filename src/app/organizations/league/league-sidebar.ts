import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronsUpDown, lucideGlobe, lucideSwords, lucideTrophy } from '@ng-icons/lucide';
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
import { compareNames } from '../compare-names';
import { initials } from '../initials';
import { tournamentPath } from '../admin/tournament-path';
import { leaguePath } from './league-path';

interface Named {
  name: string;
  slug: string;
}

export type SidebarKind = 'league' | 'tournament';

function withPage(assigned: readonly Named[], page: Named | null): Named[] {
  return page === null || assigned.some((item) => item.slug === page.slug)
    ? [...assigned]
    : [...assigned, page].sort((x, y) => compareNames(x.name, y.name));
}

/** The shell renders this twice while the phone sheet is open (the desktop column and the sheet), so it carries no `id`: the list takes its name from `aria-label`. */
@Component({
  selector: 'app-league-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronsUpDown, lucideGlobe, lucideSwords, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="organization().name + ' ' + navTopic()" class="flex flex-col gap-4">
      <a routerLink="/app" [class]="head"
        ><span aria-hidden="true" [class]="mark">{{ initials() }}</span
        ><span class="min-w-0 flex-1"
          ><span class="block truncate text-sm font-semibold">{{ organization().name }}</span
          ><span class="block text-xs text-muted-foreground">League organizer</span></span
        ><ng-icon
          name="lucideChevronsUpDown"
          class="shrink-0 text-base text-muted-foreground"
          aria-hidden="true"
      /></a>
      @if (leagues().length > 0) {
        <div>
          <p [class]="groupLabel">Your leagues</p>
          <ul role="list" aria-label="Your leagues" class="mt-1 flex flex-col gap-0.5">
            @for (item of leagues(); track item.slug) {
              <li>
                <a
                  [routerLink]="item.path"
                  [attr.aria-current]="item.isCurrent ? current() : null"
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
      }
      @if (tournaments().length > 0) {
        <div>
          <p [class]="groupLabel">Your tournaments</p>
          <ul role="list" aria-label="Your tournaments" class="mt-1 flex flex-col gap-0.5">
            @for (item of tournaments(); track item.slug) {
              <li>
                <a
                  [routerLink]="item.path"
                  [attr.aria-current]="item.isCurrent ? current() : null"
                  [class]="item.isCurrent ? currentRow : row"
                  ><ng-icon
                    name="lucideSwords"
                    [class]="item.isCurrent ? currentIcon : icon"
                    aria-hidden="true"
                  /><span class="min-w-0 flex-1">{{ item.name }}</span></a
                >
              </li>
            }
          </ul>
        </div>
      }
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
  readonly organization = input.required<Named>();
  /** `organizations.listMine` stops at `LIST_MINE_LEAGUES_LIMIT` reads and may not have answered yet, so the current page's row is added here. */
  readonly here = input.required<Named>();
  readonly hereKind = input.required<SidebarKind>();
  /** `true` on a page inside the league, such as a season's, where the league's row is not the page itself. */
  readonly current = input<'page' | 'true'>('page');

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

  private readonly mineHere = computed(() =>
    this.mine.value()?.find((row) => row.slug === this.organization().slug),
  );

  protected readonly initials = computed(() => initials(this.organization().name));
  protected readonly leagues = computed(() => {
    const here = this.here();
    const kind = this.hereKind();
    const org = this.organization().slug;
    return withPage(this.mineHere()?.leagues ?? [], kind === 'league' ? here : null).map(
      (item) => ({
        name: item.name,
        slug: item.slug,
        path: leaguePath(org, item.slug),
        isCurrent: kind === 'league' && item.slug === here.slug,
      }),
    );
  });
  protected readonly tournaments = computed(() => {
    const here = this.here();
    const kind = this.hereKind();
    const org = this.organization().slug;
    return withPage(this.mineHere()?.tournaments ?? [], kind === 'tournament' ? here : null).map(
      (item) => ({
        name: item.name,
        slug: item.slug,
        path: tournamentPath(org, item.slug),
        isCurrent: kind === 'tournament' && item.slug === here.slug,
      }),
    );
  });
  protected readonly navTopic = computed(() =>
    this.tournaments().length === 0
      ? 'leagues'
      : this.leagues().length === 0
        ? 'tournaments'
        : 'leagues and tournaments',
  );
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.organization().slug)}`,
  );
}
