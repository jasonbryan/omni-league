import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { AdminContext } from './admin-context';
import { adminPath } from './admin-path';
import { AdminLoading } from './admin-loading';
import { AdminNoAccess } from './admin-no-access';
import { AdminSidebar } from './admin-sidebar';

/**
 * The organization admin area, `/app/organizations/:slug` (#65), a `RenderMode.Client` route behind
 * `requireSignedIn`; approved in design/mockups/65-organization-admin-locations.html. It is the
 * parent of every admin page (Overview and Locations now, Leagues in #66, Staff in #67) and asks
 * one question before any of them exists: `organizations.getAdminContext` (`AdminContext`).
 *
 * - Org admin: the app shell with the admin sidebar, and the child page in `<main>`.
 * - `null` (unknown slug): #23's not-found view, top bar only.
 * - `FORBIDDEN`: the no-access view, top bar only.
 * - Pending: the loading view; any other failure: the temporarily-unavailable view.
 *
 * Only the `ready` state renders the outlet, so no child page asks for data before the caller is
 * known to be an org admin of this organization.
 */
@Component({
  selector: 'app-admin-area',
  imports: [
    AdminLoading,
    AdminNoAccess,
    AdminSidebar,
    NotFoundView,
    RouterOutlet,
    ServerErrorView,
    Shell,
    ShellSidebar,
  ],
  providers: [AdminContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @switch (context.state()) {
        @case ('ready') {
          @if (context.organization(); as organization) {
            <ng-template appShellSidebar>
              <app-admin-sidebar [organization]="organization" />
            </ng-template>
          }
          <router-outlet />
        }
        @case ('loading') {
          <app-admin-loading />
        }
        @case ('forbidden') {
          <app-admin-no-access />
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
export class AdminArea {
  protected readonly context = inject(AdminContext);

  /** "Try again" for the failure view: the Overview, built from the route's slug. */
  protected readonly path = computed(() => adminPath(this.context.slug()));
}
