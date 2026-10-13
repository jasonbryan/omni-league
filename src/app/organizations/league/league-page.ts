import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from '../admin/admin-sidebar';
import { LeagueContext } from './league-context';
import { LeagueLoading } from './league-loading';
import { LeagueManagement } from './league-management';
import { LeagueNoAccess } from './league-no-access';
import { leaguePath } from './league-path';
import { LeagueSidebar } from './league-sidebar';

/**
 * The league management page, `/app/organizations/:orgSlug/leagues/:leagueSlug` (#125), a
 * `RenderMode.Client` route behind `requireSignedIn`; approved in
 * design/mockups/125-126-seasons.html. Unlike the admin area (#65) it admits the league's assigned
 * league organizers as well as org admins. It asks one question before anything else:
 * `leagues.getOrganizerContext` (`LeagueContext`).
 *
 * - Org admin: the app shell with the admin sidebar (Leagues highlighted), and the page.
 * - League organizer: the app shell with the league organizer's sidebar, and the same page.
 * - `null` (unknown organization or league, or a draft league for someone who is not staff): #23's
 *   not-found view, top bar only.
 * - `FORBIDDEN`: the no-access view, top bar only.
 * - Pending: the loading view; any other failure: the temporarily-unavailable view.
 *
 * Only the `ready` state renders the page, so no season data is requested before the caller is
 * known to organize this league.
 */
@Component({
  selector: 'app-league-page',
  imports: [
    AdminSidebar,
    LeagueLoading,
    LeagueManagement,
    LeagueNoAccess,
    LeagueSidebar,
    NotFoundView,
    ServerErrorView,
    Shell,
    ShellSidebar,
  ],
  providers: [LeagueContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @switch (context.state()) {
        @case ('ready') {
          @if (context.league(); as league) {
            <ng-template appShellSidebar>
              @if (league.role === 'orgAdmin') {
                <app-admin-sidebar [organization]="league.organization" />
              } @else {
                <app-league-sidebar [league]="league" />
              }
            </ng-template>
          }
          <app-league-management />
        }
        @case ('loading') {
          <app-league-loading />
        }
        @case ('forbidden') {
          <app-league-no-access />
        }
        @case ('not-found') {
          <app-not-found-view />
        }
        @default {
          <app-server-error-view [retryHref]="path()" />
        }
      }
    </app-shell>
  `,
})
export class LeaguePage {
  protected readonly context = inject(LeagueContext);

  /** "Try again" for the failure view: this page, built from the route's slugs. */
  protected readonly path = computed(() =>
    leaguePath(this.context.orgSlug(), this.context.leagueSlug()),
  );
}
