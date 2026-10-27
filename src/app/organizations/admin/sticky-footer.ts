// The sticky footer of a long form on a phone (ux.md, Layout: "a form taller than the screen keeps
// its primary action visible"), shared by the create-league and create-season forms so both look
// and behave alike. Class constants, as button-classes.ts is.
//
// The footer holds the form's submit button. It sticks to the bottom of the viewport until the end
// of the form scrolls past (its containing block is the form), and from 768px (`md`) it is an
// ordinary block again, so the wider layouts are unchanged. A card around the form must clip with
// `overflow-clip`, not `overflow-hidden`: `overflow-hidden` makes the card the sticky element's
// scroll container, and then it never sticks to the viewport.

/**
 * The element around the submit button, a direct child at the end of the form. The form's own
 * padding is `px-4 py-4` below `md`, which the negative margins cancel so the footer reaches the
 * card's edges; `bg-card` hides the fields that scroll behind it. `mt-6` is the gap above it.
 */
export const STICKY_FOOTER =
  'sticky bottom-0 z-10 -mx-4 -mb-4 mt-6 border-t border-border bg-card px-4 py-3 md:static md:mx-0 md:mb-0 md:mt-6 md:border-0 md:bg-transparent md:p-0';

/**
 * Put on the element that holds the form's controls. A control that takes focus scrolls into view
 * only as far as the viewport edge, which would leave it under the sticky footer (WCAG 2.4.11,
 * Focus Not Obscured); a scroll margin the height of the footer plus a gap keeps it clear.
 */
export const STICKY_FOOTER_CLEARANCE =
  '[&_:is(input,button,select,textarea,a)]:scroll-mb-24 md:[&_:is(input,button,select,textarea,a)]:scroll-mb-0';
