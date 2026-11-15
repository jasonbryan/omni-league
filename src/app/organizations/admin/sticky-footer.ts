import { Directive, inject } from '@angular/core';
import { StickyFooterFocus } from './sticky-footer-focus';

// The card around the form must use `overflow-clip`: `overflow-hidden` makes the card the footer's
// scroll container, so the footer never sticks to the viewport.
const STICKY_FOOTER =
  'sticky bottom-0 z-10 -mx-4 -mb-4 mt-6 border-t border-border bg-card px-4 py-3 md:static md:mx-0 md:mb-0 md:mt-6 md:border-0 md:bg-transparent md:p-0';

// A focused control scrolls only to the viewport edge, which would leave it under the footer (WCAG 2.4.11).
export const STICKY_FOOTER_CLEARANCE =
  '[&_:is(input,button,select,textarea,a)]:scroll-mb-24 md:[&_:is(input,button,select,textarea,a)]:scroll-mb-0';

// 120px: the web address status and a refused Create's two-line error sit below `#slug`, and
// together with the 69px footer they need 117px. A class on `#slug` alone loses to the rule above.
export const WEB_ADDRESS_CLEARANCE = '[&_#slug]:scroll-mb-30 md:[&_#slug]:scroll-mb-0';

@Directive({
  selector: '[appStickyFooter]',
  host: { 'data-slot': 'form-footer', class: STICKY_FOOTER },
})
export class StickyFooter {
  constructor() {
    // So no form can have the footer without the focus fix.
    inject(StickyFooterFocus);
  }
}
