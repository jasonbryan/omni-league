import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicLayout } from '../public-layout/public-layout';

@Component({
  selector: 'app-placeholder',
  imports: [PublicLayout],
  template: `
    <app-public-layout>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Omni League</h1>
      </div>
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Placeholder {}
