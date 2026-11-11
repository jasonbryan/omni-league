// Vendored from spartan helm v1.9.0 (`libs/helm/input`), with the Nova style's classes (`libs/registry/src/styles/style-nova.css`)
// inlined in place of `spartan-input`.
// Local changes, to keep when re-copying from upstream:
// - no `BrnInput` or `BrnFieldControlDescribedBy` host directive: the page sets `id`, `aria-invalid`, `aria-describedby`, and
//   `data-matches-spartan-invalid` itself, because a field shows its error on leaving it and while a server refusal stands (ux.md,
//   Validation), which brain's error-state matcher does not follow;
// - `h-9` where Nova has `h-8`;
// - no outline reset and no focus border or ring classes: the solid `:focus-visible` outline in src/styles/base.css is the
//   focus indicator;
// - static classes, so a chunk that uses it carries no class-merging code.
// - the selector matches `input` elements only, and there is no `exportAs`.
import { HlmInput } from './hlm-input';

export * from './hlm-input';

export const HlmInputImports = [HlmInput] as const;
