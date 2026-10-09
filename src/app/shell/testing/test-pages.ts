import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';
import { ShellSidebar } from '../shell-sidebar';

/** Test-only page with no sidebar template, like the placeholder home and the not-found view. */
@Component({
  selector: 'app-plain-test-page',
  imports: [Shell],
  template: `
    <app-shell>
      <div><h1>Plain page</h1></div>
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlainTestPage {}

/** Test-only page that supplies a sidebar template, as an organization page does (#60). */
@Component({
  selector: 'app-sidebar-test-page',
  imports: [Shell, ShellSidebar],
  template: `
    <app-shell>
      <ng-template appShellSidebar>
        <nav aria-label="Test organization">
          <a class="sidebar-link" href="/organizations/test#row-2">Row 2</a>
        </nav>
      </ng-template>
      <div>
        <h1>Sidebar page</h1>
        <p id="row-2">Row 2</p>
      </div>
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarTestPage {}
