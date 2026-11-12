// Vendored from spartan helm v1.9.0 (`libs/helm/alert`: alert, alert title, alert description), with the Nova style's classes
// (`libs/registry/src/styles/style-nova.css`) inlined in place of its `spartan-alert-*` names.
// Local changes, to keep when re-copying from upstream:
// - no `hlmAlertAction`, which no alert uses;
// - no host `role`: upstream sets `role="alert"` on every alert, and here each use sets its own (`status`, `alert`, `note`, or none);
// - static classes, so a chunk that uses them carries no class-merging code: the alert picks one string by variant through a
//   `[class]` host binding, and the title and description set one host `class` each, in place of `cva()` and `classes()`;
import { HlmAlert } from './hlm-alert';
import { HlmAlertDescription } from './hlm-alert-description';
import { HlmAlertTitle } from './hlm-alert-title';

export * from './hlm-alert';
export * from './hlm-alert-description';
export * from './hlm-alert-title';

export const HlmAlertImports = [HlmAlert, HlmAlertDescription, HlmAlertTitle] as const;
