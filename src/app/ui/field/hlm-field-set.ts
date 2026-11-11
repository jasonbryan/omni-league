import { Directive, input } from '@angular/core';

export const FIELD_SET_CLASSES =
  'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3';

export const FIELD_LEGEND_CLASSES =
  'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base';

@Directive({
  selector: 'fieldset[hlmFieldSet]',
  host: { 'data-slot': 'field-set', class: FIELD_SET_CLASSES },
})
export class HlmFieldSet {}

export type FieldLegendVariant = 'label' | 'legend';

@Directive({
  selector: 'legend[hlmFieldLegend]',
  host: {
    'data-slot': 'field-legend',
    '[attr.data-variant]': 'variant()',
    class: FIELD_LEGEND_CLASSES,
  },
})
export class HlmFieldLegend {
  readonly variant = input<FieldLegendVariant>('legend');
}
