import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from '../admin/admin-sidebar';
import { LeagueNoAccess } from '../league/league-no-access';
import { LeagueSidebar } from '../league/league-sidebar';
import { SeasonContext } from './season-context';
import { SeasonLoading } from './season-loading';
import { SeasonManagement } from './season-management';
import { seasonManagementPath } from './season-management-path';

@Component({
  selector: 'app-season-page',
  imports: [
    AdminSidebar,
    LeagueNoAccess,
    LeagueSidebar,
    NotFoundView,
    SeasonLoading,
    SeasonManagement,
    ServerErrorView,
    Shell,
    ShellSidebar,
  ],
  providers: [SeasonContext],
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
                <app-league-sidebar
                  [organization]="league.organization"
                  [here]="{ kind: 'league', name: league.name, slug: league.slug }"
                  current="true"
                />
              }
            </ng-template>
          }
          <app-season-management />
        }
        @case ('loading') {
          <app-season-loading />
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
export class SeasonPage {
  protected readonly context = inject(SeasonContext);

  protected readonly path = computed(() =>
    seasonManagementPath(
      this.context.orgSlug(),
      this.context.leagueSlug(),
      this.context.seasonSlug(),
    ),
  );
}
