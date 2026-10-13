import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLayoutDashboard, lucideMapPin, lucideTrophy } from '@ng-icons/lucide';
import { organizationPath, type PublicOrganizationHeader } from '../organization-path';
import { initials } from '../organization-sidebar';

/**
 * The public league page's sidebar (#127; design/mockups/127-128-public-seasons.html, states 1 to
 * 3), rendered in the app shell's sidebar slot: the organization's initials tile and name,
 * Overview, its sports with their league counts, and Locations with its total. The league's sport
 * is the current section (`aria-current="true"`, the sidebar's decision 7), found by its display
 * name among the organization's sports; none is marked if the organization lists no such sport.
 *
 * The shell renders this twice while the phone sheet is open (the desktop column and the sheet),
 * so it carries no `id`, and its groups are labelled with `aria-label`. Each `href` is built from
 * the query results' slugs, so it never holds the request's query string.
 */
@Component({
  selector: 'app-public-league-sidebar',
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
            class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted"
            ><ng-icon
              name="lucideLayoutDashboard"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            /><span class="min-w-0">Overview</span></a
          >
        </li>
      </ul>
      <div>
        <p class="px-2 text-xs font-medium text-muted-foreground">Sports</p>
        <ul role="list" aria-label="Sports" class="mt-1 flex flex-col gap-0.5">
          @for (sport of sports(); track sport.segment) {
            <li>
              <span
                [attr.aria-current]="sport.current ? 'true' : null"
                [class]="sport.current ? currentClass : plainClass"
                ><ng-icon
                  name="lucideTrophy"
                  [class]="
                    sport.current
                      ? 'shrink-0 text-base'
                      : 'shrink-0 text-base text-muted-foreground'
                  "
                  aria-hidden="true"
                /><span class="min-w-0">{{ sport.name }}</span
                ><span
                  [class]="
                    sport.current
                      ? 'ms-auto text-xs tabular-nums'
                      : 'ms-auto text-xs tabular-nums text-muted-foreground'
                  "
                  >{{ sport.count }}<span class="sr-only"> {{ sport.countLabel }}</span></span
                ></span
              >
            </li>
          }
        </ul>
      </div>
      <ul role="list" class="flex flex-col gap-0.5">
        <li>
          <a [routerLink]="path()" fragment="locations" [class]="linkClass"
            ><ng-icon
              name="lucideMapPin"
              class="shrink-0 text-base text-muted-foreground"
              aria-hidden="true"
            /><span class="min-w-0">Locations</span
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
export class PublicLeagueSidebar {
  readonly organization = input.required<PublicOrganizationHeader>();
  /** The league's sport display name, whose entry among the organization's sports is current. */
  readonly sportName = input.required<string>();

  protected readonly linkClass =
    'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';
  /**
   * A sport is plain text until #114 adds the sport view, `/organizations/<org>/sports/<segment>`,
   * which the link would 404 on; #114 makes each a link (`linkClass`) again.
   */
  protected readonly plainClass =
    'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground';
  protected readonly currentClass =
    'flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';

  protected readonly path = computed(() => organizationPath(this.organization().slug));
  protected readonly initials = computed(() => initials(this.organization().name));
  protected readonly sports = computed(() =>
    this.organization().sports.map((sport) => ({
      name: sport.name,
      segment: sport.segment,
      count: sport.leagueCount,
      countLabel: sport.leagueCount === 1 ? 'league' : 'leagues',
      current: sport.name === this.sportName(),
    })),
  );
}
