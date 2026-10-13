// The mockups' classes for the publish confirmation (helm Nova alert dialog, size default), unmerged
// and as static strings, so the admin chunks load no class-merging code (button-classes.ts). Shared
// by the league dialog (#69) and the season dialog (#126). The mockups centre the content with
// `fixed` and a translate; here the CDK's global position strategy centres the pane, and the
// content is its normal-flow child, so the `role="alertdialog"` container that wraps it has the
// dialog's own box (a container around a fixed child has none, and reads as hidden).

export const ALERT_DIALOG_CONTENT =
  'group/alert-dialog-content grid w-[calc(100vw-2rem)] bg-popover text-popover-foreground ring-foreground/10 gap-4 rounded-xl p-4 ring-1 shadow-xl data-[size=default]:max-w-xs data-[size=default]:sm:max-w-sm';
export const ALERT_DIALOG_HEADER =
  'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-start sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]';
export const ALERT_DIALOG_MEDIA =
  "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(6)]";
export const ALERT_DIALOG_TITLE =
  'text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2';
export const ALERT_DIALOG_DESCRIPTION =
  'text-muted-foreground *:[a]:hover:text-foreground text-sm text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3 sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2';
export const ALERT_DIALOG_FOOTER =
  'bg-muted/50 -mx-4 -mb-4 rounded-b-xl border-t p-4 flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end';
