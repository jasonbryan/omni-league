// Static strings, so Angular sets them before the element is inserted and the admin chunks load no class-merging code (`../../ui/utils`).

export const RADIO_ITEM =
  'group/radio relative mt-0.5 flex size-4 shrink-0 rounded-full border has-checked:border-primary has-checked:bg-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
export const RADIO_EDGE = 'border-input';
export const RADIO_EDGE_INVALID = 'border-destructive';

export const RADIO_INPUT =
  'absolute inset-0 m-0 size-full cursor-default appearance-none rounded-full opacity-0';

export const RADIO_INDICATOR =
  'pointer-events-none absolute start-1/2 top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground group-has-checked/radio:block';
