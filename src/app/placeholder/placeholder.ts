import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Unstyled home placeholder (owner waived gate:ui-design for exactly this heading, #10). */
@Component({
  selector: 'app-placeholder',
  template: '<h1>Omni</h1>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Placeholder {}
