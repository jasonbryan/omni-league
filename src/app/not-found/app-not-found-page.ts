import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';
import { NotFoundView } from './not-found-view';

/**
 * The `**` route inside `/app`: the not-found view in the app shell, top bar only (no
 * sidebar template), for a signed-in area path that does not exist. A Client route
 * (app.routes.server.ts). Every other unknown path renders `NotFoundPage` in the public layout.
 */
@Component({
  selector: 'app-app-not-found-page',
  imports: [NotFoundView, Shell],
  template: `
    <app-shell>
      <app-not-found-view />
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppNotFoundPage {}
