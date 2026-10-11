// The class strings of the admin forms' fields, as design/mockups/66-69-organization-leagues.html
// draws them (helm Nova field, input, radio group, and checkbox group, with #61's focus change):
// static strings, so Angular sets them before the element is inserted and the admin chunks load no
// class-merging code (`../../ui/utils`).

export const FIELD =
  'group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2';

/** A radio or checkbox with its label, side by side. */
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

/** The wrapper of a radio's native input and its indicator; `invalid` swaps the edge colour. */
export const RADIO_ITEM =
  'group/radio relative mt-0.5 flex size-4 shrink-0 rounded-full border has-checked:border-primary has-checked:bg-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
export const RADIO_EDGE = 'border-input';
export const RADIO_EDGE_INVALID = 'border-destructive';

/** The native radio input, transparent over the indicator. */
export const RADIO_INPUT =
  'absolute inset-0 m-0 size-full cursor-default appearance-none rounded-full opacity-0';

export const RADIO_INDICATOR =
  'pointer-events-none absolute start-1/2 top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground group-has-checked/radio:block';

/** The helm badge, by variant (design/mockups/66-69-organization-leagues.html, "Status badge"). */
const BADGE =
  'group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)]';
export const BADGE_DEFAULT = `${BADGE} bg-primary text-primary-foreground [a]:hover:bg-primary/80`;
export const BADGE_SECONDARY = `${BADGE} bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80`;
export const BADGE_OUTLINE = `${BADGE} border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground`;
