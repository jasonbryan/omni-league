// Static strings, so Angular sets them before the element is inserted and the admin chunks load no class-merging code (`../../ui/utils`).

export const FIELD =
  'group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2';

export const FIELD_HORIZONTAL =
  'group/field flex w-full flex-row items-center *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px data-[matches-spartan-invalid=true]:text-destructive gap-2';

export const FIELD_GROUP =
  'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4';

export const LABEL =
  'flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5';

export const INPUT =
  'file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm';

export const DESCRIPTION =
  'text-muted-foreground text-start text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-data-horizontal/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4';

export const FIELD_SET =
  'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3';

export const LEGEND =
  'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base';

export const FIELD_ERROR = 'text-destructive text-sm font-normal flex items-start gap-1.5';

export const FIELD_CONTENT = 'group/field-content flex flex-1 flex-col leading-snug gap-0.5';
