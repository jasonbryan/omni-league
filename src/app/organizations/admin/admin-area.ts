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

/** Only the `ready` state renders the outlet, so no child page asks for data before the caller is known to be an org admin of this organization. */
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

  protected readonly path = computed(() => adminPath(this.context.slug()));
}
