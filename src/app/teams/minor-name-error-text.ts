import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MinorNameError } from './minor-name-form';

@Component({
  selector: 'app-minor-name-error-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @let shown = error();
    @if (shown.kind === 'inSeason') {
      <span
        ><strong class="font-semibold">{{ shown.minorName }}</strong> is already on
        {{ shown.teamName }} in this {{ shown.inTournament ? 'tournament' : 'season' }}.</span
      >
    } @else {
      <span>{{ shown.text }}</span>
    }
  `,
})
export class MinorNameErrorText {
  readonly error = input.required<MinorNameError>();
}
