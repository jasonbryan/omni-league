import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideGlobe,
  lucideLayoutDashboard,
  lucideMapPin,
  lucideTrophy,
  lucideUsers,
} from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import { initials } from '../initials';
import type { AdminOrganization } from './admin-context';
import { adminPath } from './admin-path';

const CURRENT =
  'flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';
const OTHER =
  'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';

function pathOf(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The shell renders this twice while the phone sheet is open (the desktop column and the sheet), so it carries no `id`. */
@Component({
  selector: 'app-admin-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideGlobe,
      lucideLayoutDashboard,
      lucideMapPin,
      lucideTrophy,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="organization().name + ' admin'" class="flex flex-col gap-6">
      <div class="flex items-center gap-3 px-2">
        <span
          aria-hidden="true"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
          >{{ initials() }}</span
        >
        <div class="min-w-0">
          <p class="text-sm/tight font-semibold">{{ organization().name }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">Admin area</p>
        </div>
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        @for (link of sections(); track link.label) {
          <li>
            <a
              [routerLink]="link.path"
              [attr.aria-current]="link.current"
              [class]="link.current ? current : other"
              ><ng-icon
                [name]="link.icon"
                [class]="
                  link.current ? 'shrink-0 text-base' : 'shrink-0 text-base text-muted-foreground'
                "
                aria-hidden="true"
              />{{ link.label }}</a
            >
          </li>
        }
      </ul>
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
export class AdminSidebar {
  private readonly router = inject(Router);

  readonly organization = input.required<Pick<AdminOrganization, 'name' | 'slug'>>();

  protected readonly current = CURRENT;
  protected readonly other = OTHER;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly initials = computed(() => initials(this.organization().name));
  protected readonly publicPath = computed(
    () => `/organizations/${encodeURIComponent(this.organization().slug)}`,
  );

  protected readonly sections = computed(() => {
    const { slug } = this.organization();
    const here = pathOf(this.url());
    const ariaCurrentFor = (path: string, includeChildren = false): 'page' | 'true' | null =>
      here === path ? 'page' : includeChildren && here.startsWith(`${path}/`) ? 'true' : null;
    return [
      { label: 'Overview', icon: 'lucideLayoutDashboard', path: adminPath(slug) },
      { label: 'Locations', icon: 'lucideMapPin', path: adminPath(slug, 'locations') },
      { label: 'Leagues', icon: 'lucideTrophy', path: adminPath(slug, 'leagues') },
      { label: 'Staff', icon: 'lucideUsers', path: adminPath(slug, 'staff') },
    ].map((link) => ({ ...link, current: ariaCurrentFor(link.path, link.label === 'Leagues') }));
  });
}
