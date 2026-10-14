import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicLayout } from '../public-layout/public-layout';
import { NotFoundView } from './not-found-view';

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
