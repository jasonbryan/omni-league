import { booleanAttribute, Directive, input } from '@angular/core';
import { BrnRadioGroup } from '@spartan-ng/brain/radio-group';

export const RADIO_GROUP_CLASSES = 'grid gap-3';

@Directive({
  selector: '[hlmRadioGroup],hlm-radio-group',
  exportAs: 'hlmRadioGroup',
  hostDirectives: [
    {
      directive: BrnRadioGroup,
      inputs: ['name', 'value', 'disabled', 'required'],
      outputs: ['valueChange'],
    },
  ],
  host: { 'data-slot': 'radio-group', class: RADIO_GROUP_CLASSES },
})
export class HlmRadioGroup {
  readonly invalid = input(false, { transform: booleanAttribute });
}
