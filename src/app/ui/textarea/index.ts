// Vendored from spartan helm v1.9.0 (`libs/helm/textarea`), with the Nova style's classes (`libs/registry/src/styles/style-nova.css`)
// inlined in place of `spartan-textarea`.
// Local changes, to keep when re-copying from upstream:
// - no `BrnTextarea` or `BrnFieldControlDescribedBy` host directive: the page sets `id`, `aria-invalid`, `aria-describedby`, and
//   `data-matches-spartan-invalid` itself, for the reason given in `src/app/ui/input`, so the `id` and `forceInvalid` inputs that
//   `BrnTextarea` exposes are gone too;
// - no outline reset and no focus border or ring classes: the solid `:focus-visible` outline in src/styles/base.css is the
//   focus indicator;
// - static classes, so a chunk that uses it carries no class-merging code.
// - the selector matches `textarea` elements only, and there is no `exportAs`.
import { HlmTextarea } from './hlm-textarea';

export * from './hlm-textarea';

export const HlmTextareaImports = [HlmTextarea] as const;
