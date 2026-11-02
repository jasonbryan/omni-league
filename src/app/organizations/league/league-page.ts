import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from '../admin/admin-sidebar';
import { LeagueContext } from './league-context';
import { LeagueLanding } from './league-landing';
import { LeagueLoading } from './league-loading';
import { LeagueManagement } from './league-management';
import { LeagueNoAccess } from './league-no-access';
import { leaguePath } from './league-path';
import { LeagueSidebar } from './league-sidebar';

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
  providers: [LeagueContext, LeagueLanding],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell [sidebarPending]="context.state() === 'loading'">
      @switch (context.state()) {
        @case ('ready') {
          @if (context.league(); as league) {
            <ng-template appShellSidebar [appShellOrganizationName]="league.organization.name">
              @if (league.role === 'orgAdmin') {
                <app-admin-sidebar
                  [organization]="{
                    organizationId: league.organizationId,
                    name: league.organization.name,
                    slug: league.organization.slug,
                  }"
                />
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

  constructor() {
    // Providers are created on first use; the landing must listen from the arrival, not from when the league loads.
    inject(LeagueLanding);
  }

  protected readonly path = computed(() =>
    leaguePath(this.context.orgSlug(), this.context.leagueSlug()),
  );
}
