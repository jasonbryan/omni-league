import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';

/**
 * Home placeholder: the `home-shell` state of design/mockups/61-token-sheet.html, approved through
 * gate:ui-design in #73. It renders in the app shell with the top bar only (no sidebar template).
 */
@Component({
  selector: 'app-placeholder',
  imports: [Shell],
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Omni League</h1>
      </div>
    </app-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Placeholder {}
