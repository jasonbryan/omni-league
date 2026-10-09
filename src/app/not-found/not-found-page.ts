import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';
import { NotFoundView } from './not-found-view';

/**
 * The router `**` route (#23): the not-found view in the app shell, top bar only (no sidebar
 * template, #73 decision 2). The view sets the 404 status and the title.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [NotFoundView, Shell],
  template: `
    <app-shell>
      <app-not-found-view />
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
