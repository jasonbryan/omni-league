import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo } from '@ng-icons/lucide';
import { FIELD_NOTE } from './field-classes';

export interface FieldNote {
  kind: 'changed' | 'rename';
  value: string | null;
}

export function fieldNoteText({ kind, value }: FieldNote): string {
  if (value === null) return 'Someone else cleared this. Saving keeps yours.';
  const changed = `Someone else changed this to "${value}".`;
  return kind === 'rename'
    ? `${changed} The name you typed did not change it.`
    : `${changed} Saving keeps yours.`;
}

@Component({
  selector: 'app-field-note',
  imports: [NgIcon],
  providers: [provideIcons({ lucideInfo })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p data-slot="field-note" [id]="id()" [class]="noteClass">
      <ng-icon name="lucideInfo" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
      <span>{{ text() }}</span>
    </p>
  `,
})
export class FieldNoteText {
  readonly id = input.required<string>();
  readonly note = input.required<FieldNote>();

  protected readonly noteClass = FIELD_NOTE;
  protected readonly text = computed(() => fieldNoteText(this.note()));
}
