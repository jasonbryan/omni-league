import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Shell } from '../shell';
import { ShellSidebar } from '../shell-sidebar';
import { TopBarAccount } from '../top-bar-account';

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

@Component({
  selector: 'app-sidebar-test-page',
  imports: [Shell, ShellSidebar],
  template: `
    <app-shell>
      <ng-template appShellSidebar appShellSidebarTitle="Test organization">
        <nav aria-label="Test organization">
          <a class="sidebar-link" href="/organizations/test#row-2">Row 2</a>
          <a class="other-path" href="/elsewhere?x=1#top">Elsewhere</a>
          <a class="other-site" href="https://example.com/a?b=1#c">Another site</a>
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

@Component({
  selector: 'app-pending-test-page',
  imports: [Shell],
  template: `
    <app-shell [sidebarPending]="true">
      <div><h1>Pending page</h1></div>
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingTestPage {}

/** The public top bar's account area, as the public layout draws it. */
@Component({
  selector: 'app-top-bar-test-page',
  imports: [RouterLink, TopBarAccount],
  template: `
    <header>
      <a routerLink="/">Omni League</a>
      <app-top-bar-account />
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopBarTestPage {}
