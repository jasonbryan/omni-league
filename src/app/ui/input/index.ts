// Vendored from spartan helm 1.6.0 (`libs/helm/input`), with the Nova style's classes inlined in place of `spartan-input`.
// Local changes, to keep when re-copying from upstream:
// - no `BrnInput` or `BrnFieldControlDescribedBy` host directive: the page sets `id`, `aria-invalid`, `aria-describedby`, and
//   `data-matches-spartan-invalid` itself, because a field shows its error on leaving it and while a server refusal stands (ux.md,
//   Validation), which brain's error-state matcher does not follow;
// - no `outline-none`: the solid `:focus-visible` outline in src/styles/base.css is the focus indicator;
// - static classes, so a chunk that uses it carries no class-merging code.
import { HlmInput } from './hlm-input';

export * from './hlm-input';

export const HlmInputImports = [HlmInput] as const;
