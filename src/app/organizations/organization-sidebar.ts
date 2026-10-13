import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLayoutDashboard, lucideMapPin, lucideTrophy } from '@ng-icons/lucide';
import { FollowLink, isPlainClick } from '../shell/follow-link';
import { organizationPath, type PublicOrganizationHeader } from './organization-path';
import { sportViewPath } from './sport-view/sport-view-path';

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
 * The organization's sidebar (#60, #73 decision 3; consolidated in #114, design/mockups/
 * 60-organization-page.html revision 4), rendered in the app shell's sidebar slot on the
 * organization page and on a sport view: the initials tile and the name, Overview, a "Sports"
 * group with one link per sport the organization has leagues in and its league count (each opens
 * that sport's view), and one Locations item with the total. It lists no league and no location:
 * a sport view lists the leagues, and the organization page lists the locations.
 *
 * `currentSport` is the URL segment of the sport view on screen, or `undefined` on the
 * organization page. That page is the current one (`aria-current="page"`): Overview on the
 * organization page, the sport on its view. Each sport's count is read after its name
 * ("Beach volleyball 12 leagues"); a screen-reader-only space keeps the name and the count apart
 * where the browser would join them.
 *
 * Locations is a link to `#locations` on the organization page. A server `href` never holds the
 * request's query string, so after hydration a plain click goes through `FollowLink.follow`: on the
 * organization page it keeps the visitor's query string (#95), and from a sport view it goes to the
 * organization page.
 *
 * The shell renders this twice while the phone sheet is open (the desktop column and the sheet),
 * so it carries no `id`, and its groups are labelled with `aria-label`. Each `href` is built from
 * the query result's slugs and segments, so it never holds the request's query string.
 */
@Component({
  selector: 'app-organization-sidebar',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideLayoutDashboard, lucideMapPin, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="organization().name" class="flex flex-col gap-6">
      <div class="flex items-center gap-3 px-2">
        <span
          aria-hidden="true"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
          >{{ initials() }}</span
        >
        <div class="min-w-0">
          <p class="text-sm/tight font-semibold">{{ organization().name }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">Organization</p>
        </div>
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        <li>
          <a
            [routerLink]="path()"
            [attr.aria-current]="currentSport() === undefined ? 'page' : null"
            [class]="currentSport() === undefined ? currentClass : linkClass"
            ><ng-icon
              name="lucideLayoutDashboard"
              [class]="
                currentSport() === undefined
                  ? 'shrink-0 text-base'
                  : 'shrink-0 text-base text-muted-foreground'
              "
              aria-hidden="true"
            /><span class="min-w-0">Overview</span></a
          >
        </li>
      </ul>
      <div>
        <p class="px-2 text-xs font-medium text-muted-foreground">Sports</p>
        @if (sports().length) {
          <ul role="list" aria-label="Sports" class="mt-1 flex flex-col gap-0.5">
            @for (sport of sports(); track sport.segment) {
              <li>
                <a
                  [routerLink]="sport.href"
                  [attr.aria-current]="sport.current ? 'page' : null"
                  [class]="sport.current ? currentClass : linkClass"
                  ><ng-icon
                    name="lucideTrophy"
                    [class]="
                      sport.current
                        ? 'shrink-0 text-base'
                        : 'shrink-0 text-base text-muted-foreground'
                    "
                    aria-hidden="true"
                  /><span class="min-w-0">{{ sport.name }}</span
                  ><span class="sr-only">&ngsp;</span
                  ><span
                    [class]="
                      sport.current
                        ? 'ms-auto text-xs tabular-nums'
                        : 'ms-auto text-xs tabular-nums text-muted-foreground'
                    "
                    >{{ sport.count }}<span class="sr-only"> {{ sport.countLabel }}</span></span
                  ></a
                >
              </li>
            }
          </ul>
        } @else {
          <p class="mt-1 px-2 py-1.5 text-sm text-muted-foreground">None yet</p>
        }
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        <li>
          <a [href]="locationsHref()" (click)="locationsClicked($event)" [class]="linkClass"
            ><ng-icon
              name="lucideMapPin"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            /><span class="min-w-0">Locations</span><span class="sr-only">&ngsp;</span
            ><span class="ms-auto text-xs tabular-nums text-muted-foreground"
              >{{ organization().locationCount
              }}<span class="sr-only">
                {{ organization().locationCount === 1 ? 'location' : 'locations' }}</span
              ></span
            ></a
          >
        </li>
      </ul>
    </nav>
  `,
})
export class OrganizationSidebar {
  private readonly followLink = inject(FollowLink);
  readonly organization = input.required<PublicOrganizationHeader>();
  /** The URL segment of the sport view on screen, or `undefined` on the organization page. */
  readonly currentSport = input<string | undefined>(undefined);

  protected readonly linkClass =
    'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';
  protected readonly currentClass =
    'flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';

  protected readonly path = computed(() => organizationPath(this.organization().slug));
  protected readonly locationsHref = computed(() => `${this.path()}#locations`);
  protected readonly initials = computed(() => initials(this.organization().name));
  protected readonly sports = computed(() =>
    this.organization().sports.map((sport) => ({
      name: sport.name,
      segment: sport.segment,
      href: sportViewPath(this.organization().slug, sport.segment),
      count: sport.leagueCount,
      countLabel: sport.leagueCount === 1 ? 'league' : 'leagues',
      current: sport.segment === this.currentSport(),
    })),
  );

  /**
   * A plain click on Locations goes through the router, to the current query string and
   * `#locations` on the organization page and to the organization page from a sport view, then
   * scrolls to the panel (`FollowLink.follow`). Any other click is left to the browser.
   */
  protected locationsClicked(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const link = event.currentTarget as HTMLAnchorElement | null;
    if (!link?.href) return;
    event.preventDefault();
    this.followLink.follow(link.href);
  }
}
