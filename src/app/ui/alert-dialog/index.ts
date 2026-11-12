// Vendored from spartan helm v1.9.0 (`libs/helm/alert-dialog`: content, header, media, title, description, footer), with the Nova
// style's classes (`libs/registry/src/styles/style-nova.css`) inlined in place of its `spartan-alert-dialog-*` names.
// Local changes, to keep when re-copying from upstream:
// - not copied: `hlm-alert-dialog` and `hlm-alert-dialog-overlay`, because `ConfirmDialog` keeps brain's `brn-alert-dialog` with
//   its own inputs and the phone-menu sheet's scrim in place of helm's `hlm()` overlay; `hlm-alert-dialog-action` and
//   `hlm-alert-dialog-cancel`, which wrap `HlmButton`, because the dialogs' buttons use the `button-classes.ts` constants; and the
//   portal and trigger, because the dialogs open through `open()`;
// - static classes, so a chunk that uses them carries no class-merging code: one host `class` per part, in place of `classes()`;
// - the content takes Nova's colours, ring, radius, padding, gap, and widths, plus `shadow-xl`, and leaves out Nova's open and close
//   animation and helm's outline reset;
// - the media is `bg-accent text-accent-foreground`, where Nova's is `bg-muted`;
import { HlmAlertDialogContent } from './hlm-alert-dialog-content';
import { HlmAlertDialogDescription } from './hlm-alert-dialog-description';
import { HlmAlertDialogFooter } from './hlm-alert-dialog-footer';
import { HlmAlertDialogHeader } from './hlm-alert-dialog-header';
import { HlmAlertDialogMedia } from './hlm-alert-dialog-media';
import { HlmAlertDialogTitle } from './hlm-alert-dialog-title';

export * from './hlm-alert-dialog-content';
export * from './hlm-alert-dialog-description';
export * from './hlm-alert-dialog-footer';
export * from './hlm-alert-dialog-header';
export * from './hlm-alert-dialog-media';
export * from './hlm-alert-dialog-title';

export const HlmAlertDialogImports = [
  HlmAlertDialogContent,
  HlmAlertDialogDescription,
  HlmAlertDialogFooter,
  HlmAlertDialogHeader,
  HlmAlertDialogMedia,
  HlmAlertDialogTitle,
] as const;
