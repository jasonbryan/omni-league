import { Directive } from '@angular/core';
import { BrnOverlayService } from '@spartan-ng/brain/overlay';
import { BrnPopover } from '@spartan-ng/brain/popover';
import { provideSpartanOverlay } from '../utils/provide-spartan-overlay';

// Vendored from spartan helm 1.6.0. Local changes, to keep when re-copying from upstream:
// - the host provides the overlay default with `provideSpartanOverlay`, as `HlmSheet` does;
// - `id` and `role` pass through to brain, so a page can name the pane its trigger controls.
@Directive({
  selector: '[hlmPopover],hlm-popover',
  providers: [provideSpartanOverlay(BrnOverlayService)],
  hostDirectives: [
    {
      directive: BrnPopover,
      inputs: [
        'align',
        'attachTo',
        'autoFocus',
        'closeOnOutsidePointerEvents',
        'id',
        'offsetX',
        'role',
        'scrollStrategy',
        'sideOffset',
        'state',
      ],
      outputs: ['stateChanged', 'closed'],
    },
  ],
  host: { 'data-slot': 'popover' },
})
export class HlmPopover {}
