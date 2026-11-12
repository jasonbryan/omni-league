import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LeagueSidebar } from '../league/league-sidebar';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from './admin-sidebar';
import { TournamentContext } from './tournament-context';
import { TournamentManagement } from './tournament-management';

@Component({
  selector: 'app-tournament-page',
  imports: [AdminSidebar, LeagueSidebar, Shell, ShellSidebar, TournamentManagement],
  providers: [TournamentContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell [sidebarPending]="context.state() === 'loading'">
      @if (context.tournament(); as tournament) {
        <ng-template appShellSidebar [appShellOrganizationName]="tournament.organization.name">
          @if (tournament.role === 'orgAdmin') {
            <app-admin-sidebar
              [organization]="{
                organizationId: tournament.organizationId,
                name: tournament.organization.name,
                slug: tournament.organization.slug,
              }"
            />
          } @else {
            <app-league-sidebar
              [organization]="tournament.organization"
              [here]="{ kind: 'tournament', name: tournament.name, slug: tournament.slug }"
            />
          }
        </ng-template>
      }
      <app-tournament-management />
    </app-shell>
  `,
})
export class TournamentPage {
  protected readonly context = inject(TournamentContext);
}
