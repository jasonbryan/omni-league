import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicLayout } from '../public-layout/public-layout';
import { NotFoundView } from './not-found-view';

/**
 * The router `**` route: the not-found view in the public layout, for every unknown
 * path outside `/app` (`AppNotFoundPage` serves `/app/**`). The view sets the 404 status and the
 * title.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [NotFoundView, PublicLayout],
  template: `
    <app-public-layout>
      <app-not-found-view />
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
