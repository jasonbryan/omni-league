import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LeagueSidebar } from '../league/league-sidebar';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from './admin-sidebar';
import { CampAddSessionLanding } from './camp-add-session-landing';
import { CampContext } from './camp-context';
import { CampManagement } from './camp-management';

@Component({
  selector: 'app-camp-page',
  imports: [AdminSidebar, LeagueSidebar, Shell, ShellSidebar, CampManagement],
  providers: [CampContext, CampAddSessionLanding],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell [sidebarPending]="context.state() === 'loading'">
      @if (context.camp(); as camp) {
        <ng-template appShellSidebar [appShellOrganizationName]="camp.organization.name">
          @if (camp.role === 'orgAdmin') {
            <app-admin-sidebar
              [organization]="{
                organizationId: camp.organizationId,
                name: camp.organization.name,
                slug: camp.organization.slug,
              }"
            />
          } @else {
            <app-league-sidebar [organization]="camp.organization" [here]="camp" hereKind="camp" />
          }
        </ng-template>
      }
      <app-camp-management />
    </app-shell>
  `,
})
export class CampPage {
  protected readonly context = inject(CampContext);
}
