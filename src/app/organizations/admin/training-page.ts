import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LeagueSidebar } from '../league/league-sidebar';
import { Shell, ShellSidebar } from '../../shell';
import { AdminSidebar } from './admin-sidebar';
import { TrainingScheduleLanding } from './training-schedule-landing';
import { TrainingContext } from './training-context';
import { TrainingManagement } from './training-management';

@Component({
  selector: 'app-training-page',
  imports: [AdminSidebar, LeagueSidebar, Shell, ShellSidebar, TrainingManagement],
  providers: [TrainingContext, TrainingScheduleLanding],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell [sidebarPending]="context.state() === 'loading'">
      @if (context.training(); as training) {
        <ng-template appShellSidebar>
          @if (training.role === 'orgAdmin') {
            <app-admin-sidebar
              [organization]="{
                organizationId: training.organizationId,
                name: training.organization.name,
                slug: training.organization.slug,
              }"
            />
          } @else {
            <app-league-sidebar
              [organization]="training.organization"
              [here]="training"
              hereKind="training"
            />
          }
        </ng-template>
      }
      <app-training-management />
    </app-shell>
  `,
})
export class TrainingPage {
  protected readonly context = inject(TrainingContext);
}
