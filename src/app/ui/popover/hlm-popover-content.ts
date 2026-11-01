import { Directive, signal } from '@angular/core';
import { injectExposesStateProvider } from '@spartan-ng/brain/core';

// Vendored from spartan helm 1.6.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - one static class string in place of `classes()`, so a chunk with a popover carries no class-merging
//   code. Its look is the approved panel's (design/mockups/300-public-site-filters.html, state 3);
// - no `effect()` writing `data-state` with `Renderer2.setAttribute`: the host binding sets it.
@Directive({
  selector: '[hlmPopoverContent],hlm-popover-content',
  host: {
    'data-slot': 'popover-content',
    '[attr.data-state]': 'state()',
    class:
      'relative flex flex-col rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0',
  },
})
export class HlmPopoverContent {
  private readonly _stateProvider = injectExposesStateProvider({ host: true });
  public readonly state = this._stateProvider.state ?? signal('closed');
}
