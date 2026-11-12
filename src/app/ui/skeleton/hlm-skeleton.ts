import { Directive } from '@angular/core';

// Vendored from spartan helm 1.9.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - the Nova style's classes are inlined in place of `spartan-skeleton`, and `classes()` is a host `class`;
// - no `rounded-md` and no `block`: with no class merging, helm's `rounded-md` would beat the page's
//   `rounded-full` or `rounded-lg`, so the page sets the one radius class and its own display.
@Directive({
  selector: '[hlmSkeleton],hlm-skeleton',
  exportAs: 'hlmSkeleton',
  host: { class: 'bg-muted motion-safe:animate-pulse', 'data-slot': 'skeleton' },
})
export class HlmSkeleton {}
