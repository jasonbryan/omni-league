import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideHistory } from '@ng-icons/lucide';
import { formatSavedTime } from './saved-time';

/** It renders only in the browser: a page shows it only for `QueryRef.savedAt`, which the server never sets. */
@Component({
  selector: 'app-saved-copy-note',
  imports: [NgIcon],
  providers: [provideIcons({ lucideHistory })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p data-saved-copy-note class="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
      <ng-icon name="lucideHistory" class="mt-0.5 shrink-0 text-base" aria-hidden="true" /><span
        ><span class="font-medium text-foreground">Saved copy</span> from
        <time [attr.datetime]="time().datetime">{{ time().text }}</time
        >. It may have changed since.</span
      >
    </p>
  `,
})
export class SavedCopyNote {
  readonly savedAt = input.required<number>();

  protected readonly time = computed(() => formatSavedTime(this.savedAt(), Date.now()));
}
