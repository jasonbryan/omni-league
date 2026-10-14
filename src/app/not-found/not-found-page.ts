import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';
import { NotFoundView } from './not-found-view';

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
