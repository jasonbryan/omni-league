// Vendored from spartan helm 1.9.0 (`libs/helm/spinner`).
// Local changes, to keep when re-copying from upstream:
// - no `role="status"` or `aria-label`, and `aria-hidden="true"` on the host: the pending button's label names the state, and a
//   status inside the button would be announced a second time;
// - the icon is `lucideLoaderCircle`, the current Lucide name for upstream's `lucideLoader2`, and there is no `icon` input;
// - static classes in `SPINNER_CLASSES` in place of `classes()`, so a chunk that uses it carries no class-merging code, and
//   `text-base` (16px) in place of upstream's arbitrary font size, which would add a rule to the initial stylesheet.
// A pending button puts `data-icon="inline-start"` on the host, which the button classes read for the start padding.
import { HlmSpinner } from './hlm-spinner';

export * from './hlm-spinner';

export const HlmSpinnerImports = [HlmSpinner] as const;
