// The class strings of the admin area's buttons and links, as design/mockups/65-organization-
// admin-locations.html draws them: helm's `buttonVariants` output unmerged (helm Nova, with #61's
// focus change). They are constants, not `buttonVariants()` calls, so the admin chunks load no
// class-merging code (`../../ui/utils`). button-classes.spec.ts checks them against
// `buttonVariants`, so a change to the helm button shows up there.
const BASE =
  "data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0";

const SIZE = 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3';

/** `hlmBtn variant="outline"`. */
export const OUTLINE_BUTTON = `${BASE} border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground ${SIZE}`;

/** `hlmBtn` (the default variant). */
export const PRIMARY_BUTTON = `${BASE} bg-primary text-primary-foreground [a]:hover:bg-primary/90 ${SIZE}`;
