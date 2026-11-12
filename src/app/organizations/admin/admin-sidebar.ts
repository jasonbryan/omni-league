import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBuilding2,
  lucideChevronsUpDown,
  lucideGlobe,
  lucideLayoutDashboard,
  lucideMapPin,
  lucideSwords,
  lucideTrophy,
  lucideUsers,
} from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import {
  SIDEBAR_GROUP_LABEL,
  SIDEBAR_HEAD_LINK,
  SIDEBAR_ICON,
  SIDEBAR_ICON_CURRENT,
  SIDEBAR_MARK,
  SIDEBAR_ROW,
  SIDEBAR_ROW_CURRENT,
} from '../../shell/sidebar-classes';
import { pathWithoutQueryOrTrailingSlash } from '../../shell/url-path';
import { initials } from '../initials';
import { injectAdminCounts } from './admin-counts';
import type { AdminOrganization } from './admin-context';
import { adminPath } from './admin-path';

/** The shell renders this twice while the phone sheet is open (the desktop column and the sheet), so it carries no `id`. */
@Component({
  selector: 'app-admin-sidebar',
  imports: [NgIcon, NgTemplateOutlet, RouterLink],
  providers: [
    provideIcons({
      lucideBuilding2,
      lucideChevronsUpDown,
      lucideGlobe,
      lucideLayoutDashboard,
      lucideMapPin,
      lucideSwords,
      lucideTrophy,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="organization().name + ' admin'" class="flex flex-col gap-4">
      <a routerLink="/app" [class]="head"
        ><span aria-hidden="true" [class]="mark">{{ initials() }}</span
        ><span class="min-w-0 flex-1"
          ><span class="block truncate text-sm font-semibold">{{ organization().name }}</span
          ><span class="block text-xs text-muted-foreground">Switch organization</span></span
        ><ng-icon
          name="lucideChevronsUpDown"
          class="shrink-0 text-base text-muted-foreground"
          aria-hidden="true"
      /></a>
      <ul role="list" class="flex flex-col gap-0.5">
        <ng-container [ngTemplateOutlet]="rows" [ngTemplateOutletContext]="{ links: overview() }" />
      </ul>
      <div>
        <p [class]="groupLabel">Programs</p>
        <ul role="list" aria-label="Programs" class="mt-1 flex flex-col gap-0.5">
          <ng-container
            [ngTemplateOutlet]="rows"
            [ngTemplateOutletContext]="{ links: programs() }"
          />
        </ul>
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        <ng-container [ngTemplateOutlet]="rows" [ngTemplateOutletContext]="{ links: settings() }" />
      </ul>
      <ul role="list" class="flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
        <li>
          <a [routerLink]="publicPath()" [class]="row"
            ><ng-icon name="lucideGlobe" [class]="icon" aria-hidden="true" /><span
              class="min-w-0 flex-1 truncate"
              >View public page</span
            ></a
          >
        </li>
      </ul>
    </nav>
    <ng-template #rows let-links="links">
      @for (link of links; track link.label) {
        <li>
          <a
            [routerLink]="link.path"
            [attr.aria-current]="link.current"
            [class]="link.current ? currentRow : row"
            ><ng-icon
              [name]="link.icon"
              [class]="link.current ? currentIcon : icon"
              aria-hidden="true"
            /><span class="min-w-0 flex-1 truncate">{{ link.label }}</span>
            @if (link.count !== null) {
              <span class="text-xs tabular-nums text-muted-foreground">{{ link.count }}</span>
            }
          </a>
        </li>
      }
    </ng-template>
  `,
})
export class AdminSidebar {
  private readonly router = inject(Router);

  readonly organization =
    input.required<Pick<AdminOrganization, 'organizationId' | 'name' | 'slug'>>();

  protected readonly head = SIDEBAR_HEAD_LINK;
  protected readonly mark = SIDEBAR_MARK;
  protected readonly row = SIDEBAR_ROW;
  protected readonly currentRow = SIDEBAR_ROW_CURRENT;
  protected readonly groupLabel = SIDEBAR_GROUP_LABEL;
  protected readonly icon = SIDEBAR_ICON;
  protected readonly currentIcon = SIDEBAR_ICON_CURRENT;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private readonly counts = injectAdminCounts(() => this.organization().organizationId);

  protected readonly initials = computed(() => initials(this.organization().name));
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.organization().slug)}`,
  );

  private readonly links = computed(() => {
    const { slug } = this.organization();
    const here = pathWithoutQueryOrTrailingSlash(this.url());
    const ariaCurrentFor = (path: string, includeChildren = false): 'page' | 'true' | null =>
      here === path ? 'page' : includeChildren && here.startsWith(`${path}/`) ? 'true' : null;
    const link = (
      label: string,
      icon: string,
      section: string,
      count: number | null,
      includeChildren = false,
    ) => {
      const path = adminPath(slug, section);
      return { label, icon, path, count, current: ariaCurrentFor(path, includeChildren) };
    };
    return {
      overview: [link('Overview', 'lucideLayoutDashboard', '', null)],
      programs: [
        link('Leagues', 'lucideTrophy', 'leagues', this.counts.leagues(), true),
        link('Tournaments', 'lucideSwords', 'tournaments', null, true),
      ],
      settings: [
        link('Locations', 'lucideMapPin', 'locations', this.counts.locations()),
        link('Staff', 'lucideUsers', 'staff', this.counts.staff()),
        link('Details', 'lucideBuilding2', 'details', null),
      ],
    };
  });

  protected readonly overview = computed(() => this.links().overview);
  protected readonly programs = computed(() => this.links().programs);
  protected readonly settings = computed(() => this.links().settings);
}
