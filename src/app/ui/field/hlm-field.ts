import { Directive } from '@angular/core';

export const FIELD_GROUP_CLASSES =
  'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4';

export const FIELD_CLASSES =
  'group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2';

export const FIELD_LABEL_CLASSES =
  'flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5';

export const FIELD_DESCRIPTION_CLASSES =
  'text-muted-foreground text-start text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-data-horizontal/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4';

export const FIELD_ERROR_CLASSES = 'text-destructive text-sm font-normal flex items-start gap-1.5';

@Directive({
  selector: '[hlmFieldGroup]',
  host: { 'data-slot': 'field-group', class: FIELD_GROUP_CLASSES },
})
export class HlmFieldGroup {}

@Directive({
  selector: '[hlmField]',
  host: {
    role: 'group',
    'data-slot': 'field',
    'data-orientation': 'vertical',
    class: FIELD_CLASSES,
  },
})
export class HlmField {}

@Directive({
  selector: 'label[hlmFieldLabel]',
  host: { 'data-slot': 'field-label', class: FIELD_LABEL_CLASSES },
})
export class HlmFieldLabel {}

@Directive({
  selector: '[hlmFieldDescription]',
  host: { 'data-slot': 'field-description', class: FIELD_DESCRIPTION_CLASSES },
})
export class HlmFieldDescription {}

@Directive({
  selector: '[hlmFieldError]',
  host: { role: 'alert', 'data-slot': 'field-error', class: FIELD_ERROR_CLASSES },
})
export class HlmFieldError {}
