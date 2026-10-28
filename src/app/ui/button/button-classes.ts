// Constants, not `buttonVariants()` calls, so the admin and public page chunks load no class-merging code (`../utils`).
// The specs check them against `buttonVariants`, so a change to the helm button shows up there.
export const BUTTON_BASE =
  "data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0";

const SIZE = 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3';

export const OUTLINE_BUTTON = `${BUTTON_BASE} border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground ${SIZE}`;

export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-primary text-primary-foreground [a]:hover:bg-primary/90 ${SIZE}`;

export const PRIMARY_BUTTON_LARGE = `${BUTTON_BASE} bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-11 gap-2 px-5 has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4`;

export const SEARCH_BUTTON =
  'group/button inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-primary bg-clip-padding px-5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all select-none hover:bg-primary/90 active:translate-y-px [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0';

export const DESTRUCTIVE_BUTTON = `${BUTTON_BASE} bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30 ${SIZE}`;
