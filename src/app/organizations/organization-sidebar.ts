import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLayoutDashboard, lucideMapPin, lucideTrophy } from '@ng-icons/lucide';
import { organizationPath, type PublicOrganizationPage } from './organization-path';

/** Up to two letters for the initials tile: the first letter or digit of the first two words. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * The organization page's sidebar content (#60, #73 decision 3), rendered in the app shell's
 * sidebar slot: the initials tile and the name, Overview (the current page), then the leagues and
 * the locations, each a link to its row on this page until league and location pages exist.
 *
 * The shell renders this twice while the phone sheet is open (the desktop column and the sheet),
 * so it carries no `id`, and its groups are labelled with `aria-label`. Each `href` is built from
 * the query result's slug (`organizationPath`), so it never holds the request's query string.
 */
@Component({
  selector: 'app-organization-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideLayoutDashboard, lucideMapPin, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="page().name" class="flex flex-col gap-6">
      <div class="flex items-center gap-3 px-2">
        <span
          aria-hidden="true"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
          >{{ initials() }}</span
        >
        <div class="min-w-0">
          <p class="text-sm/tight font-semibold">{{ page().name }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">Organization</p>
        </div>
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        <li>
          <a
            [routerLink]="path()"
            aria-current="page"
            class="flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground"
            ><ng-icon
              name="lucideLayoutDashboard"
              class="shrink-0 text-base"
              aria-hidden="true"
            />Overview</a
          >
        </li>
      </ul>
      <div>
        <p class="px-2 text-xs font-medium text-muted-foreground">Leagues</p>
        @if (leagues().length) {
          <ul role="list" aria-label="Leagues" class="mt-1 flex flex-col gap-0.5">
            @for (link of leagues(); track link.href) {
              <li>
                <a
                  [href]="link.href"
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
                  ><ng-icon
                    name="lucideTrophy"
                    class="shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  /><span class="min-w-0">{{ link.name }}</span></a
                >
              </li>
            }
          </ul>
        } @else {
          <p class="mt-1 px-2 py-1.5 text-sm text-muted-foreground">None yet</p>
        }
      </div>
      <div>
        <p class="px-2 text-xs font-medium text-muted-foreground">Locations</p>
        @if (locations().length) {
          <ul role="list" aria-label="Locations" class="mt-1 flex flex-col gap-0.5">
            @for (link of locations(); track link.href) {
              <li>
                <a
                  [href]="link.href"
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
                  ><ng-icon
                    name="lucideMapPin"
                    class="shrink-0 text-base text-muted-foreground"
                    aria-hidden="true"
                  /><span class="min-w-0">{{ link.name }}</span></a
                >
              </li>
            }
          </ul>
        } @else {
          <p class="mt-1 px-2 py-1.5 text-sm text-muted-foreground">None yet</p>
        }
      </div>
    </nav>
  `,
})
export class OrganizationSidebar {
  readonly page = input.required<PublicOrganizationPage>();

  protected readonly path = computed(() => organizationPath(this.page().slug));
  protected readonly initials = computed(() => initials(this.page().name));
  /** One link per league, to `#league-<n>` in the sorted order, as the page content numbers them. */
  protected readonly leagues = computed(() =>
    this.page().leagues.map((league, i) => ({
      name: league.name,
      href: `${this.path()}#league-${i + 1}`,
    })),
  );
  protected readonly locations = computed(() =>
    this.page().locations.map((location, i) => ({
      name: location.name,
      href: `${this.path()}#location-${i + 1}`,
    })),
  );
}
