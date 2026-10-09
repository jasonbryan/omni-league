import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Home placeholder: the `home` state of design/mockups/61-token-sheet.html, approved through
 * gate:ui-design in #73 (tokens and base styles only, no app shell; #75 adds the shell).
 */
@Component({
  selector: 'app-placeholder',
  template: `
    <main class="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-14">
      <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Omni League</h1>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Placeholder {}
